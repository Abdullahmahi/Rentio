import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CarFront, FileText, Pencil, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type DataTableColumn } from "@/components/rentio/data-table";
import { DocumentsPanel } from "@/components/rentio/documents-panel";
import { EmptyState } from "@/components/rentio/empty-state";
import { Field, FormDialog } from "@/components/rentio/form-dialog";
import { LeaseWizard, seedFromLease, type LeaseWizardSeed } from "@/components/rentio/lease-wizard";
import { MoneyInput } from "@/components/rentio/money-input";
import { MoneyText } from "@/components/rentio/money-text";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import {
  InvoiceStatusBadge,
  LeaseStatusBadge,
  PaymentStatusBadge,
  effectiveInvoiceStatus,
} from "@/components/rentio/status";
import { AdminOnly } from "@/lib/auth";
import { formatDate, todayIso } from "@/lib/format";
import { isActive, leaseContexts } from "@/lib/portfolio";
import {
  logActivity,
  qk,
  useActorId,
  useInvoices,
  usePortfolio,
  useToastMutation,
  type InvoiceWithPaid,
} from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export const Route = createFileRoute("/app/contracts/$id")({ component: ContractDetailPage });

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 border-b border-border py-2.5 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

function ContractDetailPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const portfolio = usePortfolio();
  const actorId = useActorId();

  const [renewSeed, setRenewSeed] = useState<LeaseWizardSeed | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const [rentOpen, setRentOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rentAmount, setRentAmount] = useState<number | "">("");
  const [endForm, setEndForm] = useState({
    move_out_date: todayIso(),
    refunded: "" as number | "",
    retained: "" as number | "",
    notes: "",
  });

  const context = useMemo(
    () =>
      portfolio.data ? leaseContexts(portfolio.data).find((row) => row.lease.id === id) : undefined,
    [portfolio.data, id],
  );
  const lease = context?.lease;

  const invoices = useInvoices({ leaseId: id });

  const payments = useQuery({
    queryKey: [...qk.payments, "lease", id],
    queryFn: async () => {
      const { data, error: caught } = await supabase
        .from("payments")
        .select("*")
        .eq("lease_id", id)
        .order("paid_at", { ascending: false });
      if (caught) throw caught;
      return data;
    },
  });

  const updateRent = useToastMutation({
    mutationFn: async (amount: number) => {
      const { error: caught } = await supabase
        .from("leases")
        .update({ rent_amount: amount })
        .eq("id", id);
      if (caught) throw caught;
      await logActivity(actorId, "lease", id, "update_rent", {
        from: lease?.rent_amount,
        to: amount,
      });
    },
    successKey: "contracts.rentUpdated",
    invalidate: [qk.portfolio],
    onSuccess: () => setRentOpen(false),
  });

  const terminate = useToastMutation({
    mutationFn: async (values: typeof endForm) => {
      if (!lease) throw new Error("missing-lease");

      const { error: leaseError } = await supabase
        .from("leases")
        .update({
          status: "terminado",
          move_out_date: values.move_out_date,
          deposit_refunded: values.refunded === "" ? 0 : values.refunded,
          deposit_retained: values.retained === "" ? 0 : values.retained,
          deposit_status: "liquidado",
          deposit_notes: values.notes || null,
        })
        .eq("id", id);
      if (leaseError) throw leaseError;

      const { error: unitError } = await supabase
        .from("units")
        .update({ status: "vacante" })
        .eq("id", lease.unit_id);
      if (unitError) throw unitError;

      // Parking follows the lease out — otherwise it keeps getting billed.
      const { error: parkingError } = await supabase
        .from("parking_spaces")
        .update({ lease_id: null, status: "disponible" })
        .eq("lease_id", id);
      if (parkingError) throw parkingError;

      await logActivity(actorId, "lease", id, "terminate", {
        move_out_date: values.move_out_date,
        refunded: values.refunded,
        retained: values.retained,
      });
    },
    successKey: "contracts.terminated",
    invalidate: [qk.portfolio],
    onSuccess: () => setEndOpen(false),
  });

  const invoiceColumns: DataTableColumn<InvoiceWithPaid>[] = [
    {
      key: "folio",
      header: t("receipts.columns.folio"),
      sortValue: (row) => row.invoice_number ?? "",
      cell: (row) => <span className="font-medium">{row.invoice_number ?? "—"}</span>,
    },
    {
      key: "period",
      header: t("receipts.columns.period"),
      sortValue: (row) => row.period_month,
      cell: (row) => <span className="numeric">{formatDate(row.period_month)}</span>,
    },
    {
      key: "due",
      header: t("receipts.columns.due"),
      sortValue: (row) => row.due_date,
      cell: (row) => <span className="numeric">{formatDate(row.due_date)}</span>,
    },
    {
      key: "total",
      header: t("receipts.columns.total"),
      numeric: true,
      sortValue: (row) => Number(row.total),
      cell: (row) => <MoneyText value={Number(row.total)} />,
    },
    {
      key: "balance",
      header: t("receipts.columns.balance"),
      numeric: true,
      sortValue: (row) => row.balance,
      cell: (row) => <MoneyText value={row.balance} />,
    },
    {
      key: "status",
      header: t("receipts.columns.status"),
      sortValue: (row) => row.status,
      cell: (row) => <InvoiceStatusBadge value={effectiveInvoiceStatus(row, row.paid)} />,
    },
  ];

  const paymentColumns: DataTableColumn<Tables<"payments">>[] = [
    {
      key: "date",
      header: t("payments.columns.date"),
      sortValue: (row) => row.paid_at,
      cell: (row) => <span className="numeric">{formatDate(row.paid_at)}</span>,
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

  const balance = Number(context?.balance?.balance ?? 0);

  return (
    <div className="space-y-6">
      <Link
        to="/app/contracts"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("contracts.backToList")}
      </Link>

      <QueryState
        isLoading={portfolio.isLoading}
        error={portfolio.error}
        isEmpty={!context && !portfolio.isLoading}
        onRetry={() => void portfolio.refetch()}
        skeleton={<RowsSkeleton count={4} />}
        empty={
          <EmptyState
            icon={FileText}
            message={t("contracts.notFound")}
            description={t("contracts.notFoundDescription")}
          />
        }
      >
        {context && lease ? (
          <>
            <PageHeader
              title={t("contracts.detailTitle", {
                unit: context.unit?.unit_number ?? "—",
                tenant: context.primaryTenant?.full_name ?? "—",
              })}
              description={`${context.property?.name ?? ""} · ${formatDate(lease.start_date)} — ${formatDate(lease.end_date)}`}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <LeaseStatusBadge value={lease.status} />
                  <Button
                    variant="outline"
                    onClick={() =>
                      setRenewSeed(
                        seedFromLease(
                          lease,
                          portfolio.data?.leaseTenants.filter((link) => link.lease_id === id) ?? [],
                        ),
                      )
                    }
                  >
                    <RefreshCw className="size-4" />
                    {t("contracts.renew")}
                  </Button>
                  {isActive(lease) ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEndForm({
                          move_out_date: todayIso(),
                          refunded: Number(lease.deposit_amount),
                          retained: 0,
                          notes: "",
                        });
                        setEndOpen(true);
                      }}
                    >
                      {t("contracts.terminate")}
                    </Button>
                  ) : null}
                </div>
              }
            />

            {/* ------------------------------------------------ balance card */}
            <section className="grid gap-4 rounded-lg border border-border bg-surface p-5 shadow-subtle sm:grid-cols-4">
              {(
                [
                  ["contracts.balance.invoiced", Number(context.balance?.total_invoiced ?? 0), ""],
                  ["contracts.balance.paid", Number(context.balance?.total_paid ?? 0), ""],
                  ["contracts.balance.balance", balance, balance > 0 ? "text-danger" : ""],
                ] as const
              ).map(([key, value, className]) => (
                <div key={key}>
                  <p className="text-xs font-medium text-muted-foreground">{t(key)}</p>
                  <MoneyText
                    value={value}
                    className={`mt-1 block text-xl font-semibold ${className}`}
                  />
                </div>
              ))}
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {t("contracts.balance.oldestOverdue")}
                </p>
                <p
                  className={`numeric mt-1 text-xl font-semibold ${context.balance?.oldest_overdue_date ? "text-danger" : ""}`}
                >
                  {context.balance?.oldest_overdue_date
                    ? formatDate(context.balance.oldest_overdue_date)
                    : "—"}
                </p>
              </div>
            </section>

            <Tabs defaultValue="summary">
              <TabsList className="flex-wrap">
                <TabsTrigger value="summary">{t("units.tabs.summary")}</TabsTrigger>
                <TabsTrigger value="invoices">{t("nav.receipts")}</TabsTrigger>
                <TabsTrigger value="payments">{t("nav.payments")}</TabsTrigger>
                <TabsTrigger value="parking">{t("nav.parking")}</TabsTrigger>
                <TabsTrigger value="documents">{t("documents.title")}</TabsTrigger>
              </TabsList>

              <TabsContent value="summary" className="mt-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <section className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
                    <h2 className="text-base font-semibold">{t("contracts.termsTitle")}</h2>
                    <dl className="mt-3">
                      <Row label={t("units.columns.unit")}>{context.unit?.unit_number ?? "—"}</Row>
                      <Row label={t("units.columns.property")}>{context.property?.name ?? "—"}</Row>
                      <Row label={t("contracts.columns.start")}>{formatDate(lease.start_date)}</Row>
                      <Row label={t("contracts.columns.end")}>{formatDate(lease.end_date)}</Row>
                      <Row label={t("contracts.fields.rent")}>
                        <span className="inline-flex items-center gap-2">
                          <MoneyText value={Number(lease.rent_amount)} />
                          {/* Changing the rent is an admin decision, not a manager one. */}
                          <AdminOnly>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={t("contracts.editRent")}
                              onClick={() => {
                                setRentAmount(Number(lease.rent_amount));
                                setRentOpen(true);
                              }}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                          </AdminOnly>
                        </span>
                      </Row>
                      <Row label={t("contracts.fields.dueDay")}>{lease.rent_due_day}</Row>
                      <Row label={t("contracts.fields.graceDays")}>{lease.grace_days}</Row>
                      <Row label={t("contracts.fields.lateFee")}>
                        <MoneyText value={Number(lease.late_fee_amount)} />
                      </Row>
                    </dl>
                  </section>

                  <section className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
                    <h2 className="text-base font-semibold">{t("contracts.peopleTitle")}</h2>
                    <dl className="mt-3">
                      <Row label={t("contracts.fields.primaryTenant")}>
                        {context.primaryTenant?.full_name ?? "—"}
                      </Row>
                      <Row label={t("contracts.fields.coTenants")}>
                        {context.coTenants.length
                          ? context.coTenants.map((person) => person.full_name).join(", ")
                          : "—"}
                      </Row>
                      <Row label={t("contracts.fields.guarantors")}>
                        {context.guarantors.length
                          ? context.guarantors.map((person) => person.full_name).join(", ")
                          : "—"}
                      </Row>
                    </dl>

                    <h2 className="mt-6 text-base font-semibold">{t("contracts.depositTitle")}</h2>
                    <dl className="mt-3">
                      <Row label={t("contracts.fields.deposit")}>
                        <MoneyText value={Number(lease.deposit_amount)} />
                      </Row>
                      <Row label={t("contracts.fields.depositStatus")}>
                        {t(`contracts.depositStatus.${lease.deposit_status}`, {
                          defaultValue: lease.deposit_status,
                        })}
                      </Row>
                      {lease.move_out_date ? (
                        <>
                          <Row label={t("contracts.fields.moveOut")}>
                            {formatDate(lease.move_out_date)}
                          </Row>
                          <Row label={t("contracts.fields.refunded")}>
                            <MoneyText value={Number(lease.deposit_refunded ?? 0)} />
                          </Row>
                          <Row label={t("contracts.fields.retained")}>
                            <MoneyText value={Number(lease.deposit_retained ?? 0)} />
                          </Row>
                        </>
                      ) : null}
                    </dl>
                  </section>
                </div>
              </TabsContent>

              <TabsContent value="invoices" className="mt-4">
                <QueryState
                  isLoading={invoices.isLoading}
                  error={invoices.error}
                  isEmpty={(invoices.data?.length ?? 0) === 0}
                  onRetry={() => void invoices.refetch()}
                  skeleton={<RowsSkeleton count={4} />}
                  empty={
                    <EmptyState
                      message={t("receipts.emptyTitle")}
                      description={t("receipts.emptyDescription")}
                    />
                  }
                >
                  <DataTable
                    columns={invoiceColumns}
                    data={invoices.data ?? []}
                    getRowId={(row) => row.id}
                    onRowClick={(row) =>
                      void navigate({ to: "/app/receipts/$id", params: { id: row.id } })
                    }
                  />
                </QueryState>
              </TabsContent>

              <TabsContent value="payments" className="mt-4">
                <QueryState
                  isLoading={payments.isLoading}
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

              <TabsContent value="parking" className="mt-4">
                {context.parking.length === 0 ? (
                  <EmptyState
                    icon={CarFront}
                    message={t("contracts.noParking")}
                    description={t("contracts.noParkingDescription")}
                  />
                ) : (
                  <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {context.parking.map((space) => (
                      <li
                        key={space.id}
                        className="rounded-lg border border-border bg-surface p-4 shadow-subtle"
                      >
                        <p className="font-semibold">{space.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {t(`parking.types.${space.type}`, { defaultValue: space.type })}
                        </p>
                        <div className="mt-2">
                          <MoneyText value={Number(space.monthly_fee)} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value="documents" className="mt-4">
                <DocumentsPanel ownerType="lease" ownerId={id} bucket="contracts" />
              </TabsContent>
            </Tabs>

            {/* ---------------------------------------------- admin: edit rent */}
            <FormDialog
              open={rentOpen}
              onOpenChange={(next) => {
                setRentOpen(next);
                if (!next) setError(null);
              }}
              title={t("contracts.editRent")}
              description={t("contracts.editRentDescription")}
              error={error}
              pending={updateRent.isPending}
              onSubmit={() => {
                setError(null);
                if (rentAmount === "" || Number(rentAmount) <= 0)
                  return setError(t("contracts.errors.rentRequired"));
                updateRent.mutate(Number(rentAmount));
              }}
            >
              <Field label={t("contracts.fields.rent")}>
                <MoneyInput value={rentAmount} onChange={setRentAmount} />
              </Field>
            </FormDialog>

            {/* ------------------------------------------- terminate the lease */}
            <FormDialog
              open={endOpen}
              onOpenChange={(next) => {
                setEndOpen(next);
                if (!next) setError(null);
              }}
              title={t("contracts.terminateTitle")}
              description={t("contracts.terminateDescription", {
                unit: context.unit?.unit_number ?? "—",
                tenant: context.primaryTenant?.full_name ?? "—",
              })}
              error={error}
              pending={terminate.isPending}
              submitLabel={t("contracts.terminate")}
              onSubmit={() => {
                setError(null);
                const total = Number(endForm.refunded || 0) + Number(endForm.retained || 0);
                if (total > Number(lease.deposit_amount) + 0.005)
                  return setError(t("contracts.errors.depositOverflow"));
                terminate.mutate(endForm);
              }}
            >
              <Field label={t("contracts.fields.moveOut")} htmlFor="end-date">
                <Input
                  id="end-date"
                  type="date"
                  className="numeric"
                  value={endForm.move_out_date}
                  onChange={(event) =>
                    setEndForm({ ...endForm, move_out_date: event.target.value })
                  }
                />
              </Field>
              <p className="text-sm text-muted-foreground">
                {t("contracts.depositHeld")} <MoneyText value={Number(lease.deposit_amount)} />
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("contracts.fields.refunded")}>
                  <MoneyInput
                    value={endForm.refunded}
                    onChange={(value) => setEndForm({ ...endForm, refunded: value })}
                  />
                </Field>
                <Field label={t("contracts.fields.retained")}>
                  <MoneyInput
                    value={endForm.retained}
                    onChange={(value) => setEndForm({ ...endForm, retained: value })}
                  />
                </Field>
              </div>
              <Field label={t("contracts.fields.depositNotes")} htmlFor="end-notes">
                <Textarea
                  id="end-notes"
                  rows={3}
                  value={endForm.notes}
                  onChange={(event) => setEndForm({ ...endForm, notes: event.target.value })}
                />
              </Field>
              <p className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning">
                {t("contracts.terminateWarning")}
              </p>
            </FormDialog>

            <LeaseWizard
              open={renewSeed !== null}
              onOpenChange={(next) => {
                if (!next) setRenewSeed(null);
              }}
              seed={renewSeed ?? undefined}
              onCreated={(leaseId) => {
                setRenewSeed(null);
                void navigate({ to: "/app/contracts/$id", params: { id: leaseId } });
              }}
            />
          </>
        ) : null}
      </QueryState>
    </div>
  );
}
