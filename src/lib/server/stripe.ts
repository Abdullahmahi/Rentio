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
import { escapeHtml } from "@/lib/server/email";
import { derivedKey, type Db } from "@/lib/server/session";
import { emailStaff } from "@/lib/server/staff-email";

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

export interface OAuthState {
  org: string;
  user: string;
  nonce: string;
  exp: number;
}

/** `<base64url payload>.<hmac>`; payload carries org, user, nonce and expiry. */
export function signState(state: OAuthState) {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${payload}.${mac(payload)}`;
}

/** The signed payload, or null when forged, expired or malformed. */
export function verifyState(state: string | null | undefined, now = Date.now()): OAuthState | null {
  if (!state) return null;
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(mac(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as Partial<OAuthState>;
    if (
      typeof parsed.org !== "string" ||
      typeof parsed.user !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.exp !== "number"
    )
      return null;
    return parsed.exp > now ? (parsed as OAuthState) : null;
  } catch {
    return null;
  }
}

/** Stores a fresh nonce for this admin and returns the signed state for the authorize URL. */
export async function startOAuth(db: Db, orgId: string, profileId: string, now = Date.now()) {
  const state = {
    org: orgId,
    user: profileId,
    nonce: randomBytes(16).toString("hex"),
    exp: now + STATE_TTL_S * 1000,
  };
  const { error } = await db.from("stripe_oauth_states").insert({
    nonce: state.nonce,
    org_id: orgId,
    profile_id: profileId,
    expires_at: new Date(state.exp).toISOString(),
  });
  if (error) throw error;
  return signState(state);
}

/**
 * True once, for the admin who started the flow, in their own org: the
 * signature must hold, the payload must name this org AND this user, and the
 * nonce row must still exist; it is deleted here, so a replay finds nothing.
 */
export async function consumeOAuthState(
  db: Db,
  state: string | null | undefined,
  orgId: string,
  profileId: string,
  now = Date.now(),
) {
  const parsed = verifyState(state, now);
  if (!parsed || parsed.org !== orgId || parsed.user !== profileId) return false;
  const { data, error } = await db
    .from("stripe_oauth_states")
    .delete()
    .eq("nonce", parsed.nonce)
    .eq("org_id", orgId)
    .eq("profile_id", profileId)
    .select("expires_at");
  if (error) throw error;
  const row = data?.[0];
  return Boolean(row && new Date(row.expires_at).getTime() > now);
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

// ------------------------------------------------- connect and disconnect
// Owner rule: where the rent goes is the admin's call. Routes allow these to
// admins only; here an existing account is never overwritten (Disconnect
// first, which deauthorizes it), and every change is logged and emailed to
// the company's admins.

type StripeConnect = Pick<Stripe, "oauth" | "accounts">;

export async function connectAccount(
  db: Db,
  stripe: StripeConnect,
  input: { orgId: string; profileId: string; code: string },
): Promise<"connected" | "already_connected"> {
  const { data: existing, error: readError } = await db
    .from("stripe_accounts")
    .select("stripe_account_id")
    .eq("org_id", input.orgId)
    .maybeSingle();
  if (readError) throw readError;
  // Checked before the code is exchanged, so a refused attempt never
  // authorizes a second account.
  if (existing?.stripe_account_id) return "already_connected";

  const token = await stripe.oauth.token({ grant_type: "authorization_code", code: input.code });
  const account = await stripe.accounts.retrieve(token.stripe_user_id!);
  const row = accountRow(account);
  if (existing) {
    // Only over an empty slot: a concurrent connect that won keeps its account.
    const { data, error } = await db
      .from("stripe_accounts")
      .update(row)
      .eq("org_id", input.orgId)
      .is("stripe_account_id", null)
      .select("org_id");
    if (error) throw error;
    // ponytail: the losing account stays authorized but unused; an admin can revoke it in Stripe.
    if (!data?.length) return "already_connected";
  } else {
    const { error } = await db.from("stripe_accounts").insert({ org_id: input.orgId, ...row });
    if (error?.code === "23505") return "already_connected";
    if (error) throw error;
  }

  await logAndTell(db, input, "connect", { stripe_account_id: account.id, status: row.status });
  return "connected";
}

export async function disconnectAccount(
  db: Db,
  stripe: StripeConnect,
  input: { orgId: string; profileId: string },
): Promise<"disconnected" | "not_connected"> {
  const { data: row, error } = await db
    .from("stripe_accounts")
    .select("stripe_account_id")
    .eq("org_id", input.orgId)
    .maybeSingle();
  if (error) throw error;
  if (!row?.stripe_account_id) return "not_connected";

  // Revoking is best-effort: the owner may already have removed us from
  // their dashboard, and the row must clear either way.
  const deauthorized = await stripe.oauth
    .deauthorize({ client_id: stripeEnv().connectClientId, stripe_user_id: row.stripe_account_id })
    .then(() => true)
    .catch((caught: unknown) => (console.warn("stripe deauthorize", caught), false));
  const { error: updateError } = await db
    .from("stripe_accounts")
    .update(disconnectedRow())
    .eq("org_id", input.orgId);
  if (updateError) throw updateError;

  await logAndTell(db, input, "disconnect", {
    stripe_account_id: row.stripe_account_id,
    deauthorized,
  });
  return "disconnected";
}

async function logAndTell(
  db: Db,
  input: { orgId: string; profileId: string },
  action: "connect" | "disconnect",
  meta: { stripe_account_id: string; status?: string; deauthorized?: boolean },
) {
  const { error } = await db.from("activity_log").insert({
    actor_id: input.profileId,
    entity_type: "stripe_account",
    action,
    meta,
    org_id: input.orgId,
  });
  if (error) throw error;
  const id = escapeHtml(meta.stripe_account_id);
  await emailStaff(
    db,
    input.orgId,
    ["admin"],
    action === "connect"
      ? "A Stripe account was connected to Rentio"
      : "Your Stripe account was disconnected from Rentio",
    action === "connect"
      ? `<p>Online rent now goes to Stripe account <strong>${id}</strong>.</p><p>If you did not expect this, disconnect it in Rentio, Settings, and review your company's admins.</p>`
      : `<p>Stripe account <strong>${id}</strong> was disconnected. Tenants cannot pay online until an admin connects an account again.</p>`,
  );
}
