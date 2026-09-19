import { useEffect, useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox, type ComboboxOption } from "@/components/rentio/combobox";
import { Field, FormDialog } from "@/components/rentio/form-dialog";
import { MoneyInput } from "@/components/rentio/money-input";
import { MoneyText } from "@/components/rentio/money-text";
import { formatMexicoDate } from "@/lib/format";
import { PHONE_HINT } from "@/lib/mx";
import { isActive, unitContexts } from "@/lib/portfolio";
import {
  logActivity,
  qk,
  useActorId,
  usePortfolio,
  useToastMutation,
  useSettings,
} from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { uploadFile } from "@/lib/storage";
import { cn } from "@/lib/utils";
import type { Tables } from "@/lib/database.types";

export interface LeaseWizardSeed {
  unitId: string;
  primaryTenantId: string | null;
  coTenantIds: string[];
  guarantorIds: string[];
  rentAmount: number;
  rentDueDay: number;
  graceDays: number;
  lateFee: number;
  deposit: number;
}

interface LeaseWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Renewal keeps the same unit even though it is occupied. */
  seed?: LeaseWizardSeed | undefined;
  onCreated?: ((leaseId: string) => void) | undefined;
}

type Terms = {
  start_date: string;
  end_date: string;
  rent_amount: number | "";
  rent_due_day: string;
  grace_days: string;
  late_fee_amount: number | "";
  deposit_amount: number | "";
};

