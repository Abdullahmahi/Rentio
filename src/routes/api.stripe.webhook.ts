import { createFileRoute } from "@tanstack/react-router";
import { fail, serviceDb } from "@/lib/server/session";
import { getStripe, stripeEnv } from "@/lib/server/stripe";
import { handleStripeEvent } from "@/lib/server/stripe-payments";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * Stripe → us. No session: the signature over the RAW body is the
 * authentication. Register <SITE_URL>/api/stripe/webhook in the Stripe
 * dashboard as a Connect endpoint (events from connected accounts), with
 * payment_intent.succeeded, payment_intent.processing,
 * payment_intent.payment_failed, charge.refunded, charge.dispute.created,
 * account.updated. A 200 for anything we recognised, including duplicates,
 * so Stripe stops retrying; a 500 makes it retry.
 */
export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const stripe = getStripe();
        const secret = stripeEnv().webhookSecret;
        if (!stripe || !secret) return json({ error: "stripe_not_configured" }, 503);

        const signature = request.headers.get("stripe-signature");
        if (!signature) return json({ error: "missing signature" }, 400);
        const body = await request.text();
        let event;
        try {
          event = stripe.webhooks.constructEvent(body, signature, secret);
        } catch (caught) {
          console.warn("stripe webhook signature rejected", caught);
          return json({ error: "invalid signature" }, 400);
        }

        try {
          const outcome = await handleStripeEvent(event, serviceDb());
          console.info("stripe webhook", event.type, event.account, JSON.stringify(outcome));
          return json({ received: true, ...outcome });
        } catch (caught) {
          return fail(caught, `stripe webhook ${event.type}`);
        }
      },
    },
  },
});
