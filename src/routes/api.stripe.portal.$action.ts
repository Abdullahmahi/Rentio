import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";
import { fail, requireSession, serviceDb } from "@/lib/server/session";
import { getStripe, notConfigured, stripeEnv } from "@/lib/server/stripe";
import {
  computeCharge,
  intentMetadata,
  openPaymentIntent,
  type OnlineMethod,
} from "@/lib/server/stripe-payments";
import {
  connectedAccount,
  customerFor,
  openInvoices,
  saveEnrollment,
} from "@/lib/server/stripe-portal";

const json = (body: unknown, status = 200) => Response.json(body, { status });

const ACH_OPTIONS = {
  us_bank_account: {
    verification_method: "automatic" as const,
    financial_connections: { permissions: ["payment_method" as const] },
  },
};

/**
 * The tenant's side of online rent (issues #9, #10). Everything is created ON
 * the company's connected account (direct charges).
 *   POST payment-intent  { lease_id, method: 'card'|'ach', invoice_id?, save_method? }
 *        → { clientSecret, publishableKey, stripeAccount, rent, fee, total, feePercent }
 *   POST setup-intent    {}                         → { clientSecret, publishableKey, stripeAccount }
 *   POST autopay-enroll  { lease_id, setup_intent_id } → the enrollment row
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
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const account = await connectedAccount(orgId);
          if (!account) return json({ error: "online payments not available" }, 409);
          const stripeAccount = account.stripe_account_id;

          if (params.action === "payment-intent") {
            if (typeof body["lease_id"] !== "string")
              return json({ error: "lease_id is required" }, 400);
            if (body["method"] !== "card" && body["method"] !== "ach")
              return json({ error: "method must be card or ach" }, 400);
            const method: OnlineMethod = body["method"];

            const open = await openInvoices(session, body["lease_id"]);
            if (!open) return json({ error: "lease not found" }, 404);
            const chosen =
              typeof body["invoice_id"] === "string"
                ? open.filter((invoice) => invoice.id === body["invoice_id"])
                : open;
            const rent =
              Math.round(chosen.reduce((sum, invoice) => sum + invoice.balance, 0) * 100) / 100;
            if (rent <= 0) return json({ error: "nothing to pay" }, 400);
            const charge = computeCharge(rent, method, account);
            if (charge.totalCents < 50) return json({ error: "amount too small" }, 400);

            const customer = await customerFor(stripe, session, stripeAccount, tenantId);
            const invoiceIds = chosen.map((invoice) => invoice.id);
            const result = await openPaymentIntent(serviceDb(), stripe, {
              orgId,
              leaseId: body["lease_id"],
              tenantId,
              stripeAccount,
              invoiceIds,
              method,
              params: {
                amount: charge.totalCents,
                currency: "usd",
                customer,
                // Apple Pay / Google Pay come with 'card' in the Payment Element.
                // (API 2026-11-18 renamed payment_method_types to this.)
                allowed_payment_method_types: method === "card" ? ["card"] : ["us_bank_account"],
                ...(method === "ach" ? { payment_method_options: ACH_OPTIONS } : {}),
                ...(body["save_method"] === true
                  ? { setup_future_usage: "off_session" as const }
                  : {}),
                metadata: intentMetadata({
                  orgId,
                  leaseId: body["lease_id"],
                  tenantId,
                  invoiceIds,
                  charge,
                  method,
                }),
              },
            });
            // A payment for these invoices is already moving (ACH processing,
            // or succeeded and the webhook is on its way): no second charge.
            if ("in_progress" in result)
              return json({ error: "payment_in_progress", status: result.status }, 409);
            const { intent } = result;
            return json({
              clientSecret: intent.client_secret,
              publishableKey: stripeEnv().publishableKey,
              stripeAccount,
              rent: charge.rentCents / 100,
              fee: charge.feeCents / 100,
              total: charge.totalCents / 100,
              feePercent: charge.feePercent,
            });
          }

          if (params.action === "setup-intent") {
            const customer = await customerFor(stripe, session, stripeAccount, tenantId);
            const intent = await stripe.setupIntents.create(
              {
                customer,
                usage: "off_session",
                allowed_payment_method_types: ["card", "us_bank_account"],
                payment_method_options: ACH_OPTIONS,
                metadata: { org_id: orgId, tenant_id: tenantId },
              },
              { stripeAccount },
            );
            return json({
              clientSecret: intent.client_secret,
              publishableKey: stripeEnv().publishableKey,
              stripeAccount,
            });
          }

          if (params.action === "autopay-enroll") {
            if (typeof body["lease_id"] !== "string" || typeof body["setup_intent_id"] !== "string")
              return json({ error: "lease_id and setup_intent_id are required" }, 400);
            // The lease must be one the tenant can see (RLS), and the saved
            // method must belong to THIS tenant's Customer on this account.
            const { data: lease } = await session.db
              .from("leases")
              .select("id")
              .eq("id", body["lease_id"])
              .maybeSingle();
            if (!lease) return json({ error: "lease not found" }, 404);
            const customer = await customerFor(stripe, session, stripeAccount, tenantId);
            const intent = await stripe.setupIntents.retrieve(
              body["setup_intent_id"],
              { expand: ["payment_method"] },
              { stripeAccount },
            );
            const method = intent.payment_method;
            if (
              intent.status !== "succeeded" ||
              !method ||
              typeof method === "string" ||
              (typeof intent.customer === "string" ? intent.customer : intent.customer?.id) !==
                customer
            )
              return json({ error: "payment method not set up" }, 409);

            const row = {
              org_id: orgId,
              tenant_id: tenantId,
              lease_id: lease.id,
              stripe_customer_id: customer,
              payment_method_id: method.id,
              method_type: method.type === "us_bank_account" ? "ach" : "card",
              method_label: methodLabel(method),
              enabled: true,
            };
            const result = await saveEnrollment(serviceDb(), row);
            if (!result) return json({ error: "autopay_managed_by_co_tenant" }, 409);
            return json(result);
          }

          return json({ error: "not found" }, 404);
        } catch (caught) {
          return fail(caught, `stripe portal ${params.action}`);
        }
      },
    },
  },
});

/** "Visa •••• 4242" / "Chase •••• 6789". */
function methodLabel(method: Stripe.PaymentMethod) {
  if (method.card) return `${capitalize(method.card.brand)} •••• ${method.card.last4}`;
  if (method.us_bank_account)
    return `${method.us_bank_account.bank_name ?? "Bank"} •••• ${method.us_bank_account.last4 ?? ""}`.trim();
  return method.type;
}
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
