/**
 * Server-only. Stripe Connect with STANDARD connected accounts and DIRECT
 * charges: every PaymentIntent, SetupIntent and Customer is created on the
 * company's own account (`stripeAccount` request option), so rent lands in
 * the company's Stripe balance and never passes through Rentio.
 *
 * Nothing here talks to Stripe at import time. With the env vars unset,
 * `getStripe()` is null and routes answer 503 `stripe_not_configured`.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { derivedKey } from "@/lib/server/session";

/** Platform fee on direct charges. Wired, deliberately zero (PRD). */
export const APPLICATION_FEE_CENTS = 0;

export const stripeEnv = () => ({
  secretKey: process.env["STRIPE_SECRET_KEY"] ?? "",
  publishableKey: process.env["STRIPE_PUBLISHABLE_KEY"] ?? "",
  webhookSecret: process.env["STRIPE_WEBHOOK_SECRET"] ?? "",
  connectClientId: process.env["STRIPE_CONNECT_CLIENT_ID"] ?? "",
});

export const stripeConfigured = () => {
  const env = stripeEnv();
  return Boolean(env.secretKey && env.publishableKey && env.connectClientId);
};

let client: Stripe | null = null;
/** One client per process; null until the keys are set. */
export function getStripe(): Stripe | null {
  if (!stripeConfigured()) return null;
  client ??= new Stripe(stripeEnv().secretKey, { typescript: true });
  return client;
}

export const notConfigured = () =>
  Response.json({ error: "stripe_not_configured" }, { status: 503 });

// ------------------------------------------------------------ OAuth state
// Standard accounts connect through OAuth rather than Account Links: most
// landlords who want online rent already HAVE a Stripe account, and OAuth is
// the flow that connects an existing one (Account Links always create a new
// account owned by the platform). The connected account stays the owner's:
// they log in to their own dashboard for refunds, disputes and payouts.

const STATE_TTL_S = 15 * 60;

/** `<base64url payload>.<hmac>`; payload carries org, nonce and expiry. */
export function signState(orgId: string, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({
      org: orgId,
      nonce: randomBytes(12).toString("hex"),
      exp: now + STATE_TTL_S * 1000,
    }),
  ).toString("base64url");
  return `${payload}.${mac(payload)}`;
}

/** The org the state was signed for, or null when forged, expired or malformed. */
export function verifyState(state: string | null | undefined, now = Date.now()): string | null {
  if (!state) return null;
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(mac(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      org?: unknown;
      exp?: unknown;
    };
    if (typeof parsed.org !== "string" || typeof parsed.exp !== "number") return null;
    return parsed.exp > now ? parsed.org : null;
  } catch {
    return null;
  }
}

const mac = (payload: string) =>
  createHmac("sha256", derivedKey("stripe-oauth-state")).update(payload).digest("base64url");

/** Where the admin is sent to authorize. `redirectUri` must be registered in the Stripe dashboard. */
export function connectUrl(state: string, redirectUri: string) {
  const url = new URL("https://connect.stripe.com/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", stripeEnv().connectClientId);
  url.searchParams.set("scope", "read_write");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", redirectUri);
  return url.toString();
}

// --------------------------------------------------------- account status

export type AccountSnapshot = Pick<
  Stripe.Account,
  "id" | "charges_enabled" | "payouts_enabled" | "details_submitted"
>;

/** The stripe_accounts columns a Stripe account object maps to. */
export function accountRow(account: AccountSnapshot) {
  return {
    stripe_account_id: account.id,
    charges_enabled: Boolean(account.charges_enabled),
    payouts_enabled: Boolean(account.payouts_enabled),
    details_submitted: Boolean(account.details_submitted),
    status: account.charges_enabled ? ("ready" as const) : ("pending" as const),
  };
}

export const disconnectedRow = () => ({
  stripe_account_id: null,
  charges_enabled: false,
  payouts_enabled: false,
  details_submitted: false,
  status: "not_connected" as const,
});
