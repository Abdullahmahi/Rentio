/**
 * Server-only. E-sign: signing links, the signed PDF and its record page,
 * and the emails around them.
 *
 * Links. A signer's link carries 32 random bytes (base64url). Only the
 * SHA-256 of that token is stored, so a database leak hands out no working
 * links; the server finds the signer by hashing what the link presents.
 *
 * Hashes. The record page cannot contain the hash of the file it is part
 * of. So:
 *   original_sha256  the PDF exactly as staff sent it.
 *   "signed (before this page)"  printed on the record page: the PDF with
 *                    every signature stamped, before the record page was
 *                    appended.
 *   signed_sha256    stored on the request and shown in the app: the final
 *                    bytes, record page included. Anyone holding the file
 *                    can recompute it.
 */
import { createHash, randomBytes } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { APP_TIMEZONE } from "@/lib/format";
import { fitInside, signLink, type Box } from "@/lib/esign";
import { button, emailLayout, escapeHtml, sendEmail, siteUrl } from "@/lib/server/email";
import { serviceDb } from "@/lib/server/session";
import { getObject, putObject } from "@/lib/server/storage";

// ------------------------------------------------------------------ tokens

export const sha256Hex = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

export function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: sha256Hex(token) };
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The hash to look a presented token up by, or null for anything malformed.
 *  Lookup is by an index on the hash, so there is no string compare to time. */
export function hashToken(token: string) {
  return TOKEN.test(token) ? sha256Hex(token) : null;
}

/** First hop of X-Forwarded-For (the proxy appends; the client is first). */
export function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || null;
}

// --------------------------------------------------------------- formatting

/** "Nov 12, 2026, 3:41:07 PM MST": the record page's clock, zone included. */
export function denverStamp(value: string | Date | null) {
  if (!value) return "-";
  // Date and time formatted apart: the joiner ("," or "at") differs between ICU versions.
  const at = new Date(value);
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(at);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(at);
  return `${date}, ${time}`;
}

/** The standard PDF fonts speak WinAnsi only; anything else would throw. */
export function winAnsi(text: string | null | undefined) {
  return String(text ?? "")
    .normalize("NFC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

/** Greedy word wrap by measured width; long tokens (user agents) are cut. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let piece = word;
    while (measure(piece) > maxWidth) {
      let cut = piece.length - 1;
      while (cut > 1 && measure(piece.slice(0, cut)) > maxWidth) cut--;
      if (line) lines.push(line);
      lines.push(piece.slice(0, cut));
      line = "";
      piece = piece.slice(cut);
    }
    const next = line ? `${line} ${piece}` : piece;
    if (measure(next) > maxWidth) {
      lines.push(line);
      line = piece;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export interface RecordSigner {
  name: string;
  email: string;
  viewed_at: string | null;
  signed_at: string | null;
  ip: string | null;
  user_agent: string | null;
  consent_at: string | null;
  consent_version: string | null;
  signature_kind: string | null;
}

export interface RecordInput {
  requestId: string;
  title: string;
  company: string;
  sentAt: string;
  completedAt: string;
  originalSha: string;
  stampedSha: string;
  signers: RecordSigner[];
}

export type RecordLine = { text: string; bold?: boolean; size?: number; gap?: number };

/** The signing record, as lines. Pure, so it is tested without a PDF. */
export function recordLines(input: RecordInput): RecordLine[] {
  const lines: RecordLine[] = [
    { text: "Signing record", bold: true, size: 18, gap: 10 },
    { text: `${input.title} - ${input.company}` },
    { text: `Agreement ID: ${input.requestId}` },
    { text: `Sent: ${denverStamp(input.sentAt)}` },
    { text: `Completed: ${denverStamp(input.completedAt)}`, gap: 10 },
    { text: "Document fingerprints (SHA-256)", bold: true, gap: 2 },
    { text: `Original PDF as sent: ${input.originalSha}` },
    { text: `Signed PDF before this record page was appended: ${input.stampedSha}` },
    {
      text: "The fingerprint of the complete file, this page included, is stored by the sender and shown in the app; a file cannot contain its own fingerprint.",
      size: 8,
      gap: 10,
    },
  ];
  input.signers.forEach((signer, index) => {
    lines.push(
      { text: `Signer ${index + 1}: ${signer.name}`, bold: true, gap: 2 },
      { text: `Email: ${signer.email}` },
      { text: `Opened: ${denverStamp(signer.viewed_at)}` },
      { text: `Signed: ${denverStamp(signer.signed_at)} (${signer.signature_kind ?? "-"})` },
      {
        text: `Consented to sign electronically: ${denverStamp(signer.consent_at)} (${signer.consent_version ?? "-"})`,
      },
      { text: `IP address: ${signer.ip ?? "-"}` },
      { text: `Device: ${signer.user_agent ?? "-"}`, gap: 10 },
    );
  });
  lines.push({
    text: "Signed electronically under the U.S. ESIGN Act and the Texas Uniform Electronic Transactions Act. Times are America/Denver.",
    size: 8,
  });
  return lines;
}

// -------------------------------------------------------------------- PDF

export interface StampSigner {
  name: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  signature_kind: string | null;
  signature_data: string | null;
  signed_at: string | null;
}

const INK = rgb(0.07, 0.13, 0.18); // Harbor foreground #12212E
const MUTED = rgb(0.34, 0.4, 0.48); // #56677A

async function stampSignature(
  pdf: PDFDocument,
  page: PDFPage,
  signer: StampSigner,
  font: PDFFont,
  small: PDFFont,
) {
  const box: Box = { x: signer.x, y: signer.y, w: signer.w, h: signer.h };
  if (signer.signature_kind === "drawn" && signer.signature_data) {
    const png = await pdf.embedPng(signer.signature_data);
    const fit = fitInside(box, png.width, png.height);
    page.drawImage(png, { x: fit.x, y: fit.y, width: fit.w, height: fit.h });
  } else {
    const text = winAnsi(signer.signature_data);
    const size = Math.min(
      box.h * 0.6,
      (box.w / Math.max(font.widthOfTextAtSize(text, 1), 1)) * 0.95,
    );
    page.drawText(text, {
      x: box.x + 4,
      y: box.y + (box.h - size) / 2 + size * 0.2,
      size,
      font,
      color: INK,
    });
  }
  // "The date is added for you."
  const date = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE }).format(
    new Date(signer.signed_at ?? Date.now()),
  );
  page.drawText(winAnsi(`${signer.name} - signed ${date}`), {
    x: box.x,
    y: Math.max(box.y - 9, 0),
    size: 7,
    font: small,
    color: MUTED,
  });
}

