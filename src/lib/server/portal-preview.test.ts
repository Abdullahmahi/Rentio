import { describe, expect, test } from "bun:test";

// The signing key is read when session.ts loads.
process.env["POSTGREST_JWT_SECRET"] ??= "test-secret-that-is-at-least-32-characters";
const {
  PREVIEW_TTL_SECONDS,
  canStartPreview,
  previewAllowed,
  previewAllowsRequest,
  readPreview,
  signPreview,
} = await import("@/lib/server/session");

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const STAFF = "11111111-0000-4000-8000-000000000001";
const OTHER_STAFF = "22222222-0000-4000-8000-000000000002";
const TENANT = "33333333-0000-4000-8000-000000000003";

const claims = { tenantId: TENANT, orgId: ORG_A, staffId: STAFF };

describe("starting a preview", () => {
  test("staff of the tenant's own company may", () => {
    for (const role of ["admin", "manager", "super_admin"] as const)
      expect(canStartPreview({ role, org_id: ORG_A }, { org_id: ORG_A })).toBe(true);
  });

  test("staff of org A cannot preview a tenant of org B", () => {
    expect(canStartPreview({ role: "admin", org_id: ORG_A }, { org_id: ORG_B })).toBe(false);
    expect(canStartPreview({ role: "super_admin", org_id: ORG_A }, { org_id: ORG_B })).toBe(false);
  });

  test("a super_admin in the platform view (no acting company) cannot", () => {
    expect(canStartPreview({ role: "super_admin", org_id: null }, { org_id: ORG_A })).toBe(false);
  });

  test("a tenant cannot, even one in the same company", () => {
    expect(canStartPreview({ role: "tenant", org_id: ORG_A }, { org_id: ORG_A })).toBe(false);
  });

  test("a tenant the caller cannot see cannot be previewed", () => {
    expect(canStartPreview({ role: "admin", org_id: ORG_A }, null)).toBe(false);
  });
});

describe("the preview cookie", () => {
  test("round-trips", () => {
    expect(readPreview(signPreview(claims))).toMatchObject(claims);
  });

  test("a tampered cookie is refused", () => {
    const cookie = signPreview(claims);
    expect(readPreview(cookie.replace(ORG_A, ORG_B))).toBeNull();
    expect(readPreview(cookie.replace(TENANT, OTHER_STAFF))).toBeNull();
    expect(readPreview(`${cookie.slice(0, -2)}xx`)).toBeNull();
    expect(readPreview("garbage")).toBeNull();
    expect(readPreview(null)).toBeNull();
  });

  test("an expired cookie is refused", () => {
    const now = Date.now();
    const cookie = signPreview(claims, now);
    expect(readPreview(cookie, now + (PREVIEW_TTL_SECONDS - 5) * 1000)).not.toBeNull();
    expect(readPreview(cookie, now + (PREVIEW_TTL_SECONDS + 1) * 1000)).toBeNull();
  });
});

describe("using a preview cookie", () => {
  const valid = readPreview(signPreview(claims))!;

  test("works for the staff member who started it, in that company", () => {
    expect(previewAllowed({ id: STAFF, role: "admin", org_id: ORG_A }, valid)).toBe(true);
  });

  test("a tenant cannot use one", () => {
    expect(previewAllowed({ id: STAFF, role: "tenant", org_id: ORG_A }, valid)).toBe(false);
  });

  test("another staff member cannot use it", () => {
    expect(previewAllowed({ id: OTHER_STAFF, role: "admin", org_id: ORG_A }, valid)).toBe(false);
  });

  test("it stops working once a super_admin acts in another company", () => {
    expect(previewAllowed({ id: STAFF, role: "super_admin", org_id: ORG_B }, valid)).toBe(false);
    expect(previewAllowed({ id: STAFF, role: "super_admin", org_id: null }, valid)).toBe(false);
  });
});

describe("writes in preview", () => {
  test("every write is rejected", () => {
    for (const [method, path] of [
      ["POST", "/rest/v1/payments"], // report payment
      ["POST", "/rest/v1/work_orders"], // new maintenance request
      ["PATCH", "/rest/v1/tenants"], // profile edit
      ["PATCH", "/rest/v1/profiles"], // language
      ["DELETE", "/rest/v1/payments"],
      ["PUT", "/rest/v1/payments"],
      ["POST", "/rest/v1/rpc/record_payment"],
      ["POST", "/api/storage/upload"], // receipt and photo uploads
      ["POST", "/api/storage/remove"],
      ["POST", "/api/fn/send-tenant-invite"],
      ["POST", "/api/portal-preview"],
    ] as const)
      expect(previewAllowsRequest(method, path)).toBe(false);
  });

  test("reads still work", () => {
    expect(previewAllowsRequest("GET", "/rest/v1/leases")).toBe(true);
    expect(previewAllowsRequest("HEAD", "/rest/v1/leases")).toBe(true);
    expect(previewAllowsRequest("GET", "/api/me")).toBe(true);
    expect(previewAllowsRequest("POST", "/api/storage/sign")).toBe(true);
    expect(previewAllowsRequest("POST", "/api/fn/generate-invoice-pdf")).toBe(true);
  });
});
