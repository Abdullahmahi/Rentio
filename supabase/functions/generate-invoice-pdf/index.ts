/**
 * Renders a recibo de renta as a PDF and returns a signed URL.
 *
 * The invoice is READ through the caller's own client, so row level security
 * decides whether they may see it — a tenant can only ever generate their own
 * receipt. Only the upload uses the service role.
 */
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import {
  corsHeaders, json, userClient, serviceClient,
  formatMXN, formatDate, formatPeriod,
} from "../_shared/common.ts";

const INK = rgb(0.11, 0.10, 0.09);
const MUTED = rgb(0.42, 0.40, 0.36);
const BRAND = rgb(0.106, 0.302, 0.243); // #1B4D3E
const LINE = rgb(0.906, 0.890, 0.867);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { invoice_id: invoiceId } = await request.json();
    if (!invoiceId) return json({ error: "invoice_id is required" }, 400);

    const caller = userClient(request);

    const { data: invoice, error } = await caller.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
    if (error) throw error;
    if (!invoice) return json({ error: "not found" }, 404);

    const [{ data: lines }, { data: balance }, { data: details }, { data: settings }] = await Promise.all([
      caller.from("invoice_lines").select("*").eq("invoice_id", invoiceId).order("created_at"),
      caller.from("invoice_balances").select("*").eq("invoice_id", invoiceId).maybeSingle(),
      caller.from("my_lease_details").select("*").eq("lease_id", invoice.lease_id).maybeSingle(),
      caller.from("public_settings").select("*").maybeSingle(),
    ]);

    // Tenant name comes from whichever tenant rows the caller may read.
    const { data: links } = await caller.from("lease_tenants").select("tenant_id").eq("lease_id", invoice.lease_id).eq("role", "primary");
    const { data: tenants } = await caller.from("tenants").select("full_name").in(
      "id", (links ?? []).map((row: { tenant_id: string }) => row.tenant_id),
    );
    const tenantName = tenants?.[0]?.full_name ?? "—";

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]); // A4
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const { width, height } = page.getSize();
    const left = 48;
    const right = width - 48;
    let y = height - 56;

    const text = (value: string, x: number, size = 10, font = regular, color = INK) =>
      page.drawText(value, { x, y, size, font, color });
    const rightText = (value: string, x: number, size = 10, font = regular, color = INK) =>
      page.drawText(value, { x: x - font.widthOfTextAtSize(value, size), y, size, font, color });

    // -------------------------------------------------------- letterhead
    const company = settings?.company_name ?? "Rentio";

    // The logo lives in a private bucket, so fetch the bytes with the service
    // role rather than relying on a public URL. A missing or unsupported image
    // must never stop a receipt from rendering.
    let logoHeight = 0;
    if (settings?.logo_url) {
      try {
        const { data: file } = await serviceClient().storage.from("company").download(settings.logo_url);
        if (file) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
          const image = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
          const scaled = image.scaleToFit(140, 44);
          page.drawImage(image, { x: left, y: y - scaled.height + 12, width: scaled.width, height: scaled.height });
          logoHeight = scaled.height;
        }
      } catch (logoError) {
        console.warn("logo could not be embedded", logoError);
      }
    }

    if (logoHeight > 0) y -= logoHeight - 4;
    text(company, left, 16, bold, BRAND);
    rightText("RECIBO DE RENTA", right, 14, bold);
    y -= 18;
    rightText(invoice.invoice_number ?? "", right, 10, regular, MUTED);
    y -= 28;

    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: LINE });
    y -= 22;

    // ------------------------------------------------------ parties block
    const detailY = y;
    text("Arrendador", left, 9, bold, MUTED);
    y -= 14;
    text(company, left, 10, bold);
    for (const row of [
      [settings?.["street"], settings?.["colonia"]].filter(Boolean).join(", "),
      [settings?.["city"], settings?.["state"], settings?.["postal_code"]].filter(Boolean).join(", "),
    ].filter(Boolean) as string[]) {
      y -= 13;
      text(row, left, 9, regular, MUTED);
    }

    y = detailY;
    const column = left + 280;
    text("Inquilino", column, 9, bold, MUTED);
    y -= 14;
    text(tenantName, column, 10, bold);
    y -= 13;
    text(`Unidad ${details?.unit_number ?? "—"}`, column, 9, regular, MUTED);
    if (details?.property_name) { y -= 13; text(details.property_name, column, 9, regular, MUTED); }

    y -= 30;
    for (const [label, value] of [
      ["Periodo", formatPeriod(invoice.period_month)],
      ["Fecha de emisión", formatDate(invoice.issue_date)],
      ["Fecha de vencimiento", formatDate(invoice.due_date)],
    ] as const) {
      text(label, left, 9, regular, MUTED);
      text(value, left + 120, 9, bold);
      y -= 14;
    }

    // -------------------------------------------------------- line items
    y -= 14;
    page.drawRectangle({ x: left, y: y - 4, width: right - left, height: 20, color: rgb(0.957, 0.941, 0.925) });
    y += 2;
    text("Concepto", left + 8, 9, bold, MUTED);
    rightText("Cant.", left + 380, 9, bold, MUTED);
    rightText("Importe", right - 8, 9, bold, MUTED);
    y -= 22;

    let subtotal = 0;
    for (const line of lines ?? []) {
      const amount = Number(line.amount) * Number(line.quantity);
      subtotal += amount;
      text(String(line.description).slice(0, 56), left + 8, 10);
      rightText(String(Number(line.quantity)), left + 380, 10);
      rightText(formatMXN(amount), right - 8, 10);
      y -= 8;
      page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: LINE });
      y -= 14;
    }

    // ------------------------------------------------------------ totals
    const paid = Number(balance?.paid ?? 0);
    y -= 6;
    for (const [label, value, strong] of [
      ["Total", subtotal, true],
      ["Pagado", paid, false],
      ["Saldo", subtotal - paid, true],
    ] as const) {
      rightText(label, right - 130, 10, strong ? bold : regular, strong ? INK : MUTED);
      rightText(formatMXN(value), right - 8, 10, strong ? bold : regular);
      y -= 16;
    }

    // ------------------------------------------------------ bank details
    if (settings?.clabe) {
      y -= 18;
      page.drawLine({ start: { x: left, y: y + 12 }, end: { x: right, y: y + 12 }, thickness: 1, color: LINE });
      text("Datos para transferencia", left, 9, bold, MUTED);
      y -= 14;
      text(`Banco: ${settings.bank_name ?? "—"}`, left, 9);
      y -= 13;
      text(`CLABE: ${settings.clabe}`, left, 9);
      y -= 13;
      text(`Beneficiario: ${settings.account_holder ?? "—"}`, left, 9);
      y -= 13;
      text(`Referencia: ${details?.unit_number ?? "—"}`, left, 9);
    }

    y = 48;
    text("Este recibo no es un comprobante fiscal digital (CFDI).", left, 8, regular, MUTED);

    const bytes = await pdf.save();

    // The caller may not write to storage, so the upload uses the service role.
    const service = serviceClient();
    const path = `${invoice.lease_id}/recibo-${invoice.invoice_number ?? invoiceId}.pdf`;
    const { error: uploadError } = await service.storage.from("contracts")
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (uploadError) throw uploadError;

    const { data: signed, error: signError } = await service.storage.from("contracts").createSignedUrl(path, 60 * 10);
    if (signError) throw signError;

    return json({ url: signed.signedUrl, path });
  } catch (caught) {
    console.error("generate-invoice-pdf", caught);
    return json({ error: caught instanceof Error ? caught.message : "unknown error" }, 500);
  }
});
