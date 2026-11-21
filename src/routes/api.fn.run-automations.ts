import { createFileRoute } from "@tanstack/react-router";
import { runAutomations } from "@/lib/server/automations";
import { fail, requireSession, serviceDb } from "@/lib/server/session";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * "Run now" on the Automations page. Any staff member of the company (admin
 * or manager; a super_admin for the company they are acting in) may press
 * it, never a tenant. It runs ONLY the caller's company: the service client
 * is needed for the SQL pipeline, but every call inside runAutomations is
 * filtered to this org id. Idempotent, the same pipeline the nightly cron
 * runs per company.
 */
export const Route = createFileRoute("/api/fn/run-automations")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;
        // requireSession already swapped a super_admin's org_id for the
        // acting company; none picked = the read-only platform view.
        const orgId = session.profile.org_id;
        if (!session.isStaff || !orgId) return json({ error: "forbidden" }, 403);
        try {
          return json(await runAutomations(serviceDb(), orgId, "manual", session.profile.id));
        } catch (caught) {
          return fail(caught, "run-automations");
        }
      },
    },
  },
});
