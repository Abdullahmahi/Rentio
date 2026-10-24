import { createFileRoute } from "@tanstack/react-router";
import { invite } from "@/lib/server/invite";
import { fail, requireSession } from "@/lib/server/session";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Invites a tenant to the portal. Staff only. */
export const Route = createFileRoute("/api/fn/send-tenant-invite")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;
        if (!session.isStaff) return json({ error: "forbidden" }, 403);

        try {
          const body = (await request.json()) as {
            tenant_id?: string;
            email?: string;
            full_name?: string;
          };
          if (!body.tenant_id || !body.email)
            return json({ error: "tenant_id and email are required" }, 400);

          // The tenant must be one this caller can see, i.e. in their org.
          const { data: tenant } = await session.db
            .from("tenants")
            .select("id")
            .eq("id", body.tenant_id)
            .maybeSingle();
          if (!tenant) return json({ error: "not found" }, 404);

          return json(
            await invite(session, {
              email: body.email,
              fullName: body.full_name ?? null,
              role: "tenant",
              tenantId: tenant.id,
            }),
          );
        } catch (caught) {
          return fail(caught, "send-tenant-invite");
        }
      },
    },
  },
});
