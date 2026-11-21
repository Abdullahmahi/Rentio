import { createFileRoute } from "@tanstack/react-router";
import { runAutomations } from "@/lib/server/automations";
import { fail, requireSession, serviceDb } from "@/lib/server/session";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * "Run now" on the Automations page. Admins only. The pipeline is the same
 * one the nightly cron runs and is idempotent, so pressing it twice, or
 * pressing it right after the cron, does nothing extra. It runs every
 * active company (the pipeline is global), and answers with the caller's
 * company's counts.
 */
export const Route = createFileRoute("/api/fn/run-automations")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;
        const orgId = session.profile.org_id;
        if (!session.isAdmin || !orgId) return json({ error: "forbidden" }, 403);
        try {
          const summary = await runAutomations(serviceDb(), "manual", session.profile.id);
          return json({ started_at: summary.started_at, ...summary.per_org[orgId] });
        } catch (caught) {
          return fail(caught, "run-automations");
        }
      },
    },
  },
});
