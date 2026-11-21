import { createFileRoute } from "@tanstack/react-router";
import { fail, requireSession } from "@/lib/server/session";
import { getStripe, notConfigured, stripeEnv } from "@/lib/server/stripe";
import { computeCharge, intentMetadata, type OnlineMethod } from "@/lib/server/stripe-payments";
import { connectedAccount, customerFor, openInvoices } from "@/lib/server/stripe-portal";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * The tenant's side of online rent (issue #9). Everything is created ON the
 * company's connected account (direct charges).
 *   POST payment-intent { lease_id, method: 'card'|'ach', invoice_id?, save_method? }
 *        → { clientSecret, publishableKey, stripeAccount, rent, fee, total, feePercent }
 * The amount is computed here from invoice_balances read AS THE TENANT
 * (RLS: own lease, no drafts); nothing in the body is trusted as money. The
 * tenant picks card or bank first so the card fee, when the company charges
 * one, is settled server-side before the PaymentIntent exists.
 */
export const Route = createFileRoute("/api/stripe/portal/$action")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;
        const orgId = session.profile.org_id;
        const tenantId = session.profile.tenant_id;
        if (!orgId || !tenantId) return json({ error: "tenants only" }, 403);
        const stripe = getStripe();
        if (!stripe) return notConfigured();

        try {
          if (params.action !== "payment-intent") return json({ error: "not found" }, 404);
          const body = (await request.json().catch(() => ({}))) as {
            lease_id?: unknown;
            method?: unknown;
            invoice_id?: unknown;
            save_method?: unknown;
          };
          if (typeof body.lease_id !== "string")
            return json({ error: "lease_id is required" }, 400);
          if (body.method !== "card" && body.method !== "ach")
            return json({ error: "method must be card or ach" }, 400);
          const method: OnlineMethod = body.method;

          const account = await connectedAccount(orgId);
          if (!account) return json({ error: "online payments not available" }, 409);

          const open = await openInvoices(session, body.lease_id);
          if (!open) return json({ error: "lease not found" }, 404);
          const chosen =
            typeof body.invoice_id === "string"
              ? open.filter((invoice) => invoice.id === body.invoice_id)
              : open;
          const rent =
            Math.round(chosen.reduce((sum, invoice) => sum + invoice.balance, 0) * 100) / 100;
          if (rent <= 0) return json({ error: "nothing to pay" }, 400);
          const charge = computeCharge(rent, method, account);
          if (charge.totalCents < 50) return json({ error: "amount too small" }, 400);

          const customer = await customerFor(stripe, session, account.stripe_account_id, tenantId);

          const intent = await stripe.paymentIntents.create(
            {
              amount: charge.totalCents,
              currency: "usd",
              customer,
              // Apple Pay / Google Pay come with 'card' in the Payment Element.
              // (API 2026-11-18 renamed payment_method_types to this.)
              allowed_payment_method_types: method === "card" ? ["card"] : ["us_bank_account"],
              ...(method === "ach"
                ? {
                    payment_method_options: {
                      us_bank_account: {
                        verification_method: "automatic",
                        financial_connections: { permissions: ["payment_method"] },
                      },
                    },
                  }
                : {}),
              ...(body.save_method === true ? { setup_future_usage: "off_session" as const } : {}),
              metadata: intentMetadata({
                orgId,
                leaseId: body.lease_id,
                tenantId,
                invoiceIds: chosen.map((invoice) => invoice.id),
                charge,
                method,
              }),
            },
            { stripeAccount: account.stripe_account_id },
          );

          return json({
            clientSecret: intent.client_secret,
            publishableKey: stripeEnv().publishableKey,
            stripeAccount: account.stripe_account_id,
            rent: charge.rentCents / 100,
            fee: charge.feeCents / 100,
            total: charge.totalCents / 100,
            feePercent: charge.feePercent,
          });
        } catch (caught) {
          return fail(caught, `stripe portal ${params.action}`);
        }
      },
    },
  },
});
