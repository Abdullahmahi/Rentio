import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, Plus, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/rentio/empty-state";
import { Field } from "@/components/rentio/form-dialog";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { WorkOrderPriorityBadge, WorkOrderStatusBadge } from "@/components/rentio/status";
import { CATEGORY_ICONS } from "@/routes/app.maintenance.index";
import { formatMexicoDate } from "@/lib/format";
import { useMyPortal, useToastMutation } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { uploadFile } from "@/lib/storage";
import { cn } from "@/lib/utils";
import type { Enums } from "@/lib/database.types";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/portal/maintenance/")({
  head: () => ({ meta: [{ title: `${i18n.t("pages.maintenance.title")} — Rentio` }] }),
  component: PortalMaintenance,
});

const CATEGORIES: Enums<"wo_category">[] = ["plomeria", "electricidad", "cerrajeria", "electrodomesticos", "limpieza", "otro"];
const PRIORITIES: Enums<"wo_priority">[] = ["baja", "media", "alta", "urgente"];

function PortalMaintenance() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const portal = useMyPortal();

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    category: null as Enums<"wo_category"> | null,
    priority: "media" as Enums<"wo_priority">,
    description: "",
    photos: [] as File[],
  });

  const submit = useToastMutation({
    mutationFn: async () => {
      const lease = portal.data?.lease;
      if (!lease || !form.category) throw new Error("incomplete");

      // RLS only accepts source = 'portal' from a tenant.
      const { data: order, error: caught } = await supabase.from("work_orders").insert({
        unit_id: lease.unit_id,
        lease_id: lease.id,
        source: "portal",
        category: form.category,
        priority: form.priority,
        title: `${t(`woCategory.${form.category}`)} — ${t("units.columns.unit")} ${portal.data?.details?.unit_number ?? ""}`.trim(),
        description: form.description.trim() || null,
      }).select("id").single();
      if (caught) throw caught;

      for (const photo of form.photos) {
        const path = await uploadFile("work-order-photos", order.id, photo);
        await supabase.from("work_order_photos").insert({ work_order_id: order.id, url: path });
      }
    },
    successKey: "portal.requestSent",
    invalidate: [["my-portal"]],
    onSuccess: () => {
      setCreating(false);
      setForm({ category: null, priority: "media", description: "", photos: [] });
    },
  });

  if (creating) {
    return (
      <div className="space-y-5">
        <PageHeader title={t("portal.newRequest")} description={t("portal.newRequestHint")} />

        <form
          className="space-y-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            if (!form.category) return setError(t("portal.errors.categoryRequired"));
            if (!form.description.trim()) return setError(t("portal.errors.descriptionRequired"));
            submit.mutate(undefined);
          }}
        >
          {/* Large tappable cards, not a dropdown. */}
          <Field label={t("maintenance.columns.category")}>
            <div className="grid grid-cols-2 gap-3">
              {CATEGORIES.map((category) => {
                const Icon = CATEGORY_ICONS[category];
                const active = form.category === category;
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setForm({ ...form, category })}
                    aria-pressed={active}
                    className={cn(
                      "flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border p-3 text-sm font-medium",
                      active ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface hover:bg-muted",
                    )}
                  >
                    <Icon className="size-6" />
                    <span className="text-center">{t(`woCategory.${category}`)}</span>
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label={t("maintenance.columns.priority")}>
            <div className="grid grid-cols-4 gap-2">
              {PRIORITIES.map((priority) => (
                <button
                  key={priority}
                  type="button"
                  onClick={() => setForm({ ...form, priority })}
                  aria-pressed={form.priority === priority}
                  className={cn(
                    "h-12 rounded-lg border text-sm font-medium",
                    form.priority === priority
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-surface hover:bg-muted",
                  )}
                >
                  {t(`woPriority.${priority}`)}
                </button>
              ))}
            </div>
          </Field>

          <Field label={t("maintenance.fields.description")} htmlFor="request-description">
            <Textarea id="request-description" rows={4} value={form.description}
              placeholder={t("portal.descriptionPlaceholder")}
              onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </Field>

          <Field label={t("maintenance.fields.photos")} htmlFor="request-photos" hint={t("portal.photosHint")}>
            <Input id="request-photos" type="file" accept="image/*" capture="environment" multiple className="h-12"
              onChange={(event) => setForm({ ...form, photos: [...(event.target.files ?? [])] })} />
          </Field>

          {error ? (
            <p role="alert" className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <Button type="submit" className="h-12 text-base" disabled={submit.isPending}>
              {submit.isPending ? <Loader2 className="animate-spin" /> : null}
              {t("portal.sendRequest")}
            </Button>
            <Button type="button" variant="outline" className="h-12 text-base" onClick={() => setCreating(false)}>
              {t("actions.cancel")}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("pages.maintenance.title")}
        description={t("portal.maintenanceHint")}
        actions={
          <Button className="h-11" onClick={() => setCreating(true)}>
            <Plus className="size-4" />{t("portal.newRequest")}
          </Button>
        }
      />

      <QueryState
        isLoading={portal.isLoading}
        error={portal.error}
        isEmpty={(portal.data?.workOrders.length ?? 0) === 0}
        onRetry={() => void portal.refetch()}
        skeleton={<RowsSkeleton count={4} />}
        empty={
          <EmptyState
            icon={Wrench}
            message={t("portal.noRequests")}
            description={t("portal.noRequestsDescription")}
            actionLabel={t("portal.newRequest")}
            onAction={() => setCreating(true)}
          />
        }
      >
        <ul className="space-y-3">
          {portal.data?.workOrders.map((order) => (
            <li key={order.id}>
              <button
                onClick={() => void navigate({ to: "/portal/maintenance/$id", params: { id: order.id } })}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-lg border border-border bg-surface p-4 text-left hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{order.title}</p>
                  <p className="numeric mt-0.5 text-xs text-muted-foreground">
                    {order.folio ?? "—"} · {formatMexicoDate(order.created_at)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <WorkOrderStatusBadge value={order.status} />
                    <WorkOrderPriorityBadge value={order.priority} />
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </QueryState>
    </div>
  );
}
