import { beforeAll, expect, test } from "bun:test";

process.env["POSTGREST_JWT_SECRET"] = "test-secret-at-least-thirty-two-characters-long";

// Never touches Stripe: the module only builds URLs, signs state and maps
// account objects. Keys are set after import to prove import is side-effect free.
const mod = await import("@/lib/server/stripe");

beforeAll(() => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_x";
  process.env["STRIPE_PUBLISHABLE_KEY"] = "pk_test_x";
  process.env["STRIPE_CONNECT_CLIENT_ID"] = "ca_test_x";
});

test("state round-trips to the org it was signed for", () => {
  const state = mod.signState("11111111-1111-1111-1111-111111111111");
  expect(mod.verifyState(state)).toBe("11111111-1111-1111-1111-111111111111");
});

test("state is refused when tampered, expired or malformed", () => {
  const state = mod.signState("11111111-1111-1111-1111-111111111111");
  const [payload, mac] = state.split(".") as [string, string];
  const other = Buffer.from(
    JSON.stringify({
      org: "22222222-2222-2222-2222-222222222222",
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
