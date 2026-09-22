/**
 * Takes a portal access request from someone with no invite.
 *
 * The second endpoint an anonymous caller can reach, so it plays by the same
 * rules as tenant-self-enroll:
 *
 *   - Identical response body AND timing whatever happens. The reply goes out
 *     before any lookup starts; the work runs after it in
 *     EdgeRuntime.waitUntil. A form that answers faster when the address is
 *     unknown enumerates the landlord's tenants just as well as an error
 *     message would.
 *   - Never echoes anything back about the portfolio — not whether a match
 *     was found, not a unit, not a name.
 *   - Writes nothing but a `pending` row. It cannot grant access, cannot
 *     create a tenant, and cannot send the invite; only a human approving the
 *     row in the staff queue does that.
 *   - Field lengths are capped so the table cannot be used as free storage.
 */
import { corsHeaders, json, serviceClient } from "../_shared/common.ts";

const MAX = { full_name: 120, email: 160, phone: 40, property_hint: 200, unit_hint: 40 } as const;

interface RequestBody {
  full_name?: unknown;
  email?: unknown;
  phone?: unknown;
  property_hint?: unknown;
  unit_hint?: unknown;
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : null;
}

async function record(body: RequestBody) {
  try {
    const fullName = clean(body.full_name, MAX.full_name);
    const email = clean(body.email, MAX.email);
    if (!fullName || !email || !email.includes("@")) return;

    const service = serviceClient();

    // Best effort match, recorded for staff to confirm or override. It is
    // never returned to the caller and never acted on automatically — a
    // wrong match here would hand someone another tenant's lease.
    const { data: match } = await service
      .from("tenants")
      .select("id")
      .ilike("email", email)
      .maybeSingle();

    await service.from("access_requests").insert({
      full_name: fullName,
      email: email.toLowerCase(),
      phone: clean(body.phone, MAX.phone),
      property_hint: clean(body.property_hint, MAX.property_hint),
      unit_hint: clean(body.unit_hint, MAX.unit_hint),
      matched_tenant_id: match?.id ?? null,
      status: "pending",
    });
  } catch (caught) {
    // Logged for us. The caller already has its answer and learns nothing.
    console.error("submit-access-request", caught);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: RequestBody | null = null;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    body = null;
  }

  if (body) {
    // Deliberately not awaited, so the response below cannot be timed.
    const work = record(body);
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } })
      .EdgeRuntime;
    if (runtime?.waitUntil) runtime.waitUntil(work);
    else void work;
  }

  return json({ ok: true });
});
