import { createFileRoute } from "@tanstack/react-router";
import { siteUrl } from "@/lib/server/email";
import { fail, requireSession, serviceDb } from "@/lib/server/session";
import {
  accountRow,
  connectUrl,
  disconnectedRow,
  getStripe,
  notConfigured,
  signState,
  stripeConfigured,
  stripeEnv,
  verifyState,
} from "@/lib/server/stripe";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Public https origin when known (behind Coolify the request URL is the container's). */
const origin = (request: Request) => (siteUrl() || new URL(request.url).origin).replace(/\/$/, "");
const redirectUri = (request: Request) => `${origin(request)}/api/stripe/callback`;
const backToSettings = (request: Request, result: string) =>
  Response.redirect(`${origin(request)}/app/settings?stripe=${result}`, 303);

/**
 * Stripe Connect for the company (issue #8). Standard account, OAuth.
 *   GET  account     { configured, publishableKey, account }  any signed-in user
 *   POST connect     { url }                                  staff
 *   GET  callback    ?code&state  → /app/settings?stripe=…    staff (the org that started)
 *   POST refresh     re-read the account from Stripe          staff
 *   POST disconnect  revoke access, clear the row             staff
 * Any staff of the company (admin or manager, owner rule) may do all of
 * this. Account id and status are written here only, through the service
 * connection, always for the caller's own organization.
 */
export const Route = createFileRoute("/api/stripe/$action")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;
        const orgId = session.profile.org_id;
        if (!orgId) return json({ error: "no organization" }, 403);

        if (params.action === "account") {
          // Tenants cannot read stripe_accounts (RLS), yet the portal must
          // know whether "Pay now" exists: hand back the non-secret part.
          const { data, error } = await serviceDb()
            .from("stripe_accounts")
            .select(
              "stripe_account_id, status, charges_enabled, payouts_enabled, details_submitted, card_fee_enabled, card_fee_percent",
            )
            .eq("org_id", orgId)
            .maybeSingle();
          if (error) return fail(error, "stripe account");
          const configured = stripeConfigured();
          return json({
            configured,
            publishableKey: configured ? stripeEnv().publishableKey : null,
            account: session.isStaff ? data : data && { ...data, payouts_enabled: undefined },
          });
        }

        if (params.action === "callback") {
          if (!session.isStaff) return json({ error: "forbidden" }, 403);
          const stripe = getStripe();
          if (!stripe) return notConfigured();
          const url = new URL(request.url);
          // The state is signed with our key and names the org that started
          // the flow; it must be the caller's, or someone could pin their
          // Stripe account onto another company.
          if (verifyState(url.searchParams.get("state")) !== orgId)
            return backToSettings(request, "error");
          const code = url.searchParams.get("code");
          if (!code) return backToSettings(request, "error");
          try {
            const token = await stripe.oauth.token({ grant_type: "authorization_code", code });
            const account = await stripe.accounts.retrieve(token.stripe_user_id!);
            const service = serviceDb();
            const { error } = await service
              .from("stripe_accounts")
              .upsert({ org_id: orgId, ...accountRow(account) }, { onConflict: "org_id" });
            if (error) throw error;
            await service.from("activity_log").insert({
              actor_id: session.profile.id,
              entity_type: "stripe_account",
              action: "connect",
              meta: { stripe_account_id: account.id, status: accountRow(account).status },
              org_id: orgId,
            });
            return backToSettings(request, "connected");
          } catch (caught) {
            console.error("stripe callback", caught);
            return backToSettings(request, "error");
          }
        }

        return json({ error: "not found" }, 404);
      },

      POST: async ({ request, params }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;
        const orgId = session.profile.org_id;
        if (!orgId) return json({ error: "no organization" }, 403);
        if (!session.isStaff) return json({ error: "forbidden" }, 403);
        const stripe = getStripe();
        if (!stripe) return notConfigured();
        const service = serviceDb();

        try {
          if (params.action === "connect") {
            return json({ url: connectUrl(signState(orgId), redirectUri(request)) });
          }

          const { data: row, error } = await service
            .from("stripe_accounts")
            .select("stripe_account_id")
            .eq("org_id", orgId)
            .maybeSingle();
          if (error) throw error;
          if (!row?.stripe_account_id) return json({ error: "not connected" }, 404);

          if (params.action === "refresh") {
            const account = await stripe.accounts.retrieve(row.stripe_account_id);
            const patch = accountRow(account);
            const { error: updateError } = await service
              .from("stripe_accounts")
              .update(patch)
              .eq("org_id", orgId);
            if (updateError) throw updateError;
            return json(patch);
          }

          if (params.action === "disconnect") {
            // Revoking is best-effort: the owner may already have removed us
            // from their dashboard, and the row must clear either way.
            await stripe.oauth
              .deauthorize({
                client_id: stripeEnv().connectClientId,
                stripe_user_id: row.stripe_account_id,
              })
              .catch((caught: unknown) => console.warn("stripe deauthorize", caught));
            const { error: updateError } = await service
              .from("stripe_accounts")
              .update(disconnectedRow())
              .eq("org_id", orgId);
            if (updateError) throw updateError;
            await service.from("activity_log").insert({
              actor_id: session.profile.id,
              entity_type: "stripe_account",
              action: "disconnect",
              meta: { stripe_account_id: row.stripe_account_id },
              org_id: orgId,
            });
            return json({ disconnected: true });
          }

          return json({ error: "not found" }, 404);
        } catch (caught) {
          return fail(caught, `stripe ${params.action}`);
        }
      },
    },
  },
});
