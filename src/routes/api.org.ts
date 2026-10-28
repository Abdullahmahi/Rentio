import { createFileRoute } from "@tanstack/react-router";
import { ACTING_ORG_COOKIE, requireSession } from "@/lib/server/session";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lets a super_admin pick the company they act in. `org_id: null` goes back
 *  to the platform view. The cookie is HttpOnly: the browser never reads it,
 *  the session does (src/lib/server/session.ts). */
export const Route = createFileRoute("/api/org")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;
        if (session.profile.role !== "super_admin") return json({ error: "forbidden" }, 403);

        const body = (await request.json().catch(() => ({}))) as { org_id?: unknown };
        const orgId =
          typeof body.org_id === "string" && UUID.test(body.org_id) ? body.org_id : null;
        if (body.org_id && !orgId) return json({ error: "invalid org_id" }, 400);

        const secure = process.env["NODE_ENV"] === "production" ? "; Secure" : "";
        const cookie = orgId
          ? `${ACTING_ORG_COOKIE}=${orgId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`
          : `${ACTING_ORG_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
        return new Response(JSON.stringify({ org_id: orgId }), {
          headers: { "content-type": "application/json", "set-cookie": cookie },
        });
      },
    },
  },
});