function addMonths(iso: string, months: number) {
  const date = new Date(`${iso}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

const today = () => new Date().toISOString().slice(0, 10);

export function LeaseWizard({ open, onOpenChange, seed, onCreated }: LeaseWizardProps) {
  const { t } = useTranslation();
  const portfolio = usePortfolio();
  const settings = useSettings();
  const actorId = useActorId();

  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [primary, setPrimary] = useState<string | null>(null);
  const [coTenants, setCoTenants] = useState<string[]>([]);
  const [guarantors, setGuarantors] = useState<string[]>([]);
  const [pendingCo, setPendingCo] = useState<string | null>(null);
  const [pendingGuarantor, setPendingGuarantor] = useState<string | null>(null);
  const [contractFile, setContractFile] = useState<File | null>(null);
  const [inlineTenantOpen, setInlineTenantOpen] = useState(false);
  const [inlineTenant, setInlineTenant] = useState({ full_name: "", email: "", phone: "" });
  const [inlineTarget, setInlineTarget] = useState<"primary" | "co" | "guarantor">("primary");

  const [terms, setTerms] = useState<Terms>({
    start_date: today(),
    end_date: addMonths(today(), 12),
    rent_amount: "",
    rent_due_day: "1",
    grace_days: "5",
    late_fee_amount: "",
    deposit_amount: "",
  });

  // Reset each time the dialog opens, seeding from a renewal when given one.
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setError(null);
    setContractFile(null);
    setUnitId(seed?.unitId ?? null);
    setPrimary(seed?.primaryTenantId ?? null);
    setCoTenants(seed?.coTenantIds ?? []);
    setGuarantors(seed?.guarantorIds ?? []);
    const start = seed ? today() : today();
    setTerms({
      start_date: start,
      end_date: addMonths(start, 12),
      rent_amount: seed?.rentAmount ?? "",
      rent_due_day: String(seed?.rentDueDay ?? 1),
      grace_days: String(seed?.graceDays ?? settings.data?.default_grace_days ?? 5),
      late_fee_amount: seed?.lateFee ?? Number(settings.data?.default_late_fee ?? 0),
      deposit_amount: seed?.deposit ?? "",
    });
  }, [open, seed, settings.data]);

  const units = useMemo(
    () => (portfolio.data ? unitContexts(portfolio.data) : []),
    [portfolio.data],
  );

  const unitOptions = useMemo<ComboboxOption[]>(
    () =>
      units
        // A renewal keeps its own unit in the list even though it is occupied.
        .filter(
          (row) =>
            row.unit.status === "vacante" ||
            row.unit.status === "reservada" ||
            row.unit.id === seed?.unitId,
        )
        .map((row) => ({
          value: row.unit.id,
          label: `${t("units.columns.unit")} ${row.unit.unit_number}`,
          hint: row.property?.name ?? "",
          keywords: row.property?.name ?? "",
        })),
    [units, seed?.unitId, t],
  );

  const tenantOptions = useMemo<ComboboxOption[]>(
    () =>
      (portfolio.data?.tenants ?? []).map((tenant) => ({
        value: tenant.id,
        label: tenant.full_name,
        hint: [tenant.phone, tenant.email].filter(Boolean).join(" · "),
        keywords: `${tenant.phone ?? ""} ${tenant.email ?? ""}`,
      })),
    [portfolio.data],
  );

  const selectedUnit = units.find((row) => row.unit.id === unitId);
  const tenantById = new Map((portfolio.data?.tenants ?? []).map((tenant) => [tenant.id, tenant]));

  // Pre-fill rent and deposit from the unit the moment one is chosen.
  useEffect(() => {
    if (!selectedUnit || seed) return;
    const base = Number(selectedUnit.unit.base_rent);
    setTerms((current) => ({
      ...current,
      rent_amount: current.rent_amount === "" ? base : current.rent_amount,
      deposit_amount: current.deposit_amount === "" ? base : current.deposit_amount,
    }));
  }, [selectedUnit, seed]);

  const createTenant = useToastMutation({
    mutationFn: async (values: typeof inlineTenant) => {
      const { data, error: caught } = await supabase
        .from("tenants")
        .insert({
          full_name: values.full_name.trim(),
          email: values.email.trim() || null,
          phone: values.phone.trim() || null,
        })
        .select("id")
        .single();
      if (caught) throw caught;
      return data.id;
    },
    successKey: "tenants.created",
    invalidate: [qk.portfolio],
    onSuccess: (tenantId) => {
      // Slot the new tenant straight into whichever role opened this dialog —
      // the wizard keeps its place.
      if (inlineTarget === "primary") setPrimary(tenantId);
      if (inlineTarget === "co") setCoTenants((current) => [...current, tenantId]);
      if (inlineTarget === "guarantor") setGuarantors((current) => [...current, tenantId]);
      setInlineTenantOpen(false);
      setInlineTenant({ full_name: "", email: "", phone: "" });
    },
  });

  const submit = useToastMutation({
    mutationFn: async () => {
      if (!unitId || !primary) throw new Error("incomplete");

      const { data: lease, error: leaseError } = await supabase
        .from("leases")
        .insert({
          unit_id: unitId,
          start_date: terms.start_date,
          end_date: terms.end_date,
          rent_amount: terms.rent_amount === "" ? 0 : terms.rent_amount,
          rent_due_day: Number(terms.rent_due_day) || 1,
          grace_days: Number(terms.grace_days) || 0,
          late_fee_amount: terms.late_fee_amount === "" ? 0 : terms.late_fee_amount,
          deposit_amount: terms.deposit_amount === "" ? 0 : terms.deposit_amount,
          status: "activo",
        })
        .select("id")
        .single();
      if (leaseError) throw leaseError;

      const links = [
        { lease_id: lease.id, tenant_id: primary, role: "primary" as const },
        ...coTenants.map((tenantId) => ({
          lease_id: lease.id,
          tenant_id: tenantId,
          role: "co_tenant" as const,
        })),
        ...guarantors.map((tenantId) => ({
          lease_id: lease.id,
          tenant_id: tenantId,
          role: "guarantor" as const,
        })),
      ];
      const { error: linkError } = await supabase.from("lease_tenants").insert(links);
      if (linkError) throw linkError;

      if (contractFile) {
        const path = await uploadFile("contracts", lease.id, contractFile);
        await supabase.from("leases").update({ contract_url: path }).eq("id", lease.id);
        await supabase.from("documents").insert({
          owner_type: "lease",
          owner_id: lease.id,
          name: contractFile.name,
          url: path,
          uploaded_by: actorId,
        });
      }

      const { error: unitError } = await supabase
        .from("units")
        .update({ status: "ocupada" })
        .eq("id", unitId);
      if (unitError) throw unitError;

      await logActivity(actorId, "lease", lease.id, "create", { unitId, primary });
      return lease.id;
    },
    successKey: "contracts.created",
    invalidate: [qk.portfolio],
    onSuccess: (leaseId) => {
      onOpenChange(false);
      onCreated?.(leaseId);
    },
  });

  const monthsBetween = (() => {
    const start = new Date(`${terms.start_date}T00:00:00`);
    const end = new Date(`${terms.end_date}T00:00:00`);
    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000 / 30.44));
  })();

  const next = () => {
    setError(null);
    if (step === 1) {
      if (!unitId) return setError(t("contracts.errors.unitRequired"));
      if (!primary) return setError(t("contracts.errors.tenantRequired"));
      return setStep(2);
    }
    if (step === 2) {
      if (terms.rent_amount === "" || Number(terms.rent_amount) <= 0)
        return setError(t("contracts.errors.rentRequired"));
      if (new Date(terms.end_date) <= new Date(terms.start_date))
        return setError(t("contracts.errors.datesInvalid"));
      const day = Number(terms.rent_due_day);
      if (!Number.isFinite(day) || day < 1 || day > 31)
        return setError(t("contracts.errors.dueDayRange"));
      return setStep(3);
    }
    submit.mutate(undefined);
  };

  const Chip = ({ tenantId, onRemove }: { tenantId: string; onRemove: () => void }) => (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 text-xs font-medium">
      {tenantById.get(tenantId)?.full_name ?? tenantId}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("actions.delete")}
        className="text-muted-foreground hover:text-danger"
      >
        <X className="size-3" />
      </button>
    </span>
  );

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        wide
        title={seed ? t("contracts.renewTitle") : t("contracts.new")}
        description={t(`contracts.steps.${step}.description`)}
        error={error}
        pending={submit.isPending}
        submitLabel={step === 3 ? t("contracts.createSubmit") : t("contracts.nextStep")}
        onSubmit={next}
        footerExtra={
          step > 1 ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setError(null);
                setStep(step - 1);
              }}
            >
              {t("contracts.previousStep")}
            </Button>
          ) : null
        }
      >
        <ol className="flex items-center gap-2 text-xs font-medium">
          {[1, 2, 3].map((index) => (
            <li key={index} className="flex flex-1 items-center gap-2">
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border",
                  index < step
                    ? "border-primary bg-primary text-primary-foreground"
                    : index === step
                      ? "border-primary text-primary"
                      : "border-border text-muted-foreground",
                )}
              >
                {index < step ? <Check className="size-3.5" /> : index}
              </span>
              <span
                className={cn(
                  "truncate",
                  index === step ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {t(`contracts.steps.${index}.title`)}
              </span>
            </li>
          ))}
        </ol>

        {step === 1 ? (
          <div className="space-y-4">
            <Field
              label={t("contracts.fields.unit")}
              hint={seed ? undefined : t("contracts.fields.unitHint")}
            >
              <Combobox
                options={unitOptions}
                value={unitId}
                onChange={setUnitId}
                placeholder={t("contracts.fields.unitPlaceholder")}
                disabled={Boolean(seed)}
              />
            </Field>

            <Field label={t("contracts.fields.primaryTenant")}>
              <div className="flex gap-2">
                <Combobox
                  className="flex-1"
                  options={tenantOptions}
                  value={primary}
                  onChange={setPrimary}
                  placeholder={t("contracts.fields.tenantPlaceholder")}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t("tenants.new")}
                  onClick={() => {
                    setInlineTarget("primary");
                    setInlineTenantOpen(true);
                  }}
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            </Field>

            <Field
              label={t("contracts.fields.coTenants")}
              hint={t("contracts.fields.coTenantsHint")}
            >
              <div className="flex gap-2">
                <Combobox
                  className="flex-1"
                  options={tenantOptions.filter(
                    (option) => option.value !== primary && !coTenants.includes(option.value),
                  )}
                  value={pendingCo}
                  onChange={(value) => {
                    setCoTenants((current) => [...current, value]);
                    setPendingCo(null);
                  }}
                  placeholder={t("contracts.fields.addTenant")}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t("tenants.new")}
                  onClick={() => {
                    setInlineTarget("co");
                    setInlineTenantOpen(true);
                  }}
                >
                  <Plus className="size-4" />
                </Button>
              </div>
              {coTenants.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {coTenants.map((tenantId) => (
                    <Chip
                      key={tenantId}
                      tenantId={tenantId}
                      onRemove={() =>
                        setCoTenants((current) => current.filter((value) => value !== tenantId))
                      }
                    />
                  ))}
                </div>
              ) : null}
            </Field>

            <Field
              label={t("contracts.fields.guarantors")}
              hint={t("contracts.fields.guarantorsHint")}
            >
              <div className="flex gap-2">
                <Combobox
                  className="flex-1"
                  options={tenantOptions.filter(
                    (option) => option.value !== primary && !guarantors.includes(option.value),
                  )}
                  value={pendingGuarantor}
                  onChange={(value) => {
                    setGuarantors((current) => [...current, value]);
                    setPendingGuarantor(null);
                  }}
                  placeholder={t("contracts.fields.addTenant")}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t("tenants.new")}
                  onClick={() => {
                    setInlineTarget("guarantor");
                    setInlineTenantOpen(true);
                  }}
                >
                  <Plus className="size-4" />
                </Button>
              </div>
              {guarantors.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {guarantors.map((tenantId) => (
                    <Chip
                      key={tenantId}
                      tenantId={tenantId}
                      onRemove={() =>
                        setGuarantors((current) => current.filter((value) => value !== tenantId))
                      }
                    />
                  ))}
                </div>
              ) : null}
            </Field>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("contracts.fields.startDate")} htmlFor="lease-start">
                <Input
                  id="lease-start"
                  type="date"
                  className="numeric"
                  value={terms.start_date}
                  onChange={(event) =>
                    setTerms({
                      ...terms,
                      start_date: event.target.value,
                      end_date: addMonths(event.target.value, 12),
                    })
                  }
                />
              </Field>
              <Field label={t("contracts.fields.endDate")} htmlFor="lease-end">
                <Input
                  id="lease-end"
                  type="date"
                  className="numeric"
                  value={terms.end_date}
                  onChange={(event) => setTerms({ ...terms, end_date: event.target.value })}
                />
              </Field>
            </div>
            <Field
              label={t("contracts.fields.rent")}
              hint={selectedUnit ? t("contracts.fields.rentHint") : undefined}
            >
              <MoneyInput
                value={terms.rent_amount}
                onChange={(value) => setTerms({ ...terms, rent_amount: value })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("contracts.fields.dueDay")} htmlFor="lease-due">
                <Input
                  id="lease-due"
                  inputMode="numeric"
                  className="numeric"
                  value={terms.rent_due_day}
                  onChange={(event) =>
                    setTerms({
                      ...terms,
                      rent_due_day: event.target.value.replace(/\D/g, "").slice(0, 2),
                    })
                  }
                />
              </Field>
              <Field label={t("contracts.fields.graceDays")} htmlFor="lease-grace">
                <Input
                  id="lease-grace"
                  inputMode="numeric"
                  className="numeric"
                  value={terms.grace_days}
                  onChange={(event) =>
                    setTerms({
                      ...terms,
                      grace_days: event.target.value.replace(/\D/g, "").slice(0, 2),
                    })
                  }
                />
              </Field>
              <Field label={t("contracts.fields.lateFee")}>
                <MoneyInput
                  value={terms.late_fee_amount}
                  onChange={(value) => setTerms({ ...terms, late_fee_amount: value })}
                />
              </Field>
            </div>
            <Field label={t("contracts.fields.deposit")} hint={t("contracts.fields.depositHint")}>
              <MoneyInput
                value={terms.deposit_amount}
                onChange={(value) => setTerms({ ...terms, deposit_amount: value })}
              />
            </Field>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-4">
            <dl className="overflow-hidden rounded-lg border border-border">
              {(
                [
                  [
                    "contracts.fields.unit",
                    selectedUnit
                      ? `${t("units.columns.unit")} ${selectedUnit.unit.unit_number} — ${selectedUnit.property?.name ?? ""}`
                      : "—",
                  ],
                  [
                    "contracts.fields.primaryTenant",
                    primary ? (tenantById.get(primary)?.full_name ?? "—") : "—",
                  ],
                  [
                    "contracts.fields.coTenants",
                    coTenants.length
                      ? coTenants.map((value) => tenantById.get(value)?.full_name).join(", ")
                      : "—",
                  ],
                  [
                    "contracts.fields.guarantors",
                    guarantors.length
                      ? guarantors.map((value) => tenantById.get(value)?.full_name).join(", ")
                      : "—",
                  ],
                  [
                    "contracts.fields.period",
                    `${formatMexicoDate(terms.start_date)} — ${formatMexicoDate(terms.end_date)} (${t("contracts.monthCount", { count: monthsBetween })})`,
                  ],
                  ["contracts.fields.dueDay", terms.rent_due_day],
                  ["contracts.fields.graceDays", terms.grace_days],
                ] as const
              ).map(([key, value]) => (
                <div
                  key={key}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 border-b border-border px-4 py-2.5 last:border-b-0"
                >
                  <dt className="text-sm text-muted-foreground">{t(key)}</dt>
                  <dd className="truncate text-sm font-medium">{value}</dd>
                </div>
              ))}
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 border-t border-border bg-muted/50 px-4 py-2.5">
                <dt className="text-sm text-muted-foreground">{t("contracts.fields.rent")}</dt>
                <dd>
                  <MoneyText value={Number(terms.rent_amount || 0)} className="font-semibold" />
                </dd>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 bg-muted/50 px-4 py-2.5">
                <dt className="text-sm text-muted-foreground">{t("contracts.fields.deposit")}</dt>
                <dd>
                  <MoneyText value={Number(terms.deposit_amount || 0)} className="font-semibold" />
                </dd>
              </div>
            </dl>

            <Field
              label={t("contracts.fields.contractFile")}
              htmlFor="lease-contract"
              hint={t("contracts.fields.contractFileHint")}
            >
              <Input
                id="lease-contract"
                type="file"
                accept="application/pdf,image/*"
                onChange={(event) => setContractFile(event.target.files?.[0] ?? null)}
              />
            </Field>
          </div>
        ) : null}
      </FormDialog>

      {/* A tenant created here drops straight back into the wizard. */}
      <FormDialog
        open={inlineTenantOpen}
        onOpenChange={setInlineTenantOpen}
        title={t("tenants.new")}
        description={t("contracts.inlineTenantDescription")}
        pending={createTenant.isPending}
        onSubmit={() => {
          if (!inlineTenant.full_name.trim()) return;
          createTenant.mutate(inlineTenant);
        }}
      >
        <Field label={t("tenants.fields.fullName")} htmlFor="inline-name">
          <Input
            id="inline-name"
            value={inlineTenant.full_name}
            onChange={(event) =>
              setInlineTenant({ ...inlineTenant, full_name: event.target.value })
            }
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("tenants.fields.email")} htmlFor="inline-email">
            <Input
              id="inline-email"
              type="email"
              value={inlineTenant.email}
              onChange={(event) => setInlineTenant({ ...inlineTenant, email: event.target.value })}
            />
          </Field>
          <Field label={t("tenants.fields.phone")} htmlFor="inline-phone" hint={PHONE_HINT}>
            <Input
              id="inline-phone"
              inputMode="tel"
              className="numeric"
              value={inlineTenant.phone}
              onChange={(event) => setInlineTenant({ ...inlineTenant, phone: event.target.value })}
            />
          </Field>
        </div>
      </FormDialog>
    </>
  );
}

/** Seed for renewing an existing lease. */
export function seedFromLease(
  lease: Tables<"leases">,
  links: Tables<"lease_tenants">[],
): LeaseWizardSeed {
  return {
    unitId: lease.unit_id,
    primaryTenantId: links.find((link) => link.role === "primary")?.tenant_id ?? null,
    coTenantIds: links.filter((link) => link.role === "co_tenant").map((link) => link.tenant_id),
    guarantorIds: links.filter((link) => link.role === "guarantor").map((link) => link.tenant_id),
    rentAmount: Number(lease.rent_amount),
    rentDueDay: lease.rent_due_day,
    graceDays: lease.grace_days,
    lateFee: Number(lease.late_fee_amount),
    deposit: Number(lease.deposit_amount),
  };
}

export { isActive };
