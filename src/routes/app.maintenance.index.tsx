import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Columns3,
  Image,
  MessageCircle,
  Phone,
  Plus,
  Table2,
  User,
  Wrench,
  Droplets,
  Zap,
  KeyRound,
  WashingMachine,
  Sparkles,
  CircleHelp,
} from "lucide-react";
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
import { Combobox, type ComboboxOption } from "@/components/rentio/combobox";
import { DataTable, type DataTableColumn } from "@/components/rentio/data-table";
import { EmptyState } from "@/components/rentio/empty-state";
import { Field, FormDialog } from "@/components/rentio/form-dialog";
import { PageHeader } from "@/components/rentio/page-header";
import { CardsSkeleton, QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { WorkOrderPriorityBadge, WorkOrderStatusBadge } from "@/components/rentio/status";
import { formatMexicoDate } from "@/lib/format";
import { unitContexts } from "@/lib/portfolio";
import { logActivity, qk, useActorId, usePortfolio, useToastMutation } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { uploadFile } from "@/lib/storage";
import { CATEGORY_ICONS, SOURCE_ICONS, daysOpen } from "@/lib/maintenance";
import { cn } from "@/lib/utils";
import type { Enums, Tables, TablesUpdate } from "@/lib/database.types";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/app/maintenance/")({
  head: () => ({
    meta: [
      { title: `${i18n.t("pages.maintenance.title")} — Rentio` },
      { name: "description", content: i18n.t("pages.maintenance.description") },
    ],
  }),
  component: MaintenancePage,
});

const ALL = "__all__";
const STATUSES: Enums<"wo_status">[] = [
  "nueva",
  "asignada",
  "en_progreso",
  "esperando_refacciones",
  "resuelta",
  "cerrada",
];
const CATEGORIES: Enums<"wo_category">[] = [
  "plomeria",
  "electricidad",
  "cerrajeria",
  "electrodomesticos",
  "limpieza",
  "otro",
];
const PRIORITIES: Enums<"wo_priority">[] = ["baja", "media", "alta", "urgente"];
const OPEN_STATUSES: Enums<"wo_status">[] = [
  "nueva",
  "asignada",
  "en_progreso",
  "esperando_refacciones",
];

interface OrderRow extends Tables<"work_orders"> {
  unitNumber: string;
  propertyId: string | null;
  photoCount: number;
}

function MaintenancePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const portfolio = usePortfolio();
  const actorId = useActorId();

  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<Enums<"wo_status"> | null>(null);

  const [filters, setFilters] = useState({
    status: ALL,
    priority: ALL,
    category: ALL,
    property: ALL,
    source: ALL,
  });
  const [form, setForm] = useState({
    unit_id: null as string | null,
    category: "plomeria" as Enums<"wo_category">,
    priority: "media" as Enums<"wo_priority">,
    title: "",
    description: "",
    photos: [] as File[],
  });

  const orders = useQuery({
    queryKey: qk.workOrders,
    queryFn: async () => {
      const { data, error: caught } = await supabase
        .from("work_orders")
        .select("*")
        .order("created_at", { ascending: false });
      if (caught) throw caught;
      const { data: photos } = await supabase.from("work_order_photos").select("work_order_id");
      const counts = new Map<string, number>();
      for (const photo of photos ?? []) {
        counts.set(photo.work_order_id, (counts.get(photo.work_order_id) ?? 0) + 1);
      }
      return (data ?? []).map((order) => ({ ...order, _photos: counts.get(order.id) ?? 0 }));
    },
  });

  const units = useMemo(
    () => (portfolio.data ? unitContexts(portfolio.data) : []),
    [portfolio.data],
  );

  const rows = useMemo<OrderRow[]>(() => {
    const byUnit = new Map(units.map((row) => [row.unit.id, row]));
    return (orders.data ?? [])
      .map((order) => {
        const context = byUnit.get(order.unit_id);
        return {
          ...order,
          unitNumber: context?.unit.unit_number ?? "—",
          propertyId: context?.property?.id ?? null,
          photoCount: order._photos,
        };
      })
      .filter((row) => {
        if (filters.status !== ALL && row.status !== filters.status) return false;
        if (filters.priority !== ALL && row.priority !== filters.priority) return false;
        if (filters.category !== ALL && row.category !== filters.category) return false;
        if (filters.property !== ALL && row.propertyId !== filters.property) return false;
        if (filters.source !== ALL && row.source !== filters.source) return false;
        return true;
      });
  }, [orders.data, units, filters]);

  const summary = useMemo(() => {
    const all = orders.data ?? [];
    const open = all.filter((order) => OPEN_STATUSES.includes(order.status));
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const resolvedThisMonth = all.filter(
      (order) => order.resolved_at && new Date(order.resolved_at) >= monthStart,
    );
    const durations = all
      .filter((order) => order.resolved_at)
      .map((order) => daysOpen(order.created_at, order.resolved_at));
    return {
      open: open.length,
      urgent: open.filter((order) => order.priority === "urgente").length,
      resolvedThisMonth: resolvedThisMonth.length,
      averageDays:
        durations.length === 0
          ? null
          : Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    };
  }, [orders.data]);

  const unitOptions = useMemo<ComboboxOption[]>(
    () =>
      units.map((row) => ({
        value: row.unit.id,
        label: `${t("units.columns.unit")} ${row.unit.unit_number}`,
        hint: [row.property?.name, row.tenant?.full_name].filter(Boolean).join(" · "),
        keywords: `${row.property?.name ?? ""} ${row.tenant?.full_name ?? ""}`,
      })),
    [units, t],
  );

  const changeStatus = useToastMutation({
    mutationFn: async ({ order, status }: { order: OrderRow; status: Enums<"wo_status"> }) => {
      const patch: TablesUpdate<"work_orders"> = { status };
      if (status === "resuelta" && !order.resolved_at) patch.resolved_at = new Date().toISOString();
      const { error: caught } = await supabase.from("work_orders").update(patch).eq("id", order.id);
      if (caught) throw caught;
      // The detail timeline is rebuilt from these entries.
      await logActivity(actorId, "work_order", order.id, "status", {
        from: order.status,
        to: status,
      });
    },
    successKey: "maintenance.statusChanged",
    invalidate: [qk.workOrders, qk.activity],
  });

  const create = useToastMutation({
    mutationFn: async () => {
      if (!form.unit_id) throw new Error("no-unit");
      const context = units.find((row) => row.unit.id === form.unit_id);

      const { data: order, error: caught } = await supabase
        .from("work_orders")
        .insert({
          unit_id: form.unit_id,
          lease_id: context?.activeLease?.id ?? null,
          reported_by_tenant: context?.tenant?.id ?? null,
          source: "personal",
          category: form.category,
          priority: form.priority,
          title: form.title.trim(),
          description: form.description.trim() || null,
        })
        .select("id")
        .single();
      if (caught) throw caught;

      for (const photo of form.photos) {
        const path = await uploadFile("work-order-photos", order.id, photo);
        await supabase.from("work_order_photos").insert({
          work_order_id: order.id,
          url: path,
          uploaded_by: actorId,
        });
      }

      await logActivity(actorId, "work_order", order.id, "create", { title: form.title });
      return order.id;
    },
    successKey: "maintenance.created",
    invalidate: [qk.workOrders],
    onSuccess: () => {
      setOpen(false);
      setForm({
        unit_id: null,
        category: "plomeria",
        priority: "media",
        title: "",
        description: "",
        photos: [],
      });
    },
  });

  const columns: DataTableColumn<OrderRow>[] = [
    {
      key: "folio",
      header: t("maintenance.columns.folio"),
      sortValue: (row) => row.folio ?? "",
      cell: (row) => <span className="numeric font-medium">{row.folio ?? "—"}</span>,
    },
    {
      key: "unit",
      header: t("units.columns.unit"),
      sortValue: (row) => row.unitNumber,
      cell: (row) => row.unitNumber,
    },
    {
      key: "title",
      header: t("maintenance.columns.title"),
      sortValue: (row) => row.title,
      cell: (row) => <span className="block max-w-72 truncate">{row.title}</span>,
    },
    {
      key: "category",
      header: t("maintenance.columns.category"),
      sortValue: (row) => row.category,
      cell: (row) => t(`woCategory.${row.category}`),
    },
    {
      key: "priority",
      header: t("maintenance.columns.priority"),
      sortValue: (row) => PRIORITIES.indexOf(row.priority),
      cell: (row) => <WorkOrderPriorityBadge value={row.priority} />,
    },
    {
      key: "status",
      header: t("maintenance.columns.status"),
      sortValue: (row) => STATUSES.indexOf(row.status),
      cell: (row) => <WorkOrderStatusBadge value={row.status} />,
    },
    {
      key: "source",
      header: t("maintenance.columns.source"),
      sortValue: (row) => row.source,
      cell: (row) => t(`woSource.${row.source}`),
    },
    {
      key: "vendor",
      header: t("maintenance.columns.assignee"),
      sortValue: (row) => row.vendor_name ?? "",
      cell: (row) => row.vendor_name ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: "created",
      header: t("maintenance.columns.created"),
      sortValue: (row) => row.created_at,
      cell: (row) => <span className="numeric">{formatMexicoDate(row.created_at)}</span>,
    },
    {
      key: "age",
      header: t("maintenance.columns.daysOpen"),
      numeric: true,
      sortValue: (row) => daysOpen(row.created_at, row.resolved_at),
      cell: (row) => daysOpen(row.created_at, row.resolved_at),
    },
  ];

  const summaryCards = [
    { key: "open", value: String(summary.open), tone: "" },
    { key: "urgent", value: String(summary.urgent), tone: summary.urgent > 0 ? "text-accent" : "" },
    { key: "resolved", value: String(summary.resolvedThisMonth), tone: "text-success" },
    {
      key: "average",
      value:
        summary.averageDays === null
          ? "—"
          : t("maintenance.dayCount", { count: summary.averageDays }),
      tone: "",
    },
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("pages.maintenance.title")}
        description={t("pages.maintenance.description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-border p-0.5">
              {(
                [
                  ["kanban", Columns3],
                  ["table", Table2],
                ] as const
              ).map(([mode, Icon]) => (
                <button
                  key={mode}
                  onClick={() => setView(mode)}
                  aria-pressed={view === mode}
                  aria-label={t(`maintenance.view.${mode}`)}
                  title={t(`maintenance.view.${mode}`)}
                  className={cn(
                    "grid size-8 place-items-center rounded-md",
                    view === mode
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <Icon className="size-4" />
                </button>
              ))}
            </div>
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" />
              {t("maintenance.new")}
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <div
            key={card.key}
            className="rounded-lg border border-border bg-surface p-4 shadow-subtle"
          >
            <p className="text-xs font-medium text-muted-foreground">
              {t(`maintenance.summary.${card.key}`)}
            </p>
            <p className={`numeric mt-1 text-xl font-semibold ${card.tone}`}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {(
          [
            [
              "status",
              STATUSES.map((value) => ({ value, label: t(`woStatus.${value}`) })),
              "maintenance.columns.status",
            ],
            [
              "priority",
              PRIORITIES.map((value) => ({ value, label: t(`woPriority.${value}`) })),
              "maintenance.columns.priority",
            ],
            [
              "category",
              CATEGORIES.map((value) => ({ value, label: t(`woCategory.${value}`) })),
              "maintenance.columns.category",
            ],
            [
              "source",
              (["portal", "whatsapp", "telefono", "personal"] as const).map((value) => ({
                value,
                label: t(`woSource.${value}`),
              })),
              "maintenance.columns.source",
            ],
          ] as const
        ).map(([key, options, labelKey]) => (
          <Select
            key={key}
            value={filters[key]}
            onValueChange={(value) => setFilters({ ...filters, [key]: value })}
          >
            <SelectTrigger aria-label={t(labelKey)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t(labelKey)}</SelectItem>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
        <Select
          value={filters.property}
          onValueChange={(value) => setFilters({ ...filters, property: value })}
        >
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
      </div>

      <QueryState
        isLoading={orders.isLoading || portfolio.isLoading}
        error={orders.error ?? portfolio.error}
        isEmpty={rows.length === 0}
        onRetry={() => void orders.refetch()}
        skeleton={
          view === "kanban" ? <CardsSkeleton count={6} height="h-32" /> : <RowsSkeleton count={8} />
        }
        empty={
          <EmptyState
            icon={Wrench}
            message={t("maintenance.emptyTitle")}
            description={t("maintenance.emptyDescription")}
            actionLabel={t("maintenance.new")}
            onAction={() => setOpen(true)}
          />
        }
      >
        {view === "kanban" ? (
          <div className="grid gap-3 overflow-x-auto lg:grid-cols-3 xl:grid-cols-6">
            {STATUSES.map((status) => {
              const columnRows = rows.filter((row) => row.status === status);
              return (
                <section
                  key={status}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDropTarget(status);
                  }}
                  onDragLeave={() =>
                    setDropTarget((current) => (current === status ? null : current))
                  }
                  onDrop={(event) => {
                    event.preventDefault();
                    setDropTarget(null);
                    const order = rows.find((row) => row.id === dragging);
                    setDragging(null);
                    if (order && order.status !== status) changeStatus.mutate({ order, status });
                  }}
                  className={cn(
                    "min-w-56 rounded-lg border bg-muted/30 p-2 transition-colors",
                    dropTarget === status ? "border-primary bg-primary/5" : "border-border",
                  )}
                >
                  <header className="flex items-center justify-between px-1.5 py-1.5">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t(`woStatus.${status}`)}
                    </h2>
                    <span className="numeric text-xs font-semibold text-muted-foreground">
                      {columnRows.length}
                    </span>
                  </header>

                  <ul className="space-y-2">
                    {columnRows.map((row) => {
                      const CategoryIcon = CATEGORY_ICONS[row.category];
                      const SourceIcon = SOURCE_ICONS[row.source];
                      return (
                        <li key={row.id}>
                          <article
                            draggable
                            onDragStart={() => setDragging(row.id)}
                            onDragEnd={() => {
                              setDragging(null);
                              setDropTarget(null);
                            }}
                            onClick={() =>
                              void navigate({ to: "/app/maintenance/$id", params: { id: row.id } })
                            }
                            className={cn(
                              "cursor-pointer rounded-lg border border-border bg-surface p-3 shadow-subtle transition-opacity hover:border-primary/40",
                              // Urgent orders carry a terracotta spine.
                              row.priority === "urgente" && "border-l-4 border-l-accent",
                              dragging === row.id && "opacity-50",
                            )}
                          >
                            <p className="line-clamp-2 text-sm font-medium">{row.title}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {t("units.columns.unit")} {row.unitNumber}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <WorkOrderPriorityBadge value={row.priority} />
                              <span
                                className="flex items-center gap-1 text-xs text-muted-foreground"
                                title={t(`woCategory.${row.category}`)}
                              >
                                <CategoryIcon className="size-3.5" />
                              </span>
                              <span
                                className="flex items-center gap-1 text-xs text-muted-foreground"
                                title={t(`woSource.${row.source}`)}
                              >
                                <SourceIcon className="size-3.5" />
                              </span>
                              {row.photoCount > 0 ? (
                                <span className="numeric flex items-center gap-1 text-xs text-muted-foreground">
                                  <Image className="size-3.5" />
                                  {row.photoCount}
                                </span>
                              ) : null}
                              <span className="numeric ml-auto text-xs text-muted-foreground">
                                {t("maintenance.dayCount", {
                                  count: daysOpen(row.created_at, row.resolved_at),
                                })}
                              </span>
                            </div>
                          </article>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            getRowId={(row) => row.id}
            searchValue={(row) =>
              `${row.folio ?? ""} ${row.title} ${row.unitNumber} ${row.vendor_name ?? ""}`
            }
            onRowClick={(row) =>
              void navigate({ to: "/app/maintenance/$id", params: { id: row.id } })
            }
            pageSize={15}
          />
        )}
      </QueryState>

      <FormDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        title={t("maintenance.new")}
        error={error}
        pending={create.isPending}
        onSubmit={() => {
          setError(null);
          if (!form.unit_id) return setError(t("services.errors.unitRequired"));
          if (!form.title.trim()) return setError(t("maintenance.errors.titleRequired"));
          create.mutate(undefined);
        }}
      >
        <Field label={t("units.columns.unit")} hint={t("maintenance.fields.unitHint")}>
          <Combobox
            options={unitOptions}
            value={form.unit_id}
            onChange={(value) => setForm({ ...form, unit_id: value })}
            placeholder={t("contracts.fields.unitPlaceholder")}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("maintenance.columns.category")}>
            <Select
              value={form.category}
              onValueChange={(value) =>
                setForm({ ...form, category: value as Enums<"wo_category"> })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {t(`woCategory.${category}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("maintenance.columns.priority")}>
            <Select
              value={form.priority}
              onValueChange={(value) =>
                setForm({ ...form, priority: value as Enums<"wo_priority"> })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((priority) => (
                  <SelectItem key={priority} value={priority}>
                    {t(`woPriority.${priority}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label={t("maintenance.columns.title")} htmlFor="wo-title">
          <Input
            id="wo-title"
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </Field>
        <Field label={t("maintenance.fields.description")} htmlFor="wo-description">
          <Textarea
            id="wo-description"
            rows={3}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>
        <Field label={t("maintenance.fields.photos")} htmlFor="wo-photos">
          <Input
            id="wo-photos"
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => setForm({ ...form, photos: [...(event.target.files ?? [])] })}
          />
        </Field>
      </FormDialog>
    </div>
  );
}
