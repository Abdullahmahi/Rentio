import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CarFront, FileText, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type DataTableColumn } from "@/components/rentio/data-table";
import { DocumentsPanel } from "@/components/rentio/documents-panel";
import { EmptyState } from "@/components/rentio/empty-state";
import { MoneyText } from "@/components/rentio/money-text";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import {
  LeaseStatusBadge,
  UnitStatusBadge,
  WorkOrderPriorityBadge,
  WorkOrderStatusBadge,
} from "@/components/rentio/status";
import { formatDate } from "@/lib/format";
import { leaseContexts, type LeaseContext } from "@/lib/portfolio";
import { qk, usePortfolio } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/app/units/$id")({
  head: () => ({
    meta: [
      { title: `${i18n.t("pages.detail.unit")} — Rentio` },
      { name: "description", content: i18n.t("pages.units.description") },
    ],
  }),
  component: UnitDetailPage,
});

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 border-b border-border py-2.5 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

function UnitDetailPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const portfolio = usePortfolio();

  const unit = portfolio.data?.units.find((row) => row.id === id);
  const property = portfolio.data?.properties.find((row) => row.id === unit?.property_id);

  const { current, history } = useMemo(() => {
    if (!portfolio.data) return { current: undefined, history: [] as LeaseContext[] };
    const all = leaseContexts(portfolio.data).filter((row) => row.lease.unit_id === id);
    return {
      current: all.find(
        (row) => row.lease.status === "activo" || row.lease.status === "por_vencer",
      ),
      history: all.filter(
        (row) => row.lease.status !== "activo" && row.lease.status !== "por_vencer",
      ),
    };
  }, [portfolio.data, id]);

  const workOrders = useQuery({
    queryKey: [...qk.workOrders, "unit", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select("*")
        .eq("unit_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const historyColumns: DataTableColumn<LeaseContext>[] = [
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
      cell: (row) => formatDate(row.lease.start_date),
    },
    {
      key: "end",
      header: t("contracts.columns.end"),
      sortValue: (row) => row.lease.end_date,
      cell: (row) => formatDate(row.lease.end_date),
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
      cell: (row) => <LeaseStatusBadge value={row.lease.status} />,
    },
  ];

  const woColumns: DataTableColumn<Tables<"work_orders">>[] = [
    {
      key: "folio",
      header: t("maintenance.columns.folio"),
      sortValue: (row) => row.folio ?? "",
      cell: (row) => <span className="font-medium">{row.folio ?? "—"}</span>,
    },
    {
      key: "title",
      header: t("maintenance.columns.title"),
      sortValue: (row) => row.title,
      cell: (row) => row.title,
    },
    {
      key: "priority",
      header: t("maintenance.columns.priority"),
      sortValue: (row) => row.priority,
      cell: (row) => <WorkOrderPriorityBadge value={row.priority} />,
    },
    {
      key: "status",
      header: t("maintenance.columns.status"),
      sortValue: (row) => row.status,
      cell: (row) => <WorkOrderStatusBadge value={row.status} />,
    },
    {
      key: "created",
      header: t("maintenance.columns.created"),
      sortValue: (row) => row.created_at,
      cell: (row) => formatDate(row.created_at),
    },
  ];

  return (
    <div className="space-y-6">
      <Link
        to="/app/units"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("units.backToList")}
      </Link>

      <QueryState
        isLoading={portfolio.isLoading}
        error={portfolio.error}
        isEmpty={!unit && !portfolio.isLoading}
        onRetry={() => void portfolio.refetch()}
        skeleton={<RowsSkeleton count={4} />}
        empty={
          <EmptyState message={t("units.notFound")} description={t("units.notFoundDescription")} />
        }
      >
        {unit ? (
          <>
            <PageHeader
              title={t("units.detailTitle", { number: unit.unit_number })}
              description={property?.name}
              actions={
                <div className="flex items-center gap-3">
                  <UnitStatusBadge value={unit.status} />
                  <MoneyText value={Number(unit.base_rent)} className="text-base font-semibold" />
                </div>
              }
            />

            <Tabs defaultValue="summary">
              <TabsList className="flex-wrap">
                <TabsTrigger value="summary">{t("units.tabs.summary")}</TabsTrigger>
                <TabsTrigger value="lease">{t("units.tabs.lease")}</TabsTrigger>
                <TabsTrigger value="history">{t("units.tabs.history")}</TabsTrigger>
                <TabsTrigger value="maintenance">{t("nav.maintenance")}</TabsTrigger>
                <TabsTrigger value="documents">{t("documents.title")}</TabsTrigger>
              </TabsList>

              <TabsContent value="summary" className="mt-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <section className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
                    <h2 className="text-base font-semibold">{t("units.tabs.specs")}</h2>
                    <dl className="mt-3">
                      <Row label={t("units.columns.property")}>{property?.name ?? "—"}</Row>
                      <Row label={t("units.columns.floor")}>{unit.floor ?? "—"}</Row>
                      <Row label={t("units.columns.bedrooms")}>{unit.bedrooms ?? "—"}</Row>
                      <Row label={t("units.columns.bathrooms")}>{unit.bathrooms ?? "—"}</Row>
                      <Row label={t("units.columns.sqm")}>{unit.sqm ?? "—"}</Row>
                      <Row label={t("units.columns.baseRent")}>
                        <MoneyText value={Number(unit.base_rent)} />
                      </Row>
                    </dl>
                  </section>

                  <section className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
                    <h2 className="text-base font-semibold">{t("units.tabs.current")}</h2>
                    {current ? (
                      <dl className="mt-3">
                        <Row label={t("units.columns.tenant")}>
                          {current.primaryTenant?.full_name ?? "—"}
                        </Row>
                        <Row label={t("contracts.columns.rent")}>
                          <MoneyText value={Number(current.lease.rent_amount)} />
                        </Row>
                        <Row label={t("contracts.columns.start")}>
                          {formatDate(current.lease.start_date)}
                        </Row>
                        <Row label={t("contracts.columns.end")}>
                          {formatDate(current.lease.end_date)}
                        </Row>
                        <Row label={t("nav.parking")}>
                          {current.parking.length > 0 ? (
                            current.parking.map((space) => space.label).join(", ")
                          ) : (
                            <span className="text-muted-foreground">{t("units.noParking")}</span>
                          )}
                        </Row>
                      </dl>
                    ) : (
                      <div className="mt-3">
                        <EmptyState
                          icon={FileText}
                          message={t("units.vacantTitle")}
                          description={t("units.vacantDescription")}
                          actionLabel={t("contracts.new")}
                          onAction={() => void navigate({ to: "/app/contracts" })}
                        />
                      </div>
                    )}
                  </section>
                </div>
              </TabsContent>

              <TabsContent value="lease" className="mt-4">
                {current ? (
                  <section className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-base font-semibold">
                          {current.primaryTenant?.full_name ?? t("units.tabs.lease")}
                        </h2>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {formatDate(current.lease.start_date)} —{" "}
                          {formatDate(current.lease.end_date)}
                        </p>
                      </div>
                      <LeaseStatusBadge value={current.lease.status} />
                    </div>
                    <dl className="mt-4">
                      <Row label={t("contracts.columns.rent")}>
                        <MoneyText value={Number(current.lease.rent_amount)} />
                      </Row>
                      <Row label={t("contracts.fields.dueDay")}>{current.lease.rent_due_day}</Row>
                      <Row label={t("contracts.fields.deposit")}>
                        <MoneyText value={Number(current.lease.deposit_amount)} />
                      </Row>
                      <Row label={t("contracts.columns.balance")}>
                        <MoneyText value={Number(current.balance?.balance ?? 0)} />
                      </Row>
                    </dl>
                    <Button
                      className="mt-4"
                      variant="outline"
                      onClick={() =>
                        void navigate({
                          to: "/app/contracts/$id",
                          params: { id: current.lease.id },
                        })
                      }
                    >
                      {t("units.openLease")}
                    </Button>
                  </section>
                ) : (
                  <EmptyState
                    icon={FileText}
                    message={t("units.vacantTitle")}
                    description={t("units.vacantDescription")}
                    actionLabel={t("contracts.new")}
                    onAction={() => void navigate({ to: "/app/contracts" })}
                  />
                )}
              </TabsContent>

              <TabsContent value="history" className="mt-4">
                {history.length === 0 ? (
                  <EmptyState
                    icon={FileText}
                    message={t("units.noHistory")}
                    description={t("units.noHistoryDescription")}
                  />
                ) : (
                  <DataTable
                    columns={historyColumns}
                    data={history}
                    getRowId={(row) => row.lease.id}
                    onRowClick={(row) =>
                      void navigate({ to: "/app/contracts/$id", params: { id: row.lease.id } })
                    }
                  />
                )}
              </TabsContent>

              <TabsContent value="maintenance" className="mt-4">
                <QueryState
                  isLoading={workOrders.isLoading}
                  error={workOrders.error}
                  isEmpty={(workOrders.data?.length ?? 0) === 0}
                  onRetry={() => void workOrders.refetch()}
                  skeleton={<RowsSkeleton count={3} />}
                  empty={
                    <EmptyState
                      icon={Wrench}
                      message={t("maintenance.emptyTitle")}
                      description={t("maintenance.emptyDescription")}
                    />
                  }
                >
                  <DataTable
                    columns={woColumns}
                    data={workOrders.data ?? []}
                    getRowId={(row) => row.id}
                    searchValue={(row) => `${row.folio ?? ""} ${row.title}`}
                    onRowClick={(row) =>
                      void navigate({ to: "/app/maintenance/$id", params: { id: row.id } })
                    }
                  />
                </QueryState>
              </TabsContent>

              <TabsContent value="documents" className="mt-4">
                <DocumentsPanel ownerType="unit" ownerId={id} bucket="company" />
              </TabsContent>
            </Tabs>

            {current && current.parking.length > 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CarFront className="size-4" />
                {t("units.parkingAssigned", {
                  labels: current.parking.map((space) => space.label).join(", "),
                })}
              </p>
            ) : null}
          </>
        ) : null}
      </QueryState>
    </div>
  );
}
