import { beforeAll, expect, test } from "bun:test";

process.env["POSTGREST_JWT_SECRET"] = "test-secret-at-least-thirty-two-characters-long";

// Never touches Stripe: the module only builds URLs, signs state and maps
// account objects. Keys are set after import to prove import is side-effect free.
const mod = await import("@/lib/server/stripe");
const { emailStaff } = await import("@/lib/server/staff-email");
const { fakeDb } = await import("@/lib/server/testing/fake-db");

beforeAll(() => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_x";
  process.env["STRIPE_PUBLISHABLE_KEY"] = "pk_test_x";
  process.env["STRIPE_CONNECT_CLIENT_ID"] = "ca_test_x";
});

const ORG = "11111111-1111-1111-1111-111111111111";
const ADMIN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

test("state round-trips to the org and user it was signed for", () => {
  const state = mod.signState({ org: ORG, user: ADMIN, nonce: "n1", exp: Date.now() + 1e5 });
  expect(mod.verifyState(state)).toMatchObject({ org: ORG, user: ADMIN, nonce: "n1" });
});

test("state is refused when tampered, expired or malformed", () => {
  const state = mod.signState({ org: ORG, user: ADMIN, nonce: "n1", exp: Date.now() + 15 * 60e3 });
  const [payload, mac] = state.split(".") as [string, string];
  const other = Buffer.from(
    JSON.stringify({
      org: "22222222-2222-2222-2222-222222222222",
      user: ADMIN,
      nonce: "x",
      exp: Date.now() + 1e6,
    }),
  ).toString("base64url");
  expect(mod.verifyState(`${other}.${mac}`)).toBeNull();
  expect(mod.verifyState(`${payload}.${mac.slice(1)}a`)).toBeNull();
  expect(mod.verifyState(state, Date.now() + 16 * 60 * 1000)).toBeNull();
  expect(mod.verifyState("garbage")).toBeNull();
  expect(mod.verifyState(null)).toBeNull();
});

test("OAuth state is single-use and only for the admin who started it", async () => {
  const { db, rows } = fakeDb();
  const state = await mod.startOAuth(db, ORG, ADMIN);
  expect(rows("stripe_oauth_states")).toHaveLength(1);
  // another user of the same company cannot finish it
  expect(await mod.consumeOAuthState(db, state, ORG, "someone-else")).toBe(false);
  // another company cannot either
  expect(await mod.consumeOAuthState(db, state, "other-org", ADMIN)).toBe(false);
  expect(await mod.consumeOAuthState(db, state, ORG, ADMIN)).toBe(true);
  // replay: the nonce is gone
  expect(await mod.consumeOAuthState(db, state, ORG, ADMIN)).toBe(false);
  expect(rows("stripe_oauth_states")).toHaveLength(0);
});

test("an expired nonce row is refused even with a valid signature", async () => {
  const { db, rows } = fakeDb();
  const state = await mod.startOAuth(db, ORG, ADMIN);
  rows("stripe_oauth_states")[0]!["expires_at"] = new Date(Date.now() - 1000).toISOString();
  expect(await mod.consumeOAuthState(db, state, ORG, ADMIN)).toBe(false);
});

// ------------------------------------------------- connect / disconnect
function fakeStripe(accountId = "acct_new") {
  const calls: string[] = [];
  const stripe = {
    oauth: {
      token: async () => (calls.push("token"), { stripe_user_id: accountId }),
      deauthorize: async ({ stripe_user_id }: { stripe_user_id: string }) => (
        calls.push(`deauthorize:${stripe_user_id}`),
        {}
      ),
    },
    accounts: {
      retrieve: async (id: string) => (
        calls.push(`retrieve:${id}`),
        { id, charges_enabled: true, payouts_enabled: true, details_submitted: true }
      ),
    },
  };
  return { stripe: stripe as never, calls };
}

const admins = {
  profiles: [
    { id: ADMIN, org_id: ORG, role: "admin", email: "admin@a.test" },
    { id: "m1", org_id: ORG, role: "manager", email: "manager@a.test" },
  ],
  organizations: [{ id: ORG, name: "Org A" }],
};

