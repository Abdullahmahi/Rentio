/**
 * Server-only. One email per outbox row (public.notifications), EN and
 * es-MX by the tenant's portal language (Spanish when unknown). Plain
 * sentences: these land on a phone.
 */
import { formatDate, formatMoney } from "@/lib/format";
import { button, emailLayout, escapeHtml, formatPeriod } from "@/lib/server/email";

export interface NotificationRow {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  tenant_name: string | null;
  tenant_email: string | null;
  locale: string;
  company_name: string;
  unit_number: string | null;
}

const WO_STATUS: Record<string, [en: string, es: string]> = {
  nueva: ["Received", "Recibida"],
  asignada: ["Assigned to a technician", "Asignada a técnico"],
  en_progreso: ["In progress", "En proceso"],
  esperando_refacciones: ["Waiting for parts", "Esperando refacciones"],
  resuelta: ["Resolved", "Resuelta"],
  cerrada: ["Closed", "Cerrada"],
};

const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => formatMoney(Number(value ?? 0));

export function notificationEmail(row: NotificationRow, portalUrl: string) {
  const es = row.locale !== "en";
  const lang = es ? "es-MX" : "en";
  const name = escapeHtml(row.tenant_name ?? "");
  const unit = escapeHtml(row.unit_number ?? "");
  const p = row.payload;
  const open = portalUrl ? button(portalUrl, es ? "Abrir mi portal" : "Open my portal") : "";
  const hi = es ? `<p>Hola ${name},</p>` : `<p>Hi ${name},</p>`;

  let subject: string;
  let body: string;

  switch (row.kind) {
    case "payment_confirmed": {
      const amount = num(p["amount"]);
      const date = formatDate(str(p["paid_at"]));
      subject = es ? `Pago de ${amount} confirmado` : `Payment of ${amount} confirmed`;
      body = es
        ? `${hi}<p>Confirmamos tu pago de <strong>${amount}</strong> del <strong>${date}</strong> para la unidad <strong>${unit}</strong>. Tu recibo está en el portal.</p>${open}`
        : `${hi}<p>We confirmed your payment of <strong>${amount}</strong> from <strong>${date}</strong> for unit <strong>${unit}</strong>. Your receipt is in the portal.</p>${open}`;
      break;
    }
    case "payment_rejected": {
      const amount = num(p["amount"]);
      const reason = escapeHtml(str(p["reason"]));
      subject = es
        ? `No pudimos confirmar tu pago de ${amount}`
        : `We couldn't confirm your payment of ${amount}`;
      body = es
        ? `${hi}<p>No pudimos confirmar el pago de <strong>${amount}</strong> que reportaste para la unidad <strong>${unit}</strong>.</p>${reason ? `<p>Motivo: <strong>${reason}</strong></p>` : ""}<p>Si crees que es un error, llámanos o vuelve a reportarlo con una foto del comprobante.</p>${open}`
        : `${hi}<p>We couldn't confirm the payment of <strong>${amount}</strong> you reported for unit <strong>${unit}</strong>.</p>${reason ? `<p>Reason: <strong>${reason}</strong></p>` : ""}<p>If you think this is a mistake, call us or report it again with a photo of the receipt.</p>${open}`;
      break;
    }
    case "work_order_status": {
      const title = escapeHtml(str(p["title"]));
      const [en, esLabel] = WO_STATUS[str(p["status"])] ?? [str(p["status"]), str(p["status"])];
      const status = es ? esLabel : en;
      subject = es ? `Tu solicitud: ${status}` : `Your request: ${status}`;
      body = es
        ? `${hi}<p>Tu solicitud <strong>${title}</strong> cambió a <strong>${status}</strong>.</p>${open}`
        : `${hi}<p>Your request <strong>${title}</strong> is now <strong>${status}</strong>.</p>${open}`;
      break;
    }
    case "work_order_note": {
      const title = escapeHtml(str(p["title"]));
      const note = escapeHtml(str(p["body"]));
      subject = es ? `Novedades sobre: ${title}` : `Update on: ${title}`;
      body = es
        ? `${hi}<p>Sobre tu solicitud <strong>${title}</strong>:</p><blockquote style="margin:0;padding:8px 12px;border-left:3px solid #E7E3DD">${note}</blockquote>${open}`
        : `${hi}<p>About your request <strong>${title}</strong>:</p><blockquote style="margin:0;padding:8px 12px;border-left:3px solid #E7E3DD">${note}</blockquote>${open}`;
      break;
    }
    case "rent_reminder": {
      const month = formatPeriod(str(p["period_month"]), es ? "es-MX" : "en-US");
      const due = formatDate(str(p["due_date"]));
      const balance = num(p["balance"]);
      subject = es ? `Tu renta de ${month} vence el ${due}` : `Your ${month} rent is due ${due}`;
      body = es
        ? `${hi}<p>La renta de <strong>${month}</strong> de la unidad <strong>${unit}</strong> vence el <strong>${due}</strong>. Saldo: <strong>${balance}</strong>.</p><p>Pagar tu renta no tiene costo. Si ya pagaste, repórtalo en el portal.</p>${open}`
        : `${hi}<p>Rent for <strong>${month}</strong> for unit <strong>${unit}</strong> is due <strong>${due}</strong>. Balance: <strong>${balance}</strong>.</p><p>There is never a fee to pay rent. If you already paid, report it in the portal.</p>${open}`;
      break;
    }
    default:
      throw new Error(`unknown notification kind: ${row.kind}`);
  }

  return { subject, html: emailLayout(subject, body, row.company_name, lang) };
}
