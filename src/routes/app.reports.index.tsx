import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { DataTable, type DataTableColumn } from "@/components/rentio/data-table";
import { MoneyText } from "@/components/rentio/money-text";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { formatPeriod } from "@/components/rentio/month-selector";
import { CHART, compactMoney } from "@/lib/chart";
import { formatMoney } from "@/lib/format";
import { currentPeriod, shiftPeriod } from "@/lib/invoicing";
import { usePortfolio } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import i18n from "@/lib/i18n";
import { pageTitle } from "@/lib/brand";

export const Route = createFileRoute("/app/reports/")({
  head: () => ({
    meta: [
      { title: pageTitle(i18n.t("pages.reports.title")) },
      { name: "description", content: i18n.t("pages.reports.description") },
    ],
  }),
  component: ReportsPage,
});

const ALL = "__all__";
const MONTHS = 12;

interface MonthRow {
  period: string;
  label: string;
  income: number;
  expenses: number;
  net: number;
}

/**
 * Rent income vs. expenses, the one report the owner asked for.
 *
 * Income is money actually received (confirmed payments by the day paid), not
 * what was invoiced, so it lines up with expenses by the day spent.
 */
function ReportsPage() {
  const { t, i18n: i18nInstance } = useTranslation();
  const portfolio = usePortfolio();
  const [propertyFilter, setPropertyFilter] = useState(ALL);
  const [unitFilter, setUnitFilter] = useState(ALL);

  const thisMonth = currentPeriod();
  const firstMonth = shiftPeriod(thisMonth, -(MONTHS - 1));

  const payments = useQuery({
    queryKey: ["report-income", firstMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("lease_id, amount, paid_at")
        .eq("status", "confirmado")
        .gte("paid_at", firstMonth);
      if (error) throw error;
      return data ?? [];
    },
  });

  const expenses = useQuery({
    queryKey: ["report-expenses", firstMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("unit_id, amount, spent_at")
        .gte("spent_at", firstMonth);
      if (error) throw error;
      return data ?? [];
    },
  });

  const chartConfig = useMemo<ChartConfig>(
    () => ({
      income: { label: t("reports.income"), color: CHART.collected },
      expenses: { label: t("reports.expenses"), color: CHART.vacant },
    }),
    [t],
  );

  /** Units of the chosen property, or every unit tagged with its property. */
  const unitOptions = useMemo(() => {
    const propertyName = new Map(
      (portfolio.data?.properties ?? []).map((property) => [property.id, property.name]),
    );
    return (portfolio.data?.units ?? [])
      .filter((unit) => propertyFilter === ALL || unit.property_id === propertyFilter)
      .map((unit) => ({
        id: unit.id,
        label:
          propertyFilter === ALL
            ? `${unit.unit_number} · ${propertyName.get(unit.property_id) ?? ""}`
            : unit.unit_number,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }, [portfolio.data, propertyFilter]);

  const months = useMemo<MonthRow[]>(() => {
    const leaseUnit = new Map(
      (portfolio.data?.leases ?? []).map((lease) => [lease.id, lease.unit_id]),
    );
    const unitProperty = new Map(
      (portfolio.data?.units ?? []).map((unit) => [unit.id, unit.property_id]),
    );
    const matches = (unitId: string | undefined) =>
      unitFilter === ALL
        ? propertyFilter === ALL ||
          (unitId !== undefined && unitProperty.get(unitId) === propertyFilter)
        : unitId === unitFilter;

    const buckets = new Map<string, { income: number; expenses: number }>();
    for (let index = MONTHS - 1; index >= 0; index -= 1) {
      buckets.set(shiftPeriod(thisMonth, -index), { income: 0, expenses: 0 });
    }
    for (const row of payments.data ?? []) {
      const bucket = buckets.get(`${row.paid_at.slice(0, 7)}-01`);
      if (bucket && matches(leaseUnit.get(row.lease_id))) bucket.income += Number(row.amount);
    }
    for (const row of expenses.data ?? []) {
      const bucket = buckets.get(`${row.spent_at.slice(0, 7)}-01`);
      if (bucket && matches(row.unit_id)) bucket.expenses += Number(row.amount);
    }
    return [...buckets].map(([period, value]) => ({
      period,
      label: formatPeriod(period, i18nInstance.language).split(" ")[0] ?? period,
      ...value,
      net: value.income - value.expenses,
    }));
  }, [
    portfolio.data,
    payments.data,
    expenses.data,
    propertyFilter,
    unitFilter,
    thisMonth,
    i18nInstance.language,
  ]);

  const totals = months.reduce(
    (sum, row) => ({
      income: sum.income + row.income,
      expenses: sum.expenses + row.expenses,
      net: sum.net + row.net,
    }),
    { income: 0, expenses: 0, net: 0 },
  );

  const columns: DataTableColumn<MonthRow>[] = [
    {
      key: "period",
      header: t("receipts.columns.period"),
      sortValue: (row) => row.period,
      cell: (row) => (
        <span className="numeric">{formatPeriod(row.period, i18nInstance.language)}</span>
      ),
    },
    {
      key: "income",
      header: t("reports.income"),
      numeric: true,
      sortValue: (row) => row.income,
      cell: (row) => <MoneyText value={row.income} />,
    },
    {
      key: "expenses",
      header: t("reports.expenses"),
      numeric: true,
      sortValue: (row) => row.expenses,
      cell: (row) => <MoneyText value={row.expenses} />,
    },
    {
      key: "net",
      header: t("reports.net"),
      numeric: true,
      sortValue: (row) => row.net,
      cell: (row) => <MoneyText value={row.net} />,
    },
  ];

  const kpis = [
    { key: "income", value: totals.income, tone: "" },
    { key: "expenses", value: totals.expenses, tone: "" },
    { key: "net", value: totals.net, tone: totals.net < 0 ? "text-danger" : "text-success" },
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("pages.reports.title")}
        description={t("pages.reports.description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={propertyFilter}
              onValueChange={(value) => {
                setPropertyFilter(value);
                setUnitFilter(ALL);
              }}
            >
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
            <Select value={unitFilter} onValueChange={setUnitFilter}>
              <SelectTrigger className="w-56" aria-label={t("units.columns.unit")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("reports.allUnits")}</SelectItem>
                {unitOptions.map((unit) => (
                  <SelectItem key={unit.id} value={unit.id}>
                    {t("units.columns.unit")} {unit.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      <QueryState
        isLoading={portfolio.isLoading || payments.isLoading || expenses.isLoading}
        error={portfolio.error ?? payments.error ?? expenses.error}
        onRetry={() => {
          void portfolio.refetch();
          void payments.refetch();
          void expenses.refetch();
        }}
        skeleton={<RowsSkeleton count={8} />}
      >
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            {kpis.map((kpi) => (
              <div
                key={kpi.key}
                className="rounded-lg border border-border bg-surface p-4 shadow-subtle"
              >
                <p className="text-xs font-medium text-muted-foreground">
                  {t(`reports.${kpi.key}`)} · {t("reports.last12")}
                </p>
                <p className={cn("numeric mt-1 text-xl font-semibold", kpi.tone)}>
                  {formatMoney(kpi.value)}
                </p>
              </div>
            ))}
          </div>

          <section className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
            <h2 className="text-base font-semibold">{t("reports.chartTitle")}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("reports.chartHint")}</p>
            <ChartContainer config={chartConfig} className="mt-4 aspect-auto h-72 w-full">
              <BarChart data={months} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={compactMoney} tickLine={false} axisLine={false} width={52} />
                <ChartTooltip
                  cursor={{ fill: CHART.grid }}
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => (
                        <span className="flex w-full justify-between gap-3">
                          <span className="text-muted-foreground">
                            {chartConfig[name as string]?.label ?? name}
                          </span>
                          <span className="numeric font-medium">{formatMoney(Number(value))}</span>
                        </span>
                      )}
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="income" fill="var(--color-income)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" fill="var(--color-expenses)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </section>

          <DataTable
            columns={columns}
            data={[...months].reverse()}
            getRowId={(row) => row.period}
            pageSize={12}
          />
        </div>
      </QueryState>
    </div>
  );
}
