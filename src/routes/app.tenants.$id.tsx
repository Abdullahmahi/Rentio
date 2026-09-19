import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Mail, Users, Wrench } from "lucide-react";
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
  PaymentStatusBadge,
  WorkOrderStatusBadge,
} from "@/components/rentio/status";
import { formatMexicoDate } from "@/lib/format";
import { isActive, leaseContexts } from "@/lib/portfolio";
import { logActivity, qk, useActorId, usePortfolio, useToastMutation } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export const Route = createFileRoute("/app/tenants/$id")({ component: TenantDetailPage });

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 border-b border-border py-2.5 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

function TenantDetailPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const portfolio = usePortfolio();
  const actorId = useActorId();
  const [inviteError, setInviteError] = useState<string | null>(null);

  const tenant = portfolio.data?.tenants.find((row) => row.id === id);

  const leases = useMemo(() => {
    if (!portfolio.data) return [];
    const mine = new Set(
      portfolio.data.leaseTenants
        .filter((link) => link.tenant_id === id)
        .map((link) => link.lease_id),
    );
    return leaseContexts(portfolio.data).filter((context) => mine.has(context.lease.id));
  }, [portfolio.data, id]);

  const currentLease = leases.find((context) => isActive(context.lease));
  const leaseIds = leases.map((context) => context.lease.id);

  /** Has this tenant already been given portal access? */
  const portalProfile = useQuery({
    queryKey: ["tenant-profile", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, created_at, role")
        .eq("tenant_id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const payments = useQuery({
    queryKey: [...qk.payments, "tenant", id, leaseIds.join(",")],
    enabled: leaseIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .in("lease_id", leaseIds)
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const workOrders = useQuery({
    queryKey: [...qk.workOrders, "tenant", id, leaseIds.join(",")],
    enabled: leaseIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select("*")
        .in("lease_id", leaseIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const invite = useToastMutation({
    mutationFn: async () => {
      if (!tenant?.email) throw new Error("missing-email");
      // Creating an auth user needs the service role, so it lives in an edge
      // function (send-tenant-invite). See supabase/functions.
      const { error } = await supabase.functions.invoke("send-tenant-invite", {
        body: { tenant_id: id, email: tenant.email, full_name: tenant.full_name },
      });
      if (error) throw error;
      await logActivity(actorId, "tenant", id, "invite", { email: tenant.email });
    },
    successKey: "tenants.invited",
    invalidate: [["tenant-profile", id]],
  });

  const paymentColumns: DataTableColumn<Tables<"payments">>[] = [
    {
      key: "date",
      header: t("payments.columns.date"),
      sortValue: (row) => row.paid_at,
      cell: (row) => formatMexicoDate(row.paid_at),
    },
    {
      key: "amount",
      header: t("payments.columns.amount"),
      numeric: true,
      sortValue: (row) => Number(row.amount),
      cell: (row) => <MoneyText value={Number(row.amount)} />,
    },
    {
      key: "method",
      header: t("payments.columns.method"),
      sortValue: (row) => row.method,
      cell: (row) => t(`paymentMethod.${row.method}`),
    },
    {
      key: "reference",
      header: t("payments.columns.reference"),
      sortValue: (row) => row.reference ?? "",
      cell: (row) => <span className="numeric">{row.reference ?? "—"}</span>,
    },
    {
      key: "status",
      header: t("payments.columns.status"),
      sortValue: (row) => row.status,
      cell: (row) => <PaymentStatusBadge value={row.status} />,
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
      key: "status",
      header: t("maintenance.columns.status"),
      sortValue: (row) => row.status,
      cell: (row) => <WorkOrderStatusBadge value={row.status} />,
    },
    {
      key: "created",
      header: t("maintenance.columns.created"),
      sortValue: (row) => row.created_at,
      cell: (row) => formatMexicoDate(row.created_at),
    },
  ];

  const balance = Number(currentLease?.balance?.balance ?? 0);

  return (
    <div className="space-y-6">
      <Link
        to="/app/tenants"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("tenants.backToList")}
      </Link>

      <QueryState
        isLoading={portfolio.isLoading}
        error={portfolio.error}
        isEmpty={!tenant && !portfolio.isLoading}
        onRetry={() => void portfolio.refetch()}
        skeleton={<RowsSkeleton count={4} />}
        empty={
          <EmptyState
            icon={Users}
            message={t("tenants.notFound")}
            description={t("tenants.notFoundDescription")}
          />
        }
      >
        {tenant ? (
          <>
            <PageHeader
              title={tenant.full_name}
              description={[tenant.email, tenant.phone].filter(Boolean).join(" · ")}
              actions={
                portalProfile.data ? (
                  <span className="inline-flex items-center gap-2 rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm font-medium text-success">
                    <CheckCircle2 className="size-4" />
                    {t("tenants.portalActiveSince", {
                      date: formatMexicoDate(portalProfile.data.created_at),
                    })}
                  </span>
                ) : (
                  <div className="text-right">
                    <Button
                      onClick={() => {
                        setInviteError(null);
                        if (!tenant.email)
                          return setInviteError(t("tenants.errors.emailRequiredForInvite"));
                        invite.mutate(undefined);
                      }}
                      disabled={invite.isPending}
                    >
                      <Mail className="size-4" />
                      {t("tenants.invite")}
                    </Button>
                    {inviteError ? (
                      <p role="alert" className="mt-1.5 text-xs text-danger">
                        {inviteError}
                      </p>
                    ) : null}
                  </div>
                )
              }
            />

            <Tabs defaultValue="summary">
              <TabsList className="flex-wrap">
                <TabsTrigger value="summary">{t("units.tabs.summary")}</TabsTrigger>
                <TabsTrigger value="payments">{t("nav.payments")}</TabsTrigger>
                <TabsTrigger value="maintenance">{t("nav.maintenance")}</TabsTrigger>
                <TabsTrigger value="documents">{t("documents.title")}</TabsTrigger>
              </TabsList>

              <TabsContent value="summary" className="mt-4">
                <div className="grid gap-4 lg:grid-cols-3">
                  <section className="rounded-lg border border-border bg-surface p-5 shadow-subtle lg:col-span-2">
                    <h2 className="text-base font-semibold">{t("tenants.contactTitle")}</h2>
                    <dl className="mt-3">
                      <Row label={t("tenants.fields.email")}>{tenant.email ?? "—"}</Row>
                      <Row label={t("tenants.fields.phone")}>
                        <span className="numeric">{tenant.phone ?? "—"}</span>
                      </Row>
                      <Row label={t("tenants.fields.rfc")}>{tenant.rfc ?? "—"}</Row>
                      <Row label={t("tenants.fields.emergencyName")}>
                        {tenant.emergency_contact_name ?? "—"}
                      </Row>
                      <Row label={t("tenants.fields.emergencyPhone")}>
                        <span className="numeric">{tenant.emergency_contact_phone ?? "—"}</span>
                      </Row>
                      {tenant.notes ? (
                        <Row label={t("tenants.fields.notes")}>{tenant.notes}</Row>
                      ) : null}
                    </dl>
                  </section>

                  <section className="space-y-4">
                    <div className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
                      <p className="text-xs font-medium text-muted-foreground">
                        {t("contracts.columns.balance")}
                      </p>
                      <MoneyText
                        value={balance}
                        className={`mt-1 block text-2xl font-semibold ${balance > 0 ? "text-danger" : ""}`}
                      />
                      {currentLease?.balance?.oldest_overdue_date ? (
                        <p className="mt-1 text-xs text-danger">
                          {t("contracts.oldestOverdue", {
                            date: formatMexicoDate(currentLease.balance.oldest_overdue_date),
                          })}
                        </p>
                      ) : null}
                    </div>

                    <div className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
                      <h2 className="text-base font-semibold">{t("tenants.currentLease")}</h2>
                      {currentLease ? (
                        <>
                          <dl className="mt-3">
                            <Row label={t("units.columns.unit")}>
                              {currentLease.unit?.unit_number ?? "—"}
                            </Row>
                            <Row label={t("units.columns.property")}>
                              {currentLease.property?.name ?? "—"}
                            </Row>
                            <Row label={t("contracts.columns.rent")}>
                              <MoneyText value={Number(currentLease.lease.rent_amount)} />
                            </Row>
                            <Row label={t("contracts.columns.status")}>
                              <LeaseStatusBadge value={currentLease.lease.status} />
                            </Row>
                          </dl>
                          <Button
                            className="mt-4"
                            variant="outline"
                            onClick={() =>
                              void navigate({
                                to: "/app/contracts/$id",
                                params: { id: currentLease.lease.id },
                              })
                            }
                          >
                            {t("units.openLease")}
                          </Button>
                        </>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground">{t("tenants.noLease")}</p>
                      )}
                    </div>
                  </section>
                </div>
              </TabsContent>

              <TabsContent value="payments" className="mt-4">
                <QueryState
                  isLoading={payments.isLoading && leaseIds.length > 0}
                  error={payments.error}
                  isEmpty={(payments.data?.length ?? 0) === 0}
                  onRetry={() => void payments.refetch()}
                  skeleton={<RowsSkeleton count={4} />}
                  empty={
                    <EmptyState
                      message={t("payments.emptyTitle")}
                      description={t("payments.emptyDescription")}
                    />
                  }
                >
                  <DataTable
                    columns={paymentColumns}
                    data={payments.data ?? []}
                    getRowId={(row) => row.id}
                  />
                </QueryState>
              </TabsContent>

              <TabsContent value="maintenance" className="mt-4">
                <QueryState
                  isLoading={workOrders.isLoading && leaseIds.length > 0}
                  error={workOrders.error}
                  isEmpty={(workOrders.data?.length ?? 0) === 0}
                  onRetry={() => void workOrders.refetch()}
                  skeleton={<RowsSkeleton count={4} />}
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
                    onRowClick={(row) =>
                      void navigate({ to: "/app/maintenance/$id", params: { id: row.id } })
                    }
                  />
                </QueryState>
              </TabsContent>

              <TabsContent value="documents" className="mt-4">
                <DocumentsPanel ownerType="tenant" ownerId={id} bucket="tenant-docs" />
              </TabsContent>
            </Tabs>
          </>
        ) : null}
      </QueryState>
    </div>
  );
}
