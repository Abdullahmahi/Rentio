/**
 * Server-only. The D3 warning: a late fee MAY be charged from a date unless
 * rent arrives first. Staff still add any fee by hand. EN and es-MX, chosen
 * by the tenant's portal language (Spanish when unknown).
 */
import { formatDate, formatMoney } from "@/lib/format";
import { button, emailLayout, escapeHtml, formatPeriod } from "@/lib/server/email";

export interface LateFeeWarning {
  tenant_name: string | null;
  locale: string;
  company_name: string;
  unit_number: string;
  period_month: string;
  eligible_on: string;
  fee: number;
  balance: number;
}

export function lateFeeWarningEmail(warning: LateFeeWarning, portalUrl: string) {
  const es = warning.locale !== "en";
  const lang = es ? "es-MX" : "en";
  const month = formatPeriod(warning.period_month, es ? "es-MX" : "en-US");
  const fee = formatMoney(Number(warning.fee));
  const balance = formatMoney(Number(warning.balance));
  const date = formatDate(warning.eligible_on);
  const name = escapeHtml(warning.tenant_name ?? "");
  const unit = escapeHtml(warning.unit_number);

  const subject = es
    ? `Aviso: tu renta de ${month} sigue pendiente`
    : `Reminder: your ${month} rent is still open`;
  const body = es
    ? `<p>Hola ${name},</p>
       <p>Aún no hemos recibido el pago completo de la renta de <strong>${month}</strong> de la unidad <strong>${unit}</strong>. Saldo pendiente: <strong>${balance}</strong>.</p>
       <p>Se podría cobrar un cargo por pago tardío de <strong>${fee}</strong> a partir del <strong>${date}</strong> si la renta no se recibe antes.</p>
       <p>Si ya pagaste, repórtalo en tu portal para que lo confirmemos.</p>
       ${portalUrl ? button(portalUrl, "Abrir mi portal") : ""}`
    : `<p>Hi ${name},</p>
       <p>We have not yet received full payment of rent for <strong>${month}</strong> for unit <strong>${unit}</strong>. Balance due: <strong>${balance}</strong>.</p>
       <p>A late fee of <strong>${fee}</strong> may be charged on <strong>${date}</strong> if rent for ${month} is not received before then.</p>
       <p>If you already paid, report it in your portal so we can confirm it.</p>
       ${portalUrl ? button(portalUrl, "Open my portal") : ""}`;

  return { subject, html: emailLayout(subject, body, warning.company_name, lang) };
}