async function appendRecord(pdf: PDFDocument, lines: RecordLine[]) {
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [width, height] = [612, 792]; // US Letter
  const margin = 54;
  let page = pdf.addPage([width, height]);
  let y = height - margin;
  for (const line of lines) {
    const font = line.bold ? bold : regular;
    const size = line.size ?? 9.5;
    const leading = size * 1.35;
    for (const part of wrapText(winAnsi(line.text), width - margin * 2, (s) =>
      font.widthOfTextAtSize(s, size),
    )) {
      if (y - leading < margin) {
        page = pdf.addPage([width, height]);
        y = height - margin;
      }
      y -= leading;
      page.drawText(part, { x: margin, y, size, font, color: line.bold ? INK : MUTED });
    }
    y -= line.gap ?? 0;
  }
}

/** Stamps every signature, appends the record, and returns both hashes. */
export async function buildSignedPdf(
  original: Uint8Array,
  signers: StampSigner[],
  record: Omit<RecordInput, "stampedSha" | "originalSha">,
) {
  const completed = new Date(record.completedAt);
  const pdf = await PDFDocument.load(original);
  // Fixed dates, so a retried finalisation produces the same bytes.
  pdf.setCreationDate(completed);
  pdf.setModificationDate(completed);
  const script = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const small = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  for (const signer of signers) {
    const page = pages[signer.page - 1];
    if (!page) throw new Error(`signature spot on missing page ${signer.page}`);
    await stampSignature(pdf, page, signer, script, small);
  }
  const stamped = await pdf.save();
  const stampedSha = sha256Hex(stamped);

  const withRecord = await PDFDocument.load(stamped);
  withRecord.setCreationDate(completed);
  withRecord.setModificationDate(completed);
  await appendRecord(
    withRecord,
    recordLines({ ...record, originalSha: sha256Hex(original), stampedSha }),
  );
  const bytes = await withRecord.save();
  return { bytes, stampedSha, signedSha: sha256Hex(bytes) };
}

/** Page count and crop boxes of a PDF staff want to send; throws if unreadable. */
export async function inspectPdf(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((page) => {
    const box = page.getCropBox();
    return { x: box.x, y: box.y, w: box.width, h: box.height };
  });
}

// ------------------------------------------------------------------- email

export async function companyName(orgId: string) {
  const { data } = await serviceDb()
    .from("settings")
    .select("company_name")
    .eq("org_id", orgId)
    .maybeSingle();
  return data?.company_name ?? "Rentio";
}

/** Emails one signer their link. False when delivery failed (no RESEND key,
 *  bounce...): the link still works and staff can copy it from the app. */
