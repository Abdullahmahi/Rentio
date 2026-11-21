import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormDialog } from "@/components/rentio/form-dialog";
import { db } from "@/lib/db";
import type { Tables } from "@/lib/database.types";
import { logActivity, useActorId, useToastMutation } from "@/lib/queries";
import { formatUsPhone } from "@/lib/us";
import { TRADES, vendorsKey } from "@/lib/vendors";

type Vendor = Tables<"vendors">;

const toForm = (vendor?: Vendor | null) => ({
  company_name: vendor?.company_name ?? "",
  contact_name: vendor?.contact_name ?? "",
  phone: vendor?.phone ?? "",
  email: vendor?.email ?? "",
  trade: vendor?.trade ?? "",
  insurance_expires_on: vendor?.insurance_expires_on ?? "",
  w9_on_file: vendor?.w9_on_file ?? false,
  notes: vendor?.notes ?? "",
  active: vendor?.active ?? true,
});

/** Add or edit a vendor. Used by the directory and inline from a work order. */
export function VendorDialog({
  open,
  onOpenChange,
  vendor,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor?: Vendor | null | undefined;
  onSaved?: ((vendor: Vendor) => void) | undefined;
}) {
  const { t } = useTranslation();
  const actorId = useActorId();
  const [form, setForm] = useState(() => toForm(vendor));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(toForm(vendor));
      setError(null);
    }
  }, [open, vendor]);

  const save = useToastMutation({
    mutationFn: async (values: ReturnType<typeof toForm>) => {
      const record = {
        company_name: values.company_name.trim(),
        contact_name: values.contact_name.trim() || null,
        phone: values.phone.trim() || null,
        email: values.email.trim() || null,
        trade: values.trade.trim() || null,
        insurance_expires_on: values.insurance_expires_on || null,
        w9_on_file: values.w9_on_file,
        notes: values.notes.trim() || null,
        active: values.active,
      };
      const { data, error: caught } = vendor
        ? await db.from("vendors").update(record).eq("id", vendor.id).select("*").single()
        : await db.from("vendors").insert(record).select("*").single();
      if (caught) throw caught;
      await logActivity(actorId, "vendor", data.id, vendor ? "update" : "create", {
        company: record.company_name,
      });
      return data;
    },
    successKey: "vendors.saved",
    invalidate: [vendorsKey],
    onSuccess: (saved) => {
      onOpenChange(false);
      onSaved?.(saved);
    },
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(vendor ? "vendors.edit" : "vendors.new")}
      error={error}
      pending={save.isPending}
      onSubmit={() => {
        if (!form.company_name.trim()) return setError(t("vendors.errors.companyRequired"));
        save.mutate(form);
      }}
    >
      <Field label={t("vendors.fields.company")} htmlFor="vendor-company">
        <Input
          id="vendor-company"
          value={form.company_name}
          onChange={(event) => setForm({ ...form, company_name: event.target.value })}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("vendors.fields.contact")} htmlFor="vendor-contact">
          <Input
            id="vendor-contact"
            value={form.contact_name}
            onChange={(event) => setForm({ ...form, contact_name: event.target.value })}
          />
        </Field>
        <Field label={t("vendors.fields.trade")} htmlFor="vendor-trade">
          <Input
            id="vendor-trade"
            list="vendor-trades"
            value={form.trade}
            onChange={(event) => setForm({ ...form, trade: event.target.value })}
          />
          <datalist id="vendor-trades">
            {TRADES.map((trade) => (
              <option key={trade} value={t(`vendors.trades.${trade}`)} />
            ))}
          </datalist>
        </Field>
        <Field label={t("vendors.fields.phone")} htmlFor="vendor-phone-input">
          <Input
            id="vendor-phone-input"
            inputMode="tel"
            className="numeric"
            value={form.phone}
            onChange={(event) => setForm({ ...form, phone: formatUsPhone(event.target.value) })}
          />
        </Field>
        <Field label={t("vendors.fields.email")} htmlFor="vendor-email">
          <Input
            id="vendor-email"
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </Field>
        <Field label={t("vendors.fields.insurance")} htmlFor="vendor-insurance">
          <Input
            id="vendor-insurance"
            type="date"
            value={form.insurance_expires_on}
            onChange={(event) => setForm({ ...form, insurance_expires_on: event.target.value })}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={form.w9_on_file}
          onCheckedChange={(checked) => setForm({ ...form, w9_on_file: checked === true })}
        />
        {t("vendors.fields.w9")}
      </label>
      {vendor ? (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={form.active}
            onCheckedChange={(checked) => setForm({ ...form, active: checked === true })}
          />
          {t("vendors.fields.active")}
        </label>
      ) : null}
      <Field label={t("vendors.fields.notes")} htmlFor="vendor-notes">
        <Textarea
          id="vendor-notes"
          rows={2}
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
        />
      </Field>
    </FormDialog>
  );
}
