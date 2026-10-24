import { createFileRoute } from "@tanstack/react-router";
import { renderInvoicePdf } from "@/lib/server/invoice-pdf";
import { fail, requireSession } from "@/lib/server/session";
import { signedUrl } from "@/lib/server/storage";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Renders a recibo and returns a signed URL. Any signed-in user: RLS
 *  decides whether they may see the invoice at all. */
export const Route = createFileRoute("/api/fn/generate-invoice-pdf")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;
        const orgId = session.profile.org_id;
        if (!orgId) return json({ error: "no organization" }, 403);

        try {
          const { invoice_id: invoiceId } = (await request.json()) as { invoice_id?: string };
          if (!invoiceId) return json({ error: "invoice_id is required" }, 400);
          const rendered = await renderInvoicePdf(session.db, orgId, invoiceId);
          if (!rendered) return json({ error: "not found" }, 404);
          return json({ url: signedUrl(orgId, "contracts", rendered.path), path: rendered.path });
        } catch (caught) {
          return fail(caught, "generate-invoice-pdf");
        }
      },
    },
  },
});