export async function emailSigningLink(options: {
  to: string;
  name: string;
  locale: string;
  company: string;
  title: string;
  token: string;
  expiresAt: string;
  message?: string | null;
}) {
  const es = options.locale !== "en";
  const link = signLink(siteUrl(), options.token);
  const until = new Intl.DateTimeFormat(es ? "es-MX" : "en-US", {
    timeZone: APP_TIMEZONE,
    dateStyle: "long",
  }).format(new Date(options.expiresAt));
  const name = escapeHtml(options.name);
  const title = escapeHtml(options.title);
  const note = options.message
    ? `<p style="white-space:pre-line;border-left:3px solid #DFE6ED;padding-left:12px">${escapeHtml(options.message)}</p>`
    : "";
  const heading = es ? `Firma: ${title}` : `Please sign: ${title}`;
  const body = es
    ? `<p>Hola ${name},</p>
       <p>${escapeHtml(options.company)} te envió <strong>${title}</strong> para leer y firmar.</p>
       ${note}
       ${button(link, "Leer y firmar")}
       <p style="color:#56677A">El enlace es solo para ti y vence el ${until}.</p>`
    : `<p>Hi ${name},</p>
       <p>${escapeHtml(options.company)} sent you <strong>${title}</strong> to read and sign.</p>
       ${note}
       ${button(link, "Read and sign")}
       <p style="color:#56677A">This link is just for you and works until ${until}.</p>`;
  try {
    await sendEmail({
      to: options.to,
      subject: `${es ? "Firma" : "Please sign"}: ${options.title} - ${options.company}`,
      html: emailLayout(heading, body, options.company, es ? "es-MX" : "en"),
    });
    return true;
  } catch (caught) {
    console.warn("esign: link not emailed", caught);
    return false;
  }
}

// ------------------------------------------------------------- finalisation

/**
 * Runs when a signer may have been the last. Safe to call any number of
 * times from any number of requests: claim_signature_finalisation lets one
 * caller through, complete_signature_request is idempotent, and file paths
 * are fixed per request so a retry overwrites rather than duplicates.
 * Everything is filtered by the org the caller derived from the signer row.
 */
export async function finaliseIfComplete(requestId: string, orgId: string) {
  const service = serviceDb();
  const { data: claimed, error: claimError } = await service.rpc("claim_signature_finalisation", {
    p_request: requestId,
  });
  if (claimError) throw claimError;
  if (!claimed) return false;

  const { data: request, error } = await service
    .from("signature_requests")
    .select("*")
    .eq("id", requestId)
    .eq("org_id", orgId)
    .single();
  if (error) throw error;
  const { data: signers, error: signersError } = await service
    .from("signature_signers")
    .select("*")
    .eq("request_id", requestId)
    .eq("org_id", orgId)
    .order("position");
  if (signersError) throw signersError;

  const original = await getObject(orgId, "contracts", request.original_path);
  if (!original) throw new Error("original PDF is missing");
  const company = await companyName(orgId);
  const completedAt = signers
    .map((signer) => signer.signed_at ?? "")
    .sort()
    .at(-1)!;

  const { bytes, signedSha } = await buildSignedPdf(new Uint8Array(original), signers, {
    requestId,
    title: request.title,
    company,
    sentAt: request.created_at,
    completedAt,
    signers,
  });

  const fileName = `signed-${requestId}.pdf`;
  const leasePath = `${request.lease_id}/${fileName}`;
  await putObject(orgId, "contracts", leasePath, bytes);
  const tenantPaths: Record<string, string> = {};
  for (const tenantId of new Set(signers.map((signer) => signer.tenant_id).filter(Boolean))) {
    tenantPaths[tenantId!] = `${tenantId}/${fileName}`;
    await putObject(orgId, "tenant-docs", tenantPaths[tenantId!]!, bytes);
  }

  const name = `${request.title.replace(/[^\w.-]+/g, "-").slice(0, 80)}-signed.pdf`;
  const { error: completeError } = await service.rpc("complete_signature_request", {
    p_request: requestId,
    p_signed_path: leasePath,
    p_signed_sha: signedSha,
    p_name: name,
    p_tenant_paths: tenantPaths,
  });
  if (completeError) throw completeError;

  // Everyone gets the final copy. Best effort: it is also in their portal.
  const attachment = { filename: name, content: Buffer.from(bytes).toString("base64") };
  for (const signer of signers) {
    const es = signer.locale !== "en";
    try {
      await sendEmail({
        to: signer.email,
        subject: `${es ? "Firmado" : "Signed"}: ${request.title} - ${company}`,
        html: emailLayout(
          es ? "Todos firmaron" : "Everyone has signed",
          es
            ? `<p>Hola ${escapeHtml(signer.name)},</p><p>Adjuntamos la copia final firmada de <strong>${escapeHtml(request.title)}</strong>, con la hoja de registro de firmas.</p>`
            : `<p>Hi ${escapeHtml(signer.name)},</p><p>Attached is the final signed copy of <strong>${escapeHtml(request.title)}</strong>, with its signing record.</p>`,
          company,
          es ? "es-MX" : "en",
        ),
        attachments: [attachment],
      });
    } catch (caught) {
      console.warn("esign: final copy not emailed", caught);
    }
  }
  return true;
}
