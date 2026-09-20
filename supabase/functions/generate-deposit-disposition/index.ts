/**
 * Renders the Security Deposit Disposition required by Texas Property Code
 * §92.104(c) and returns a signed URL.
 *
 * When any part of a deposit is withheld the landlord must deliver a written
 * description and itemized list of deductions. This is that document, so it
 * has to be complete: the parties, the deposit held, every deduction with its
 * amount, the refund, and the date.
 *
 * Read through the CALLER's client so row level security decides who may see
 * the lease. Staff only in practice — a tenant has no route to this.
 */
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import {
  corsHeaders, json, userClient, serviceClient, requireStaff,
  formatMoney, formatDate,
} from "../_shared/common.ts";

const INK = rgb(0.11, 0.10, 0.09);
const MUTED = rgb(0.42, 0.40, 0.36);
const BRAND = rgb(0.106, 0.302, 0.243);
const LINE = rgb(0.906, 0.890, 0.867);

type Lang = "en" | "es-MX";

const COPY = {
  en: {
    title: "Security Deposit Disposition",
    subtitle: "Texas Property Code §92.104",
    landlord: "Landlord",
    tenant: "Tenant",
    property: "Property",
    unit: "Unit",
    leaseTerm: "Lease term",
    surrender: "Date of surrender",
    forwarding: "Forwarding address received",
    forwardingAddress: "Forwarding address",
    dueBy: "Refund due by",
    held: "Security deposit held",
    deductions: "Itemized deductions",
    description: "Description",
    amount: "Amount",
    totalDeductions: "Total deductions",
    refund: "Amount refunded to tenant",
    none: "No deductions were made from this deposit.",
    issued: "Issued",
    footer: "This document is generated for record-keeping purposes and is not legal advice.",
  },
  "es-MX": {
    title: "Disposición del Depósito en Garantía",
    subtitle: "Código de Propiedad de Texas §92.104",
    landlord: "Arrendador",
    tenant: "Inquilino",
    property: "Propiedad",
    unit: "Unidad",
    leaseTerm: "Vigencia del contrato",
    surrender: "Fecha de entrega",
    forwarding: "Domicilio de reenvío recibido",
    forwardingAddress: "Domicilio de reenvío",
    dueBy: "Reembolso a más tardar el",
    held: "Depósito en garantía retenido",
    deductions: "Deducciones detalladas",
    description: "Concepto",
    amount: "Importe",
    totalDeductions: "Total de deducciones",
    refund: "Monto reembolsado al inquilino",
    none: "No se hicieron deducciones a este depósito.",
    issued: "Emitido",
    footer:
      "Este documento se genera para fines de registro y no constituye asesoría legal.",
  },
} satisfies Record<Lang, Record<string, string>>;

