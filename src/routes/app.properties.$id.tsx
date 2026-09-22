import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Building2, CarFront, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { ConfirmDialog } from "@/components/rentio/confirm-dialog";
import { DataTable, type DataTableColumn } from "@/components/rentio/data-table";
import { DocumentsPanel } from "@/components/rentio/documents-panel";
import { EmptyState } from "@/components/rentio/empty-state";
import { Field, FormDialog } from "@/components/rentio/form-dialog";
import { MoneyText } from "@/components/rentio/money-text";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { UnitStatusBadge } from "@/components/rentio/status";
import { AdminOnly } from "@/lib/auth";
import { occupancy, unitContexts, type UnitContext } from "@/lib/portfolio";
import { DEFAULT_CITY, DEFAULT_STATE, US_STATES, formatCityStateZip } from "@/lib/us";
import { logActivity, qk, useActorId, usePortfolio, useToastMutation } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/app/properties/$id")({
  head: () => ({
    meta: [
      { title: `${i18n.t("pages.detail.property")} — Rentio` },
      { name: "description", content: i18n.t("pages.properties.description") },
    ],
  }),
  component: PropertyDetailPage,
});

function PropertyDetailPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const portfolio = usePortfolio();
  const actorId = useActorId();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: "",
    street: "",
    address_line_2: "",
    city: "",
    state: "",
    postal_code: "",
    units_in_structure: "",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);

  const property = portfolio.data?.properties.find((row) => row.id === id);
  const stats = portfolio.data
    ? occupancy(portfolio.data, id)
    : { total: 0, occupied: 0, vacant: 0, rate: 0 };

  const units = useMemo<UnitContext[]>(
    () =>
      portfolio.data
        ? unitContexts(portfolio.data).filter((row) => row.unit.property_id === id)
        : [],
    [portfolio.data, id],
  );
  const parking = useMemo(
    () => portfolio.data?.parking.filter((space) => space.property_id === id) ?? [],
    [portfolio.data, id],
  );

  const save = useToastMutation({
    mutationFn: async (values: typeof form) => {
      const { error: caught } = await supabase
        .from("properties")
        .update({
          ...values,
          units_in_structure: values.units_in_structure ? Number(values.units_in_structure) : null,
        })
        .eq("id", id);
      if (caught) throw caught;
      await logActivity(actorId, "property", id, "update", { name: values.name });
    },
    successKey: "properties.updated",
    invalidate: [qk.portfolio],
    onSuccess: () => setEditing(false),
  });

  const destroy = useToastMutation({
    mutationFn: async () => {
      const { error: caught } = await supabase.from("properties").delete().eq("id", id);
      if (caught) throw caught;
      await logActivity(actorId, "property", id, "delete", { name: property?.name });
    },
    successKey: "properties.deleted",
    invalidate: [qk.portfolio],
    onSuccess: () => void navigate({ to: "/app/properties" }),
  });

  const unitColumns: DataTableColumn<UnitContext>[] = [
    {
      key: "unit",
      header: t("units.columns.unit"),
      sortValue: (row) => row.unit.unit_number,
      cell: (row) => <span className="font-medium">{row.unit.unit_number}</span>,
    },
    {
      key: "floor",
      header: t("units.columns.floor"),
      numeric: true,
      sortValue: (row) => row.unit.floor ?? 0,
      cell: (row) => row.unit.floor ?? "—",
    },
    {
      key: "bedrooms",
      header: t("units.columns.bedrooms"),
      numeric: true,
      sortValue: (row) => row.unit.bedrooms ?? 0,
      cell: (row) => row.unit.bedrooms ?? "—",
    },
    {
      key: "rent",
      header: t("units.columns.baseRent"),
      numeric: true,
      sortValue: (row) => Number(row.unit.base_rent),
      cell: (row) => <MoneyText value={Number(row.unit.base_rent)} />,
    },
    {
      key: "status",
      header: t("units.columns.status"),
      sortValue: (row) => row.unit.status,
      cell: (row) => <UnitStatusBadge value={row.unit.status} />,
    },
    {
      key: "tenant",
      header: t("units.columns.tenant"),
      sortValue: (row) => row.tenant?.full_name ?? "",
      cell: (row) => row.tenant?.full_name ?? <span className="text-muted-foreground">—</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <Link
        to="/app/properties"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("properties.backToList")}
      </Link>

      <QueryState
        isLoading={portfolio.isLoading}
        error={portfolio.error}
        isEmpty={!property && !portfolio.isLoading}
        onRetry={() => void portfolio.refetch()}
        skeleton={<RowsSkeleton count={4} />}
        empty={
          <EmptyState
            icon={Building2}
            message={t("properties.notFound")}
            description={t("properties.notFoundDescription")}
          />
        }
      >
        {property ? (
          <>
            <PageHeader
              title={property.name}
              description={[
                [property.street, property.address_line_2].filter(Boolean).join(", "),
                formatCityStateZip(property.city, property.state, property.postal_code),
              ]
                .filter(Boolean)
                .join(" · ")}
              actions={
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setForm({
                        name: property.name,
                        street: property.street ?? "",
                        address_line_2: property.address_line_2 ?? "",
                        city: property.city ?? "",
                        state: property.state ?? DEFAULT_STATE,
                        postal_code: property.postal_code ?? "",
                        units_in_structure:
                          property.units_in_structure === null
                            ? ""
                            : String(property.units_in_structure),
                        notes: property.notes ?? "",
                      });
                      setEditing(true);
                    }}
                  >
                    <Pencil className="size-4" />
                    {t("actions.edit")}
                  </Button>
                  <AdminOnly>
                    <ConfirmDialog
                      triggerLabel={t("actions.delete")}
                      triggerVariant="outline"
                      destructive
                      title={t("properties.deleteTitle")}
                      description={t("properties.deleteDescription", {
                        name: property.name,
                        count: stats.total,
                      })}
                      confirmLabel={t("actions.delete")}
                      onConfirm={() => destroy.mutate(undefined)}
                    />
                  </AdminOnly>
                </div>
              }
            />

            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  ["properties.stats.units", String(stats.total)],
                  ["properties.stats.occupied", `${stats.occupied} / ${stats.total}`],
                  ["properties.stats.occupancy", `${Math.round(stats.rate * 100)}%`],
                ] as const
              ).map(([key, value]) => (
                <div
                  key={key}
                  className="rounded-lg border border-border bg-surface p-4 shadow-subtle"
                >
                  <p className="text-xs font-medium text-muted-foreground">{t(key)}</p>
                  <p className="numeric mt-1 text-2xl font-semibold">{value}</p>
                </div>
              ))}
            </div>

            <Tabs defaultValue="units">
              <TabsList>
                <TabsTrigger value="units">{t("nav.units")}</TabsTrigger>
                <TabsTrigger value="parking">{t("nav.parking")}</TabsTrigger>
                <TabsTrigger value="documents">{t("documents.title")}</TabsTrigger>
              </TabsList>

              <TabsContent value="units" className="mt-4">
                {units.length === 0 ? (
                  <EmptyState
                    icon={Building2}
                    message={t("units.emptyTitle")}
                    description={t("units.emptyDescription")}
                  />
                ) : (
                  <DataTable
                    columns={unitColumns}
                    data={units}
                    getRowId={(row) => row.unit.id}
                    searchValue={(row) => `${row.unit.unit_number} ${row.tenant?.full_name ?? ""}`}
                    onRowClick={(row) =>
                      void navigate({ to: "/app/units/$id", params: { id: row.unit.id } })
                    }
                    pageSize={15}
                  />
                )}
              </TabsContent>

              <TabsContent value="parking" className="mt-4">
                {parking.length === 0 ? (
                  <EmptyState
                    icon={CarFront}
                    message={t("parking.emptyTitle")}
                    description={t("parking.emptyDescription")}
                  />
                ) : (
                  <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {parking.map((space) => (
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
                <DocumentsPanel ownerType="property" ownerId={id} bucket="company" />
              </TabsContent>
            </Tabs>

            <FormDialog
              open={editing}
              onOpenChange={(next) => {
                setEditing(next);
                if (!next) setError(null);
              }}
              title={t("properties.edit")}
              error={error}
              pending={save.isPending}
              onSubmit={() => {
                setError(null);
                if (!form.name.trim()) return setError(t("properties.errors.nameRequired"));
                save.mutate({ ...form, name: form.name.trim() });
              }}
            >
              <Field label={t("properties.fields.name")} htmlFor="edit-name">
                <Input
                  id="edit-name"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </Field>
              <Field label={t("properties.fields.street")} htmlFor="edit-street">
                <Input
                  id="edit-street"
                  value={form.street}
                  onChange={(event) => setForm({ ...form, street: event.target.value })}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("properties.fields.addressLine2")} htmlFor="edit-address-2">
                  <Input
                    id="edit-address-2"
                    value={form.address_line_2}
                    onChange={(event) => setForm({ ...form, address_line_2: event.target.value })}
                  />
                </Field>
                <Field label={t("properties.fields.postalCode")} htmlFor="edit-cp">
                  <Input
                    id="edit-cp"
                    inputMode="numeric"
                    maxLength={5}
                    value={form.postal_code}
                    onChange={(event) =>
                      setForm({ ...form, postal_code: event.target.value.replace(/\D/g, "") })
                    }
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("properties.fields.city")} htmlFor="edit-city">
                  <Input
                    id="edit-city"
                    value={form.city}
                    onChange={(event) => setForm({ ...form, city: event.target.value })}
                  />
                </Field>
                <Field label={t("properties.fields.state")}>
                  <Select
                    value={form.state}
                    onValueChange={(value) => setForm({ ...form, state: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {US_STATES.map(([code, name]) => (
                        <SelectItem key={code} value={code}>
                          {code} — {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field
                label={t("properties.fields.unitsInStructure")}
                htmlFor="edit-units-in-structure"
                hint={t("properties.fields.unitsInStructureHint")}
              >
                <Input
                  id="edit-units-in-structure"
                  inputMode="numeric"
                  className="numeric max-w-40"
                  placeholder={t("properties.fields.unitsInStructurePlaceholder")}
                  value={form.units_in_structure}
                  onChange={(event) =>
                    setForm({ ...form, units_in_structure: event.target.value.replace(/\D/g, "") })
                  }
                />
              </Field>
              <Field label={t("properties.fields.notes")} htmlFor="edit-notes">
                <Textarea
                  id="edit-notes"
                  rows={3}
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                />
              </Field>
            </FormDialog>
          </>
        ) : null}
      </QueryState>
    </div>
  );
}
