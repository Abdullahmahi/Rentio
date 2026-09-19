import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CarFront, Info, LayoutList, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox, type ComboboxOption } from "@/components/rentio/combobox";
import { ConfirmDialog } from "@/components/rentio/confirm-dialog";
import { EmptyState } from "@/components/rentio/empty-state";
import { Field, FormDialog } from "@/components/rentio/form-dialog";
import { MoneyInput } from "@/components/rentio/money-input";
import { MoneyText } from "@/components/rentio/money-text";
import { PageHeader } from "@/components/rentio/page-header";
import { CardsSkeleton, QueryState } from "@/components/rentio/query-state";
import { StatusBadge } from "@/components/rentio/status-badge";
import { isActive, leaseContexts, leaseLabel } from "@/lib/portfolio";
import { formatMXN } from "@/lib/format";
import { logActivity, qk, useActorId, usePortfolio, useToastMutation } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/app/parking/")({
  head: () => ({ meta: [
    { title: `${i18n.t("pages.parking.title")} — Rentio` },
    { name: "description", content: i18n.t("pages.parking.description") },
  ] }),
  component: ParkingPage,
});

type Space = Tables<"parking_spaces">;

const STATUS_VARIANT = {
  disponible: "success",
  asignado: "info",
  fuera_de_servicio: "neutral",
} as const;

function statusOf(space: Space): keyof typeof STATUS_VARIANT {
  if (space.status === "asignado" || space.lease_id) return "asignado";
  if (space.status === "fuera_de_servicio") return "fuera_de_servicio";
  return "disponible";
}

