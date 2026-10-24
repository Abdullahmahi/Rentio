import { createFileRoute } from "@tanstack/react-router";
import { invite } from "@/lib/server/invite";
import { fail, requireSession } from "@/lib/server/session";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Invites an admin or property manager. Admin only. */
export const Route = createFileRoute("/api/fn/send-staff-invite")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;
        if (!session.isAdmin || !session.profile.org_id) return json({ error: "forbidden" }, 403);

        try {
          const body = (await request.json()) as {
            email?: string;
            full_name?: string;
            role?: string;
          };
          if (!body.email || !body.role) return json({ error: "email and role are required" }, 400);
          if (body.role !== "admin" && body.role !== "manager")
            return json({ error: "invalid role" }, 400);
          return json(
            await invite(session, {
              email: body.email,
              fullName: body.full_name ?? null,
              role: body.role,
              tenantId: null,
            }),
          );
        } catch (caught) {
          return fail(caught, "send-staff-invite");
        }
      },
    },
  },
});
