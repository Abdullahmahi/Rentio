/** Emails a recibo to the tenant with the PDF attached. Staff only. */
import {
  corsHeaders, json, userClient, requireStaff, serviceClient,
  sendEmail, emailLayout, formatMoney, formatDate, formatPeriod,
} from "../_shared/common.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { invoice_id: invoiceId } = await request.json();
    if (!invoiceId) return json({ error: "invoice_id is required" }, 400);

    const caller = userClient(request);
    const { isStaff } = await requireStaff(caller);
    if (!isStaff) return json({ error: "forbidden" }, 403);

    const service = serviceClient();
    const { data: invoice, error } = await service.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
    if (error) throw error;
    if (!invoice) return json({ error: "not found" }, 404);

    const [{ data: balance }, { data: details }, { data: settings }, { data: links }] = await Promise.all([
      service.from("invoice_balances").select("*").eq("invoice_id", invoiceId).maybeSingle(),
      service.from("my_lease_details").select("*").eq("lease_id", invoice.lease_id).maybeSingle(),
      service.from("settings").select("*").maybeSingle(),
      service.from("lease_tenants").select("tenant_id").eq("lease_id", invoice.lease_id).eq("role", "primary"),
    ]);

    const { data: tenants } = await service.from("tenants").select("full_name, email")
      .in("id", (links ?? []).map((row: { tenant_id: string }) => row.tenant_id));
    const tenant = tenants?.[0];
    if (!tenant?.email) return json({ error: "tenant has no email address" }, 400);

    // Reuse the same renderer the download button uses, so the attachment and
    // the on-screen PDF can never drift apart.
    const pdfResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-invoice-pdf`, {
      method: "POST",
      headers: {
        Authorization: request.headers.get("Authorization") ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ invoice_id: invoiceId }),
    });
    const pdfResult = await pdfResponse.json();
    if (!pdfResponse.ok) throw new Error(pdfResult?.error ?? "could not render the PDF");

    const fileResponse = await fetch(pdfResult.url);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(await fileResponse.arrayBuffer())));

    const company = settings?.company_name ?? "Rentio";
    const periodLabel = formatPeriod(invoice.period_month);
    const total = Number(invoice.total);
    const due = Math.max(0, total - Number(balance?.paid ?? 0));

    const body = `
      <p>Hola ${tenant.full_name},</p>
      <p>Adjuntamos tu recibo de renta correspondiente a <strong>${periodLabel}</strong> de la unidad
      <strong>${details?.unit_number ?? ""}</strong>.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;font-size:14px">
        <tr><td style="padding:4px 16px 4px 0;color:#6B655C">Folio</td><td style="font-weight:600">${invoice.invoice_number ?? "—"}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#6B655C">Vencimiento</td><td style="font-weight:600">${formatDate(invoice.due_date)}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#6B655C">Total</td><td style="font-weight:600">${formatMoney(total)}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#6B655C">Saldo</td><td style="font-weight:600">${formatMoney(due)}</td></tr>
      </table>
      ${settings?.clabe ? `<p style="color:#6B655C">Puedes pagar por transferencia a la CLABE <strong>${settings.clabe}</strong>
        (${settings.bank_name ?? ""}, ${settings.account_holder ?? ""}) usando <strong>${details?.unit_number ?? ""}</strong> como referencia.</p>` : ""}
      <p>Cuando realices tu pago, repórtalo desde tu portal para que lo confirmemos.</p>`;

    await sendEmail({
      to: tenant.email,
      subject: `Recibo de renta — ${periodLabel} — Unidad ${details?.unit_number ?? ""}`.trim(),
      html: emailLayout(`Recibo de renta — ${periodLabel}`, body, company),
      attachments: [{ filename: `recibo-${invoice.invoice_number ?? invoiceId}.pdf`, content: base64 }],
    });

    await service.from("invoices").update({ status: "enviado" }).eq("id", invoiceId).eq("status", "borrador");
    return json({ sent: true, to: tenant.email });
  } catch (caught) {
    console.error("send-invoice-email", caught);
    return json({ error: caught instanceof Error ? caught.message : "unknown error" }, 500);
  }
});
