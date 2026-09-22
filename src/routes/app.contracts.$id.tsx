import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  CarFront,
  Download,
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { StatutoryClock } from "@/components/rentio/statutory-clock";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import {
  InvoiceStatusBadge,
  LeaseStatusBadge,
  PaymentStatusBadge,
  effectiveInvoiceStatus,
} from "@/components/rentio/status";
import { AdminOnly } from "@/lib/auth";
import { formatDate, formatMoney, todayIso } from "@/lib/format";
import { lateFeeAmount } from "@/lib/late-fee";
import {
  NOTICE_DELIVERY,
  NOTICE_TYPES,
  REKEY_ITEM_KEY,
  type NoticeDelivery,
  type NoticeType,
  defaultVacateDate,
  rekeyClock,
  turnoverRowsFor,
} from "@/lib/texas";
import {
  type DepositItem,
  deductionsExceedDeposit,
  depositClock,
  depositDueDate,
  itemizationTotal,
  parseItemization,
  refundDue,
} from "@/lib/deposit";
import { cn } from "@/lib/utils";
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
import { describeError, supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/app/contracts/$id")({
  head: () => ({
    meta: [
      { title: `${i18n.t("pages.detail.contract")} — Rentio` },
      { name: "description", content: i18n.t("pages.contracts.description") },
    ],
  }),
  component: ContractDetailPage,
});

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
  const [moveOutOpen, setMoveOutOpen] = useState(false);
  const [forwardingOpen, setForwardingOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [rentOpen, setRentOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rentAmount, setRentAmount] = useState<number | "">("");

  // Stage 1. Ends the tenancy. Does NOT start the deposit clock.
  const [moveOutForm, setMoveOutForm] = useState({
    surrender_date: todayIso(),
    move_out_notes: "",
  });
  // Stage 2. This is what starts the 30-day clock.
  const [forwardingForm, setForwardingForm] = useState({
    forwarding_address: "",
    forwarding_address_received_at: todayIso(),
  });
  const [itemization, setItemization] = useState<DepositItem[]>([]);
  const [settleAck, setSettleAck] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticeForm, setNoticeForm] = useState({
    type: "non_payment" as NoticeType,
    reason: "",
    vacate_date: defaultVacateDate(),
    delivery: "in_person" as NoticeDelivery,
    delivered_at: todayIso(),
  });

  const context = useMemo(
    () =>
      portfolio.data ? leaseContexts(portfolio.data).find((row) => row.lease.id === id) : undefined,
    [portfolio.data, id],
  );
  const lease = context?.lease;

  const clock = depositClock(
    lease ?? {
      surrender_date: null,
      forwarding_address_received_at: null,
      deposit_due_date: null,
      deposit_settled_at: null,
    },
  );
  const itemizationRows = parseItemization(lease?.deposit_itemization);
  const overDeposit = deductionsExceedDeposit(Number(lease?.deposit_amount ?? 0), itemization);

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

  /**
   * Stage 1 — record move-out. Ends the tenancy and frees the unit, and
   * deliberately does NOT touch the deposit: under §92.103 the 30-day clock
   * starts when the forwarding address arrives, which may be weeks later.
   */
  const recordMoveOut = useToastMutation({
    mutationFn: async (values: typeof moveOutForm) => {
      if (!lease) throw new Error("missing-lease");

      const { error: leaseError } = await supabase
        .from("leases")
        .update({
          status: "terminado",
          surrender_date: values.surrender_date,
          move_out_date: values.surrender_date,
          move_out_notes: values.move_out_notes || null,
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

      await logActivity(actorId, "lease", id, "record_move_out", {
        surrender_date: values.surrender_date,
      });
    },
    successKey: "contracts.moveOutRecorded",
    invalidate: [qk.portfolio],
    onSuccess: () => setMoveOutOpen(false),
  });

  /** Stage 2 — the forwarding address. This starts the statutory clock. */
  const recordForwarding = useToastMutation({
    mutationFn: async (values: typeof forwardingForm) => {
      const { error: caught } = await supabase
        .from("leases")
        .update({
          forwarding_address: values.forwarding_address.trim(),
          forwarding_address_received_at: values.forwarding_address_received_at,
        })
        .eq("id", id);
      if (caught) throw caught;
      await logActivity(actorId, "lease", id, "record_forwarding_address", {
        received_at: values.forwarding_address_received_at,
        due_date: depositDueDate(values.forwarding_address_received_at),
      });
    },
    successKey: "contracts.forwardingRecorded",
    invalidate: [qk.portfolio],
    onSuccess: () => setForwardingOpen(false),
  });

  const settleDeposit = useToastMutation({
    mutationFn: async () => {
      if (!lease) throw new Error("missing-lease");
      const held = Number(lease.deposit_amount);
      const withheld = itemizationTotal(itemization);
      const refunded = refundDue(held, itemization);
      const settledAt = todayIso();

      const { error: caught } = await supabase
        .from("leases")
        .update({
          deposit_itemization: itemization as unknown as never,
          deposit_retained: withheld,
          deposit_refunded: refunded,
          deposit_settled_at: settledAt,
          deposit_status: refunded > 0 ? "devuelto" : "liquidado",
        })
        .eq("id", id);
      if (caught) throw caught;

      await logActivity(actorId, "lease", id, "settle_deposit", {
        held,
        withheld,
        refunded,
        settled_at: settledAt,
        due_date: lease.deposit_due_date,
        on_time: lease.deposit_due_date ? settledAt <= lease.deposit_due_date : null,
        items: itemization.length,
      });
    },
    successKey: "contracts.depositSettled",
    invalidate: [qk.portfolio],
    onSuccess: () => setSettleOpen(false),
  });

  const turnover = useQuery({
    queryKey: ["turnover", id],
    queryFn: async () => {
      const { data, error: caught } = await supabase
        .from("unit_turnover_checklist")
        .select("*")
        .eq("lease_id", id)
        .order("position");
      if (caught) throw caught;
      return data;
    },
  });
  const turnoverDone = (turnover.data ?? []).filter((item) => item.completed).length;

  const notices = useQuery({
    queryKey: ["lease-notices", id],
    queryFn: async () => {
      const { data, error: caught } = await supabase
        .from("lease_notices")
        .select("*")
        .eq("lease_id", id)
        .order("delivered_at", { ascending: false });
      if (caught) throw caught;
      return data;
    },
  });

  /** Backfill for leases activated before the checklist existed. */
  const createChecklist = useToastMutation({
    mutationFn: async () => {
      if (!lease) throw new Error("missing-lease");
      const { error: caught } = await supabase
        .from("unit_turnover_checklist")
        .upsert(turnoverRowsFor(lease.unit_id, lease.id), { onConflict: "lease_id,item_key" });
      if (caught) throw caught;
    },
    successKey: "turnover.created",
    invalidate: [
      ["turnover", id],
      ["turnover", "overdue"],
    ],
  });

  const toggleTurnover = useToastMutation({
    mutationFn: async ({ id: itemId, completed }: { id: string; completed: boolean }) => {
      const { error: caught } = await supabase
        .from("unit_turnover_checklist")
        .update({ completed, completed_by: completed ? actorId : null })
        .eq("id", itemId);
      if (caught) throw caught;
    },
    successKey: "turnover.updated",
    invalidate: [
      ["turnover", id],
      ["turnover", "overdue"],
    ],
  });

  const createNotice = useToastMutation({
    mutationFn: async (values: typeof noticeForm) => {
      const { data, error: caught } = await supabase
        .from("lease_notices")
        .insert({
          lease_id: id,
          type: values.type,
          reason: values.reason.trim() || null,
          vacate_date: values.vacate_date,
          delivery: values.delivery,
          delivered_at: values.delivered_at,
          created_by: actorId,
        })
        .select("id")
        .single();
      if (caught) throw caught;
      await logActivity(actorId, "lease", id, "notice_to_vacate", {
        notice_id: data.id,
        type: values.type,
        vacate_date: values.vacate_date,
        delivery: values.delivery,
      });
      return data.id;
    },
    successKey: "notices.created",
    invalidate: [["lease-notices", id]],
    onSuccess: (noticeId) => {
      setNoticeOpen(false);
      void downloadNotice(noticeId as string);
    },
  });

  const downloadNotice = async (noticeId: string) => {
    try {
      const { data, error: caught } = await supabase.functions.invoke("generate-notice-to-vacate", {
        body: { notice_id: noticeId },
      });
      if (caught) throw caught;
      const url = (data as { url?: string } | null)?.url;
      if (!url) throw new Error("no-url");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      toast.error(t(describeError(caught)));
    }
  };

  const downloadDisposition = async () => {
    try {
      const { data, error: caught } = await supabase.functions.invoke(
        "generate-deposit-disposition",
        { body: { lease_id: id } },
      );
      if (caught) throw caught;
      const url = (data as { url?: string } | null)?.url;
      if (!url) throw new Error("no-url");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      toast.error(t(describeError(caught)));
    }
  };

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
                        setMoveOutForm({ surrender_date: todayIso(), move_out_notes: "" });
                        setMoveOutOpen(true);
                      }}
                    >
                      {t("contracts.recordMoveOut")}
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
                <TabsTrigger value="compliance">{t("contracts.tabs.compliance")}</TabsTrigger>
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
                        <span className="numeric">
                          {lease.late_fee_type === "percent"
                            ? `${Number(lease.late_fee_percent)}% · ${formatMoney(
                                lateFeeAmount({
                                  late_fee_type: lease.late_fee_type,
                                  late_fee_percent: Number(lease.late_fee_percent),
                                  late_fee_amount: Number(lease.late_fee_amount),
                                  rent_amount: Number(lease.rent_amount),
                                }),
                              )}`
                            : formatMoney(Number(lease.late_fee_amount))}
                        </span>
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
                      {lease.surrender_date ? (
                        <Row label={t("contracts.fields.surrenderDate")}>
                          {formatDate(lease.surrender_date)}
                        </Row>
                      ) : null}
                      {lease.forwarding_address_received_at ? (
                        <>
                          <Row label={t("contracts.fields.forwardingReceived")}>
                            {formatDate(lease.forwarding_address_received_at)}
                          </Row>
                          <Row label={t("contracts.fields.forwardingAddress")}>
                            <span className="whitespace-pre-line">{lease.forwarding_address}</span>
                          </Row>
                        </>
                      ) : null}
                      {lease.deposit_settled_at ? (
                        <>
                          <Row label={t("contracts.fields.depositSettledAt")}>
                            {formatDate(lease.deposit_settled_at)}
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

                    {/* The clock. Missing this deadline costs real money, so
                        it is the loudest thing on the page once it starts. */}
                    {clock.stage === "awaiting_forwarding" ? (
                      <div className="mt-4 space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
                        <p className="text-sm font-medium text-warning-foreground">
                          {t("contracts.awaitingForwarding")}
                        </p>
                        <Button size="sm" onClick={() => setForwardingOpen(true)}>
                          {t("contracts.recordForwarding")}
                        </Button>
                      </div>
                    ) : null}

                    {clock.stage === "running" || clock.stage === "overdue" ? (
                      <div
                        className={cn(
                          "mt-4 space-y-3 rounded-lg border p-4",
                          clock.tone === "danger"
                            ? "border-danger/40 bg-danger/10"
                            : clock.tone === "warning"
                              ? "border-warning/40 bg-warning/10"
                              : "border-border bg-muted/40",
                        )}
                      >
                        <StatutoryClock
                          tone={clock.tone}
                          label={
                            clock.stage === "overdue"
                              ? t("contracts.depositOverdue", {
                                  date: formatDate(clock.dueDate ?? ""),
                                  count: Math.abs(clock.daysRemaining ?? 0),
                                })
                              : t("contracts.depositCountdown", {
                                  date: formatDate(clock.dueDate ?? ""),
                                  count: clock.daysRemaining ?? 0,
                                })
                          }
                        />
                        <Button
                          size="sm"
                          onClick={() => {
                            setItemization(parseItemization(lease.deposit_itemization));
                            setSettleAck(false);
                            setSettleOpen(true);
                          }}
                        >
                          {t("contracts.settleDeposit")}
                        </Button>
                      </div>
                    ) : null}

                    {clock.stage === "settled" && itemizationRows.length > 0 ? (
                      <div className="mt-4 rounded-lg border border-border">
                        <p className="border-b border-border px-4 py-2 text-sm font-medium">
                          {t("contracts.deductionsTitle")}
                        </p>
                        {itemizationRows.map((item, index) => (
                          <div
                            key={`${item.description}-${index}`}
                            className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-border px-4 py-2 text-sm last:border-b-0"
                          >
                            <span className="truncate">{item.description}</span>
                            <MoneyText value={item.amount} />
                          </div>
                        ))}
                      </div>
                    ) : null}
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

              <TabsContent value="compliance" className="mt-4 space-y-6">
                {/* ------------------------------- move-in / turnover */}
                <section className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-semibold">{t("turnover.title")}</h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">{t("turnover.hint")}</p>
                    </div>
                    <span className="numeric text-sm font-medium">
                      {turnoverDone}/{turnover.data?.length ?? 0}
                    </span>
                  </div>

                  <QueryState
                    isLoading={turnover.isLoading}
                    error={turnover.error}
                    isEmpty={(turnover.data?.length ?? 0) === 0}
                    onRetry={() => void turnover.refetch()}
                    skeleton={<RowsSkeleton count={4} />}
                    empty={
                      <div className="mt-3 space-y-3">
                        <p className="text-sm text-muted-foreground">{t("turnover.none")}</p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => createChecklist.mutate(undefined)}
                        >
                          {t("turnover.create")}
                        </Button>
                      </div>
                    }
                  >
                    <ul className="mt-3 space-y-1">
                      {(turnover.data ?? []).map((item) => {
                        const rekey =
                          item.item_key === REKEY_ITEM_KEY && !item.completed
                            ? rekeyClock(lease.start_date)
                            : null;
                        return (
                          <li
                            key={item.id}
                            className="flex items-start gap-3 rounded-md px-1 py-2 hover:bg-muted/50"
                          >
                            <Checkbox
                              className="mt-0.5"
                              checked={item.completed}
                              aria-label={t(`turnover.items.${item.item_key}`, {
                                defaultValue: item.item,
                              })}
                              onCheckedChange={(checked) =>
                                toggleTurnover.mutate({ id: item.id, completed: checked === true })
                              }
                            />
                            <span className="min-w-0 flex-1">
                              <span
                                className={cn(
                                  "text-sm",
                                  item.completed && "text-muted-foreground line-through",
                                )}
                              >
                                {t(`turnover.items.${item.item_key}`, { defaultValue: item.item })}
                              </span>
                              {rekey ? (
                                <StatutoryClock
                                  className="mt-1"
                                  tone={
                                    rekey.overdue
                                      ? "danger"
                                      : rekey.daysRemaining <= 2
                                        ? "warning"
                                        : "neutral"
                                  }
                                  label={
                                    rekey.overdue
                                      ? t("turnover.rekeyOverdue", {
                                          count: Math.abs(rekey.daysRemaining),
                                        })
                                      : t("turnover.rekeyCountdown", {
                                          count: rekey.daysRemaining,
                                          date: formatDate(rekey.deadline),
                                        })
                                  }
                                />
                              ) : null}
                              {item.completed && item.completed_at ? (
                                <span className="mt-0.5 block text-xs text-muted-foreground">
                                  {formatDate(item.completed_at)}
                                </span>
                              ) : null}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </QueryState>
                </section>

                {/* ----------------------------------------- notices */}
                <section className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-semibold">{t("notices.title")}</h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">{t("notices.hint")}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setNoticeForm({
                          type: "non_payment",
                          reason: "",
                          vacate_date: defaultVacateDate(),
                          delivery: "in_person",
                          delivered_at: todayIso(),
                        });
                        setNoticeOpen(true);
                      }}
                    >
                      <Plus className="size-4" />
                      {t("notices.generate")}
                    </Button>
                  </div>

                  <p className="mt-3 rounded-lg border border-info/25 bg-info/10 px-3 py-2 text-xs text-info">
                    {t("notices.notACourtFiling")}
                  </p>

                  <QueryState
                    isLoading={notices.isLoading}
                    error={notices.error}
                    isEmpty={(notices.data?.length ?? 0) === 0}
                    onRetry={() => void notices.refetch()}
                    skeleton={<RowsSkeleton count={2} />}
                    empty={
                      <p className="mt-3 text-sm text-muted-foreground">{t("notices.none")}</p>
                    }
                  >
                    <ul className="mt-3 divide-y divide-border">
                      {(notices.data ?? []).map((notice) => (
                        <li key={notice.id} className="flex flex-wrap items-center gap-3 py-2.5">
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">
                              {t(`notices.types.${notice.type}`)}
                            </span>
                            <span className="numeric block text-xs text-muted-foreground">
                              {t("notices.summary", {
                                delivered: formatDate(notice.delivered_at),
                                method: t(`notices.delivery.${notice.delivery}`),
                                vacate: formatDate(notice.vacate_date),
                              })}
                            </span>
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void downloadNotice(notice.id)}
                          >
                            <Download className="size-4" />
                            {t("actions.download")}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </QueryState>
                </section>
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

            {/* ---------------------------- stage 1: record move-out */}
            <FormDialog
              open={moveOutOpen}
              onOpenChange={(next) => {
                setMoveOutOpen(next);
                if (!next) setError(null);
              }}
              title={t("contracts.recordMoveOutTitle")}
              description={t("contracts.terminateDescription", {
                unit: context.unit?.unit_number ?? "—",
                tenant: context.primaryTenant?.full_name ?? "—",
              })}
              error={error}
              pending={recordMoveOut.isPending}
              submitLabel={t("contracts.recordMoveOut")}
              onSubmit={() => {
                setError(null);
                recordMoveOut.mutate(moveOutForm);
              }}
            >
              <Field label={t("contracts.fields.surrenderDate")} htmlFor="surrender-date">
                <Input
                  id="surrender-date"
                  type="date"
                  className="numeric"
                  value={moveOutForm.surrender_date}
                  onChange={(event) =>
                    setMoveOutForm({ ...moveOutForm, surrender_date: event.target.value })
                  }
                />
              </Field>
              <Field label={t("contracts.fields.moveOutNotes")} htmlFor="move-out-notes">
                <Textarea
                  id="move-out-notes"
                  rows={4}
                  placeholder={t("contracts.fields.moveOutNotesPlaceholder")}
                  value={moveOutForm.move_out_notes}
                  onChange={(event) =>
                    setMoveOutForm({ ...moveOutForm, move_out_notes: event.target.value })
                  }
                />
              </Field>
              <DocumentsPanel ownerType="lease" ownerId={id} bucket="contracts" />
              <p className="rounded-lg border border-info/25 bg-info/10 px-3 py-2 text-sm text-info">
                {t("contracts.moveOutClockNotice")}
              </p>
              <p className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning">
                {t("contracts.terminateWarning")}
              </p>
            </FormDialog>

            {/* ------------------- stage 2: the forwarding address starts it */}
            <FormDialog
              open={forwardingOpen}
              onOpenChange={(next) => {
                setForwardingOpen(next);
                if (!next) setError(null);
              }}
              title={t("contracts.recordForwardingTitle")}
              description={t("contracts.recordForwardingDescription")}
              error={error}
              pending={recordForwarding.isPending}
              submitLabel={t("contracts.recordForwarding")}
              onSubmit={() => {
                setError(null);
                if (!forwardingForm.forwarding_address.trim())
                  return setError(t("contracts.errors.forwardingRequired"));
                if (
                  lease.surrender_date &&
                  forwardingForm.forwarding_address_received_at < lease.surrender_date
                )
                  return setError(t("contracts.errors.forwardingBeforeSurrender"));
                recordForwarding.mutate(forwardingForm);
              }}
            >
              <Field label={t("contracts.fields.forwardingAddress")} htmlFor="forwarding-address">
                <Textarea
                  id="forwarding-address"
                  rows={4}
                  value={forwardingForm.forwarding_address}
                  onChange={(event) =>
                    setForwardingForm({
                      ...forwardingForm,
                      forwarding_address: event.target.value,
                    })
                  }
                />
              </Field>
              <Field label={t("contracts.fields.forwardingReceived")} htmlFor="forwarding-date">
                <Input
                  id="forwarding-date"
                  type="date"
                  className="numeric"
                  value={forwardingForm.forwarding_address_received_at}
                  onChange={(event) =>
                    setForwardingForm({
                      ...forwardingForm,
                      forwarding_address_received_at: event.target.value,
                    })
                  }
                />
              </Field>
              <p className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning">
                {t("contracts.forwardingStartsClock", {
                  date: formatDate(
                    depositDueDate(forwardingForm.forwarding_address_received_at || todayIso()),
                  ),
                })}
              </p>
            </FormDialog>

            {/* ------------------------------- settle: the itemized list */}
            <FormDialog
              open={settleOpen}
              onOpenChange={(next) => {
                setSettleOpen(next);
                if (!next) setError(null);
              }}
              title={t("contracts.settleDepositTitle")}
              description={t("contracts.settleDepositDescription")}
              error={error}
              pending={settleDeposit.isPending}
              submitLabel={t("contracts.settleDeposit")}
              onSubmit={() => {
                setError(null);
                if (itemization.some((item) => !item.description.trim()))
                  return setError(t("contracts.errors.deductionDescriptionRequired"));
                if (overDeposit && !settleAck)
                  return setError(t("contracts.errors.deductionsOverDeposit"));
                settleDeposit.mutate(undefined);
              }}
            >
              <div className="space-y-2">
                {itemization.map((item, index) => (
                  <div key={index} className="grid grid-cols-[minmax(0,1fr)_9rem_auto] gap-2">
                    <Input
                      aria-label={t("contracts.fields.deductionDescription")}
                      placeholder={t("contracts.fields.deductionPlaceholder")}
                      value={item.description}
                      onChange={(event) =>
                        setItemization(
                          itemization.map((row, rowIndex) =>
                            rowIndex === index ? { ...row, description: event.target.value } : row,
                          ),
                        )
                      }
                    />
                    <MoneyInput
                      value={item.amount === 0 ? "" : item.amount}
                      onChange={(value) =>
                        setItemization(
                          itemization.map((row, rowIndex) =>
                            rowIndex === index ? { ...row, amount: value === "" ? 0 : value } : row,
                          ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("actions.delete")}
                      onClick={() =>
                        setItemization(itemization.filter((_, rowIndex) => rowIndex !== index))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setItemization([...itemization, { description: "", amount: 0 }])}
                >
                  <Plus className="size-4" />
                  {t("contracts.addDeduction")}
                </Button>
              </div>

              <dl className="rounded-lg border border-border">
                {(
                  [
                    ["contracts.depositHeld", Number(lease.deposit_amount)],
                    ["contracts.totalDeductions", itemizationTotal(itemization)],
                  ] as const
                ).map(([key, value]) => (
                  <div
                    key={key}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-border px-4 py-2 text-sm"
                  >
                    <dt className="text-muted-foreground">{t(key)}</dt>
                    <dd>
                      <MoneyText value={value} />
                    </dd>
                  </div>
                ))}
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 bg-muted/50 px-4 py-2.5">
                  <dt className="text-sm font-medium">{t("contracts.refundDue")}</dt>
                  <dd>
                    <MoneyText
                      value={refundDue(Number(lease.deposit_amount), itemization)}
                      className="font-semibold"
                    />
                  </dd>
                </div>
              </dl>

              {overDeposit ? (
                <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5">
                  <p className="text-sm text-warning-foreground">
                    {t("contracts.deductionsExceedDeposit")}
                  </p>
                  <label className="flex items-start gap-2 text-sm text-warning-foreground">
                    <Checkbox
                      checked={settleAck}
                      onCheckedChange={(checked) => setSettleAck(checked === true)}
                    />
                    <span>{t("contracts.deductionsExceedDepositAck")}</span>
                  </label>
                </div>
              ) : null}

              <Button
                type="button"
                variant="outline"
                onClick={() => downloadDisposition()}
                disabled={!lease.forwarding_address_received_at}
              >
                <Download className="size-4" />
                {t("contracts.downloadDisposition")}
              </Button>
            </FormDialog>

            {/* --------------------------------- notice to vacate */}
            <FormDialog
              open={noticeOpen}
              onOpenChange={(next) => {
                setNoticeOpen(next);
                if (!next) setError(null);
              }}
              title={t("notices.generateTitle")}
              description={t("notices.generateDescription")}
              error={error}
              pending={createNotice.isPending}
              submitLabel={t("notices.generate")}
              onSubmit={() => {
                setError(null);
                if (noticeForm.vacate_date < noticeForm.delivered_at)
                  return setError(t("notices.errors.vacateBeforeDelivery"));
                createNotice.mutate(noticeForm);
              }}
            >
              <Field label={t("notices.fields.type")}>
                <Select
                  value={noticeForm.type}
                  onValueChange={(value) =>
                    setNoticeForm({ ...noticeForm, type: value as NoticeType })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NOTICE_TYPES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`notices.types.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={t("notices.fields.vacateDate")}
                  htmlFor="notice-vacate"
                  hint={t("notices.fields.vacateDateHint")}
                >
                  <Input
                    id="notice-vacate"
                    type="date"
                    className="numeric"
                    value={noticeForm.vacate_date}
                    onChange={(event) =>
                      setNoticeForm({ ...noticeForm, vacate_date: event.target.value })
                    }
                  />
                </Field>
                <Field label={t("notices.fields.deliveredAt")} htmlFor="notice-delivered">
                  <Input
                    id="notice-delivered"
                    type="date"
                    className="numeric"
                    value={noticeForm.delivered_at}
                    onChange={(event) =>
                      setNoticeForm({ ...noticeForm, delivered_at: event.target.value })
                    }
                  />
                </Field>
              </div>
              <Field label={t("notices.fields.delivery")}>
                <Select
                  value={noticeForm.delivery}
                  onValueChange={(value) =>
                    setNoticeForm({ ...noticeForm, delivery: value as NoticeDelivery })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NOTICE_DELIVERY.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`notices.delivery.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("notices.fields.reason")} htmlFor="notice-reason">
                <Textarea
                  id="notice-reason"
                  rows={3}
                  value={noticeForm.reason}
                  onChange={(event) => setNoticeForm({ ...noticeForm, reason: event.target.value })}
                />
              </Field>
              <p className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning">
                {t("notices.notACourtFiling")}
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
