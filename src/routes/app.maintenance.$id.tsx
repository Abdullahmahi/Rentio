import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Eye, Lock, Send, ShieldAlert, Wrench } from "lucide-react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/rentio/empty-state";
import { Field } from "@/components/rentio/form-dialog";
import { MoneyInput } from "@/components/rentio/money-input";
import { MoneyText } from "@/components/rentio/money-text";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { WorkOrderPriorityBadge, WorkOrderStatusBadge } from "@/components/rentio/status";
import { CATEGORY_ICONS, SOURCE_ICONS, daysOpen } from "@/lib/maintenance";
import { repairClock } from "@/lib/texas";
import { formatDate } from "@/lib/format";
import { leaseContexts } from "@/lib/portfolio";
import { logActivity, qk, useActorId, usePortfolio, useToastMutation } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { signedUrl } from "@/lib/storage";
import { cn } from "@/lib/utils";
import type { Enums, TablesUpdate } from "@/lib/database.types";

export const Route = createFileRoute("/app/maintenance/$id")({ component: WorkOrderDetailPage });

const STATUSES: Enums<"wo_status">[] = [
  "nueva",
  "asignada",
  "en_progreso",
  "esperando_refacciones",
  "resuelta",
  "cerrada",
];

function WorkOrderDetailPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const portfolio = usePortfolio();
  const actorId = useActorId();

  const [noteBody, setNoteBody] = useState("");
  const [noteInternal, setNoteInternal] = useState(true);
  const [vendor, setVendor] = useState({
    vendor_name: "",
    vendor_phone: "",
    cost: "" as number | "",
  });
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  const order = useQuery({
    queryKey: qk.workOrder(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const photos = useQuery({
    queryKey: [...qk.workOrder(id), "photos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_order_photos")
        .select("*")
        .eq("work_order_id", id);
      if (error) throw error;
      return data;
    },
  });

  const notes = useQuery({
    queryKey: [...qk.workOrder(id), "notes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_order_notes")
        .select("*")
        .eq("work_order_id", id)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  /** Status history comes from activity_log — no extra table for a timeline. */
  const timeline = useQuery({
    queryKey: [...qk.workOrder(id), "timeline"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("*")
        .eq("entity_type", "work_order")
        .eq("entity_id", id)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (order.data) {
      setVendor({
        vendor_name: order.data.vendor_name ?? "",
        vendor_phone: order.data.vendor_phone ?? "",
        cost: order.data.cost === null ? "" : Number(order.data.cost),
      });
    }
  }, [order.data]);

  // Private bucket: each photo needs its own short-lived signed URL.
  useEffect(() => {
    let active = true;
    void (async () => {
      const entries = await Promise.all(
        (photos.data ?? []).map(async (photo) => {
          try {
            return [photo.id, await signedUrl("work-order-photos", photo.url)] as const;
          } catch {
            return [photo.id, ""] as const;
          }
        }),
      );
      if (active) setPhotoUrls(Object.fromEntries(entries.filter(([, url]) => url)));
    })();
    return () => {
      active = false;
    };
  }, [photos.data]);

  const context = useMemo(() => {
    if (!portfolio.data || !order.data) return undefined;
    const unit = portfolio.data.units.find((row) => row.id === order.data?.unit_id);
    const lease = order.data.lease_id
      ? leaseContexts(portfolio.data).find((row) => row.lease.id === order.data?.lease_id)
      : undefined;
    return {
      unit,
      property: portfolio.data.properties.find((row) => row.id === unit?.property_id),
      tenant: lease?.primaryTenant,
    };
  }, [portfolio.data, order.data]);

  const setStatus = useToastMutation({
    mutationFn: async (status: Enums<"wo_status">) => {
      const patch: TablesUpdate<"work_orders"> = { status };
      if (status === "resuelta" && !order.data?.resolved_at)
        patch.resolved_at = new Date().toISOString();
      const { error } = await supabase.from("work_orders").update(patch).eq("id", id);
      if (error) throw error;
      await logActivity(actorId, "work_order", id, "status", {
        from: order.data?.status,
        to: status,
      });
    },
    successKey: "maintenance.statusChanged",
    invalidate: [qk.workOrder(id), qk.workOrders, [...qk.workOrder(id), "timeline"]],
  });

  const saveVendor = useToastMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("work_orders")
        .update({
          vendor_name: vendor.vendor_name.trim() || null,
          vendor_phone: vendor.vendor_phone.trim() || null,
          cost: vendor.cost === "" ? null : vendor.cost,
        })
        .eq("id", id);
      if (error) throw error;
      await logActivity(actorId, "work_order", id, "assign_vendor", {
        vendor: vendor.vendor_name,
        cost: vendor.cost,
      });
    },
    successKey: "maintenance.vendorSaved",
    invalidate: [qk.workOrder(id), qk.workOrders, [...qk.workOrder(id), "timeline"]],
  });

  const addNote = useToastMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("work_order_notes").insert({
        work_order_id: id,
        author_id: actorId,
        body: noteBody.trim(),
        is_internal: noteInternal,
      });
      if (error) throw error;
    },
    successKey: "maintenance.noteAdded",
    invalidate: [[...qk.workOrder(id), "notes"]],
    onSuccess: () => setNoteBody(""),
  });

  const data = order.data;
  const CategoryIcon = data ? CATEGORY_ICONS[data.category] : Wrench;
  const SourceIcon = data ? SOURCE_ICONS[data.source] : Wrench;

  const repair =
    data?.affects_health_safety && data.written_notice_at
      ? repairClock(data.written_notice_at, undefined, data.resolved_at)
      : null;

  const internalNotes = (notes.data ?? []).filter((note) => note.is_internal);
  const tenantNotes = (notes.data ?? []).filter((note) => !note.is_internal);

  return (
    <div className="space-y-6">
      <Link
        to="/app/maintenance"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("maintenance.backToList")}
      </Link>

      <QueryState
        isLoading={order.isLoading || portfolio.isLoading}
        error={order.error ?? portfolio.error}
        isEmpty={!data && !order.isLoading}
        onRetry={() => void order.refetch()}
        skeleton={<RowsSkeleton count={5} />}
        empty={
          <EmptyState
            icon={Wrench}
            message={t("maintenance.notFound")}
            description={t("maintenance.notFoundDescription")}
          />
        }
      >
        {data ? (
          <>
            <PageHeader
              title={data.title}
              description={[
                data.folio,
                `${t("units.columns.unit")} ${context?.unit?.unit_number ?? "—"}`,
                context?.property?.name,
                context?.tenant?.full_name,
                formatDate(data.created_at),
              ]
                .filter(Boolean)
                .join(" · ")}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <WorkOrderPriorityBadge value={data.priority} />
                  <WorkOrderStatusBadge value={data.status} />
                  <Select
                    value={data.status}
                    onValueChange={(value) => setStatus.mutate(value as Enums<"wo_status">)}
                  >
                    <SelectTrigger className="w-52" aria-label={t("maintenance.changeStatus")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {t(`woStatus.${status}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              }
            />

            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm shadow-subtle">
              <span className="flex items-center gap-1.5">
                <CategoryIcon className="size-4 text-muted-foreground" />
                {t(`woCategory.${data.category}`)}
              </span>
              <span className="flex items-center gap-1.5">
                <SourceIcon className="size-4 text-muted-foreground" />
                {t(`woSource.${data.source}`)}
              </span>
              <span className="numeric text-muted-foreground">
                {t("maintenance.openFor", { count: daysOpen(data.created_at, data.resolved_at) })}
              </span>
              {data.resolved_at ? (
                <span className="numeric text-success">
                  {t("maintenance.resolvedOn", { date: formatDate(data.resolved_at) })}
                </span>
              ) : null}
            </div>

            {/* §92.056 — the statutory repair window, counted from the
                tenant's written notice. A portal order IS that notice. */}
            {data.affects_health_safety && data.written_notice_at ? (
              <div
                className={cn(
                  "rounded-lg border p-4",
                  repair?.tone === "danger"
                    ? "border-danger/40 bg-danger/10"
                    : repair?.tone === "warning"
                      ? "border-warning/40 bg-warning/10"
                      : "border-border bg-muted/40",
                )}
              >
                <p className="flex items-center gap-2 text-sm font-medium">
                  <ShieldAlert className="size-4 shrink-0" />
                  {repair?.overdue
                    ? t("maintenance.repairOverdue", { count: repair.day })
                    : t("maintenance.repairWindow", { day: repair?.day ?? 1, total: 7 })}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("maintenance.writtenNoticeOn", {
                    date: formatDate(data.written_notice_at),
                  })}
                </p>
              </div>
            ) : null}

            {data.description ? (
              <section className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
                <h2 className="text-base font-semibold">{t("maintenance.fields.description")}</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                  {data.description}
                </p>
              </section>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                {/* ------------------------------------------- photos */}
                <section className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
                  <h2 className="text-base font-semibold">{t("maintenance.photos")}</h2>
                  {(photos.data?.length ?? 0) === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {t("maintenance.noPhotos")}
                    </p>
                  ) : (
                    <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {photos.data?.map((photo) => (
                        <li key={photo.id}>
                          <button
                            className="block w-full overflow-hidden rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                            onClick={() => setLightbox(photoUrls[photo.id] ?? null)}
                            aria-label={t("maintenance.openPhoto")}
                          >
                            {photoUrls[photo.id] ? (
                              <img
                                src={photoUrls[photo.id]}
                                alt=""
                                className="aspect-square w-full object-cover"
                              />
                            ) : (
                              <span className="grid aspect-square w-full place-items-center bg-muted text-muted-foreground">
                                …
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {/* ---------------------------------------- note streams */}
                <section className="space-y-4">
                  <div className="rounded-lg border border-border bg-muted/50 p-5">
                    <h2 className="flex items-center gap-2 text-base font-semibold">
                      <Lock className="size-4" />
                      {t("maintenance.internalNotes")}
                    </h2>
                    <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                      {t("maintenance.internalNotesHint")}
                    </p>
                    <ul className="mt-3 space-y-2">
                      {internalNotes.length === 0 ? (
                        <li className="text-sm text-muted-foreground">
                          {t("maintenance.noNotes")}
                        </li>
                      ) : (
                        internalNotes.map((note) => (
                          <li
                            key={note.id}
                            className="rounded-lg border border-border bg-surface px-3 py-2"
                          >
                            <p className="whitespace-pre-wrap text-sm">{note.body}</p>
                            <p className="numeric mt-1 text-xs text-muted-foreground">
                              {formatDate(note.created_at)}
                            </p>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>

                  <div className="rounded-lg border border-info/25 bg-info/5 p-5">
                    <h2 className="flex items-center gap-2 text-base font-semibold text-info">
                      <Eye className="size-4" />
                      {t("maintenance.tenantNotes")}
                    </h2>
                    <p className="mt-0.5 text-xs font-medium text-info">
                      {t("maintenance.tenantNotesHint")}
                    </p>
                    <ul className="mt-3 space-y-2">
                      {tenantNotes.length === 0 ? (
                        <li className="text-sm text-muted-foreground">
                          {t("maintenance.noNotes")}
                        </li>
                      ) : (
                        tenantNotes.map((note) => (
                          <li
                            key={note.id}
                            className="rounded-lg border border-border bg-surface px-3 py-2"
                          >
                            <p className="whitespace-pre-wrap text-sm">{note.body}</p>
                            <p className="numeric mt-1 text-xs text-muted-foreground">
                              {formatDate(note.created_at)}
                            </p>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>

                  {/* The destination is chosen before writing, never after. */}
                  <div
                    className={cn(
                      "rounded-lg border p-4",
                      noteInternal ? "border-border bg-muted/50" : "border-info/25 bg-info/5",
                    )}
                  >
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          [true, "maintenance.internalNotes", Lock],
                          [false, "maintenance.tenantNotes", Eye],
                        ] as const
                      ).map(([value, labelKey, Icon]) => (
                        <button
                          key={String(value)}
                          type="button"
                          onClick={() => setNoteInternal(value)}
                          aria-pressed={noteInternal === value}
                          className={cn(
                            "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium",
                            noteInternal === value
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-surface text-muted-foreground hover:bg-muted",
                          )}
                        >
                          <Icon className="size-3.5" />
                          {t(labelKey)}
                        </button>
                      ))}
                    </div>
                    <Textarea
                      className="mt-3"
                      rows={3}
                      value={noteBody}
                      aria-label={t(
                        noteInternal ? "maintenance.internalNotes" : "maintenance.tenantNotes",
                      )}
                      placeholder={t(
                        noteInternal
                          ? "maintenance.internalPlaceholder"
                          : "maintenance.tenantPlaceholder",
                      )}
                      onChange={(event) => setNoteBody(event.target.value)}
                    />
                    <Button
                      className="mt-3"
                      disabled={!noteBody.trim() || addNote.isPending}
                      onClick={() => addNote.mutate(undefined)}
                    >
                      <Send className="size-4" />
                      {t("maintenance.addNote")}
                    </Button>
                  </div>
                </section>
              </div>

              <div className="space-y-4">
                {/* ------------------------------------------ assignment */}
                <section className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
                  <h2 className="text-base font-semibold">{t("maintenance.assignment")}</h2>
                  <div className="mt-3 space-y-4">
                    <Field label={t("maintenance.fields.vendorName")} htmlFor="vendor-name">
                      <Input
                        id="vendor-name"
                        value={vendor.vendor_name}
                        onChange={(event) =>
                          setVendor({ ...vendor, vendor_name: event.target.value })
                        }
                      />
                    </Field>
                    <Field label={t("maintenance.fields.vendorPhone")} htmlFor="vendor-phone">
                      <Input
                        id="vendor-phone"
                        inputMode="tel"
                        className="numeric"
                        value={vendor.vendor_phone}
                        onChange={(event) =>
                          setVendor({ ...vendor, vendor_phone: event.target.value })
                        }
                      />
                    </Field>
                    <Field
                      label={t("maintenance.fields.cost")}
                      hint={t("maintenance.fields.costHint")}
                    >
                      <MoneyInput
                        value={vendor.cost}
                        onChange={(value) => setVendor({ ...vendor, cost: value })}
                      />
                    </Field>
                    <Button
                      variant="outline"
                      disabled={saveVendor.isPending}
                      onClick={() => saveVendor.mutate(undefined)}
                    >
                      {t("actions.save")}
                    </Button>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
                    <Button
                      variant="outline"
                      disabled={data.status === "resuelta" || data.status === "cerrada"}
                      onClick={() => setStatus.mutate("resuelta")}
                    >
                      {t("maintenance.resolve")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={data.status === "cerrada"}
                      onClick={() => setStatus.mutate("cerrada")}
                    >
                      {t("maintenance.close")}
                    </Button>
                  </div>

                  {data.cost !== null ? (
                    <p className="mt-4 flex items-baseline justify-between text-sm">
                      <span className="text-muted-foreground">{t("maintenance.fields.cost")}</span>
                      <MoneyText value={Number(data.cost)} className="font-semibold" />
                    </p>
                  ) : null}
                </section>

                {/* -------------------------------------------- timeline */}
                <section className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
                  <h2 className="text-base font-semibold">{t("maintenance.timeline")}</h2>
                  {(timeline.data?.length ?? 0) === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {t("maintenance.noTimeline")}
                    </p>
                  ) : (
                    <ol className="mt-3 space-y-3">
                      {timeline.data?.map((entry) => {
                        const meta = entry.meta as { to?: string; from?: string } | null;
                        return (
                          <li key={entry.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
                            <span className="mt-1.5 size-2 rounded-full bg-primary" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium">
                                {entry.action === "status" && meta?.to
                                  ? t("maintenance.movedTo", { status: t(`woStatus.${meta.to}`) })
                                  : t(`maintenance.actions.${entry.action}`, {
                                      defaultValue: entry.action,
                                    })}
                              </p>
                              <p className="numeric text-xs text-muted-foreground">
                                {formatDate(entry.created_at)}
                              </p>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </section>
              </div>
            </div>

            <Dialog
              open={lightbox !== null}
              onOpenChange={(next) => {
                if (!next) setLightbox(null);
              }}
            >
              <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                  <DialogTitle>{t("maintenance.photos")}</DialogTitle>
                </DialogHeader>
                {lightbox ? (
                  <img
                    src={lightbox}
                    alt=""
                    className="max-h-[75vh] w-full rounded-lg object-contain"
                  />
                ) : null}
              </DialogContent>
            </Dialog>
          </>
        ) : null}
      </QueryState>
    </div>
  );
}
