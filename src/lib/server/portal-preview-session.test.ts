import { afterAll, describe, expect, mock, test } from "bun:test";

// requireSession end to end, with Clerk and PostgREST stubbed: the cookie
// and header turn a staff request into the tenant's read-only session.
process.env["POSTGREST_JWT_SECRET"] ??= "test-secret-that-is-at-least-32-characters";

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const TENANT = "33333333-0000-4000-8000-000000000003";
let caller = {
  id: "11111111-0000-4000-8000-000000000001",
  clerk_user_id: "user_staff",
  role: "admin",
  org_id: ORG_A as string | null,
  tenant_id: null as string | null,
};
const tenantProfile = {
  id: "44444444-0000-4000-8000-000000000004",
  clerk_user_id: "user_tenant",
  role: "tenant",
  org_id: ORG_A,
  tenant_id: TENANT,
};

let clerkUser = "user_staff";
mock.module("@clerk/tanstack-react-start/server", () => ({
  auth: async () => ({ userId: clerkUser }),
  clerkClient: () => ({ users: { getUser: async () => ({ emailAddresses: [] }) } }),
}));

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = decodeURIComponent(String(input));
  const accept = new Headers(init?.headers).get("accept") ?? "";
  let rows: unknown[] = [];
  if (url.includes("/profiles") && url.includes("clerk_user_id=eq.user_staff")) rows = [caller];
  else if (url.includes("/profiles") && url.includes("clerk_user_id=eq.user_tenant"))
    rows = [tenantProfile];
  else if (url.includes("/organizations")) rows = [{ status: "active" }];
  else if (url.includes("/profiles") && url.includes(`tenant_id=eq.${TENANT}`))
    rows = url.includes(`org_id=eq.${ORG_A}`) ? [tenantProfile] : [];
  else if (url.includes("/tenants") && url.includes(`id=eq.${TENANT}`))
    rows = url.includes(`org_id=eq.${ORG_A}`) ? [{ full_name: "Ana Tenant" }] : [];
  const body = accept.includes("vnd.pgrst.object") ? (rows[0] ?? null) : rows;
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { PREVIEW_COOKIE, PREVIEW_HEADER, forgetProfile, requireSession, signPreview } =
  await import("@/lib/server/session");

function request(method: string, path: string, cookie: string | null, header = true) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (header) headers.set(PREVIEW_HEADER, "1");
  return new Request(`http://app.test${path}`, { method, headers });
}

const previewCookie = (orgId = ORG_A, staffId = caller.id) =>
  `${PREVIEW_COOKIE}=${signPreview({ tenantId: TENANT, orgId, staffId })}`;

describe("requireSession in portal preview", () => {
  test("a portal read gets the tenant's session, not staff", async () => {
    const session = await requireSession(request("GET", "/rest/v1/leases", previewCookie()));
    if (session instanceof Response) throw new Error(`got ${session.status}`);
    expect(session.profile.id).toBe(tenantProfile.id);
    expect(session.isStaff).toBe(false);
    expect(session.preview?.tenantName).toBe("Ana Tenant");
  });

  test("writes in preview are rejected", async () => {
    for (const [method, path] of [
      ["POST", "/rest/v1/payments"],
      ["PATCH", "/rest/v1/tenants"],
      ["POST", "/api/storage/upload"],
    ]) {
      const session = await requireSession(request(method!, path!, previewCookie()));
      expect(session).toBeInstanceOf(Response);
      expect(((await (session as Response).json()) as { error: string }).error).toBe(
        "preview_read_only",
      );
    }
  });

  test("without the portal header the staff session is untouched", async () => {
    const session = await requireSession(
      request("POST", "/rest/v1/payments", previewCookie(), false),
    );
    if (session instanceof Response) throw new Error(`got ${session.status}`);
    expect(session.profile.id).toBe(caller.id);
    expect(session.preview).toBeUndefined();
  });

  test("a cookie for org B gives staff of org A nothing", async () => {
    const session = await requireSession(request("GET", "/rest/v1/leases", previewCookie(ORG_B)));
    if (session instanceof Response) throw new Error(`got ${session.status}`);
    expect(session.profile.id).toBe(caller.id);
    expect(session.preview).toBeUndefined();
  });

  test("a tenant cannot use a preview cookie", async () => {
    clerkUser = "user_tenant";
    const cookie = previewCookie(ORG_A, tenantProfile.id);
    const session = await requireSession(request("GET", "/rest/v1/leases", cookie));
    if (session instanceof Response) throw new Error(`got ${session.status}`);
    expect(session.profile.id).toBe(tenantProfile.id);
    expect(session.preview).toBeUndefined();
    clerkUser = "user_staff";
  });

  test("staff whose role changed lose the preview", async () => {
    caller = { ...caller, role: "tenant" };
    forgetProfile("user_staff");
    const session = await requireSession(request("GET", "/rest/v1/leases", previewCookie()));
    if (session instanceof Response) throw new Error(`got ${session.status}`);
    expect(session.preview).toBeUndefined();
  });
});
