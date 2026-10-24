/** Server-only. Email through Resend, and the shared email chrome. */
import { APP_TIMEZONE } from "@/lib/format";

/** Resend is optional: without a key the caller gets a clear, actionable
 *  error instead of a silent no-op. */
export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; content: string }[];
}) {
  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["RESEND_FROM"] ?? "Rentio <no-reply@rentio.com>";
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [options.to],
      subject: options.subject,
      html: options.html,
      attachments: options.attachments,
    }),
  });
  if (!response.ok)
    throw new Error(`Resend responded ${response.status}: ${await response.text()}`);
  return await response.json();
}

/** Where emailed links point. */
export const siteUrl = () => process.env["SITE_URL"] ?? "";

export const formatPeriod = (value: string, locale = "en-US") => {
  const label = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: APP_TIMEZONE,
  }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
  return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
};

/** Names typed by staff end up inside HTML. */
export const escapeHtml = (value: string | null | undefined) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );

/** Shared email chrome. `lang` follows the recipient's language. */
export function emailLayout(title: string, body: string, companyName: string, lang = "en") {
  const company = escapeHtml(companyName);
  return `<!doctype html><html lang="${lang}"><body style="margin:0;background:#FAF9F7;font-family:Inter,Helvetica,Arial,sans-serif;color:#1C1A17">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E7E3DD;border-radius:10px">
        <tr><td style="padding:24px 24px 0">
          <p style="margin:0;font-size:14px;font-weight:600;color:#1B4D3E">${company}</p>
          <h1 style="margin:12px 0 0;font-size:20px;font-weight:600">${title}</h1>
        </td></tr>
        <tr><td style="padding:16px 24px 24px;font-size:14px;line-height:1.6">${body}</td></tr>
        <tr><td style="padding:0 24px 24px;font-size:12px;color:#6B655C;border-top:1px solid #E7E3DD;padding-top:16px">
          ${
            lang === "es-MX"
              ? `Este mensaje fue enviado automáticamente por ${company}. Si tienes dudas, responde a este correo.`
              : `This message was sent automatically by ${company}. Reply to this email with any questions.`
          }
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function button(href: string, label: string) {
  return `<p style="margin:20px 0"><a href="${escapeHtml(href)}"
     style="display:inline-block;background:#1B4D3E;color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">
     ${label}</a></p>`;
}