function ParkingPage() {
  const { t } = useTranslation();
  const portfolio = usePortfolio();
  const actorId = useActorId();

  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [assignFor, setAssignFor] = useState<Space | null>(null);
  const [assignLease, setAssignLease] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({ property_id: "", label: "", type: "techado", monthly_fee: 1200 as number | "", status: "disponible" });
  const [bulk, setBulk] = useState({ property_id: "", prefix: "E-", start: "1", count: "10", type: "techado", monthly_fee: 1200 as number | "" });

  const leaseOptions = useMemo<ComboboxOption[]>(() => {
    if (!portfolio.data) return [];
    return leaseContexts(portfolio.data)
      .filter((context) => isActive(context.lease))
      .map((context) => ({
        value: context.lease.id,
        label: leaseLabel(context, t("units.columns.unit")),
        hint: context.property?.name ?? "",
        keywords: `${context.unit?.unit_number ?? ""} ${context.primaryTenant?.full_name ?? ""}`,
      }));
  }, [portfolio.data, t]);

  const groups = useMemo(() => {
    if (!portfolio.data) return [];
    const contexts = leaseContexts(portfolio.data);
    const leaseById = new Map(contexts.map((context) => [context.lease.id, context]));

    return portfolio.data.properties.map((property) => {
      const spaces = portfolio.data.parking.filter((space) => space.property_id === property.id);
      const assigned = spaces.filter((space) => statusOf(space) === "asignado");
      return {
        property,
        spaces: spaces.map((space) => ({ space, lease: space.lease_id ? leaseById.get(space.lease_id) : undefined })),
        stats: {
          total: spaces.length,
          available: spaces.filter((space) => statusOf(space) === "disponible").length,
          assigned: assigned.length,
          revenue: assigned.reduce((sum, space) => sum + Number(space.monthly_fee), 0),
        },
      };
    }).filter((group) => group.spaces.length > 0 || portfolio.data.properties.length <= 3);
  }, [portfolio.data]);

  const create = useToastMutation({
    mutationFn: async (values: typeof form) => {
      const { data, error: caught } = await supabase.from("parking_spaces").insert({
        property_id: values.property_id,
        label: values.label.trim(),
        type: values.type,
        monthly_fee: values.monthly_fee === "" ? 0 : values.monthly_fee,
        status: values.status,
      }).select("id").single();
      if (caught) throw caught;
      await logActivity(actorId, "parking_space", data.id, "create", { label: values.label });
    },
    successKey: "parking.created",
    invalidate: [qk.portfolio],
    onSuccess: () => { setCreateOpen(false); setForm({ ...form, label: "" }); },
  });

  const createBulk = useToastMutation({
    mutationFn: async (values: typeof bulk) => {
      const start = Number(values.start);
      const count = Number(values.count);
      const rows = Array.from({ length: count }, (_, index) => ({
        property_id: values.property_id,
        label: `${values.prefix}${String(start + index).padStart(2, "0")}`,
        type: values.type,
        monthly_fee: values.monthly_fee === "" ? 0 : values.monthly_fee,
        status: "disponible",
      }));
      const { error: caught } = await supabase.from("parking_spaces").insert(rows);
      if (caught) throw caught;
      await logActivity(actorId, "parking_space", null, "bulk_create", { count, prefix: values.prefix });
      return count;
    },
    successKey: "parking.bulkCreated",
    invalidate: [qk.portfolio],
    onSuccess: () => setBulkOpen(false),
  });

  const assign = useToastMutation({
    mutationFn: async ({ space, leaseId }: { space: Space; leaseId: string }) => {
      const { error: caught } = await supabase.from("parking_spaces")
        .update({ lease_id: leaseId, status: "asignado" }).eq("id", space.id);
      if (caught) throw caught;
      await logActivity(actorId, "parking_space", space.id, "assign", { label: space.label, leaseId });
    },
    successKey: "parking.assigned",
    invalidate: [qk.portfolio],
    onSuccess: () => { setAssignFor(null); setAssignLease(null); },
  });

  const release = useToastMutation({
    mutationFn: async (space: Space) => {
      const { error: caught } = await supabase.from("parking_spaces")
        .update({ lease_id: null, status: "disponible" }).eq("id", space.id);
      if (caught) throw caught;
      await logActivity(actorId, "parking_space", space.id, "release", { label: space.label });
    },
    successKey: "parking.released",
    invalidate: [qk.portfolio],
  });

  const bulkPreview = (() => {
    const start = Number(bulk.start);
    const count = Number(bulk.count);
    if (!Number.isFinite(start) || !Number.isFinite(count) || count < 1) return null;
    const first = `${bulk.prefix}${String(start).padStart(2, "0")}`;
    const last = `${bulk.prefix}${String(start + count - 1).padStart(2, "0")}`;
    return t("parking.bulkPreview", { first, last, count });
  })();

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("pages.parking.title")}
        description={t("pages.parking.description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setBulkOpen(true)}>
              <LayoutList className="size-4" />{t("parking.bulkNew")}
            </Button>
            <Button onClick={() => setCreateOpen(true)}><Plus className="size-4" />{t("parking.new")}</Button>
          </div>
        }
      />

      <QueryState
        isLoading={portfolio.isLoading}
        error={portfolio.error}
        isEmpty={groups.every((group) => group.spaces.length === 0)}
        onRetry={() => void portfolio.refetch()}
        skeleton={<CardsSkeleton count={8} height="h-28" />}
        empty={
          <EmptyState
            icon={CarFront}
            message={t("parking.emptyTitle")}
            description={t("parking.emptyDescription")}
            actionLabel={t("parking.bulkNew")}
            onAction={() => setBulkOpen(true)}
          />
        }
      >
        <div className="space-y-8">
          {groups.map(({ property, spaces, stats }) => (
            <section key={property.id} className="space-y-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-border pb-3">
                <h2 className="text-base font-semibold">{property.name}</h2>
                <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  {([
                    ["parking.stats.total", String(stats.total)],
                    ["parking.stats.available", String(stats.available)],
                    ["parking.stats.assigned", String(stats.assigned)],
                    ["parking.stats.revenue", formatMXN(stats.revenue)],
                  ] as const).map(([key, value]) => (
                    <div key={key} className="flex items-baseline gap-1.5">
                      <dt className="text-muted-foreground">{t(key)}</dt>
                      <dd className="numeric font-semibold">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {spaces.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("parking.noneInProperty")}</p>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {spaces.map(({ space, lease }) => {
                    const status = statusOf(space);
                    return (
                      <li key={space.id} className="rounded-lg border border-border bg-surface p-4 shadow-subtle">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-base font-semibold">{space.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {t(`parking.types.${space.type}`, { defaultValue: space.type })}
                            </p>
                          </div>
                          <StatusBadge status={t(`parking.status.${status}`)} variant={STATUS_VARIANT[status]} />
                        </div>

                        <div className="mt-3"><MoneyText value={Number(space.monthly_fee)} /></div>

                        {status === "asignado" ? (
                          <p className="mt-2 truncate text-xs text-muted-foreground">
                            {lease
                              ? `${t("units.columns.unit")} ${lease.unit?.unit_number ?? "—"} — ${lease.primaryTenant?.full_name ?? "—"}`
                              : t("parking.unknownLease")}
                          </p>
                        ) : null}

                        <div className="mt-4">
                          {status === "asignado" ? (
                            <ConfirmDialog
                              triggerLabel={t("parking.release")}
                              triggerVariant="outline"
                              destructive
                              title={t("parking.releaseTitle", { label: space.label })}
                              description={t("parking.releaseDescription")}
                              confirmLabel={t("parking.release")}
                              onConfirm={() => release.mutate(space)}
                            />
                          ) : status === "disponible" ? (
                            <Button variant="outline" onClick={() => { setAssignFor(space); setAssignLease(null); }}>
                              {t("parking.assign")}
                            </Button>
                          ) : (
                            <p className="text-xs text-muted-foreground">{t("parking.outOfServiceHint")}</p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>
      </QueryState>

      {/* -------------------------------------------------- new space */}
      <FormDialog
        open={createOpen}
        onOpenChange={(next) => { setCreateOpen(next); if (!next) setError(null); }}
        title={t("parking.new")}
        error={error}
        pending={create.isPending}
        onSubmit={() => {
          setError(null);
          if (!form.property_id) return setError(t("units.errors.propertyRequired"));
          if (!form.label.trim()) return setError(t("parking.errors.labelRequired"));
          create.mutate(form);
        }}
      >
        <Field label={t("units.fields.property")}>
          <Select value={form.property_id} onValueChange={(value) => setForm({ ...form, property_id: value })}>
            <SelectTrigger><SelectValue placeholder={t("units.fields.propertyPlaceholder")} /></SelectTrigger>
            <SelectContent>
              {portfolio.data?.properties.map((property) => (
                <SelectItem key={property.id} value={property.id}>{property.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("parking.fields.label")} htmlFor="space-label" hint={t("parking.fields.labelHint")}>
            <Input id="space-label" value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} />
          </Field>
          <Field label={t("parking.fields.type")}>
            <Select value={form.type} onValueChange={(value) => setForm({ ...form, type: value })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="techado">{t("parking.types.techado")}</SelectItem>
                <SelectItem value="descubierto">{t("parking.types.descubierto")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("parking.fields.fee")}>
            <MoneyInput value={form.monthly_fee} onChange={(value) => setForm({ ...form, monthly_fee: value })} />
          </Field>
          <Field label={t("parking.fields.status")}>
            <Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="disponible">{t("parking.status.disponible")}</SelectItem>
                <SelectItem value="fuera_de_servicio">{t("parking.status.fuera_de_servicio")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </FormDialog>

      {/* ------------------------------------------- bulk create in series */}
      <FormDialog
        open={bulkOpen}
        onOpenChange={(next) => { setBulkOpen(next); if (!next) setError(null); }}
        title={t("parking.bulkNew")}
        description={t("parking.bulkDescription")}
        error={error}
        pending={createBulk.isPending}
        submitLabel={t("parking.bulkSubmit")}
        onSubmit={() => {
          setError(null);
          if (!bulk.property_id) return setError(t("units.errors.propertyRequired"));
          const count = Number(bulk.count);
          if (!Number.isFinite(count) || count < 1 || count > 200) return setError(t("parking.errors.countRange"));
          createBulk.mutate(bulk);
        }}
      >
        <Field label={t("units.fields.property")}>
          <Select value={bulk.property_id} onValueChange={(value) => setBulk({ ...bulk, property_id: value })}>
            <SelectTrigger><SelectValue placeholder={t("units.fields.propertyPlaceholder")} /></SelectTrigger>
            <SelectContent>
              {portfolio.data?.properties.map((property) => (
                <SelectItem key={property.id} value={property.id}>{property.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("parking.fields.prefix")} htmlFor="bulk-prefix">
            <Input id="bulk-prefix" value={bulk.prefix} onChange={(event) => setBulk({ ...bulk, prefix: event.target.value })} />
          </Field>
          <Field label={t("parking.fields.start")} htmlFor="bulk-start">
            <Input id="bulk-start" inputMode="numeric" className="numeric" value={bulk.start}
              onChange={(event) => setBulk({ ...bulk, start: event.target.value.replace(/\D/g, "") })} />
          </Field>
          <Field label={t("parking.fields.count")} htmlFor="bulk-count">
            <Input id="bulk-count" inputMode="numeric" className="numeric" value={bulk.count}
              onChange={(event) => setBulk({ ...bulk, count: event.target.value.replace(/\D/g, "") })} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("parking.fields.type")}>
            <Select value={bulk.type} onValueChange={(value) => setBulk({ ...bulk, type: value })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="techado">{t("parking.types.techado")}</SelectItem>
                <SelectItem value="descubierto">{t("parking.types.descubierto")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("parking.fields.fee")}>
            <MoneyInput value={bulk.monthly_fee} onChange={(value) => setBulk({ ...bulk, monthly_fee: value })} />
          </Field>
        </div>
        {bulkPreview ? (
          <p className="rounded-lg border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground">{bulkPreview}</p>
        ) : null}
      </FormDialog>

      {/* ------------------------------------------------------- assign */}
      <FormDialog
        open={assignFor !== null}
        onOpenChange={(next) => { if (!next) { setAssignFor(null); setAssignLease(null); setError(null); } }}
        title={t("parking.assignTitle", { label: assignFor?.label ?? "" })}
        error={error}
        pending={assign.isPending}
        submitLabel={t("parking.assign")}
        onSubmit={() => {
          setError(null);
          if (!assignFor || !assignLease) return setError(t("parking.errors.leaseRequired"));
          assign.mutate({ space: assignFor, leaseId: assignLease });
        }}
      >
        <Field label={t("parking.fields.lease")}>
          <Combobox
            options={leaseOptions}
            value={assignLease}
            onChange={setAssignLease}
            placeholder={t("parking.fields.leasePlaceholder")}
          />
        </Field>
        <p className="flex items-start gap-2 rounded-lg border border-info/25 bg-info/10 px-3 py-2 text-sm text-info">
          <Info className="mt-0.5 size-4 shrink-0" />
          {t("parking.assignNote")}
        </p>
      </FormDialog>
    </div>
  );
}
