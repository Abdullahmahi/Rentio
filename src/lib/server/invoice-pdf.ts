/**
 * Server-only. Renders a recibo de renta as a PDF and files it under
 * contracts/<lease_id>/.
 *
 * The invoice is READ through the caller's own client, so row level security
 * decides whether they may see it: a tenant can only ever render their own
 * receipt. Shared by the download route and the email route, so the
 * attachment and the on-screen PDF can never drift apart.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatDate, formatMoney } from "@/lib/format";
import { formatPeriod } from "@/lib/server/email";
import type { Db } from "@/lib/server/session";
import { getObject, putObject } from "@/lib/server/storage";

const INK = rgb(0.11, 0.1, 0.09);
const MUTED = rgb(0.42, 0.4, 0.36);
const BRAND = rgb(0.106, 0.302, 0.243); // #1B4D3E
const LINE = rgb(0.906, 0.89, 0.867);

export async function renderInvoicePdf(db: Db, orgId: string, invoiceId: string) {
  const { data: invoice, error } = await db
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) throw error;
  if (!invoice) return null;

  const [{ data: lines }, { data: balance }, { data: details }, { data: settings }] =
    await Promise.all([
      db.from("invoice_lines").select("*").eq("invoice_id", invoiceId).order("created_at"),
      db.from("invoice_balances").select("*").eq("invoice_id", invoiceId).maybeSingle(),
      db.from("my_lease_details").select("*").eq("lease_id", invoice.lease_id).maybeSingle(),
      db.from("public_settings").select("*").maybeSingle(),
    ]);

  // Tenant name comes from whichever tenant rows the caller may read.
  const { data: links } = await db
    .from("lease_tenants")
    .select("tenant_id")
    .eq("lease_id", invoice.lease_id)
    .eq("role", "primary");
  const { data: tenants } = await db
    .from("tenants")
    .select("full_name")
    .in(
      "id",
      (links ?? []).map((row) => row.tenant_id),
    );
  const tenantName = tenants?.[0]?.full_name ?? "-";

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

  // The logo is a private file, read straight from storage rather than a
  // public URL. A missing or unsupported image must never stop a receipt
  // from rendering.
  let logoHeight = 0;
  if (settings?.logo_url) {
    try {
      const logo = await getObject(orgId, "company", settings.logo_url);
      if (logo) {
        const isPng = logo[0] === 0x89 && logo[1] === 0x50;
        const image = isPng ? await pdf.embedPng(logo) : await pdf.embedJpg(logo);
        const scaled = image.scaleToFit(140, 44);
        page.drawImage(image, {
          x: left,
          y: y - scaled.height + 12,
          width: scaled.width,
          height: scaled.height,
        });
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
    [settings?.["street"], settings?.["address_line_2"]].filter(Boolean).join(", "),
    [settings?.["city"], [settings?.["state"], settings?.["postal_code"]].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", "),
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
  text(`Unidad ${details?.unit_number ?? "-"}`, column, 9, regular, MUTED);
  if (details?.property_name) {
    y -= 13;
    text(details.property_name, column, 9, regular, MUTED);
  }

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
  page.drawRectangle({
    x: left,
    y: y - 4,
    width: right - left,
    height: 20,
    color: rgb(0.957, 0.941, 0.925),
  });
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
    rightText(formatMoney(amount), right - 8, 10);
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
    rightText(formatMoney(value), right - 8, 10, strong ? bold : regular);
    y -= 16;
  }

  // ------------------------------------------------------- how to pay
  // Only the methods the landlord actually filled in. No routing or account
  // number is stored, so none can be printed here.
  const payRows = [
    ["Zelle", settings?.["zelle_handle"]],
    ["Cheque a nombre de", settings?.["check_payable_to"]],
    ["Enviar cheque a", settings?.["check_mailing_address"]],
    ["Entregar en", settings?.["dropoff_address"]],
    ["Horario", settings?.["office_hours"]],
  ].filter(([, value]) => Boolean(value)) as [string, string][];

  if (payRows.length > 0) {
    y -= 18;
    page.drawLine({
      start: { x: left, y: y + 12 },
      end: { x: right, y: y + 12 },
      thickness: 1,
      color: LINE,
    });
    text("Cómo pagar", left, 9, bold, MUTED);
    y -= 14;
    text(`Referencia: unidad ${details?.unit_number ?? "-"}`, left, 9, bold);
    for (const [label, value] of payRows) {
      y -= 13;
      text(`${label}: ${String(value).replace(/\s*\n\s*/g, " · ")}`.slice(0, 96), left, 9);
    }
    if (settings?.["payment_notes"]) {
      y -= 13;
      text(
        String(settings["payment_notes"])
          .replace(/\s*\n\s*/g, " ")
          .slice(0, 96),
        left,
        9,
        regular,
        MUTED,
      );
    }
  }

  y = 48;
  text(
    "Documento generado para control interno. No constituye asesoría legal.",
    left,
    8,
    regular,
    MUTED,
  );

  const bytes = await pdf.save();
  // The prefix is free text in Settings; the file name must stay a safe path segment.
  const safeNumber = (invoice.invoice_number ?? invoiceId).replace(/[^\w.-]+/g, "_");
  const path = `${invoice.lease_id}/recibo-${safeNumber}.pdf`;
  await putObject(orgId, "contracts", path, bytes);
  return { invoice, bytes, path };
}
