import { createFileRoute } from "@tanstack/react-router";
import { drainNotifications } from "@/lib/server/notifications";
import { fail, requireSession, serviceDb } from "@/lib/server/session";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * Staff call this right after confirming or refusing a payment, or moving a
 * repair request, so the tenant hears back in seconds instead of at the
 * nightly run. It drains every pending row, not only this company's: the
 * emails are due anyway and the triggers already scoped who gets what.
 */
export const Route = createFileRoute("/api/fn/send-notifications")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;
        if (!session.isStaff) return json({ error: "forbidden" }, 403);
        try {
          return json(await drainNotifications(serviceDb()));
        } catch (caught) {
          return fail(caught, "send-notifications");
        }
      },
    },
  },
});
