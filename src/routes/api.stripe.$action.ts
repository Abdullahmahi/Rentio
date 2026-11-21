import { createFileRoute } from "@tanstack/react-router";
import { runAutopay } from "@/lib/server/autopay";
import { siteUrl } from "@/lib/server/email";
import { fail, requireSession, serviceDb } from "@/lib/server/session";
import {
  accountRow,
  connectAccount,
  connectUrl,
  consumeOAuthState,
  disconnectAccount,
  getStripe,
  notConfigured,
  startOAuth,
  stripeConfigured,
  stripeEnv,
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
 *   POST connect     { url }                                  admin, nothing connected yet
 *   GET  callback    ?code&state  → /app/settings?stripe=…    the admin who started it
 *   POST refresh     re-read the account from Stripe          staff
 *   POST disconnect  revoke access, clear the row             admin
 * Owner rule: the money destination stays with the admin, so connecting,
 * replacing (disconnect, then connect) and disconnecting are admin-only.
 * Account id and status are written here only, through the service
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
          if (!session.isAdmin) return backToSettings(request, "error");
          const stripe = getStripe();
          if (!stripe) return notConfigured();
          const url = new URL(request.url);
          const code = url.searchParams.get("code");
          try {
            // Signed by us, naming this org AND this admin, single-use: nobody
            // else can finish (or replay) the flow to pin their own account.
            const service = serviceDb();
            const ok = await consumeOAuthState(
              service,
              url.searchParams.get("state"),
              orgId,
              session.profile.id,
            );
            if (!ok || !code) return backToSettings(request, "error");
            const result = await connectAccount(service, stripe, {
              orgId,
              profileId: session.profile.id,
              code,
            });
            return backToSettings(request, result === "connected" ? "connected" : "already");
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

        // Staff: charge today's enrolled invoices now (issue #10). The nightly
        // job will do this on its own once it calls runAutopay per org.
        if (params.action === "autopay-run") {
          try {
            return json(await runAutopay(orgId, { stripe, db: service }));
          } catch (caught) {
            return fail(caught, "stripe autopay-run");
          }
        }

        try {
          const adminOnly = params.action === "connect" || params.action === "disconnect";
          if (adminOnly && !session.isAdmin) return json({ error: "admin only" }, 403);

          if (params.action === "connect") {
            const { data: existing, error } = await service
              .from("stripe_accounts")
              .select("stripe_account_id")
              .eq("org_id", orgId)
              .maybeSingle();
            if (error) throw error;
            if (existing?.stripe_account_id)
              return json({ error: "already connected: disconnect first" }, 409);
            const state = await startOAuth(service, orgId, session.profile.id);
            return json({ url: connectUrl(state, redirectUri(request)) });
          }

          if (params.action === "disconnect") {
            const result = await disconnectAccount(service, stripe, {
              orgId,
              profileId: session.profile.id,
            });
            if (result === "not_connected") return json({ error: "not connected" }, 404);
            return json({ disconnected: true });
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

          return json({ error: "not found" }, 404);
        } catch (caught) {
          return fail(caught, `stripe ${params.action}`);
        }
      },
    },
  },
});
