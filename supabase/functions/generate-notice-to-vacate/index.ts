/**
 * Renders a Notice to Vacate (Texas Property Code §24.005) and returns a
 * signed URL.
 *
 * This GENERATES A DOCUMENT AND KEEPS A RECORD. It does not file anything
 * with a court, it does not start an eviction suit, and nothing in the
 * output may imply that it does.
 *
 * Read through the CALLER's client so row level security applies. Staff only.
 */
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import {
  corsHeaders, json, userClient, serviceClient, requireStaff, formatDate,
} from "../_shared/common.ts";

const INK = rgb(0.11, 0.10, 0.09);
const MUTED = rgb(0.42, 0.40, 0.36);
const BRAND = rgb(0.106, 0.302, 0.243);
const LINE = rgb(0.906, 0.890, 0.867);

type Lang = "en" | "es-MX";

const COPY = {
  en: {
    title: "Notice to Vacate",
    subtitle: "Texas Property Code §24.005",
    to: "To",
    property: "Property",
    unit: "Unit",
    issued: "Date of notice",
    delivery: "Method of delivery",
    body: "You are hereby given notice to vacate the premises described above on or before:",
    reasonLabel: "Reason for this notice",
    types: {
      non_payment: "Non-payment of rent",
      lease_violation: "Violation of the lease",
      end_of_term: "End of the lease term",
    },
    delivery_methods: {
      in_person: "Delivered in person",
      mail: "Delivered by mail",
      affixed_to_door: "Affixed to the inside of the main entry door",
    },
    closing:
      "If you do not vacate by the date above, the landlord may pursue the remedies available " +
      "under Texas law.",
    landlord: "Landlord",
    footer: "This document is generated for record-keeping purposes and is not legal advice.",
  },
  "es-MX": {
    title: "Aviso para Desocupar",
    subtitle: "Código de Propiedad de Texas §24.005",
    to: "Para",
    property: "Propiedad",
    unit: "Unidad",
    issued: "Fecha del aviso",
    delivery: "Forma de entrega",
    body: "Por este medio se le avisa que debe desocupar el inmueble descrito arriba a más tardar el:",
    reasonLabel: "Motivo de este aviso",
    types: {
      non_payment: "Falta de pago de la renta",
      lease_violation: "Incumplimiento del contrato",
      end_of_term: "Fin de la vigencia del contrato",
    },
    delivery_methods: {
      in_person: "Entregado en persona",
      mail: "Entregado por correo",
      affixed_to_door: "Fijado en el interior de la puerta principal",
    },
    closing:
      "Si no desocupa antes de la fecha indicada, el arrendador puede recurrir a los remedios " +
      "disponibles bajo la ley de Texas.",
    landlord: "Arrendador",
    footer: "Este documento se genera para fines de registro y no constituye asesoría legal.",
  },
} as const;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { notice_id: noticeId } = await request.json();
    if (!noticeId) return json({ error: "notice_id is required" }, 400);

    const caller = userClient(request);
    const { isStaff } = await requireStaff(caller);
    if (!isStaff) return json({ error: "forbidden" }, 403);

    const { data: notice, error } = await caller.from("lease_notices")
      .select("*").eq("id", noticeId).maybeSingle();
    if (error) throw error;
    if (!notice) return json({ error: "not found" }, 404);

    const [{ data: details }, { data: settings }] = await Promise.all([
      caller.from("my_lease_details").select("*").eq("lease_id", notice.lease_id).maybeSingle(),
      caller.from("public_settings").select("*").maybeSingle(),
    ]);

    const { data: links } = await caller.from("lease_tenants")
      .select("tenant_id").eq("lease_id", notice.lease_id).eq("role", "primary");
    const tenantIds = (links ?? []).map((row: { tenant_id: string }) => row.tenant_id);
    const { data: tenants } = await caller.from("tenants").select("id, full_name").in("id", tenantIds);
    const tenantName = tenants?.[0]?.full_name ?? "-";

    const { data: profile } = await caller.from("profiles")
      .select("locale").in("tenant_id", tenantIds).maybeSingle();
    const lang: Lang = profile?.locale === "en" ? "en" : "es-MX";
    const c = COPY[lang];

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
    const row = (label: string, value: string) => {
      text(label, left, 9, regular, MUTED);
      text(value, left + 170, 9, bold);
      y -= 15;
    };
    /** Naive greedy wrap — enough for two paragraphs of fixed copy. */
    const paragraph = (value: string, size = 10) => {
      const words = value.split(" ");
      let line = "";
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (regular.widthOfTextAtSize(next, size) > right - left) {
          text(line, left, size);
          y -= size + 4;
          line = word;
        } else {
          line = next;
        }
      }
      if (line) {
        text(line, left, size);
        y -= size + 4;
      }
    };

    const company = settings?.company_name ?? "Rentio";
    text(company, left, 14, bold, BRAND);
    y -= 20;
    text(c.title, left, 18, bold);
    y -= 15;
    text(c.subtitle, left, 9, regular, MUTED);
    y -= 12;
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: LINE });
    y -= 22;

    row(c.to, tenantName);
    if (details?.property_name) row(c.property, String(details.property_name));
    row(c.unit, String(details?.unit_number ?? "-"));
    row(c.issued, formatDate(notice.delivered_at));
    row(c.delivery, c.delivery_methods[notice.delivery as keyof typeof c.delivery_methods]);

    y -= 12;
    paragraph(c.body);
    y -= 6;
    text(formatDate(notice.vacate_date), left, 20, bold, BRAND);
    y -= 30;

    text(c.reasonLabel, left, 9, regular, MUTED);
    y -= 14;
    text(c.types[notice.type as keyof typeof c.types], left, 11, bold);
    y -= 16;
    if (notice.reason) {
      paragraph(String(notice.reason), 10);
    }

    y -= 10;
    paragraph(c.closing, 9);

    y -= 26;
    text(c.landlord, left, 9, regular, MUTED);
    y -= 14;
    text(company, left, 10, bold);

    y = 48;
    text(c.footer, left, 8, regular, MUTED);

    const bytes = await pdf.save();

    const service = serviceClient();
    const path = `${notice.lease_id}/notice-to-vacate-${noticeId}.pdf`;
    const { error: uploadError } = await service.storage.from("contracts")
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (uploadError) throw uploadError;

    // Keep the record pointing at the document it produced.
    await service.from("lease_notices").update({ document_url: path }).eq("id", noticeId);

    const { data: signed, error: signError } = await service.storage.from("contracts")
      .createSignedUrl(path, 60 * 10);
    if (signError) throw signError;

    return json({ url: signed.signedUrl, path });
  } catch (caught) {
    console.error("generate-notice-to-vacate", caught);
    return json({ error: caught instanceof Error ? caught.message : "unknown error" }, 500);
  }
});
