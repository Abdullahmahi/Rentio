import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/rentio/status-badge";
import type { Enums } from "@/lib/database.types";
import { cn } from "@/lib/utils";

type Variant = "success" | "warning" | "danger" | "info" | "neutral";

// Colour is never the only signal — every badge also renders its label.
const UNIT: Record<Enums<"unit_status">, Variant> = {
  vacante: "neutral", ocupada: "success", mantenimiento: "warning", reservada: "info",
};
const LEASE: Record<Enums<"lease_status">, Variant> = {
  borrador: "neutral", activo: "success", por_vencer: "warning",
  terminado: "neutral", rescindido: "danger",
};
const INVOICE: Record<Enums<"invoice_status">, Variant> = {
  borrador: "neutral", enviado: "info", pagado_parcial: "warning",
  pagado: "success", vencido: "danger", cancelado: "neutral",
};
const PAYMENT: Record<Enums<"payment_status">, Variant> = {
  pendiente: "warning", confirmado: "success", cancelado: "neutral",
};
const WO_STATUS: Record<Enums<"wo_status">, Variant> = {
  nueva: "info", asignada: "info", en_progreso: "warning",
  esperando_refacciones: "warning", resuelta: "success", cerrada: "neutral",
};
const WO_PRIORITY: Record<Enums<"wo_priority">, Variant> = {
  baja: "neutral", media: "info", alta: "warning", urgente: "danger",
};
const UTILITY: Record<Enums<"utility_status">, Variant> = {
  pendiente: "warning", facturado: "success",
};

function make<T extends string>(map: Record<T, Variant>, namespace: string) {
  return function Badge({ value, className }: { value: T; className?: string }) {
    const { t } = useTranslation();
    return (
      <span className={cn(namespace === "invoiceStatus" && value === "cancelado" && "line-through", className)}>
        <StatusBadge status={t(`${namespace}.${value}`)} variant={map[value]} />
      </span>
    );
  };
}

export const UnitStatusBadge = make(UNIT, "unitStatus");
export const LeaseStatusBadge = make(LEASE, "leaseStatus");
export const InvoiceStatusBadge = make(INVOICE, "invoiceStatus");
export const PaymentStatusBadge = make(PAYMENT, "paymentStatus");
export const WorkOrderStatusBadge = make(WO_STATUS, "woStatus");
export const WorkOrderPriorityBadge = make(WO_PRIORITY, "woPriority");
export const UtilityStatusBadge = make(UTILITY, "utilityStatus");

/**
 * An invoice past its due date with money still owed reads as `vencido`,
 * whatever the stored status says. Derived in one place so the list, the
 * detail page, the dashboard and the portal cannot disagree.
 */
export function effectiveInvoiceStatus(
  invoice: { status: Enums<"invoice_status">; due_date: string; total: number },
  paid: number,
): Enums<"invoice_status"> {
  if (invoice.status === "cancelado" || invoice.status === "borrador") return invoice.status;
  const balance = Number(invoice.total) - paid;
  if (balance <= 0.005) return "pagado";
  const due = new Date(`${invoice.due_date}T23:59:59`);
  if (due.getTime() < Date.now()) return "vencido";
  return paid > 0 ? "pagado_parcial" : invoice.status;
}
