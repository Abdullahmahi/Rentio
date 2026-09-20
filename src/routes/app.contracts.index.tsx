import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FileText, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, type DataTableColumn } from "@/components/rentio/data-table";
import { EmptyState } from "@/components/rentio/empty-state";
import { LeaseWizard } from "@/components/rentio/lease-wizard";
import { MoneyText } from "@/components/rentio/money-text";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { LeaseStatusBadge } from "@/components/rentio/status";
import { StatusBadge } from "@/components/rentio/status-badge";
import { formatDate } from "@/lib/format";
import { daysUntilEnd, isExpiringSoon, leaseContexts, type LeaseContext } from "@/lib/portfolio";
import { usePortfolio } from "@/lib/queries";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/app/contracts/")({
  head: () => ({
    meta: [
      { title: `${i18n.t("pages.contracts.title")} — Rentio` },
      { name: "description", content: i18n.t("pages.contracts.description") },
    ],
  }),
  component: ContractsPage,
});

const ALL = "__all__";

function ContractsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const portfolio = usePortfolio();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [propertyFilter, setPropertyFilter] = useState(ALL);

  const rows = useMemo(() => {
    if (!portfolio.data) return [];
    return leaseContexts(portfolio.data).filter((context) => {
      if (statusFilter !== ALL && context.lease.status !== statusFilter) return false;
      if (propertyFilter !== ALL && context.property?.id !== propertyFilter) return false;
      return true;
    });
  }, [portfolio.data, statusFilter, propertyFilter]);

  const columns: DataTableColumn<LeaseContext>[] = [
    {
      key: "unit",
      header: t("units.columns.unit"),
      sortValue: (row) => row.unit?.unit_number ?? "",
      cell: (row) => (
        <div className="min-w-0">
          <div className="font-medium">{row.unit?.unit_number ?? "—"}</div>
          <div className="truncate text-xs text-muted-foreground">{row.property?.name}</div>
        </div>
      ),
    },
    {
      key: "tenant",
      header: t("contracts.columns.tenant"),
      sortValue: (row) => row.primaryTenant?.full_name ?? "",
      cell: (row) => row.primaryTenant?.full_name ?? "—",
    },
    {
      key: "start",
      header: t("contracts.columns.start"),
      sortValue: (row) => row.lease.start_date,
      cell: (row) => <span className="numeric">{formatDate(row.lease.start_date)}</span>,
    },
    {
      key: "end",
      header: t("contracts.columns.end"),
      sortValue: (row) => row.lease.end_date,
      cell: (row) => <span className="numeric">{formatDate(row.lease.end_date)}</span>,
    },
    {
      key: "rent",
      header: t("contracts.columns.rent"),
      numeric: true,
      sortValue: (row) => Number(row.lease.rent_amount),
      cell: (row) => <MoneyText value={Number(row.lease.rent_amount)} />,
    },
    {
      key: "status",
      header: t("contracts.columns.status"),
      sortValue: (row) => row.lease.status,
      cell: (row) =>
        // A lease inside its last 60 days is flagged even while still `activo`.
        isExpiringSoon(row.lease) ? (
          <StatusBadge status={t("leaseStatus.por_vencer")} variant="warning" />
        ) : (
          <LeaseStatusBadge value={row.lease.status} />
        ),
    },
    {
      key: "balance",
      header: t("contracts.columns.balance"),
      numeric: true,
      sortValue: (row) => Number(row.balance?.balance ?? 0),
      cell: (row) => {
        const balance = Number(row.balance?.balance ?? 0);
        return <MoneyText value={balance} className={balance > 0 ? "text-danger" : undefined} />;
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("pages.contracts.title")}
        description={t("pages.contracts.description")}
        actions={
          <Button onClick={() => setWizardOpen(true)}>
            <Plus className="size-4" />
            {t("contracts.new")}
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-xl">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger aria-label={t("contracts.columns.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("contracts.filters.allStatuses")}</SelectItem>
            {(["borrador", "activo", "por_vencer", "terminado", "rescindido"] as const).map(
              (status) => (
                <SelectItem key={status} value={status}>
                  {t(`leaseStatus.${status}`)}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
        <Select value={propertyFilter} onValueChange={setPropertyFilter}>
          <SelectTrigger aria-label={t("units.filters.property")}>
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
      </div>

      <QueryState
        isLoading={portfolio.isLoading}
        error={portfolio.error}
        isEmpty={rows.length === 0}
        onRetry={() => void portfolio.refetch()}
        skeleton={<RowsSkeleton count={8} />}
        empty={
          <EmptyState
            icon={FileText}
            message={t("contracts.emptyTitle")}
            description={t("contracts.emptyDescription")}
            actionLabel={t("contracts.new")}
            onAction={() => setWizardOpen(true)}
          />
        }
      >
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(row) => row.lease.id}
          searchValue={(row) =>
            `${row.unit?.unit_number ?? ""} ${row.primaryTenant?.full_name ?? ""} ${row.property?.name ?? ""}`
          }
          onRowClick={(row) =>
            void navigate({ to: "/app/contracts/$id", params: { id: row.lease.id } })
          }
          pageSize={15}
        />
      </QueryState>

      {rows.some((row) => isExpiringSoon(row.lease)) ? (
        <p className="text-sm text-muted-foreground">
          {t("contracts.expiringHint", {
            count: rows.filter((row) => isExpiringSoon(row.lease)).length,
            days: Math.min(
              ...rows
                .filter((row) => isExpiringSoon(row.lease))
                .map((row) => daysUntilEnd(row.lease)),
            ),
          })}
        </p>
      ) : null}

      <LeaseWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreated={(leaseId) =>
          void navigate({ to: "/app/contracts/$id", params: { id: leaseId } })
        }
      />
    </div>
  );
}
