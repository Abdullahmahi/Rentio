/**
 * Server-only. Who is calling, and a database client that acts as them.
 *
 * Clerk proves identity. Postgres decides access, exactly as it did under
 * Supabase: every request reaches PostgREST with a JWT whose `sub` is the
 * caller's profile id and whose `org_id` is their organization, so the RLS
 * policies (and the org isolation added in 20261024001400) apply unchanged.
 * That JWT is minted here, lives 60 seconds, and never reaches the browser.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { PostgrestClient } from "@supabase/postgrest-js";
import { auth, clerkClient } from "@clerk/tanstack-react-start/server";
import type { Database, Tables } from "@/lib/database.types";

/** Internal Docker-network address. PostgREST is never exposed publicly. */
export const POSTGREST_URL = process.env["POSTGREST_URL"] ?? "http://127.0.0.1:3001";

const JWT_SECRET = process.env["POSTGREST_JWT_SECRET"] ?? "";

/** Which company a super_admin is acting in. Set by /api/org. */
export const ACTING_ORG_COOKIE = "rentio_org";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The company a super_admin acts in: the cookie's uuid, or nothing (the
 * read-only platform view). Acting is always an explicit pick in the org
 * switcher. It used to default to the only company, which meant the day a
 * second company was created every super_admin silently fell into the
 * platform view and their writes started failing.
 */
function actingOrgFor(request: Request) {
  const cookie = readCookie(request, ACTING_ORG_COOKIE);
  return cookie && UUID.test(cookie) ? cookie : null;
}

