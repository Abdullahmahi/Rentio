import { createFileRoute } from "@tanstack/react-router";
import { NoTenantEmail, sendInvoiceEmail } from "@/lib/server/send-invoice-email";
import { fail, requireSession } from "@/lib/server/session";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Emails a recibo to the tenant with the PDF attached. Staff only. */
export const Route = createFileRoute("/api/fn/send-invoice-email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;
        const orgId = session.profile.org_id;
        if (!session.isStaff || !orgId) return json({ error: "forbidden" }, 403);

        try {
          const { invoice_id: invoiceId } = (await request.json()) as { invoice_id?: string };
          if (!invoiceId) return json({ error: "invoice_id is required" }, 400);
          return json(await sendInvoiceEmail(session.db, orgId, invoiceId));
        } catch (caught) {
          if (caught instanceof NoTenantEmail) return json({ error: caught.message }, 400);
          if (caught instanceof Error && caught.message === "invoice not found")
            return json({ error: "not found" }, 404);
          return fail(caught, "send-invoice-email");
        }
      },
    },
  },
});
