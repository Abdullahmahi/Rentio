import { createFileRoute } from "@tanstack/react-router";
import { ilikeLiteral, serviceDb } from "@/lib/server/session";

/**
 * Takes a portal access request from someone with no invite. One of two
 * things an anonymous caller can reach, so:
 *
 *   - Identical response body AND timing whatever happens: the reply goes
 *     out before any lookup starts. A form that answers faster when the
 *     address is unknown enumerates the landlord's tenants.
 *   - Never echoes anything about the portfolio back.
 *   - Writes nothing but a `pending` row. Only a human approving it in the
 *     staff queue grants access.
 *   - Field lengths are capped so the table cannot be used as free storage.
 */
const MAX = { full_name: 120, email: 160, phone: 40, property_hint: 200, unit_hint: 40 } as const;

type Body = Partial<Record<keyof typeof MAX | "org", unknown>>;

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : null;
}

async function record(body: Body) {
  try {
    const fullName = clean(body.full_name, MAX.full_name);
    const email = clean(body.email, MAX.email);
    if (!fullName || !email || !email.includes("@")) return;

    const service = serviceDb();

    // Which company is being asked. The form can name it by slug; with only
    // one organization on the platform, that one.
    // ponytail: slug or sole org; resolve from the portal hostname once
    // organizations get their own portal domains.
    const slug = clean(body.org, 80);
    const { data: orgs } = slug
      ? await service.from("organizations").select("id").eq("slug", slug)
      : await service.from("organizations").select("id").limit(2);
    if (orgs?.length !== 1) return;
    const orgId = orgs[0]!.id;

    // Best-effort match for staff to confirm. Never returned, never acted on.
    const { data: match } = await service
      .from("tenants")
      .select("id")
      .eq("org_id", orgId)
      .ilike("email", ilikeLiteral(email))
      .limit(1)
      .maybeSingle();

    await service.from("access_requests").insert({
      org_id: orgId,
      full_name: fullName,
      email: email.toLowerCase(),
      phone: clean(body.phone, MAX.phone),
      property_hint: clean(body.property_hint, MAX.property_hint),
      unit_hint: clean(body.unit_hint, MAX.unit_hint),
      matched_tenant_id: match?.id ?? null,
      status: "pending",
    });
  } catch (caught) {
    console.error("submit-access-request", caught);
  }
}

export const Route = createFileRoute("/api/fn/submit-access-request")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as Body | null;
        // Deliberately not awaited, so the response below cannot be timed.
        if (body) void record(body);
        return Response.json({ ok: true });
      },
    },
  },
});
