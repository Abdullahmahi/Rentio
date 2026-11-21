import { createFileRoute } from "@tanstack/react-router";
import {
  PREVIEW_COOKIE,
  PREVIEW_TTL_SECONDS,
  canStartPreview,
  fail,
  previewTarget,
  requireSession,
  serviceDb,
  signPreview,
} from "@/lib/server/session";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const secureFlag = () => (process.env["NODE_ENV"] === "production" ? "; Secure" : "");
const clearCookie = () =>
  `${PREVIEW_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag()}`;

/**
 * Starts (POST) or ends (DELETE) a read-only portal preview. Staff of the
 * tenant's own company only; the cookie it sets is checked again on every
 * request by requireSession (src/lib/server/session.ts).
 */
export const Route = createFileRoute("/api/portal-preview")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;
        // A preview cannot start another preview.
        if (session.preview) return json({ error: "forbidden" }, 403);

        try {
          const body = (await request.json().catch(() => ({}))) as { tenant_id?: unknown };
          const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : null;
          if (!tenantId) return json({ error: "tenant_id is required" }, 400);

          // RLS already limits staff to their own company; the explicit org
          // check is the second lock.
          const { data: tenant } = await session.db
            .from("tenants")
            .select("id, org_id, full_name")
            .eq("id", tenantId)
            .maybeSingle();
          if (!canStartPreview(session.profile, tenant)) return json({ error: "forbidden" }, 403);
          const orgId = session.profile.org_id!;

          const claims = { tenantId, orgId, staffId: session.profile.id };
          if (!(await previewTarget(claims))) return json({ error: "no_portal_login" }, 409);

          const { error: logError } = await serviceDb()
            .from("activity_log")
            .insert({
              org_id: orgId,
              actor_id: session.profile.id,
              entity_type: "tenant",
              entity_id: tenantId,
              action: "portal_preview",
              meta: { tenant_name: tenant!.full_name, role: session.profile.role },
            });
          if (logError) return fail(logError, "portal_preview log");

          const cookie = `${PREVIEW_COOKIE}=${signPreview(claims)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${PREVIEW_TTL_SECONDS}${secureFlag()}`;
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "content-type": "application/json", "set-cookie": cookie },
          });
        } catch (caught) {
          return fail(caught, "portal-preview");
        }
      },
      // Clearing needs no session: sign-out calls it after Clerk is gone.
      DELETE: async () =>
        new Response(null, { status: 204, headers: { "set-cookie": clearCookie() } }),
    },
  },
});