test("connect fills an empty slot, logs it", async () => {
  const { db, rows } = fakeDb(admins);
  const { stripe } = fakeStripe();
  const result = await mod.connectAccount(db, stripe, { orgId: ORG, profileId: ADMIN, code: "c" });
  expect(result).toBe("connected");
  expect(rows("stripe_accounts")[0]).toMatchObject({ org_id: ORG, stripe_account_id: "acct_new" });
  expect(rows("activity_log")[0]).toMatchObject({ action: "connect", actor_id: ADMIN });
});

test("connect never overwrites an existing account and never exchanges the code", async () => {
  const { db, rows } = fakeDb({
    ...admins,
    stripe_accounts: [{ org_id: ORG, stripe_account_id: "acct_old", status: "ready" }],
  });
  const { stripe, calls } = fakeStripe("acct_evil");
  const result = await mod.connectAccount(db, stripe, { orgId: ORG, profileId: ADMIN, code: "c" });
  expect(result).toBe("already_connected");
  expect(calls).toEqual([]);
  expect(rows("stripe_accounts")[0]!["stripe_account_id"]).toBe("acct_old");
  expect(rows("activity_log")).toHaveLength(0);
});

test("connect after a disconnect reuses the row", async () => {
  const { db, rows } = fakeDb({
    ...admins,
    stripe_accounts: [{ org_id: ORG, stripe_account_id: null, card_fee_enabled: true }],
  });
  const { stripe } = fakeStripe("acct_2");
  expect(await mod.connectAccount(db, stripe, { orgId: ORG, profileId: ADMIN, code: "c" })).toBe(
    "connected",
  );
  expect(rows("stripe_accounts")[0]).toMatchObject({
    stripe_account_id: "acct_2",
    card_fee_enabled: true,
  });
});

test("disconnect deauthorizes the old account, clears the row and logs it", async () => {
  const { db, rows } = fakeDb({
    ...admins,
    stripe_accounts: [{ org_id: ORG, stripe_account_id: "acct_old", status: "ready" }],
  });
  const { stripe, calls } = fakeStripe();
  expect(await mod.disconnectAccount(db, stripe, { orgId: ORG, profileId: ADMIN })).toBe(
    "disconnected",
  );
  expect(calls).toEqual(["deauthorize:acct_old"]);
  expect(rows("stripe_accounts")[0]).toMatchObject({
    stripe_account_id: null,
    status: "not_connected",
  });
  expect(rows("activity_log")[0]).toMatchObject({
    action: "disconnect",
    meta: { stripe_account_id: "acct_old", deauthorized: true },
  });
});

test("staff email goes to admins only and never throws", async () => {
  const { db } = fakeDb(admins);
  const sent: string[] = [];
  const n = await emailStaff(db, ORG, ["admin"], "t", "<p>b</p>", async (m) => {
    sent.push(m.to);
    return {};
  });
  expect(n).toBe(1);
  expect(sent).toEqual(["admin@a.test"]);
  // no Resend key: logged, not thrown
  expect(await emailStaff(db, ORG, ["admin"], "t", "b")).toBe(0);
});

test("connect URL names the platform client and the signed state", () => {
  const url = new URL(mod.connectUrl("abc.def", "https://rentio.test/api/stripe/callback"));
  expect(url.origin + url.pathname).toBe("https://connect.stripe.com/oauth/authorize");
  expect(url.searchParams.get("client_id")).toBe("ca_test_x");
  expect(url.searchParams.get("state")).toBe("abc.def");
  expect(url.searchParams.get("scope")).toBe("read_write");
  expect(url.searchParams.get("redirect_uri")).toBe("https://rentio.test/api/stripe/callback");
});

test("account status follows charges_enabled", () => {
  const base = { id: "acct_1", payouts_enabled: false, details_submitted: true };
  expect(mod.accountRow({ ...base, charges_enabled: true }).status).toBe("ready");
  expect(mod.accountRow({ ...base, charges_enabled: false }).status).toBe("pending");
  expect(mod.disconnectedRow().status).toBe("not_connected");
  expect(mod.APPLICATION_FEE_CENTS).toBe(0);
});

test("unset keys mean not configured and a 503, never a throw", async () => {
  process.env["STRIPE_SECRET_KEY"] = "";
  expect(mod.stripeConfigured()).toBe(false);
  expect(mod.getStripe()).toBeNull();
  const response = mod.notConfigured();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "stripe_not_configured" });
});
