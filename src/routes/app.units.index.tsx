import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LayoutGrid, Plus, Table2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, type DataTableColumn } from "@/components/rentio/data-table";
import { EmptyState } from "@/components/rentio/empty-state";
import { Field, FormDialog } from "@/components/rentio/form-dialog";
import { MoneyInput } from "@/components/rentio/money-input";
import { MoneyText } from "@/components/rentio/money-text";
import { PageHeader } from "@/components/rentio/page-header";
import { CardsSkeleton, QueryState } from "@/components/rentio/query-state";
import { UnitStatusBadge } from "@/components/rentio/status";
import { unitContexts, type UnitContext } from "@/lib/portfolio";
import { logActivity, qk, useActorId, usePortfolio, useToastMutation } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/app/units/")({
  head: () => ({ meta: [
    { title: `${i18n.t("pages.units.title")} — Rentio` },
    { name: "description", content: i18n.t("pages.units.description") },
  ] }),
  component: UnitsPage,
});

const ALL = "__all__";

interface UnitForm {
  property_id: string; unit_number: string; floor: string;
  bedrooms: string; bathrooms: string; sqm: string; base_rent: number | "";
}

const EMPTY_FORM: UnitForm = {
  property_id: "", unit_number: "", floor: "", bedrooms: "1", bathrooms: "1", sqm: "", base_rent: "",
};

function UnitsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const portfolio = usePortfolio();
  const actorId = useActorId();

  const [view, setView] = useState<"table" | "cards">("table");
  const [propertyFilter, setPropertyFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [bedroomFilter, setBedroomFilter] = useState(ALL);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (!portfolio.data) return [];
    return unitContexts(portfolio.data).filter(({ unit }) => {
      if (propertyFilter !== ALL && unit.property_id !== propertyFilter) return false;
      if (statusFilter !== ALL && unit.status !== statusFilter) return false;
      if (bedroomFilter !== ALL && String(unit.bedrooms ?? "") !== bedroomFilter) return false;
      return true;
    });
  }, [portfolio.data, propertyFilter, statusFilter, bedroomFilter]);

  const create = useToastMutation({
    mutationFn: async (values: UnitForm) => {
      const { data, error: caught } = await supabase.from("units").insert({
        property_id: values.property_id,
        unit_number: values.unit_number.trim(),
        floor: values.floor === "" ? null : Number(values.floor),
        bedrooms: values.bedrooms === "" ? null : Number(values.bedrooms),
        bathrooms: values.bathrooms === "" ? null : Number(values.bathrooms),
        sqm: values.sqm === "" ? null : Number(values.sqm),
        base_rent: values.base_rent === "" ? 0 : values.base_rent,
      }).select("id").single();
      if (caught) throw caught;
      await logActivity(actorId, "unit", data.id, "create", { unit_number: values.unit_number });
      return data;
    },
    successKey: "units.created",
    invalidate: [qk.portfolio],
    onSuccess: () => { setOpen(false); setForm(EMPTY_FORM); },
  });

  const submit = () => {
    setError(null);
    if (!form.property_id) return setError(t("units.errors.propertyRequired"));
    if (!form.unit_number.trim()) return setError(t("units.errors.numberRequired"));
    create.mutate(form);
  };

  const columns: DataTableColumn<UnitContext>[] = [
    { key: "unit", header: t("units.columns.unit"), sortValue: (row) => row.unit.unit_number,
      cell: (row) => <span className="font-medium">{row.unit.unit_number}</span> },
    { key: "property", header: t("units.columns.property"), sortValue: (row) => row.property?.name ?? "",
      cell: (row) => row.property?.name ?? "—" },
    { key: "floor", header: t("units.columns.floor"), numeric: true, sortValue: (row) => row.unit.floor ?? 0,
      cell: (row) => row.unit.floor ?? "—" },
    { key: "bedrooms", header: t("units.columns.bedrooms"), numeric: true, sortValue: (row) => row.unit.bedrooms ?? 0,
      cell: (row) => row.unit.bedrooms ?? "—" },
    { key: "bathrooms", header: t("units.columns.bathrooms"), numeric: true, sortValue: (row) => Number(row.unit.bathrooms ?? 0),
      cell: (row) => row.unit.bathrooms ?? "—" },
    { key: "sqm", header: t("units.columns.sqm"), numeric: true, sortValue: (row) => Number(row.unit.sqm ?? 0),
      cell: (row) => row.unit.sqm ?? "—" },
    { key: "rent", header: t("units.columns.baseRent"), numeric: true, sortValue: (row) => Number(row.unit.base_rent),
      cell: (row) => <MoneyText value={Number(row.unit.base_rent)} /> },
    { key: "status", header: t("units.columns.status"), sortValue: (row) => row.unit.status,
      cell: (row) => <UnitStatusBadge value={row.unit.status} /> },
    { key: "tenant", header: t("units.columns.tenant"), sortValue: (row) => row.tenant?.full_name ?? "",
      cell: (row) => row.tenant?.full_name ?? <span className="text-muted-foreground">—</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("pages.units.title")}
        description={t("pages.units.description")}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-border p-0.5">
              {([["table", Table2], ["cards", LayoutGrid]] as const).map(([mode, Icon]) => (
                <button
                  key={mode}
                  onClick={() => setView(mode)}
                  aria-pressed={view === mode}
                  aria-label={t(`units.view.${mode}`)}
                  title={t(`units.view.${mode}`)}
                  className={cn("grid size-8 place-items-center rounded-md", view === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
                >
                  <Icon className="size-4" />
                </button>
              ))}
            </div>
            <Button onClick={() => setOpen(true)}><Plus className="size-4" />{t("units.new")}</Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Select value={propertyFilter} onValueChange={setPropertyFilter}>
          <SelectTrigger aria-label={t("units.filters.property")}><SelectValue placeholder={t("units.filters.property")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("units.filters.allProperties")}</SelectItem>
            {portfolio.data?.properties.map((property) => (
              <SelectItem key={property.id} value={property.id}>{property.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger aria-label={t("units.filters.status")}><SelectValue placeholder={t("units.filters.status")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("units.filters.allStatuses")}</SelectItem>
            {(["vacante", "ocupada", "mantenimiento", "reservada"] as const).map((status) => (
              <SelectItem key={status} value={status}>{t(`unitStatus.${status}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={bedroomFilter} onValueChange={setBedroomFilter}>
          <SelectTrigger aria-label={t("units.filters.bedrooms")}><SelectValue placeholder={t("units.filters.bedrooms")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("units.filters.allBedrooms")}</SelectItem>
            {["1", "2", "3", "4"].map((count) => (
              <SelectItem key={count} value={count}>{t("units.filters.bedroomCount", { count: Number(count) })}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <QueryState
        isLoading={portfolio.isLoading}
        error={portfolio.error}
        isEmpty={rows.length === 0}
        onRetry={() => void portfolio.refetch()}
        skeleton={<CardsSkeleton count={6} height="h-24" />}
        empty={<EmptyState message={t("units.emptyTitle")} description={t("units.emptyDescription")} actionLabel={t("units.new")} onAction={() => setOpen(true)} />}
      >
        {view === "table" ? (
          <DataTable
            columns={columns}
            data={rows}
            getRowId={(row) => row.unit.id}
            searchValue={(row) => `${row.unit.unit_number} ${row.property?.name ?? ""} ${row.tenant?.full_name ?? ""}`}
            onRowClick={(row) => void navigate({ to: "/app/units/$id", params: { id: row.unit.id } })}
            pageSize={15}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows.map((row) => (
              <button
                key={row.unit.id}
                onClick={() => void navigate({ to: "/app/units/$id", params: { id: row.unit.id } })}
                className="rounded-lg border border-border bg-surface p-4 text-left shadow-subtle transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-base font-semibold">{row.unit.unit_number}</p>
                  <UnitStatusBadge value={row.unit.status} />
                </div>
                <p className="mt-1 truncate text-sm text-muted-foreground">{row.property?.name}</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("units.card.specs", {
                    bedrooms: row.unit.bedrooms ?? 0,
                    bathrooms: row.unit.bathrooms ?? 0,
                    sqm: row.unit.sqm ?? 0,
                  })}
                </p>
                <div className="mt-3"><MoneyText value={Number(row.unit.base_rent)} /></div>
                {row.tenant ? <p className="mt-2 truncate text-xs text-muted-foreground">{row.tenant.full_name}</p> : null}
              </button>
            ))}
          </div>
        )}
      </QueryState>

      <FormDialog
        open={open}
        onOpenChange={(next) => { setOpen(next); if (!next) setError(null); }}
        title={t("units.new")}
        error={error}
        pending={create.isPending}
        onSubmit={submit}
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
          <Field label={t("units.fields.number")} htmlFor="unit-number">
            <Input id="unit-number" value={form.unit_number} onChange={(event) => setForm({ ...form, unit_number: event.target.value })} />
          </Field>
          <Field label={t("units.fields.floor")} htmlFor="unit-floor">
            <Input id="unit-floor" inputMode="numeric" className="numeric" value={form.floor}
              onChange={(event) => setForm({ ...form, floor: event.target.value.replace(/\D/g, "") })} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("units.fields.bedrooms")} htmlFor="unit-bedrooms">
            <Input id="unit-bedrooms" inputMode="numeric" className="numeric" value={form.bedrooms}
              onChange={(event) => setForm({ ...form, bedrooms: event.target.value.replace(/\D/g, "") })} />
          </Field>
          <Field label={t("units.fields.bathrooms")} htmlFor="unit-bathrooms">
            <Input id="unit-bathrooms" inputMode="decimal" className="numeric" value={form.bathrooms}
              onChange={(event) => setForm({ ...form, bathrooms: event.target.value.replace(/[^\d.]/g, "") })} />
          </Field>
          <Field label={t("units.fields.sqm")} htmlFor="unit-sqm">
            <Input id="unit-sqm" inputMode="decimal" className="numeric" value={form.sqm}
              onChange={(event) => setForm({ ...form, sqm: event.target.value.replace(/[^\d.]/g, "") })} />
          </Field>
        </div>
        <Field label={t("units.fields.baseRent")}>
          <MoneyInput value={form.base_rent} onChange={(value) => setForm({ ...form, base_rent: value })} />
        </Field>
      </FormDialog>
    </div>
  );
}
