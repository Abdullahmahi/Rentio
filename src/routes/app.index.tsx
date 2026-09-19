import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { EmptyState } from "@/components/rentio/empty-state";
import { MoneyText } from "@/components/rentio/money-text";
import { PageHeader } from "@/components/rentio/page-header";
import { CardsSkeleton, QueryState } from "@/components/rentio/query-state";
import { WorkOrderStatusBadge } from "@/components/rentio/status";
import { formatPeriod } from "@/components/rentio/month-selector";
import { CHART, UNIT_STATUS_COLOR, compactMXN } from "@/lib/chart";
import { formatMXN, formatMexicoDate } from "@/lib/format";
import { periodKey, shiftPeriod } from "@/lib/invoicing";
import { daysUntilEnd, isActive, isExpiringSoon, leaseContexts, occupancy } from "@/lib/portfolio";
import { qk, usePortfolio } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { Enums } from "@/lib/database.types";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/app/")({
  head: () => ({ meta: [
    { title: `${i18n.t("pages.dashboard.title")} — Rentio` },
    { name: "description", content: i18n.t("pages.dashboard.description") },
  ] }),
  component: DashboardPage,
});

const MONTHS_BACK = 6;
const UNIT_STATUSES: Enums<"unit_status">[] = ["ocupada", "vacante", "mantenimiento", "reservada"];

