/**
 * Server-only. Who is calling, and a database client that acts as them.
 *
 * Clerk proves identity. Postgres decides access, exactly as it did under
 * Supabase: every request reaches PostgREST with a JWT whose `sub` is the
 * caller's profile id and whose `org_id` is their organization, so the RLS
 * policies (and the org isolation added in 20261024001400) apply unchanged.
 * That JWT is minted here, lives 60 seconds, and never reaches the browser.
 */
import { createHmac } from "node:crypto";
import { PostgrestClient } from "@supabase/postgrest-js";
import { auth, clerkClient } from "@clerk/tanstack-react-start/server";
import type { Database, Tables } from "@/lib/database.types";

/** Internal Docker-network address. PostgREST is never exposed publicly. */
export const POSTGREST_URL = process.env["POSTGREST_URL"] ?? "http://127.0.0.1:3001";

const JWT_SECRET = process.env["POSTGREST_JWT_SECRET"] ?? "";

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
  return createHmac("sha256", JWT_SECRET).update(purpose).digest();
}

function clientFor(token: string): Db {
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
    if (new URL(origin).host !== new URL(request.url).host)
      return json({ error: "forbidden" }, 403);
  }

  const { userId } = await auth();
  if (!userId) return json({ error: "unauthenticated" }, 401);

  let entry = cache.get(userId);
  if (!entry || Date.now() - entry.at > TTL_MS) {
    const profile = await findOrLinkProfile(userId);
    const suspended = profile ? !(await organizationIsActive(profile.org_id)) : false;
    entry = { profile, suspended, at: Date.now() };
    cache.set(userId, entry);
  }
  const profile = entry.profile;
  if (!profile) return json({ error: "no_profile" }, 403);
  if (entry.suspended) return json({ error: "organization_suspended" }, 403);

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