function readCookie(request: Request, name: string) {
  const match = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

export type Db = PostgrestClient<Database>;
export type Profile = Tables<"profiles">;

export interface Session {
  profile: Profile;
  /** Acts as the caller. RLS applies. Read through this one. */
  db: Db;
  /** The bearer token behind `db`, for the PostgREST proxy. */
  token: string;
  isStaff: boolean;
  isAdmin: boolean;
  /** Set while staff view the portal as a tenant: `profile`, `db` and
   *  `token` are then the tenant's, and only reads get this far. */
  preview?: { tenantId: string; tenantName: string; staffId: string };
}

/** HS256, the one algorithm PostgREST and node:crypto share without a library. */
export function signJwt(claims: Record<string, unknown>, ttlSeconds = 60) {
  if (JWT_SECRET.length < 32)
    throw new Error("POSTGREST_JWT_SECRET must be at least 32 characters");
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ ...claims, iat: now, exp: now + ttlSeconds })}`;
  return `${unsigned}.${createHmac("sha256", JWT_SECRET).update(unsigned).digest("base64url")}`;
}

/** Same key, separate purpose, so a storage signature can never pass as a JWT. */
export function derivedKey(purpose: string) {
  if (JWT_SECRET.length < 32)
    throw new Error("POSTGREST_JWT_SECRET must be at least 32 characters");
  return createHmac("sha256", JWT_SECRET).update(purpose).digest();
}

export function clientFor(token: string): Db {
  return new PostgrestClient<Database>(POSTGREST_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Bypasses RLS. Only for writes the caller legitimately cannot make
 *  itself: linking a login to its profile, recording an anonymous request. */
export function serviceDb(): Db {
  return clientFor(signJwt({ role: "service_role" }));
}

/** `ilike` treats % and _ as wildcards; an email address is a literal. */
export function ilikeLiteral(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

// ponytail: per-process 60s cache (spec §4.1). A role change or suspension
// takes up to a minute to bite; move to a shared cache only if that matters.
const cache = new Map<string, { profile: Profile | null; suspended: boolean; at: number }>();
const TTL_MS = 60_000;

/**
 * The profile behind a Clerk login. The first time someone signs in, their
 * profile is linked by an address Clerk has already verified:
 *
 *   1. a profile staff invited, or one carried over from Supabase, or
 *   2. exactly one tenant with that email who is named on a lease, which
 *      gets a tenant profile (what the tenant-self-enroll function did).
 *
 * Neither path can grant staff access: invited roles were chosen by an
 * admin, and the self-enrol role is hard-coded.
 */
async function findOrLinkProfile(clerkUserId: string): Promise<Profile | null> {
  const service = serviceDb();
  const linked = await service
    .from("profiles")
    .select("*")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  if (linked.error) throw linked.error;
  if (linked.data) return linked.data;

  const user = await clerkClient().users.getUser(clerkUserId);
  const emails = user.emailAddresses
    .filter((address) => address.verification?.status === "verified")
    .map((address) => address.emailAddress.toLowerCase());

  for (const email of emails) {
    const invited = await service
      .from("profiles")
      .select("*")
      .ilike("email", ilikeLiteral(email))
      .is("clerk_user_id", null)
      .maybeSingle();
    if (invited.data) {
      const { data, error } = await service
        .from("profiles")
        .update({ clerk_user_id: clerkUserId })
        .eq("id", invited.data.id)
        .is("clerk_user_id", null)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (data) return data;
    }

    const { data: tenants } = await service
      .from("tenants")
      .select("id, full_name, org_id, lease_tenants!inner(lease_id)")
      .ilike("email", ilikeLiteral(email));
    const distinct = [...new Map((tenants ?? []).map((row) => [row.id, row])).values()];
    // tenants.email is not unique (B-007). Two matches is ambiguous; staff
    // can still invite the right one by hand.
    if (distinct.length !== 1) continue;
    const tenant = distinct[0]!;

    const { count } = await service
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id);
    if (count) continue; // already claimed by another login

    const { data, error } = await service
      .from("profiles")
      .insert({
        clerk_user_id: clerkUserId,
        email,
        full_name: tenant.full_name,
        role: "tenant", // never from the request
        tenant_id: tenant.id,
        org_id: tenant.org_id,
      })
      .select("*")
      .single();
    if (!error) return data;
    // Lost a race with a parallel first request: that one linked it.
    const retry = await service
      .from("profiles")
      .select("*")
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle();
    return retry.data ?? null;
  }
  return null;
}

async function organizationIsActive(orgId: string | null) {
  if (!orgId) return true; // super_admin
  const { data } = await serviceDb()
    .from("organizations")
    .select("status")
    .eq("id", orgId)
    .maybeSingle();
  return data?.status === "active";
}

const json = (body: unknown, status: number) => Response.json(body, { status });

/**
 * The caller's session, or the Response to send instead.
 *
 *   const session = await requireSession(request);
 *   if (session instanceof Response) return session;
 */
export async function requireSession(request: Request): Promise<Session | Response> {
  // The Clerk cookie is SameSite=Lax, and the app's own calls send a bearer
  // token; refuse a cross-site write either way.
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && request.method !== "HEAD" && origin) {
    let sameOrigin = false;
    try {
      sameOrigin = new URL(origin).host === new URL(request.url).host;
    } catch {
      sameOrigin = false; // "null" and other non-URL origins
    }
    if (!sameOrigin) return json({ error: "forbidden" }, 403);
  }

  const { userId } = await auth();
  if (!userId) return json({ error: "unauthenticated" }, 401);

  let entry = cache.get(userId);
  if (!entry || Date.now() - entry.at > TTL_MS) {
    const profile = await findOrLinkProfile(userId);
    const suspended = profile ? !(await organizationIsActive(profile.org_id)) : false;
    entry = { profile, suspended, at: Date.now() };
    // A login that has no profile yet (signed up before being invited) is
    // retried on every request rather than remembered for a minute.
    if (profile) cache.set(userId, entry);
  }
  if (!entry.profile) return json({ error: "no_profile" }, 403);
  if (entry.suspended) return json({ error: "organization_suspended" }, 403);

  // A super_admin has no company of their own. With one picked (cookie from
  // /api/org) they act exactly like that company's admin; with none picked
  // they keep the read-everything platform view and can write nothing.
  const acting = entry.profile.role === "super_admin" ? actingOrgFor(request) : null;
  const profile = acting ? { ...entry.profile, org_id: acting } : entry.profile;

  // Portal preview: only for requests the portal itself makes (header) and
  // only with a cookie this server signed for this very staff member in the
  // company they are in now. Anything else falls through to their own session.
  const claims =
    request.headers.get(PREVIEW_HEADER) === "1"
      ? readPreview(readCookie(request, PREVIEW_COOKIE))
      : null;
  if (claims && previewAllowed(profile, claims)) {
    if (!previewAllowsRequest(request.method, new URL(request.url).pathname))
      return json({ error: "preview_read_only" }, 403);
    const target = await previewTarget(claims);
    if (!target) return json({ error: "preview_unavailable" }, 403);
    const tenantToken = signJwt({
      role: "authenticated",
      sub: target.profile.id,
      org_id: target.profile.org_id,
    });
    return {
      profile: target.profile,
      db: clientFor(tenantToken),
      token: tenantToken,
      isStaff: false,
      isAdmin: false,
      preview: { tenantId: claims.tenantId, tenantName: target.tenantName, staffId: profile.id },
    };
  }

  const token = signJwt({ role: "authenticated", sub: profile.id, org_id: profile.org_id });
  return {
    profile,
    db: clientFor(token),
    token,
    isStaff: ["admin", "manager", "super_admin"].includes(profile.role),
    isAdmin: ["admin", "super_admin"].includes(profile.role),
  };
}

/** Forget a login's cached profile, after its row changes. */
export function forgetProfile(clerkUserId: string | null | undefined) {
  if (clerkUserId) cache.delete(clerkUserId);
}

// ------------------------------------------------------------ portal preview
//
// Staff see the portal exactly as one of their tenants does, read-only. The
// browser holds only an HttpOnly cookie this server signed: tenant, company,
// staff member, expiry. Every request re-checks it against the live session,
// and the tenant's JWT is minted here and never leaves the server.

export const PREVIEW_COOKIE = "rentio_preview";
/** The portal sends this on its own requests; /app never does, so a preview
 *  in one tab never changes what the staff app sees in another. */
export const PREVIEW_HEADER = "x-rentio-preview";
export const PREVIEW_TTL_SECONDS = 30 * 60;

const STAFF_ROLES: string[] = ["admin", "manager", "super_admin"];

export interface PreviewClaims {
  tenantId: string;
  orgId: string;
  staffId: string;
  exp: number;
}

function previewSignature(payload: string) {
  return createHmac("sha256", derivedKey("portal-preview")).update(payload).digest("base64url");
}

export function signPreview(claims: Omit<PreviewClaims, "exp">, now = Date.now()) {
  const exp = Math.floor(now / 1000) + PREVIEW_TTL_SECONDS;
  const payload = [claims.tenantId, claims.orgId, claims.staffId, exp].join(".");
  return `${payload}.${previewSignature(payload)}`;
}

/** The claims of an untampered, unexpired cookie; null for anything else. */
export function readPreview(value: string | null, now = Date.now()): PreviewClaims | null {
  const parts = value?.split(".") ?? [];
  if (parts.length !== 5) return null;
  const [tenantId, orgId, staffId, expText, signature] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  const expected = Buffer.from(previewSignature(parts.slice(0, 4).join(".")));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const exp = Number(expText);
  if (!Number.isInteger(exp) || exp * 1000 <= now) return null;
  if (![tenantId, orgId, staffId].every((id) => UUID.test(id))) return null;
  return { tenantId, orgId, staffId, exp };
}

/** May this caller start a preview of this tenant? Staff of the tenant's own
 *  company only; a super_admin counts for the company they are acting in
 *  (their session profile.org_id is that company, or null in the platform view). */
export function canStartPreview(
  caller: Pick<Profile, "role" | "org_id">,
  tenant: { org_id: string } | null,
) {
  return (
    STAFF_ROLES.includes(caller.role) &&
    caller.org_id !== null &&
    tenant !== null &&
    tenant.org_id === caller.org_id
  );
}

/** Does a valid cookie still belong to the caller of this request? */
export function previewAllowed(
  caller: Pick<Profile, "id" | "role" | "org_id">,
  claims: PreviewClaims,
) {
  return (
    STAFF_ROLES.includes(caller.role) &&
    claims.staffId === caller.id &&
    caller.org_id !== null &&
    claims.orgId === caller.org_id
  );
}

/** The portal's only POSTs that read: signing file links and rendering a
 *  recibo the tenant could already download. Anything else that is not a
 *  GET is a write and is refused in preview. PostgREST itself runs GET and
 *  HEAD in read-only transactions. */
const PREVIEW_READ_POSTS = new Set(["/api/storage/sign", "/api/fn/generate-invoice-pdf"]);

export function previewAllowsRequest(method: string, pathname: string) {
  if (method === "GET" || method === "HEAD") return true;
  return method === "POST" && PREVIEW_READ_POSTS.has(pathname);
}

/** The tenant's own portal login, in the cookie's company. A tenant who was
 *  never invited has no profile, and RLS would show them nothing. */
export async function previewTarget(claims: Pick<PreviewClaims, "tenantId" | "orgId">) {
  const service = serviceDb();
  const [{ data: tenantProfile }, { data: tenant }] = await Promise.all([
    service
      .from("profiles")
      .select("*")
      .eq("tenant_id", claims.tenantId)
      .eq("org_id", claims.orgId)
      .eq("role", "tenant")
      .limit(1)
      .maybeSingle(),
    service
      .from("tenants")
      .select("full_name")
      .eq("id", claims.tenantId)
      .eq("org_id", claims.orgId)
      .maybeSingle(),
  ]);
  if (!tenantProfile || !tenant) return null;
  return { profile: tenantProfile, tenantName: tenant.full_name };
}

/** Error body every route returns, so the client can show one message. */
export function fail(caught: unknown, label: string) {
  console.error(label, caught);
  const message =
    caught instanceof Error
      ? caught.message
      : typeof caught === "object" && caught && "message" in caught
        ? String((caught as { message: unknown }).message)
        : "unknown error";
  return json({ error: message }, 500);
}
