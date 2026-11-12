import { createFileRoute } from "@tanstack/react-router";
import { ACTING_ORG_COOKIE, requireSession, serviceDb } from "@/lib/server/session";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const secureFlag = () => (process.env["NODE_ENV"] === "production" ? "; Secure" : "");

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

        // Who acted in which company, in the audit log (audit §4.2 #3).
        // session.profile.org_id is the company they were acting in before.
        const logOrg = orgId ?? session.profile.org_id;
        if (logOrg) {
          const { error: logError } = await serviceDb()
            .from("activity_log")
            .insert({
              org_id: logOrg,
              actor_id: session.profile.id,
              entity_type: "organization",
              entity_id: orgId,
              action: orgId ? "act_in_org" : "leave_org",
              meta: { from: session.profile.org_id, to: orgId },
            });
          if (logError) console.error("act_in_org log failed", logError);
        }

        // A session cookie: it dies with the browser, and sign-out clears it
        // (DELETE below), so the next person on this machine never inherits
        // the company a previous super_admin was acting in.
        const cookie = `${ACTING_ORG_COOKIE}=${orgId ?? "all"}; Path=/; HttpOnly; SameSite=Lax${secureFlag()}`;
        return new Response(JSON.stringify({ org_id: orgId }), {
          headers: { "content-type": "application/json", "set-cookie": cookie },
        });
      },
      // Clearing needs no session: sign-out calls it after Clerk is gone.
      DELETE: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "set-cookie": `${ACTING_ORG_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag()}`,
          },
        }),
    },
  },
});