interface Deduction { description: string; amount: number }

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { lease_id: leaseId } = await request.json();
    if (!leaseId) return json({ error: "lease_id is required" }, 400);

    const caller = userClient(request);
    const { isStaff } = await requireStaff(caller);
    if (!isStaff) return json({ error: "forbidden" }, 403);

    const { data: lease, error } = await caller.from("leases").select("*").eq("id", leaseId).maybeSingle();
    if (error) throw error;
    if (!lease) return json({ error: "not found" }, 404);

    const [{ data: details }, { data: settings }] = await Promise.all([
      caller.from("my_lease_details").select("*").eq("lease_id", leaseId).maybeSingle(),
      caller.from("public_settings").select("*").maybeSingle(),
    ]);

    const { data: links } = await caller.from("lease_tenants")
      .select("tenant_id").eq("lease_id", leaseId).eq("role", "primary");
    const tenantIds = (links ?? []).map((row: { tenant_id: string }) => row.tenant_id);
    const { data: tenants } = await caller.from("tenants").select("id, full_name").in("id", tenantIds);
    const tenantName = tenants?.[0]?.full_name ?? "-";

    // The tenant's own language, so the document they receive is readable.
    const { data: profile } = await caller.from("profiles")
      .select("locale").in("tenant_id", tenantIds).maybeSingle();
    const lang: Lang = profile?.locale === "en" ? "en" : "es-MX";
    const c = COPY[lang];

    const deductions: Deduction[] = Array.isArray(lease.deposit_itemization)
      ? (lease.deposit_itemization as Deduction[])
      : [];
    const held = Number(lease.deposit_amount ?? 0);
    const totalDeductions = deductions.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const refund = Math.max(0, held - totalDeductions);

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
    const row = (label: string, value: string) => {
      text(label, left, 9, regular, MUTED);
      text(value, left + 170, 9, bold);
      y -= 15;
    };

    // ------------------------------------------------------- letterhead
    const company = settings?.company_name ?? "Rentio";
    text(company, left, 14, bold, BRAND);
    y -= 20;
    text(c.title, left, 18, bold);
    y -= 15;
    text(c.subtitle, left, 9, regular, MUTED);
    y -= 12;
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: LINE });
    y -= 22;

    // ----------------------------------------------------------- parties
    row(c.landlord, company);
    row(c.tenant, tenantName);
    if (details?.property_name) row(c.property, String(details.property_name));
    row(c.unit, String(details?.unit_number ?? "-"));
    row(c.leaseTerm, `${formatDate(lease.start_date)} - ${formatDate(lease.end_date)}`);
    if (lease.surrender_date) row(c.surrender, formatDate(lease.surrender_date));
    if (lease.forwarding_address_received_at) {
      row(c.forwarding, formatDate(lease.forwarding_address_received_at));
    }
    if (lease.deposit_due_date) row(c.dueBy, formatDate(lease.deposit_due_date));
    if (lease.forwarding_address) {
      text(c.forwardingAddress, left, 9, regular, MUTED);
      y -= 13;
      for (const line of String(lease.forwarding_address).split("\n").slice(0, 4)) {
        text(line.slice(0, 80), left, 9);
        y -= 12;
      }
      y -= 3;
    }

    // -------------------------------------------------------- deductions
    y -= 10;
    page.drawRectangle({
      x: left, y: y - 4, width: right - left, height: 20, color: rgb(0.957, 0.941, 0.925),
    });
    y += 2;
    text(c.deductions, left + 8, 9, bold, MUTED);
    rightText(c.amount, right - 8, 9, bold, MUTED);
    y -= 22;

    if (deductions.length === 0) {
      text(c.none, left + 8, 10, regular, MUTED);
      y -= 20;
    } else {
      for (const line of deductions) {
        text(String(line.description ?? "").slice(0, 60), left + 8, 10);
        rightText(formatMoney(Number(line.amount) || 0), right - 8, 10);
        y -= 8;
        page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: LINE });
        y -= 14;
      }
    }

    // ------------------------------------------------------------ totals
    y -= 6;
    for (const [label, value, strong] of [
      [c.held, held, false],
      [c.totalDeductions, totalDeductions, false],
      [c.refund, refund, true],
    ] as const) {
      rightText(label, right - 130, 10, strong ? bold : regular, strong ? INK : MUTED);
      rightText(formatMoney(value), right - 8, 10, strong ? bold : regular);
      y -= 16;
    }

    y -= 14;
    text(`${c.issued}: ${formatDate(lease.deposit_settled_at ?? new Date().toISOString().slice(0, 10))}`, left, 9, regular, MUTED);

    y = 48;
    text(c.footer, left, 8, regular, MUTED);

    const bytes = await pdf.save();

    // The caller may not write to storage, so the upload uses the service role.
    const service = serviceClient();
    const path = `${leaseId}/deposit-disposition-${leaseId}.pdf`;
    const { error: uploadError } = await service.storage.from("contracts")
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (uploadError) throw uploadError;

    const { data: signed, error: signError } = await service.storage.from("contracts")
      .createSignedUrl(path, 60 * 10);
    if (signError) throw signError;

    return json({ url: signed.signedUrl, path });
  } catch (caught) {
    console.error("generate-deposit-disposition", caught);
    return json({ error: caught instanceof Error ? caught.message : "unknown error" }, 500);
  }
});
