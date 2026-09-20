import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Download, Plus, Receipt, WalletCards, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Combobox, type ComboboxOption } from "@/components/rentio/combobox";
import { DataTable, type DataTableColumn } from "@/components/rentio/data-table";
import { EmptyState } from "@/components/rentio/empty-state";
import { Field, FormDialog } from "@/components/rentio/form-dialog";
import { MoneyInput } from "@/components/rentio/money-input";
import { MoneyText } from "@/components/rentio/money-text";
import { PageHeader } from "@/components/rentio/page-header";
import { CardsSkeleton, QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { PaymentStatusBadge } from "@/components/rentio/status";
import { AdminOnly } from "@/lib/auth";
import { formatDate, formatMoney, todayIso } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";
import { allocateOldestFirst, type OpenInvoice } from "@/lib/invoicing";
import { isActive, leaseContexts, leaseLabel } from "@/lib/portfolio";
import { logActivity, qk, useActorId, usePortfolio, useToastMutation } from "@/lib/queries";
import { describeError, supabase } from "@/lib/supabase";
import { signedUrl, uploadFile } from "@/lib/storage";
import type { Enums, Tables } from "@/lib/database.types";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/app/payments/")({
  head: () => ({
    meta: [
      { title: `${i18n.t("pages.payments.title")} — Rentio` },
      { name: "description", content: i18n.t("pages.payments.description") },
    ],
  }),
  component: PaymentsPage,
});

const ALL = "__all__";
const METHODS: Enums<"payment_method">[] = [
  "ach",
  "zelle",
  "check",
  "money_order",
  "cash",
  "card",
  "other",
];

interface PaymentRow extends Tables<"payments"> {
  unitNumber: string;
  tenantName: string;
  propertyId: string | null;
}

