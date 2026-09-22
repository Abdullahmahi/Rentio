import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type DataTableColumn } from "@/components/rentio/data-table";
import { MoneyText } from "@/components/rentio/money-text";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { LeaseStatusBadge, UnitStatusBadge } from "@/components/rentio/status";
import { StatusBadge } from "@/components/rentio/status-badge";
import { formatPeriod } from "@/components/rentio/month-selector";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/rentio/empty-state";
import { downloadCsv } from "@/lib/csv";
import { daysBetween, formatDate, formatMoney, todayIso } from "@/lib/format";
import { currentPeriod, shiftPeriod } from "@/lib/invoicing";
import { isActive, leaseContexts, occupancy, unitContexts } from "@/lib/portfolio";
import { depositClock } from "@/lib/deposit";
import { usePortfolio } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/app/reports/")({
  head: () => ({
    meta: [
      { title: `${i18n.t("pages.reports.title")} — Rentio` },
      { name: "description", content: i18n.t("pages.reports.description") },
    ],
  }),
  component: ReportsPage,
});

/**
 * A severity ramp, not four categorical hues: 30 days late and 90+ days late
 * are the same kind of fact at different temperatures. Mixed from the existing
 * warning and danger tokens so it follows the theme.
 */
const AGING_RAMP = {
  b30: "var(--warning)",
  b60: "color-mix(in oklab, var(--danger) 35%, var(--warning))",
  b90: "color-mix(in oklab, var(--danger) 70%, var(--warning))",
  b90plus: "var(--danger)",
} as const;

const ALL = "__all__";
const MONTHS = 12;

interface RentRollRow {
  unitNumber: string;
  propertyName: string;
  propertyId: string | null;
  tenant: string;
  rent: number;
  start: string | null;
  end: string | null;
  status: string;
  unitStatus: "vacante" | "ocupada" | "mantenimiento" | "reservada";
  leaseStatus: "borrador" | "activo" | "por_vencer" | "terminado" | "rescindido" | null;
}

interface DepositRow {
  leaseId: string;
  tenant: string;
  unitNumber: string;
  propertyId: string | null;
  depositHeld: number;
  surrenderDate: string | null;
  forwardingDate: string | null;
  dueDate: string | null;
  settledAt: string | null;
  daysTaken: number | null;
  /** "compliant" | "late" | "pending" | "not_started" */
  flag: "compliant" | "late" | "pending" | "not_started";
}

interface AgingRow {
  tenant: string;
  unitNumber: string;
  propertyId: string | null;
  bucket: "b30" | "b60" | "b90" | "b90plus";
  amount: number;
  days: number;
}