function Kpi({ label, value, note, tone, bar }: {
  label: string; value: string; note?: string | undefined;
  tone?: string | undefined; bar?: number | undefined;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-subtle">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`numeric mt-1 text-2xl font-semibold ${tone ?? ""}`}>{value}</p>
      {bar !== undefined ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.round(bar * 100))}%` }} />
        </div>
      ) : null}
      {note ? <p className={`mt-1.5 text-xs ${tone ?? "text-muted-foreground"}`}>{note}</p> : null}
    </div>
  );
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean | undefined;
  payload?: { name?: string; value?: number; color?: string; dataKey?: string }[] | undefined;
  label?: string | undefined;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-subtle">
      <p className="font-medium">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey ?? entry.name} className="numeric mt-0.5 text-muted-foreground">
          <span className="mr-1.5 inline-block size-2 rounded-full align-middle" style={{ background: entry.color }} />
          {entry.name}: {formatMXN(Number(entry.value ?? 0))}
        </p>
      ))}
    </div>
  );
}

function DashboardPage() {
  const { t, i18n: i18nInstance } = useTranslation();
  const navigate = useNavigate();
  const portfolio = usePortfolio();

  const thisMonth = periodKey(new Date());
  const lastMonth = shiftPeriod(thisMonth, -1);
  const firstMonth = shiftPeriod(thisMonth, -(MONTHS_BACK - 1));

  /** Six months of invoices plus their paid amounts, for the trend chart. */
  const trend = useQuery({
    queryKey: ["dashboard-trend", firstMonth],
    queryFn: async () => {
      const [{ data: invoices, error }, { data: balances }] = await Promise.all([
        supabase.from("invoices").select("id, period_month, total, status").gte("period_month", firstMonth),
        supabase.from("invoice_balances").select("invoice_id, paid"),
      ]);
      if (error) throw error;
      const paidById = new Map((balances ?? []).map((row) => [row.invoice_id, Number(row.paid ?? 0)]));
      return (invoices ?? [])
        .filter((invoice) => invoice.status !== "cancelado")
        .map((invoice) => ({
          period: invoice.period_month,
          invoiced: Number(invoice.total),
          collected: paidById.get(invoice.id) ?? 0,
        }));
    },
  });

  const pendingPayments = useQuery({
    queryKey: [...qk.payments, "pending-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("payments").select("id", { count: "exact", head: true }).eq("status", "pendiente");
      if (error) throw error;
      return count ?? 0;
    },
  });

  const recentPayments = useQuery({
    queryKey: [...qk.payments, "recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments").select("*").eq("status", "confirmado")
        .order("paid_at", { ascending: false }).limit(5);
      if (error) throw error;
      return data;
    },
  });

  const recentOrders = useQuery({
    queryKey: [...qk.workOrders, "recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders").select("*").order("created_at", { ascending: false }).limit(5);
      if (error) throw error;
      return data;
    },
  });

  const openOrderCounts = useQuery({
    queryKey: [...qk.workOrders, "open-counts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("work_orders").select("status, priority");
      if (error) throw error;
      const open = (data ?? []).filter(
        (order) => !["resuelta", "cerrada"].includes(order.status),
      );
      return { open: open.length, urgent: open.filter((order) => order.priority === "urgente").length };
    },
  });

  const contexts = useMemo(() => (portfolio.data ? leaseContexts(portfolio.data) : []), [portfolio.data]);
  const stats = portfolio.data ? occupancy(portfolio.data) : { total: 0, occupied: 0, vacant: 0, rate: 0 };

  const monthly = useMemo(() => {
    const buckets = new Map<string, { invoiced: number; collected: number }>();
    for (let index = MONTHS_BACK - 1; index >= 0; index -= 1) {
      buckets.set(shiftPeriod(thisMonth, -index), { invoiced: 0, collected: 0 });
    }
    for (const row of trend.data ?? []) {
      const bucket = buckets.get(row.period);
      if (!bucket) continue;
      bucket.invoiced += row.invoiced;
      bucket.collected += row.collected;
    }
    return [...buckets.entries()].map(([period, value]) => ({
      period,
      label: formatPeriod(period, i18nInstance.language).split(" ")[0] ?? period,
      ...value,
    }));
  }, [trend.data, thisMonth, i18nInstance.language]);

  const current = monthly.at(-1) ?? { invoiced: 0, collected: 0 };
  const previous = monthly.at(-2) ?? { invoiced: 0, collected: 0 };

  const overdue = useMemo(
    () => contexts
      .filter((context) => isActive(context.lease) && Number(context.balance?.balance ?? 0) > 0.005)
      .map((context) => {
        const oldest = context.balance?.oldest_overdue_date;
        return {
          context,
          amount: Number(context.balance?.balance ?? 0),
          days: oldest
            ? Math.max(0, Math.floor((Date.now() - new Date(`${oldest}T00:00:00`).getTime()) / 86_400_000))
            : 0,
        };
      })
      .filter((row) => row.days > 0)
      .sort((a, b) => b.days - a.days),
    [contexts],
  );

  const expiring = contexts.filter((context) => isExpiringSoon(context.lease));

  const byStatus = UNIT_STATUSES
    .map((status) => ({
      status,
      name: t(`unitStatus.${status}`),
      value: (portfolio.data?.units ?? []).filter((unit) => unit.status === status).length,
    }))
    .filter((entry) => entry.value > 0);

  const trendNote = (currentValue: number, previousValue: number) => {
    if (previousValue <= 0) return undefined;
    const delta = Math.round(((currentValue - previousValue) / previousValue) * 100);
    return t(delta >= 0 ? "dashboard.trendUp" : "dashboard.trendDown", { percent: Math.abs(delta) });
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("pages.dashboard.title")} description={t("pages.dashboard.description")} />

      {/* Alert strip — the confirmation queue is the thing that goes stale. */}
      {(pendingPayments.data ?? 0) > 0 ? (
        <Link
          to="/app/payments"
          className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm font-medium text-warning hover:bg-warning/15"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{t("dashboard.pendingPayments", { count: pendingPayments.data ?? 0 })}</span>
          <ArrowRight className="size-4 shrink-0" />
        </Link>
      ) : null}

      <QueryState
        isLoading={portfolio.isLoading}
        error={portfolio.error}
        onRetry={() => void portfolio.refetch()}
        skeleton={<CardsSkeleton count={5} height="h-24" />}
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Kpi
            label={t("dashboard.kpi.occupancy")}
            value={t("dashboard.unitsOf", { occupied: stats.occupied, total: stats.total })}
            note={`${Math.round(stats.rate * 100)}%`}
            bar={stats.rate}
          />
          <Kpi
            label={t("dashboard.kpi.collected")}
            value={formatMXN(current.collected)}
            note={t("dashboard.ofInvoiced", { amount: formatMXN(current.invoiced) })}
            bar={current.invoiced > 0 ? current.collected / current.invoiced : 0}
          />
          <Kpi
            label={t("dashboard.kpi.overdue")}
            value={formatMXN(overdue.reduce((sum, row) => sum + row.amount, 0))}
            note={t("dashboard.overdueLeases", { count: overdue.length })}
            tone="text-danger"
          />
          <Kpi
            label={t("dashboard.kpi.openOrders")}
            value={String(openOrderCounts.data?.open ?? 0)}
            note={(openOrderCounts.data?.urgent ?? 0) > 0
              ? t("dashboard.urgentOrders", { count: openOrderCounts.data?.urgent ?? 0 })
              : undefined}
            tone={(openOrderCounts.data?.urgent ?? 0) > 0 ? "text-accent" : undefined}
          />
          <Kpi
            label={t("dashboard.kpi.expiring")}
            value={String(expiring.length)}
            note={expiring.length > 0
              ? t("dashboard.expiringSoonest", { days: Math.min(...expiring.map((row) => daysUntilEnd(row.lease))) })
              : undefined}
          />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {/* ------------------------------------- invoiced vs collected */}
          <section className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
            <h2 className="text-base font-semibold">{t("dashboard.incomeTitle")}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("dashboard.incomeHint")}</p>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                {/* Part-of-whole: the total is a recessive track, not a second
                    competing hue — a gray can never be a categorical slot. */}
                <BarChart data={monthly} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false}
                    tick={{ fill: CHART.axis, fontSize: 12 }} />
                  <YAxis tickFormatter={compactMXN} tickLine={false} axisLine={false} width={52}
                    tick={{ fill: CHART.axis, fontSize: 12 }} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: CHART.grid }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  <Bar dataKey="invoiced" name={t("dashboard.invoiced")} fill={CHART.track} radius={[4, 4, 0, 0]} barSize={22} />
                  <Bar dataKey="collected" name={t("dashboard.collected")} fill={CHART.collected} radius={[4, 4, 0, 0]} barSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* ------------------------------------------- units by status */}
          <section className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
            <h2 className="text-base font-semibold">{t("dashboard.unitsTitle")}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("dashboard.unitsHint")}</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={byStatus} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="86%"
                      paddingAngle={2} stroke="var(--surface)" strokeWidth={2}>
                      {byStatus.map((entry) => (
                        <Cell key={entry.status} fill={UNIT_STATUS_COLOR[entry.status]} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const entry = payload[0];
                        return (
                          <div className="rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-subtle">
                            <span className="numeric">{entry?.name}: {entry?.value}</span>
                          </div>
                        );
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {/* Direct labels — identity is never colour alone. */}
              <ul className="space-y-2">
                {byStatus.map((entry) => (
                  <li key={entry.status} className="flex items-center gap-2 text-sm">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: UNIT_STATUS_COLOR[entry.status] }} />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{entry.name}</span>
                    <span className="numeric font-semibold">{entry.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* ---------------------------------------- overdue lease list */}
          <section className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
            <h2 className="text-base font-semibold">{t("dashboard.overdueTitle")}</h2>
            {overdue.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">{t("dashboard.noOverdue")}</p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {overdue.slice(0, 6).map((row) => (
                  <li key={row.context.lease.id}>
                    <button
                      onClick={() => void navigate({ to: "/app/contracts/$id", params: { id: row.context.lease.id } })}
                      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5 text-left hover:bg-muted/40"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{row.context.primaryTenant?.full_name ?? "—"}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {t("units.columns.unit")} {row.context.unit?.unit_number ?? "—"} · {t("dashboard.daysOverdue", { count: row.days })}
                        </p>
                      </div>
                      <MoneyText value={row.amount} className="text-danger" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ------------------------------ recent payments & work orders */}
          <div className="space-y-6">
            <section className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
              <h2 className="text-base font-semibold">{t("dashboard.recentPayments")}</h2>
              {(recentPayments.data?.length ?? 0) === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">{t("payments.emptyTitle")}</p>
              ) : (
                <ul className="mt-3 divide-y divide-border">
                  {recentPayments.data?.map((payment) => (
                    <li key={payment.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{t(`paymentMethod.${payment.method}`)}</p>
                        <p className="numeric text-xs text-muted-foreground">{formatMexicoDate(payment.paid_at)}</p>
                      </div>
                      <MoneyText value={Number(payment.amount)} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
              <h2 className="text-base font-semibold">{t("dashboard.recentOrders")}</h2>
              {(recentOrders.data?.length ?? 0) === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">{t("maintenance.emptyTitle")}</p>
              ) : (
                <ul className="mt-3 divide-y divide-border">
                  {recentOrders.data?.map((order) => (
                    <li key={order.id}>
                      <button
                        onClick={() => void navigate({ to: "/app/maintenance/$id", params: { id: order.id } })}
                        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5 text-left hover:bg-muted/40"
                      >
                        <span className="min-w-0 truncate text-sm">{order.title}</span>
                        <WorkOrderStatusBadge value={order.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>

        {stats.total === 0 ? (
          <EmptyState message={t("properties.emptyTitle")} description={t("properties.emptyDescription")} />
        ) : null}
      </QueryState>
    </div>
  );
}