function PaymentsPage() {
  const { t } = useTranslation();
  const portfolio = usePortfolio();
  const actorId = useActorId();

  const [tab, setTab] = useState("queue");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<PaymentRow | null>(null);
  const [voidFor, setVoidFor] = useState<PaymentRow | null>(null);
  const [reason, setReason] = useState("");
  const [recordOpen, setRecordOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [methodFilter, setMethodFilter] = useState(ALL);
  const [propertyFilter, setPropertyFilter] = useState(ALL);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [form, setForm] = useState({
    lease_id: null as string | null,
    amount: "" as number | "",
    paid_at: todayIso(),
    method: "ach" as Enums<"payment_method">,
    reference: "",
    notes: "",
    receipt: null as File | null,
  });
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  const payments = useQuery({
    queryKey: qk.payments,
    queryFn: async () => {
      const { data, error: caught } = await supabase
        .from("payments")
        .select("*")
        .order("paid_at", { ascending: false });
      if (caught) throw caught;
      return data;
    },
  });

  /** Open invoices drive both the "Aplicar a" panel and confirmation. */
  const openInvoices = useQuery({
    queryKey: ["open-invoices"],
    queryFn: async () => {
      const { data, error: caught } = await supabase
        .from("invoice_balances")
        .select("*")
        .gt("balance", 0);
      if (caught) throw caught;
      const ids = (data ?? [])
        .map((row) => row.invoice_id)
        .filter((value): value is string => Boolean(value));
      if (ids.length === 0) return [] as (OpenInvoice & { leaseId: string })[];
      const { data: heads, error: headError } = await supabase
        .from("invoices")
        .select("id, lease_id, invoice_number, due_date, status")
        .in("id", ids);
      if (headError) throw headError;

      const headById = new Map((heads ?? []).map((head) => [head.id, head]));
      return (data ?? []).flatMap((row) => {
        const head = row.invoice_id ? headById.get(row.invoice_id) : undefined;
        if (!head || head.status === "cancelado" || head.status === "borrador") return [];
        return [
          {
            id: head.id,
            leaseId: head.lease_id,
            invoiceNumber: head.invoice_number,
            dueDate: head.due_date,
            balance: Number(row.balance ?? 0),
          },
        ];
      });
    },
  });

  const profiles = useQuery({
    queryKey: ["staff-profiles"],
    queryFn: async () => {
      const { data, error: caught } = await supabase.from("profiles").select("id, full_name");
      if (caught) throw caught;
      return data;
    },
  });

  const contexts = useMemo(
    () => (portfolio.data ? leaseContexts(portfolio.data) : []),
    [portfolio.data],
  );
  const contextByLease = useMemo(
    () => new Map(contexts.map((context) => [context.lease.id, context])),
    [contexts],
  );

  const decorate = useCallback(
    (payment: Tables<"payments">): PaymentRow => {
      const context = contextByLease.get(payment.lease_id);
      return {
        ...payment,
        unitNumber: context?.unit?.unit_number ?? "—",
        tenantName: context?.primaryTenant?.full_name ?? "—",
        propertyId: context?.property?.id ?? null,
      };
    },
    [contextByLease],
  );

  const queue = useMemo(
    () => (payments.data ?? []).filter((payment) => payment.status === "pendiente").map(decorate),
    [payments.data, decorate],
  );

  const history = useMemo(() => {
    return (payments.data ?? [])
      .filter((payment) => payment.status !== "pendiente")
      .map(decorate)
      .filter((row) => {
        if (methodFilter !== ALL && row.method !== methodFilter) return false;
        if (propertyFilter !== ALL && row.propertyId !== propertyFilter) return false;
        if (fromDate && row.paid_at < fromDate) return false;
        if (toDate && row.paid_at > toDate) return false;
        return true;
      });
  }, [payments.data, decorate, methodFilter, propertyFilter, fromDate, toDate]);

  // Land on the queue whenever something is waiting; otherwise show history.
  useEffect(() => {
    if (!payments.data) return;
    setTab(queue.length > 0 ? "queue" : "history");
  }, [payments.data, queue.length]);

  const leaseOptions = useMemo<ComboboxOption[]>(
    () =>
      contexts
        .filter((context) => isActive(context.lease))
        .map((context) => ({
          value: context.lease.id,
          label: leaseLabel(context, t("units.columns.unit")),
          hint: t("payments.currentBalance", {
            amount: formatMoney(Number(context.balance?.balance ?? 0)),
          }),
          keywords: `${context.unit?.unit_number ?? ""} ${context.primaryTenant?.full_name ?? ""}`,
        })),
    [contexts, t],
  );

  const invoicesForLease = useMemo(
    () =>
      (openInvoices.data ?? [])
        .filter((invoice) => invoice.leaseId === form.lease_id)
        .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1)),
    [openInvoices.data, form.lease_id],
  );

  /** Oldest-first by default; whatever the user types wins. */
  const suggested = useMemo(
    () => allocateOldestFirst(Number(form.amount || 0), invoicesForLease),
    [form.amount, invoicesForLease],
  );

  const effectiveAllocations = useMemo(() => {
    const base = new Map(suggested.allocations.map((row) => [row.invoiceId, row.amount]));
    for (const [invoiceId, amount] of Object.entries(overrides)) base.set(invoiceId, amount);
    return [...base.entries()]
      .filter(([, amount]) => amount > 0)
      .map(([invoiceId, amount]) => ({ invoiceId, amount }));
  }, [suggested, overrides]);

  const allocatedTotal = effectiveAllocations.reduce((sum, row) => sum + row.amount, 0);
  const credit = Math.max(0, Number(form.amount || 0) - allocatedTotal);

  const insertAllocations = async (
    paymentId: string,
    rows: { invoiceId: string; amount: number }[],
  ) => {
    if (rows.length === 0) return;
    const { error: caught } = await supabase.from("payment_allocations").insert(
      rows.map((row) => ({
        payment_id: paymentId,
        invoice_id: row.invoiceId,
        amount: row.amount,
      })),
    );
    if (caught) throw caught;
  };

  /** Keep invoice.status honest after money moves. */
  const refreshInvoiceStatuses = async (invoiceIds: string[]) => {
    if (invoiceIds.length === 0) return;
    const { data } = await supabase
      .from("invoice_balances")
      .select("*")
      .in("invoice_id", invoiceIds);
    for (const row of data ?? []) {
      if (!row.invoice_id) continue;
      const paid = Number(row.paid ?? 0);
      const total = Number(row.total ?? 0);
      const status: Enums<"invoice_status"> =
        paid >= total - 0.005 ? "pagado" : paid > 0 ? "pagado_parcial" : "enviado";
      await supabase
        .from("invoices")
        .update({ status })
        .eq("id", row.invoice_id)
        .neq("status", "cancelado")
        .neq("status", "borrador");
    }
  };

  const confirm = useToastMutation({
    mutationFn: async (payment: PaymentRow) => {
      const open = (openInvoices.data ?? []).filter(
        (invoice) => invoice.leaseId === payment.lease_id,
      );
      const { allocations } = allocateOldestFirst(Number(payment.amount), open);

      const { error: caught } = await supabase
        .from("payments")
        .update({
          status: "confirmado",
          confirmed_by: actorId,
          confirmed_at: new Date().toISOString(),
        })
        .eq("id", payment.id);
      if (caught) throw caught;

      await insertAllocations(payment.id, allocations);
      await refreshInvoiceStatuses(allocations.map((row) => row.invoiceId));
      await logActivity(actorId, "payment", payment.id, "confirm", {
        amount: payment.amount,
        allocations: allocations.length,
      });
    },
    successKey: "payments.confirmed",
    invalidate: [qk.payments, ["open-invoices"], ["invoices"], qk.portfolio],
  });

  const reject = useToastMutation({
    mutationFn: async ({ payment, why }: { payment: PaymentRow; why: string }) => {
      const { error: caught } = await supabase
        .from("payments")
        .update({ status: "cancelado", void_reason: why })
        .eq("id", payment.id);
      if (caught) throw caught;
      await logActivity(actorId, "payment", payment.id, "reject", { reason: why });
    },
    successKey: "payments.rejected",
    invalidate: [qk.payments, qk.portfolio],
    onSuccess: () => {
      setRejectFor(null);
      setReason("");
    },
  });

  // Voiding never deletes the row — it drops the allocations and keeps history.
  const voidPayment = useToastMutation({
    mutationFn: async ({ payment, why }: { payment: PaymentRow; why: string }) => {
      const { data: existing } = await supabase
        .from("payment_allocations")
        .select("invoice_id")
        .eq("payment_id", payment.id);
      const touched = (existing ?? []).map((row) => row.invoice_id);

      const { error: deleteError } = await supabase
        .from("payment_allocations")
        .delete()
        .eq("payment_id", payment.id);
      if (deleteError) throw deleteError;

      const { error: caught } = await supabase
        .from("payments")
        .update({ status: "cancelado", void_reason: why })
        .eq("id", payment.id);
      if (caught) throw caught;

      await refreshInvoiceStatuses(touched);
      await logActivity(actorId, "payment", payment.id, "void", {
        reason: why,
        amount: payment.amount,
      });
    },
    successKey: "payments.voided",
    invalidate: [qk.payments, ["open-invoices"], ["invoices"], qk.portfolio],
    onSuccess: () => {
      setVoidFor(null);
      setReason("");
    },
  });

  const record = useToastMutation({
    mutationFn: async () => {
      if (!form.lease_id) throw new Error("no-lease");

      const { data: payment, error: caught } = await supabase
        .from("payments")
        .insert({
          lease_id: form.lease_id,
          amount: form.amount === "" ? 0 : form.amount,
          paid_at: form.paid_at,
          method: form.method,
          reference: form.reference.trim() || null,
          notes: form.notes.trim() || null,
          status: "confirmado",
          recorded_by: actorId,
          confirmed_by: actorId,
          confirmed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (caught) throw caught;

      if (form.receipt) {
        const path = await uploadFile("payment-receipts", form.lease_id, form.receipt);
        await supabase.from("payments").update({ receipt_url: path }).eq("id", payment.id);
      }

      await insertAllocations(payment.id, effectiveAllocations);
      await refreshInvoiceStatuses(effectiveAllocations.map((row) => row.invoiceId));
      await logActivity(actorId, "payment", payment.id, "create", { amount: form.amount, credit });
    },
    successKey: "payments.recorded",
    invalidate: [qk.payments, ["open-invoices"], ["invoices"], qk.portfolio],
    onSuccess: () => {
      setRecordOpen(false);
      setForm({
        lease_id: null,
        amount: "",
        paid_at: todayIso(),
        method: "ach",
        reference: "",
        notes: "",
        receipt: null,
      });
      setOverrides({});
    },
  });

  const openReceipt = async (payment: Tables<"payments">) => {
    if (!payment.receipt_url) return;
    try {
      setLightbox(await signedUrl("payment-receipts", payment.receipt_url));
    } catch (caught) {
      toast.error(t(describeError(caught)));
    }
  };

  const nameOf = (profileId: string | null) =>
    profiles.data?.find((profile) => profile.id === profileId)?.full_name ?? "—";

  const historyColumns: DataTableColumn<PaymentRow>[] = [
    {
      key: "date",
      header: t("payments.columns.date"),
      sortValue: (row) => row.paid_at,
      cell: (row) => <span className="numeric">{formatDate(row.paid_at)}</span>,
    },
    {
      key: "tenant",
      header: t("contracts.columns.tenant"),
      sortValue: (row) => row.tenantName,
      cell: (row) => (
        <span className={row.status === "cancelado" ? "line-through text-muted-foreground" : ""}>
          {row.tenantName}
        </span>
      ),
    },
    {
      key: "unit",
      header: t("units.columns.unit"),
      sortValue: (row) => row.unitNumber,
      cell: (row) => row.unitNumber,
    },
    {
      key: "amount",
      header: t("payments.columns.amount"),
      numeric: true,
      sortValue: (row) => Number(row.amount),
      cell: (row) => (
        <MoneyText
          value={Number(row.amount)}
          className={row.status === "cancelado" ? "line-through" : ""}
        />
      ),
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
    {
      key: "recorded",
      header: t("payments.columns.recordedBy"),
      sortValue: (row) => row.recorded_by ?? "",
      cell: (row) => nameOf(row.recorded_by),
    },
    {
      key: "actions",
      header: "",
      cell: (row) =>
        row.status === "confirmado" ? (
          <AdminOnly>
            <Button
              size="sm"
              variant="ghost"
              onClick={(event) => {
                event.stopPropagation();
                setVoidFor(row);
                setReason("");
              }}
            >
              {t("payments.void")}
            </Button>
          </AdminOnly>
        ) : null,
    },
  ];

  const exportCsv = () => {
    downloadCsv(
      `pagos-${todayIso()}`,
      [
        t("payments.columns.date"),
        t("contracts.columns.tenant"),
        t("units.columns.unit"),
        t("payments.columns.amount"),
        t("payments.columns.method"),
        t("payments.columns.reference"),
        t("payments.columns.status"),
        t("payments.columns.recordedBy"),
      ],
      history.map((row) => [
        row.paid_at,
        row.tenantName,
        row.unitNumber,
        Number(row.amount),
        t(`paymentMethod.${row.method}`),
        row.reference ?? "",
        t(`paymentStatus.${row.status}`),
        nameOf(row.recorded_by),
      ]),
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("pages.payments.title")}
        description={t("pages.payments.description")}
        actions={
          <Button onClick={() => setRecordOpen(true)}>
            <Plus className="size-4" />
            {t("payments.record")}
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="queue">
            {t("payments.tabs.queue")}
            {queue.length > 0 ? (
              <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning/20 px-1.5 text-xs font-semibold text-warning">
                {queue.length}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="history">{t("payments.tabs.history")}</TabsTrigger>
        </TabsList>

        {/* ---------------------------------------- confirmation queue */}
        <TabsContent value="queue" className="mt-4">
          <QueryState
            isLoading={payments.isLoading || portfolio.isLoading}
            error={payments.error ?? portfolio.error}
            isEmpty={queue.length === 0}
            onRetry={() => void payments.refetch()}
            skeleton={<CardsSkeleton count={3} height="h-40" />}
            empty={
              <EmptyState
                icon={Check}
                message={t("payments.queueEmptyTitle")}
                description={t("payments.queueEmptyDescription")}
              />
            }
          >
            <ul className="grid gap-4 lg:grid-cols-2">
              {queue.map((payment) => (
                <li
                  key={payment.id}
                  className="rounded-lg border border-warning/30 bg-surface p-5 shadow-subtle"
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold">{payment.tenantName}</p>
                      <p className="text-sm text-muted-foreground">
                        {t("units.columns.unit")} {payment.unitNumber}
                      </p>
                      <dl className="mt-3 space-y-1 text-sm">
                        <div className="flex gap-2">
                          <dt className="text-muted-foreground">{t("payments.columns.date")}:</dt>
                          <dd className="numeric font-medium">{formatDate(payment.paid_at)}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="text-muted-foreground">{t("payments.columns.method")}:</dt>
                          <dd className="font-medium">{t(`paymentMethod.${payment.method}`)}</dd>
                        </div>
                        <div className="flex min-w-0 gap-2">
                          <dt className="shrink-0 text-muted-foreground">
                            {t("payments.columns.reference")}:
                          </dt>
                          <dd className="numeric truncate font-medium">
                            {payment.reference ?? "—"}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <div className="text-right">
                      <MoneyText
                        value={Number(payment.amount)}
                        className="block text-xl font-semibold"
                      />
                      {payment.receipt_url ? (
                        <button
                          onClick={() => void openReceipt(payment)}
                          className="mt-3 grid size-20 place-items-center rounded-lg border border-border bg-muted text-muted-foreground hover:border-primary/40"
                          aria-label={t("payments.viewReceipt")}
                        >
                          <Receipt className="size-6" />
                        </button>
                      ) : (
                        <p className="mt-3 text-xs text-muted-foreground">
                          {t("payments.noReceipt")}
                        </p>
                      )}
                    </div>
                  </div>

                  {payment.notes ? (
                    <p className="mt-3 text-sm text-muted-foreground">{payment.notes}</p>
                  ) : null}

                  <div className="mt-4 flex gap-2">
                    <Button
                      className="flex-1"
                      disabled={confirm.isPending}
                      onClick={() => confirm.mutate(payment)}
                    >
                      <Check className="size-4" />
                      {t("payments.confirm")}
                    </Button>
                    <Button
                      className="flex-1"
                      variant="outline"
                      onClick={() => {
                        setRejectFor(payment);
                        setReason("");
                      }}
                    >
                      <X className="size-4" />
                      {t("payments.reject")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </QueryState>
        </TabsContent>

        {/* ------------------------------------------------- history */}
        <TabsContent value="history" className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Select value={methodFilter} onValueChange={setMethodFilter}>
              <SelectTrigger aria-label={t("payments.columns.method")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("payments.filters.allMethods")}</SelectItem>
                {METHODS.map((method) => (
                  <SelectItem key={method} value={method}>
                    {t(`paymentMethod.${method}`)}
                  </SelectItem>
                ))}
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
            <Input
              type="date"
              className="numeric"
              aria-label={t("payments.filters.from")}
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
            />
            <Input
              type="date"
              className="numeric"
              aria-label={t("payments.filters.to")}
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
            />
            <Button variant="outline" onClick={exportCsv} disabled={history.length === 0}>
              <Download className="size-4" />
              {t("actions.export")}
            </Button>
          </div>

          <QueryState
            isLoading={payments.isLoading || portfolio.isLoading}
            error={payments.error ?? portfolio.error}
            isEmpty={history.length === 0}
            onRetry={() => void payments.refetch()}
            skeleton={<RowsSkeleton count={8} />}
            empty={
              <EmptyState
                icon={WalletCards}
                message={t("payments.emptyTitle")}
                description={t("payments.emptyDescription")}
              />
            }
          >
            <DataTable
              columns={historyColumns}
              data={history}
              getRowId={(row) => row.id}
              searchValue={(row) => `${row.tenantName} ${row.unitNumber} ${row.reference ?? ""}`}
              pageSize={15}
            />
          </QueryState>
        </TabsContent>
      </Tabs>

      {/* ------------------------------------------------ record a payment */}
      <FormDialog
        open={recordOpen}
        onOpenChange={(next) => {
          setRecordOpen(next);
          if (!next) {
            setError(null);
            setOverrides({});
          }
        }}
        wide
        title={t("payments.record")}
        error={error}
        pending={record.isPending}
        onSubmit={() => {
          setError(null);
          if (!form.lease_id) return setError(t("payments.errors.leaseRequired"));
          if (form.amount === "" || Number(form.amount) <= 0)
            return setError(t("payments.errors.amountRequired"));
          if (allocatedTotal > Number(form.amount) + 0.005)
            return setError(t("payments.errors.overAllocated"));
          record.mutate(undefined);
        }}
      >
        <Field label={t("parking.fields.lease")}>
          <Combobox
            options={leaseOptions}
            value={form.lease_id}
            onChange={(value) => {
              setForm({ ...form, lease_id: value });
              setOverrides({});
            }}
            placeholder={t("parking.fields.leasePlaceholder")}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("payments.columns.amount")}>
            <MoneyInput
              value={form.amount}
              onChange={(value) => {
                setForm({ ...form, amount: value });
                setOverrides({});
              }}
            />
          </Field>
          <Field label={t("payments.fields.paidAt")} htmlFor="payment-date">
            <Input
              id="payment-date"
              type="date"
              className="numeric"
              value={form.paid_at}
              onChange={(event) => setForm({ ...form, paid_at: event.target.value })}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("payments.columns.method")}>
            <Select
              value={form.method}
              onValueChange={(value) =>
                setForm({ ...form, method: value as Enums<"payment_method"> })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((method) => (
                  <SelectItem key={method} value={method}>
                    {t(`paymentMethod.${method}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("payments.columns.reference")} htmlFor="payment-reference">
            <Input
              id="payment-reference"
              className="numeric"
              value={form.reference}
              onChange={(event) => setForm({ ...form, reference: event.target.value })}
            />
          </Field>
        </div>

        {/* "Aplicar a": oldest-first by default, every row overridable. */}
        {form.lease_id ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("payments.applyTo")}</p>
            {invoicesForLease.length === 0 ? (
              <p className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                {t("payments.noOpenInvoices")}
              </p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {invoicesForLease.map((invoice) => {
                  const value =
                    overrides[invoice.id] ??
                    suggested.allocations.find((row) => row.invoiceId === invoice.id)?.amount ??
                    0;
                  return (
                    <li
                      key={invoice.id}
                      className="grid grid-cols-[minmax(0,1fr)_10rem] items-center gap-3 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {invoice.invoiceNumber ?? "—"}
                        </p>
                        <p className="numeric text-xs text-muted-foreground">
                          {t("receipts.columns.due")} {formatDate(invoice.dueDate)} ·{" "}
                          {t("receipts.columns.balance")} {formatMoney(invoice.balance)}
                        </p>
                      </div>
                      <MoneyInput
                        value={value === 0 ? "" : value}
                        onChange={(next) =>
                          setOverrides({ ...overrides, [invoice.id]: next === "" ? 0 : next })
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            )}

            {credit > 0.005 ? (
              <p className="rounded-lg border border-info/25 bg-info/10 px-3 py-2 text-sm text-info">
                {t("payments.creditNotice", { amount: formatMoney(credit) })}
              </p>
            ) : null}
          </div>
        ) : null}

        <Field label={t("payments.fields.receipt")} htmlFor="payment-receipt">
          <Input
            id="payment-receipt"
            type="file"
            accept="image/*,application/pdf"
            onChange={(event) => setForm({ ...form, receipt: event.target.files?.[0] ?? null })}
          />
        </Field>
        <Field label={t("tenants.fields.notes")} htmlFor="payment-notes">
          <Textarea
            id="payment-notes"
            rows={2}
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </Field>
      </FormDialog>

      {/* ------------------------------------------------------- reject */}
      <FormDialog
        open={rejectFor !== null}
        onOpenChange={(next) => {
          if (!next) {
            setRejectFor(null);
            setError(null);
          }
        }}
        title={t("payments.rejectTitle")}
        description={t("payments.rejectDescription")}
        error={error}
        pending={reject.isPending}
        submitLabel={t("payments.reject")}
        onSubmit={() => {
          setError(null);
          if (!reason.trim()) return setError(t("payments.errors.reasonRequired"));
          if (rejectFor) reject.mutate({ payment: rejectFor, why: reason.trim() });
        }}
      >
        <Field label={t("payments.fields.reason")} htmlFor="reject-reason">
          <Textarea
            id="reject-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </FormDialog>

      {/* -------------------------------------------------- void (admin) */}
      <FormDialog
        open={voidFor !== null}
        onOpenChange={(next) => {
          if (!next) {
            setVoidFor(null);
            setError(null);
          }
        }}
        title={t("payments.voidTitle")}
        description={t("payments.voidDescription")}
        error={error}
        pending={voidPayment.isPending}
        submitLabel={t("payments.void")}
        onSubmit={() => {
          setError(null);
          if (!reason.trim()) return setError(t("payments.errors.reasonRequired"));
          if (voidFor) voidPayment.mutate({ payment: voidFor, why: reason.trim() });
        }}
      >
        <Field label={t("payments.fields.reason")} htmlFor="void-reason">
          <Textarea
            id="void-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </FormDialog>

      {/* ------------------------------------------------- receipt lightbox */}
      <Dialog
        open={lightbox !== null}
        onOpenChange={(next) => {
          if (!next) setLightbox(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("payments.viewReceipt")}</DialogTitle>
          </DialogHeader>
          {lightbox ? (
            <img
              src={lightbox}
              alt={t("payments.viewReceipt")}
              className="max-h-[70vh] w-full rounded-lg object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
