import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Receipt } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Combobox, type ComboboxOption } from "@/components/rentio/combobox";
import { Field, FormDialog } from "@/components/rentio/form-dialog";
import { MoneyInput } from "@/components/rentio/money-input";
import { db } from "@/lib/db";
import type { Enums, Tables } from "@/lib/database.types";
import { EXPENSE_CATEGORIES } from "@/lib/expenses";
import { formatDate, todayIso } from "@/lib/format";
import { logActivity, qk, useActorId, useToastMutation } from "@/lib/queries";
import { useVendors } from "@/lib/vendors";

const NO_VENDOR = "__none__";

/**
 * "Create expense" for a work order with a cost. plan.md D6: only ever on a
 * staff click, never automatic. expenses.work_order_id is unique, so a second
 * click (or a second tab) cannot expense the same order twice.
 */
export function WorkOrderExpense({ order }: { order: Tables<"work_orders"> }) {
  const { t } = useTranslation();
  const actorId = useActorId();
  const vendors = useVendors();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(() => prefill(order));
  const linkedKey = [...qk.workOrder(order.id), "expense"];

  const linked = useQuery({
    queryKey: linkedKey,
    queryFn: async () => {
      const { data, error: caught } = await db
        .from("expenses")
        .select("id, spent_at")
        .eq("work_order_id", order.id)
        .maybeSingle();
      if (caught) throw caught;
      return data;
    },
  });

  const vendorOptions = useMemo<ComboboxOption[]>(
    () => [
      { value: NO_VENDOR, label: "—" },
      ...(vendors.data ?? [])
        .filter((row) => row.active || row.id === form.vendor_id)
        .map((row) => ({ value: row.id, label: row.company_name, hint: row.trade ?? "" })),
    ],
    [vendors.data, form.vendor_id],
  );

  const create = useToastMutation({
    mutationFn: async (values: ReturnType<typeof prefill>) => {
      const { data, error: caught } = await db
        .from("expenses")
        .insert({
          unit_id: order.unit_id,
          work_order_id: order.id,
          vendor_id: values.vendor_id,
          category: values.category,
          amount: Number(values.amount),
          spent_at: values.spent_at,
          description: values.description.trim(),
          created_by: actorId,
        })
        .select("id")
        .single();
      if (caught) throw caught;
      await logActivity(actorId, "expense", data.id, "create", {
        unit: order.unit_id,
        amount: values.amount,
        work_order: order.id,
      });
    },
    successKey: "expenses.fromWorkOrder.created",
    invalidate: [linkedKey, ["expenses"], ["report-expenses"]],
    onSuccess: () => setOpen(false),
  });

  if (order.cost === null || linked.isLoading) return null;

  if (linked.data) {
    return (
      <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <CheckCircle2 className="size-4 text-success" />
        {t("expenses.fromWorkOrder.done", { date: formatDate(linked.data.spent_at) })}
        <Link to="/app/expenses" className="font-medium text-primary hover:underline">
          {t("expenses.fromWorkOrder.view")}
        </Link>
      </p>
    );
  }

  return (
    <>
      <Button
        className="mt-3"
        variant="outline"
        onClick={() => {
          setForm(prefill(order));
          setError(null);
          setOpen(true);
        }}
      >
        <Receipt className="size-4" />
        {t("expenses.fromWorkOrder.create")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("expenses.fromWorkOrder.create")}
        description={t("expenses.fromWorkOrder.hint")}
        error={error}
        pending={create.isPending}
        onSubmit={() => {
          setError(null);
          if (form.amount === "" || Number(form.amount) <= 0)
            return setError(t("expenses.errors.amountRequired"));
          if (!form.spent_at) return setError(t("expenses.errors.dateRequired"));
          if (!form.description.trim()) return setError(t("expenses.errors.descriptionRequired"));
          create.mutate(form);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("payments.columns.amount")}>
            <MoneyInput
              value={form.amount}
              onChange={(value) => setForm({ ...form, amount: value })}
            />
          </Field>
          <Field label={t("expenses.columns.date")} htmlFor="wo-expense-date">
            <Input
              id="wo-expense-date"
              type="date"
              value={form.spent_at}
              onChange={(event) => setForm({ ...form, spent_at: event.target.value })}
            />
          </Field>
          <Field label={t("expenses.columns.category")}>
            <Select
              value={form.category}
              onValueChange={(value) =>
                setForm({ ...form, category: value as Enums<"expense_category"> })
              }
            >
              <SelectTrigger aria-label={t("expenses.columns.category")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {t(`expenses.categories.${category}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("expenses.columns.vendor")}>
            <Combobox
              options={vendorOptions}
              value={form.vendor_id ?? NO_VENDOR}
              onChange={(value) =>
                setForm({ ...form, vendor_id: value === NO_VENDOR ? null : value })
              }
              placeholder={t("vendors.picker.placeholder")}
            />
          </Field>
        </div>
        <Field label={t("expenses.columns.description")} htmlFor="wo-expense-description">
          <Input
            id="wo-expense-description"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>
      </FormDialog>
    </>
  );
}

function prefill(order: Tables<"work_orders">) {
  return {
    amount: (order.cost === null ? "" : Number(order.cost)) as number | "",
    spent_at: todayIso(),
    category: "repairs_maintenance" as Enums<"expense_category">,
    vendor_id: order.vendor_id,
    description: [order.folio, order.title].filter(Boolean).join(" · "),
  };
}
