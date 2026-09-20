import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2, Plus } from "lucide-react";
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
import { EmptyState } from "@/components/rentio/empty-state";
import { Field, FormDialog } from "@/components/rentio/form-dialog";
import { PageHeader } from "@/components/rentio/page-header";
import { CardsSkeleton, QueryState } from "@/components/rentio/query-state";
import { occupancy } from "@/lib/portfolio";
import { DEFAULT_CITY, DEFAULT_STATE, US_STATES, formatCityStateZip } from "@/lib/us";
import { logActivity, qk, useActorId, usePortfolio, useToastMutation } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/app/properties/")({
  head: () => ({
    meta: [
      { title: `${i18n.t("pages.properties.title")} — Rentio` },
      { name: "description", content: i18n.t("pages.properties.description") },
    ],
  }),
  component: PropertiesPage,
});

const EMPTY_FORM = {
  name: "",
  street: "",
  address_line_2: "",
  city: DEFAULT_CITY,
  state: DEFAULT_STATE,
  postal_code: "",
  notes: "",
};

function PropertiesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const portfolio = usePortfolio();
  const actorId = useActorId();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const cards = useMemo(() => {
    if (!portfolio.data) return [];
    return portfolio.data.properties.map((property) => ({
      property,
      stats: occupancy(portfolio.data, property.id),
    }));
  }, [portfolio.data]);

  const create = useToastMutation({
    mutationFn: async (values: typeof EMPTY_FORM) => {
      const { data, error: caught } = await supabase
        .from("properties")
        .insert(values)
        .select("id")
        .single();
      if (caught) throw caught;
      await logActivity(actorId, "property", data.id, "create", { name: values.name });
      return data;
    },
    successKey: "properties.created",
    invalidate: [qk.portfolio],
    onSuccess: () => {
      setOpen(false);
      setForm(EMPTY_FORM);
    },
  });

  const submit = () => {
    setError(null);
    if (!form.name.trim()) return setError(t("properties.errors.nameRequired"));
    create.mutate({ ...form, name: form.name.trim() });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("pages.properties.title")}
        description={t("pages.properties.description")}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            {t("properties.new")}
          </Button>
        }
      />

      <QueryState
        isLoading={portfolio.isLoading}
        error={portfolio.error}
        isEmpty={cards.length === 0}
        onRetry={() => void portfolio.refetch()}
        skeleton={<CardsSkeleton count={3} />}
        empty={
          <EmptyState
            icon={Building2}
            message={t("properties.emptyTitle")}
            description={t("properties.emptyDescription")}
            actionLabel={t("properties.new")}
            onAction={() => setOpen(true)}
          />
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map(({ property, stats }) => (
            <button
              key={property.id}
              onClick={() =>
                void navigate({ to: "/app/properties/$id", params: { id: property.id } })
              }
              className="rounded-lg border border-border bg-surface p-5 text-left shadow-subtle transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <Building2 className="size-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold">{property.name}</h2>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {[property.street, property.address_line_2].filter(Boolean).join(", ")}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {formatCityStateZip(property.city, property.state, property.postal_code)}
                  </p>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                <span className="text-sm text-muted-foreground">
                  {t("properties.unitCount", { count: stats.total })}
                </span>
                <span className="numeric text-sm font-semibold">
                  {Math.round(stats.rate * 100)}%
                </span>
              </div>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={t("properties.occupancyLabel", {
                  occupied: stats.occupied,
                  total: stats.total,
                })}
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.round(stats.rate * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("properties.occupancyLabel", { occupied: stats.occupied, total: stats.total })}
              </p>
            </button>
          ))}
        </div>
      </QueryState>

      <FormDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        title={t("properties.new")}
        description={t("properties.newDescription")}
        error={error}
        pending={create.isPending}
        onSubmit={submit}
      >
        <Field label={t("properties.fields.name")} htmlFor="property-name">
          <Input
            id="property-name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>
        <Field label={t("properties.fields.street")} htmlFor="property-street">
          <Input
            id="property-street"
            value={form.street}
            onChange={(event) => setForm({ ...form, street: event.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("properties.fields.addressLine2")} htmlFor="property-address-2">
            <Input
              id="property-address-2"
              value={form.address_line_2}
              onChange={(event) => setForm({ ...form, address_line_2: event.target.value })}
            />
          </Field>
          <Field label={t("properties.fields.postalCode")} htmlFor="property-cp">
            <Input
              id="property-cp"
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
          <Field label={t("properties.fields.city")} htmlFor="property-city">
            <Input
              id="property-city"
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
        <Field label={t("properties.fields.notes")} htmlFor="property-notes">
          <Textarea
            id="property-notes"
            rows={3}
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </Field>
      </FormDialog>
    </div>
  );
}