function ReportsPage() {
  const { t, i18n: i18nInstance } = useTranslation();
  const portfolio = usePortfolio();
  const [propertyFilter, setPropertyFilter] = useState(ALL);

  const firstMonth = shiftPeriod(currentPeriod(), -(MONTHS - 1));

  const income = useQuery({
    queryKey: ["report-income", firstMonth],
    queryFn: async () => {
      const [{ data: invoices, error }, { data: balances }] = await Promise.all([
        supabase
          .from("invoices")
          .select("id, lease_id, period_month, total, status")
          .gte("period_month", firstMonth),
        supabase.from("invoice_balances").select("invoice_id, paid"),
      ]);
      if (error) throw error;
      const paidById = new Map(
        (balances ?? []).map((row) => [row.invoice_id, Number(row.paid ?? 0)]),
      );
      return (invoices ?? [])
        .filter((invoice) => invoice.status !== "cancelado")
        .map((invoice) => ({
          leaseId: invoice.lease_id,
          period: invoice.period_month,
          invoiced: Number(invoice.total),
          collected: paidById.get(invoice.id) ?? 0,
        }));
    },
  });

  const contexts = useMemo(
    () => (portfolio.data ? leaseContexts(portfolio.data) : []),
    [portfolio.data],
  );
  const units = useMemo(
    () => (portfolio.data ? unitContexts(portfolio.data) : []),
    [portfolio.data],
  );
  const matchesProperty = useCallback(
    (propertyId: string | null | undefined) =>
      propertyFilter === ALL || propertyId === propertyFilter,
    [propertyFilter],
  );

  // ------------------------------------------------------------ rent roll
  const rentRoll = useMemo<RentRollRow[]>(
    () =>
      units
        .filter((row) => matchesProperty(row.property?.id))
        .map((row) => {
          const context = contexts.find((candidate) => candidate.lease.id === row.activeLease?.id);
          return {
            unitNumber: row.unit.unit_number,
            propertyName: row.property?.name ?? "—",
            propertyId: row.property?.id ?? null,
            tenant: row.tenant?.full_name ?? "—",
            rent: Number(row.activeLease?.rent_amount ?? row.unit.base_rent),
            start: row.activeLease?.start_date ?? null,
            end: row.activeLease?.end_date ?? null,
            status: row.unit.status,
            unitStatus: row.unit.status,
            leaseStatus: context?.lease.status ?? null,
          };
        }),
    [units, contexts, matchesProperty],
  );

  // -------------------------------------------------------------- aging
  const aging = useMemo<AgingRow[]>(
    () =>
      contexts
        .filter((context) => isActive(context.lease) && matchesProperty(context.property?.id))
        .flatMap((context) => {
          const amount = Number(context.balance?.balance ?? 0);
          const oldest = context.balance?.oldest_overdue_date;
          if (amount <= 0.005 || !oldest) return [];
          const days = Math.max(0, daysBetween(oldest, todayIso()));
          const bucket: AgingRow["bucket"] =
            days <= 30 ? "b30" : days <= 60 ? "b60" : days <= 90 ? "b90" : "b90plus";
          return [
            {
              tenant: context.primaryTenant?.full_name ?? "—",
              unitNumber: context.unit?.unit_number ?? "—",
              propertyId: context.property?.id ?? null,
              bucket,
              amount,
              days,
            },
          ];
        })
        .sort((a, b) => b.days - a.days),
    [contexts, matchesProperty],
  );

  const bucketTotals = (["b30", "b60", "b90", "b90plus"] as const).map((bucket) => ({
    bucket,
    total: aging.filter((row) => row.bucket === bucket).reduce((sum, row) => sum + row.amount, 0),
    count: aging.filter((row) => row.bucket === bucket).length,
  }));

  const overdueTotal = bucketTotals.reduce((sum, entry) => sum + entry.total, 0);

  // ------------------------------------------------------ income by month
  const leasePropertyId = useMemo(
    () => new Map(contexts.map((context) => [context.lease.id, context.property?.id ?? null])),
    [contexts],
  );

  const monthlyIncome = useMemo(() => {
    const buckets = new Map<string, { invoiced: number; collected: number }>();
    for (let index = MONTHS - 1; index >= 0; index -= 1) {
      buckets.set(shiftPeriod(currentPeriod(), -index), { invoiced: 0, collected: 0 });
    }
    for (const row of income.data ?? []) {
      if (!matchesProperty(leasePropertyId.get(row.leaseId) ?? null)) continue;
      const bucket = buckets.get(row.period);
      if (!bucket) continue;
      bucket.invoiced += row.invoiced;
      bucket.collected += row.collected;
    }
    return [...buckets.entries()].map(([period, value]) => ({ period, ...value }));
  }, [income.data, leasePropertyId, propertyFilter]);

  // ---------------------------------------------------------- occupancy
  const vacancies = useMemo(
    () =>
      units
        .filter((row) => row.unit.status === "vacante" && matchesProperty(row.property?.id))
        .map((row) => {
          // Days vacant runs from the end of the most recent lease on the unit.
          const ended = contexts
            .filter(
              (context) => context.lease.unit_id === row.unit.id && context.lease.move_out_date,
            )
            .map((context) => context.lease.move_out_date as string)
            .sort()
            .at(-1);
          return {
            unitNumber: row.unit.unit_number,
            propertyName: row.property?.name ?? "—",
            baseRent: Number(row.unit.base_rent),
            since: ended ?? null,
            days: ended ? Math.max(0, daysBetween(ended, todayIso())) : null,
          };
        })
        .sort((a, b) => (b.days ?? 0) - (a.days ?? 0)),
    [units, contexts, matchesProperty],
  );

  const occupancyStats = portfolio.data
    ? occupancy(portfolio.data, propertyFilter === ALL ? undefined : propertyFilter)
    : { total: 0, occupied: 0, vacant: 0, rate: 0 };

  // --------------------------------------------------------------- tables
  const rentRollColumns: DataTableColumn<RentRollRow>[] = [
    {
      key: "unit",
      header: t("units.columns.unit"),
      sortValue: (row) => row.unitNumber,
      cell: (row) => <span className="font-medium">{row.unitNumber}</span>,
    },
    {
      key: "property",
      header: t("units.columns.property"),
      sortValue: (row) => row.propertyName,
      cell: (row) => row.propertyName,
    },
    {
      key: "tenant",
      header: t("contracts.columns.tenant"),
      sortValue: (row) => row.tenant,
      cell: (row) => row.tenant,
    },
    {
      key: "rent",
      header: t("contracts.columns.rent"),
      numeric: true,
      sortValue: (row) => row.rent,
      cell: (row) => <MoneyText value={row.rent} />,
    },
    {
      key: "start",
      header: t("contracts.columns.start"),
      sortValue: (row) => row.start ?? "",
      cell: (row) => <span className="numeric">{row.start ? formatDate(row.start) : "—"}</span>,
    },
    {
      key: "end",
      header: t("contracts.columns.end"),
      sortValue: (row) => row.end ?? "",
      cell: (row) => <span className="numeric">{row.end ? formatDate(row.end) : "—"}</span>,
    },
    {
      key: "unitStatus",
      header: t("units.columns.status"),
      sortValue: (row) => row.unitStatus,
      cell: (row) => <UnitStatusBadge value={row.unitStatus} />,
    },
    {
      key: "leaseStatus",
      header: t("contracts.columns.status"),
      sortValue: (row) => row.leaseStatus ?? "",
      cell: (row) =>
        row.leaseStatus ? (
          <LeaseStatusBadge value={row.leaseStatus} />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  const agingColumns: DataTableColumn<AgingRow>[] = [
    {
      key: "tenant",
      header: t("contracts.columns.tenant"),
      sortValue: (row) => row.tenant,
      cell: (row) => row.tenant,
    },
    {
      key: "unit",
      header: t("units.columns.unit"),
      sortValue: (row) => row.unitNumber,
      cell: (row) => row.unitNumber,
    },
    {
      key: "days",
      header: t("reports.daysOverdue"),
      numeric: true,
      sortValue: (row) => row.days,
      cell: (row) => row.days,
    },
    {
      key: "bucket",
      header: t("reports.bucket"),
      sortValue: (row) => row.bucket,
      cell: (row) => t(`reports.buckets.${row.bucket}`),
    },
    {
      key: "amount",
      header: t("payments.columns.amount"),
      numeric: true,
      sortValue: (row) => row.amount,
      cell: (row) => <MoneyText value={row.amount} className="text-danger" />,
    },
  ];

  const incomeColumns: DataTableColumn<(typeof monthlyIncome)[number]>[] = [
    {
      key: "period",
      header: t("receipts.columns.period"),
      sortValue: (row) => row.period,
      cell: (row) => (
        <span className="numeric">{formatPeriod(row.period, i18nInstance.language)}</span>
      ),
    },
    {
      key: "invoiced",
      header: t("dashboard.invoiced"),
      numeric: true,
      sortValue: (row) => row.invoiced,
      cell: (row) => <MoneyText value={row.invoiced} />,
    },
    {
      key: "collected",
      header: t("dashboard.collected"),
      numeric: true,
      sortValue: (row) => row.collected,
      cell: (row) => <MoneyText value={row.collected} />,
    },
    {
      key: "rate",
      header: t("reports.collectionRate"),
      numeric: true,
      sortValue: (row) => (row.invoiced > 0 ? row.collected / row.invoiced : 0),
      cell: (row) => (
        <span className="numeric">
          {row.invoiced > 0 ? `${Math.round((row.collected / row.invoiced) * 100)}%` : "—"}
        </span>
      ),
    },
  ];

  const vacancyColumns: DataTableColumn<(typeof vacancies)[number]>[] = [
    {
      key: "unit",
      header: t("units.columns.unit"),
      sortValue: (row) => row.unitNumber,
      cell: (row) => <span className="font-medium">{row.unitNumber}</span>,
    },
    {
      key: "property",
      header: t("units.columns.property"),
      sortValue: (row) => row.propertyName,
      cell: (row) => row.propertyName,
    },
    {
      key: "rent",
      header: t("units.columns.baseRent"),
      numeric: true,
      sortValue: (row) => row.baseRent,
      cell: (row) => <MoneyText value={row.baseRent} />,
    },
    {
      key: "since",
      header: t("reports.vacantSince"),
      sortValue: (row) => row.since ?? "",
      cell: (row) => <span className="numeric">{row.since ? formatDate(row.since) : "—"}</span>,
    },
    {
      key: "days",
      header: t("reports.daysVacant"),
      numeric: true,
      sortValue: (row) => row.days ?? 0,
      cell: (row) => row.days ?? "—",
    },
  ];

  /**
   * Every terminated lease, whether its deposit clock has started, and
   * whether it was settled inside the statutory 30 days.
   */
  const depositRows = useMemo<DepositRow[]>(
    () =>
      contexts
        .filter(
          (context) =>
            context.lease.surrender_date !== null && matchesProperty(context.property?.id),
        )
        .map((context) => {
          const clock = depositClock(context.lease);
          const settledAt = context.lease.deposit_settled_at;
          const dueDate = context.lease.deposit_due_date;
          const received = context.lease.forwarding_address_received_at;
          return {
            leaseId: context.lease.id,
            tenant: context.primaryTenant?.full_name ?? "—",
            unitNumber: context.unit?.unit_number ?? "—",
            propertyId: context.property?.id ?? null,
            depositHeld: Number(context.lease.deposit_amount),
            surrenderDate: context.lease.surrender_date,
            forwardingDate: received,
            dueDate,
            settledAt,
            daysTaken: settledAt && received ? daysBetween(received, settledAt) : null,
            flag:
              settledAt && dueDate
                ? settledAt <= dueDate
                  ? ("compliant" as const)
                  : ("late" as const)
                : clock.stage === "awaiting_forwarding"
                  ? ("not_started" as const)
                  : clock.stage === "overdue"
                    ? ("late" as const)
                    : ("pending" as const),
          };
        })
        .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")),
    [contexts, matchesProperty],
  );

  const depositColumns: DataTableColumn<DepositRow>[] = [
    {
      key: "tenant",
      header: t("contracts.columns.tenant"),
      sortValue: (row) => row.tenant,
      cell: (row) => row.tenant,
    },
    {
      key: "unit",
      header: t("units.columns.unit"),
      sortValue: (row) => row.unitNumber,
      cell: (row) => <span className="numeric">{row.unitNumber}</span>,
    },
    {
      key: "deposit",
      header: t("contracts.fields.deposit"),
      numeric: true,
      sortValue: (row) => row.depositHeld,
      cell: (row) => <MoneyText value={row.depositHeld} />,
    },
    {
      key: "surrender",
      header: t("contracts.fields.surrenderDate"),
      numeric: true,
      sortValue: (row) => row.surrenderDate ?? "",
      cell: (row) => (
        <span className="numeric">{row.surrenderDate ? formatDate(row.surrenderDate) : "—"}</span>
      ),
    },
    {
      key: "forwarding",
      header: t("contracts.fields.forwardingReceived"),
      numeric: true,
      sortValue: (row) => row.forwardingDate ?? "",
      cell: (row) => (
        <span className="numeric">{row.forwardingDate ? formatDate(row.forwardingDate) : "—"}</span>
      ),
    },
    {
      key: "due",
      header: t("reports.depositDueDate"),
      numeric: true,
      sortValue: (row) => row.dueDate ?? "",
      cell: (row) => <span className="numeric">{row.dueDate ? formatDate(row.dueDate) : "—"}</span>,
    },
    {
      key: "settled",
      header: t("contracts.fields.depositSettledAt"),
      numeric: true,
      sortValue: (row) => row.settledAt ?? "",
      cell: (row) => (
        <span className="numeric">{row.settledAt ? formatDate(row.settledAt) : "—"}</span>
      ),
    },
    {
      key: "daysTaken",
      header: t("reports.daysTaken"),
      numeric: true,
      sortValue: (row) => row.daysTaken ?? 0,
      cell: (row) => <span className="numeric">{row.daysTaken ?? "—"}</span>,
    },
    {
      key: "flag",
      header: t("reports.depositCompliance"),
      sortValue: (row) => row.flag,
      cell: (row) => (
        <StatusBadge
          status={t(`reports.depositFlag.${row.flag}`)}
          variant={
            row.flag === "compliant"
              ? "success"
              : row.flag === "late"
                ? "danger"
                : row.flag === "not_started"
                  ? "warning"
                  : "info"
          }
        />
      ),
    },
  ];

  const exporters = {
    rentRoll: () =>
      downloadCsv(
        `rent-roll-${todayIso()}`,
        [
          t("units.columns.unit"),
          t("units.columns.property"),
          t("contracts.columns.tenant"),
          t("contracts.columns.rent"),
          t("contracts.columns.start"),
          t("contracts.columns.end"),
          t("units.columns.status"),
        ],
        rentRoll.map((row) => [
          row.unitNumber,
          row.propertyName,
          row.tenant,
          row.rent,
          row.start ?? "",
          row.end ?? "",
          t(`unitStatus.${row.unitStatus}`),
        ]),
      ),
    aging: () =>
      downloadCsv(
        `morosidad-${todayIso()}`,
        [
          t("contracts.columns.tenant"),
          t("units.columns.unit"),
          t("reports.daysOverdue"),
          t("reports.bucket"),
          t("payments.columns.amount"),
        ],
        aging.map((row) => [
          row.tenant,
          row.unitNumber,
          row.days,
          t(`reports.buckets.${row.bucket}`),
          row.amount,
        ]),
      ),
    deposits: () =>
      downloadCsv(
        `deposit-compliance-${todayIso()}`,
        [
          t("contracts.columns.tenant"),
          t("units.columns.unit"),
          t("contracts.fields.deposit"),
          t("contracts.fields.surrenderDate"),
          t("contracts.fields.forwardingReceived"),
          t("reports.depositDueDate"),
          t("contracts.fields.depositSettledAt"),
          t("reports.daysTaken"),
          t("reports.depositCompliance"),
        ],
        depositRows.map((row) => [
          row.tenant,
          row.unitNumber,
          row.depositHeld,
          row.surrenderDate ?? "",
          row.forwardingDate ?? "",
          row.dueDate ?? "",
          row.settledAt ?? "",
          row.daysTaken ?? "",
          t(`reports.depositFlag.${row.flag}`),
        ]),
      ),
    income: () =>
      downloadCsv(
        `ingresos-${todayIso()}`,
        [t("receipts.columns.period"), t("dashboard.invoiced"), t("dashboard.collected")],
        monthlyIncome.map((row) => [row.period, row.invoiced, row.collected]),
      ),
    occupancy: () =>
      downloadCsv(
        `ocupacion-${todayIso()}`,
        [
          t("units.columns.unit"),
          t("units.columns.property"),
          t("units.columns.baseRent"),
          t("reports.vacantSince"),
          t("reports.daysVacant"),
        ],
        vacancies.map((row) => [
          row.unitNumber,
          row.propertyName,
          row.baseRent,
          row.since ?? "",
          row.days ?? "",
        ]),
      ),
  };

  /**
   * "Export" tells you nothing. The row count and the filename tell you what
   * you are about to get, and whether the filter you set is the one you meant.
   */
  const ExportButton = ({
    onClick,
    rows,
    filename,
  }: {
    onClick: () => void;
    rows: number;
    filename: string;
  }) => {
    const disabled = rows === 0;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={disabled ? "inline-flex cursor-not-allowed" : "inline-flex"}>
            <Button variant="outline" onClick={onClick} disabled={disabled}>
              <Download className="size-4" />
              {disabled
                ? t("reports.exportEmpty")
                : t("reports.exportRows", { count: rows, filename: `${filename}.csv` })}
            </Button>
          </span>
        </TooltipTrigger>
        {disabled ? <TooltipContent>{t("reports.exportEmptyHint")}</TooltipContent> : null}
      </Tooltip>
    );
  };

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <PageHeader
          title={t("pages.reports.title")}
          description={t("pages.reports.description")}
          actions={
            <Select value={propertyFilter} onValueChange={setPropertyFilter}>
              <SelectTrigger className="w-56" aria-label={t("units.filters.property")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("units.filters.allProperties")}</SelectItem>
                {portfolio.data?.properties.map((property) => (
                  <SelectItem key={property.id} value={property.id}>
                    {property.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />

        <QueryState
          isLoading={portfolio.isLoading}
          error={portfolio.error ?? income.error}
          onRetry={() => {
            void portfolio.refetch();
            void income.refetch();
          }}
          skeleton={<RowsSkeleton count={8} />}
        >
          <Tabs defaultValue="rent-roll">
            <TabsList className="flex-wrap">
              <TabsTrigger value="rent-roll">{t("reports.tabs.rentRoll")}</TabsTrigger>
              <TabsTrigger value="aging">{t("reports.tabs.aging")}</TabsTrigger>
              <TabsTrigger value="deposits">{t("reports.tabs.deposits")}</TabsTrigger>
              <TabsTrigger value="income">{t("reports.tabs.income")}</TabsTrigger>
              <TabsTrigger value="occupancy">{t("reports.tabs.occupancy")}</TabsTrigger>
            </TabsList>

            <TabsContent value="rent-roll" className="mt-4 space-y-3">
              <div className="flex justify-end">
                <ExportButton
                  onClick={exporters.rentRoll}
                  rows={rentRoll.length}
                  filename={`rent-roll-${todayIso()}`}
                />
              </div>
              <DataTable
                columns={rentRollColumns}
                data={rentRoll}
                getRowId={(row) => `${row.propertyName}-${row.unitNumber}`}
                searchValue={(row) => `${row.unitNumber} ${row.propertyName} ${row.tenant}`}
                pageSize={20}
              />
            </TabsContent>

            <TabsContent value="aging" className="mt-4 space-y-3">
              {/* The shape of the delinquency is the insight — four numbers in a
                row hide whether it is one very old lease or forty new ones. */}
              {overdueTotal > 0 ? (
                <div className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
                  <div className="flex h-7 w-full overflow-hidden rounded-full">
                    {bucketTotals
                      .filter((entry) => entry.total > 0)
                      .map((entry) => (
                        <div
                          key={entry.bucket}
                          className="h-full"
                          style={{
                            width: `${(entry.total / overdueTotal) * 100}%`,
                            background: AGING_RAMP[entry.bucket],
                          }}
                          title={`${t(`reports.buckets.${entry.bucket}`)} · ${formatMoney(entry.total)}`}
                        />
                      ))}
                  </div>
                  <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                    {bucketTotals.map((entry) => (
                      <li key={entry.bucket} className="flex items-center gap-2 text-sm">
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ background: AGING_RAMP[entry.bucket] }}
                        />
                        <span className="text-muted-foreground">
                          {t(`reports.buckets.${entry.bucket}`)}
                        </span>
                        <span className="numeric font-semibold">{formatMoney(entry.total)}</span>
                        <span className="numeric text-xs text-muted-foreground">
                          {t("reports.leaseCount", { count: entry.count })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <EmptyState message={t("reports.noOverdue")} />
              )}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {bucketTotals.map((entry) => (
                  <div
                    key={entry.bucket}
                    className="rounded-lg border border-border bg-surface p-4 shadow-subtle"
                  >
                    <p className="text-xs font-medium text-muted-foreground">
                      {t(`reports.buckets.${entry.bucket}`)}
                    </p>
                    <p className="numeric mt-1 text-xl font-semibold text-danger">
                      {formatMoney(entry.total)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("reports.leaseCount", { count: entry.count })}
                    </p>
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <ExportButton
                  onClick={exporters.aging}
                  rows={aging.length}
                  filename={`morosidad-${todayIso()}`}
                />
              </div>
              <DataTable
                columns={agingColumns}
                data={aging}
                getRowId={(row) => `${row.unitNumber}-${row.tenant}`}
                searchValue={(row) => `${row.tenant} ${row.unitNumber}`}
                pageSize={20}
              />
            </TabsContent>

            <TabsContent value="deposits" className="mt-4 space-y-3">
              <p className="rounded-lg border border-info/25 bg-info/10 px-3 py-2 text-sm text-info">
                {t("reports.depositComplianceHint")}
              </p>
              <div className="flex justify-end">
                <ExportButton
                  onClick={exporters.deposits}
                  rows={depositRows.length}
                  filename={`deposit-compliance-${todayIso()}`}
                />
              </div>
              <DataTable
                columns={depositColumns}
                data={depositRows}
                getRowId={(row) => row.leaseId}
                searchValue={(row) => `${row.tenant} ${row.unitNumber}`}
                pageSize={20}
              />
            </TabsContent>

            <TabsContent value="income" className="mt-4 space-y-3">
              <div className="flex justify-end">
                <ExportButton
                  onClick={exporters.income}
                  rows={monthlyIncome.length}
                  filename={`ingresos-${todayIso()}`}
                />
              </div>
              <DataTable
                columns={incomeColumns}
                data={monthlyIncome}
                getRowId={(row) => row.period}
                pageSize={12}
              />
            </TabsContent>

            <TabsContent value="occupancy" className="mt-4 space-y-3">
              <div className="grid gap-4 sm:grid-cols-3">
                {(
                  [
                    ["dashboard.kpi.occupancy", `${Math.round(occupancyStats.rate * 100)}%`],
                    [
                      "properties.stats.occupied",
                      `${occupancyStats.occupied} / ${occupancyStats.total}`,
                    ],
                    ["reports.vacantUnits", String(occupancyStats.vacant)],
                  ] as const
                ).map(([key, value]) => (
                  <div
                    key={key}
                    className="rounded-lg border border-border bg-surface p-4 shadow-subtle"
                  >
                    <p className="text-xs font-medium text-muted-foreground">{t(key)}</p>
                    <p className="numeric mt-1 text-xl font-semibold">{value}</p>
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <ExportButton
                  onClick={exporters.occupancy}
                  rows={vacancies.length}
                  filename={`ocupacion-${todayIso()}`}
                />
              </div>
              <DataTable
                columns={vacancyColumns}
                data={vacancies}
                getRowId={(row) => `${row.propertyName}-${row.unitNumber}`}
                searchValue={(row) => `${row.unitNumber} ${row.propertyName}`}
                pageSize={20}
              />
            </TabsContent>
          </Tabs>
        </QueryState>
      </div>
    </TooltipProvider>
  );
}
