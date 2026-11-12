import { createFileRoute } from "@tanstack/react-router";
import { formatDate, formatMoney } from "@/lib/format";
import { emailLayout, escapeHtml, formatPeriod, sendEmail } from "@/lib/server/email";
import { renderInvoicePdf } from "@/lib/server/invoice-pdf";
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
        const db = session.db;

        try {
          const { invoice_id: invoiceId } = (await request.json()) as { invoice_id?: string };
          if (!invoiceId) return json({ error: "invoice_id is required" }, 400);

          // The same renderer the download button uses, so the attachment
          // and the on-screen PDF can never drift apart.
          const rendered = await renderInvoicePdf(db, orgId, invoiceId);
          if (!rendered) return json({ error: "not found" }, 404);
          const { invoice } = rendered;

          const [{ data: balance }, { data: details }, { data: settings }, { data: links }] =
            await Promise.all([
              db.from("invoice_balances").select("*").eq("invoice_id", invoiceId).maybeSingle(),
              db
                .from("my_lease_details")
                .select("*")
                .eq("lease_id", invoice.lease_id)
                .maybeSingle(),
              db.from("settings").select("*").maybeSingle(),
              db
                .from("lease_tenants")
                .select("tenant_id")
                .eq("lease_id", invoice.lease_id)
                .eq("role", "primary"),
            ]);

          const { data: tenants } = await db
            .from("tenants")
            .select("full_name, email")
            .in(
              "id",
              (links ?? []).map((row) => row.tenant_id),
            );
          const tenant = tenants?.[0];
          if (!tenant?.email) return json({ error: "tenant has no email address" }, 400);

          // The tenant's portal language; Spanish when they have none yet.
          const { data: profile } = await db
            .from("profiles")
            .select("locale")
            .in(
              "tenant_id",
              (links ?? []).map((row) => row.tenant_id),
            )
            .not("locale", "is", null)
            .limit(1)
            .maybeSingle();
          const es = profile?.locale !== "en";
          const lang = es ? "es-MX" : "en";

          const company = settings?.company_name ?? "Rentio";
          const periodLabel = formatPeriod(invoice.period_month, es ? "es-MX" : "en-US");
          const total = Number(invoice.total);
          const due = Math.max(0, total - Number(balance?.paid ?? 0));
          const unit = escapeHtml(details?.unit_number);
          const name = escapeHtml(tenant.full_name);
          const row = (label: string, value: string) =>
            `<tr><td style="padding:4px 16px 4px 0;color:#6B655C">${label}</td><td style="font-weight:600">${value}</td></tr>`;
          const folio = escapeHtml(invoice.invoice_number ?? "—");

          const body = es
            ? `
            <p>Hola ${name},</p>
            <p>Adjuntamos tu recibo de renta correspondiente a <strong>${periodLabel}</strong> de la unidad
            <strong>${unit}</strong>.</p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;font-size:14px">
              ${row("Folio", folio)}
              ${row("Vencimiento", formatDate(invoice.due_date))}
              ${row("Total", formatMoney(total))}
              ${row("Saldo", formatMoney(due))}
            </table>
            <p style="color:#6B655C">Consulta "Cómo pagar" en tu portal. Incluye <strong>unidad ${unit}</strong> como referencia en cualquier pago.</p>
            <p>Cuando realices tu pago, repórtalo desde tu portal para que lo confirmemos.</p>`
            : `
            <p>Hi ${name},</p>
            <p>Attached is your rent invoice for <strong>${periodLabel}</strong>, unit <strong>${unit}</strong>.</p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;font-size:14px">
              ${row("Invoice", folio)}
              ${row("Due", formatDate(invoice.due_date))}
              ${row("Total", formatMoney(total))}
              ${row("Balance", formatMoney(due))}
            </table>
            <p style="color:#6B655C">See "How to pay" in your portal. Put <strong>unit ${unit}</strong> as the reference on any payment.</p>
            <p>Once you've paid, report it in your portal so we can confirm it.</p>`;

          const title = es ? `Recibo de renta — ${periodLabel}` : `Rent invoice — ${periodLabel}`;
          const unitLabel = `${es ? "Unidad" : "Unit"} ${details?.unit_number ?? ""}`.trim();

          await sendEmail({
            to: tenant.email,
            subject: `${title} — ${unitLabel}`,
            html: emailLayout(title, body, company, lang),
            attachments: [
              {
                filename: `recibo-${invoice.invoice_number ?? invoiceId}.pdf`,
                content: Buffer.from(rendered.bytes).toString("base64"),
              },
            ],
          });

          await db
            .from("invoices")
            .update({ status: "enviado" })
            .eq("id", invoiceId)
            .eq("status", "borrador");
          return json({ sent: true, to: tenant.email });
        } catch (caught) {
          return fail(caught, "send-invoice-email");
        }
      },
    },
  },
});
