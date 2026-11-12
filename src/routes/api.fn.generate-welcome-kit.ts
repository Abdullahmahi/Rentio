import { createFileRoute } from "@tanstack/react-router";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import QRCode from "qrcode";
import { fail, requireSession } from "@/lib/server/session";
import { getObject } from "@/lib/server/storage";

const json = (body: unknown, status = 200) => Response.json(body, { status });

const INK = rgb(0.11, 0.1, 0.09);
const MUTED = rgb(0.42, 0.4, 0.36);
const BRAND = rgb(0.106, 0.302, 0.243); // #1B4D3E, as invoice-pdf.ts
const LINE = rgb(0.906, 0.89, 0.867);
const PANEL = rgb(0.957, 0.941, 0.925);

const PORTAL_URL = "https://rentio-app.com/sign-in";

/** The standard fonts are WinAnsi only; anything else would throw mid-render. */
const safe = (value: string | null | undefined) =>
  String(value ?? "")
    .replace(/\s*\n\s*/g, " · ")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");

function wrap(value: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

const STEPS: [string, string][] = [
  [
    "Open rentio-app.com/sign-in on your phone or computer.",
    "Abre rentio-app.com/sign-in en tu teléfono o computadora.",
  ],
  [
    "Sign in with the email address your property manager has on file. Your invitation email has the link.",
    "Inicia sesión con el correo que tu administrador tiene registrado. El correo de invitación trae el enlace.",
  ],
  [
    "See your balance, download receipts, report a payment and request repairs.",
    "Consulta tu saldo, descarga recibos, reporta un pago y solicita reparaciones.",
  ],
];

/**
 * Staff only. A one-page bilingual flyer to hand new tenants: company and
 * logo, three steps into the portal, how to pay. Letter size, printed as is.
 */
export const Route = createFileRoute("/api/fn/generate-welcome-kit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;
        const orgId = session.profile.org_id;
        if (!session.isStaff || !orgId) return json({ error: "forbidden" }, 403);

        try {
          const { data: settings, error } = await session.db
            .from("public_settings")
            .select("*")
            .maybeSingle();
          if (error) throw error;
          const company = safe(settings?.company_name) || "Rentio";

          const pdf = await PDFDocument.create();
          pdf.setTitle(`${company} · Tenant portal`);
          const page = pdf.addPage([612, 792]); // US Letter
          const regular = await pdf.embedFont(StandardFonts.Helvetica);
          const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
          const { width, height } = page.getSize();
          const left = 54;
          const right = width - 54;
          const textWidth = right - left;
          let y = height - 60;

          const text = (value: string, x: number, size: number, font = regular, color = INK) =>
            page.drawText(value, { x, y, size, font, color });
          const paragraph = (
            value: string,
            x: number,
            size: number,
            font = regular,
            color = INK,
          ) => {
            for (const line of wrap(value, font, size, right - x)) {
              text(line, x, size, font, color);
              y -= size + 4;
            }
          };

          // ---------------------------------------------------- letterhead
          if (settings?.logo_url) {
            try {
              const logo = await getObject(orgId, "company", settings.logo_url);
              if (logo) {
                const isPng = logo[0] === 0x89 && logo[1] === 0x50;
                const image = isPng ? await pdf.embedPng(logo) : await pdf.embedJpg(logo);
                const scaled = image.scaleToFit(160, 52);
                page.drawImage(image, { x: left, y: y - scaled.height + 14, ...scaled });
                y -= scaled.height + 4;
              }
            } catch (logoError) {
              console.warn("logo could not be embedded", logoError);
            }
          }
          text(company, left, 20, bold, BRAND);
          y -= 34;
          text("Welcome to your tenant portal", left, 24, bold);
          y -= 26;
          text("Bienvenido a tu portal de inquilino", left, 18, regular, MUTED);
          y -= 22;
          page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: LINE });
          y -= 30;

          // ----------------------------------------------------- 3 steps
          text("How to use it · Cómo usarlo", left, 12, bold, MUTED);
          y -= 26;
          STEPS.forEach(([en, es], index) => {
            page.drawCircle({ x: left + 12, y: y + 5, size: 12, color: BRAND });
            const digit = String(index + 1);
            page.drawText(digit, {
              x: left + 12 - bold.widthOfTextAtSize(digit, 13) / 2,
              y: y,
              size: 13,
              font: bold,
              color: rgb(1, 1, 1),
            });
            paragraph(en, left + 36, 12, bold);
            paragraph(es, left + 36, 11, regular, MUTED);
            y -= 12;
          });

          // ------------------------------------------- the address + QR
          const QR = 140;
          y -= 6;
          const panelTop = y + 10;
          const panelBottom = panelTop - QR - 20;
          page.drawRectangle({
            x: left,
            y: panelBottom,
            width: textWidth,
            height: panelTop - panelBottom,
            color: PANEL,
          });
          const qr = await pdf.embedPng(
            await QRCode.toBuffer(PORTAL_URL, { type: "png", margin: 1, width: QR * 4 }),
          );
          page.drawImage(qr, { x: right - 10 - QR, y: panelBottom + 10, width: QR, height: QR });
          const urlWidth = textWidth - 36 - QR - 10;
          y = panelTop - 36;
          text("Go to · Entra a", left + 18, 11, bold, MUTED);
          y -= 34;
          const urlSize = Math.min(28, urlWidth / (bold.widthOfTextAtSize(PORTAL_URL, 1) || 1));
          text(PORTAL_URL, left + 18, urlSize, bold, BRAND);
          y -= 30;
          text("or scan the code · o escanea el código", left + 18, 11, regular, MUTED);
          y = panelBottom - 42;

          // -------------------------------------------------- how to pay
          const payRows = (
            [
              ["Zelle", settings?.zelle_handle],
              ["Check payable to · Cheque a nombre de", settings?.check_payable_to],
              ["Mail checks to · Enviar cheque a", settings?.check_mailing_address],
              ["Drop off at · Entregar en", settings?.dropoff_address],
              ["Hours · Horario", settings?.office_hours],
            ] as [string, string | null | undefined][]
          ).filter(([, value]) => Boolean(value));

          text("How to pay rent · Cómo pagar la renta", left, 12, bold, MUTED);
          y -= 20;
          if (payRows.length === 0) {
            paragraph("Ask your property manager. · Pregunta a tu administrador.", left, 11);
          }
          for (const [label, value] of payRows) {
            paragraph(`${label}: ${safe(value)}`, left, 11);
            y -= 2;
          }
          if (settings?.payment_notes)
            paragraph(safe(settings.payment_notes), left, 10, regular, MUTED);
          y -= 4;
          paragraph(
            "Include your unit number as the reference, then report the payment in the portal. · Incluye tu número de unidad como referencia y reporta el pago en el portal.",
            left,
            10,
            regular,
            MUTED,
          );

          // ------------------------------------------------------ contact
          const contact = [settings?.phone, settings?.email]
            .filter(Boolean)
            .map(safe)
            .join("  ·  ");
          if (contact) {
            y = 64;
            page.drawLine({
              start: { x: left, y: y + 16 },
              end: { x: right, y: y + 16 },
              thickness: 1,
              color: LINE,
            });
            text(`Questions · Dudas: ${contact}`, left, 10, regular, MUTED);
          }

          const bytes = await pdf.save();
          return new Response(new Uint8Array(bytes), {
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": 'attachment; filename="tenant-welcome-kit.pdf"',
              "Cache-Control": "no-store",
            },
          });
        } catch (caught) {
          return fail(caught, "generate-welcome-kit");
        }
      },
    },
  },
});
