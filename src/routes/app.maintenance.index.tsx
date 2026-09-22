import { useEffect, useMemo, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { formatDate } from "@/lib/format";
import { unitContexts } from "@/lib/portfolio";
import { logActivity, qk, useActorId, usePortfolio, useToastMutation } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { StatutoryClock } from "@/components/rentio/statutory-clock";
import { signedUrls, uploadFile } from "@/lib/storage";
import { CATEGORY_ICONS, SOURCE_ICONS, daysOpen } from "@/lib/maintenance";
import { REPAIR_WINDOW_DAYS, repairClock } from "@/lib/texas";
import { cn } from "@/lib/utils";
import type { Enums, Tables, TablesUpdate } from "@/lib/database.types";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/app/maintenance/")({
  // `?new=1` lets the command palette land straight in the create dialog. The
  // page strips the param once it has opened it, so a refresh is not sticky.
  validateSearch: (search: Record<string, unknown>): { new?: true } =>
    search["new"] === true || search["new"] === "1" ? { new: true } : {},
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

/** Three reads at a glance; the rest go behind a "+N". */
const PHOTOS_PER_CARD = 3;
/**
 * The board shows four columns, not six: xl:grid-cols-6 forces horizontal
 * scrolling on any laptop and two of those columns sit near-empty. The table
 * view still filters on all six — nothing is hidden, the board is made to fit.
 * `esperando_refacciones` rides with `en_progreso`; both mean "started, not
 * finished", and dropping onto that column sets the one a human would pick.
 */
const BOARD_COLUMNS = [
  { key: "nueva", drop: "nueva", statuses: ["nueva"] },
  { key: "asignada", drop: "asignada", statuses: ["asignada"] },
  { key: "en_progreso", drop: "en_progreso", statuses: ["en_progreso", "esperando_refacciones"] },
  // Never straight to cerrada — closing is a decision, not a drag.
  { key: "terminadas", drop: "resuelta", statuses: ["resuelta", "cerrada"] },
] as const satisfies readonly {
  key: string;
  drop: Enums<"wo_status">;
  statuses: readonly Enums<"wo_status">[];
}[];

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
  thumbnails: string[];
}

function MaintenancePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const portfolio = usePortfolio();
  const actorId = useActorId();

  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Arrived from the command palette's "New work order".
  const openNew = Route.useSearch({ select: (search) => search["new"] });
  useEffect(() => {
    if (!openNew) return;
    setOpen(true);
    void navigate({ to: "/app/maintenance", search: {}, replace: true });
  }, [openNew, navigate]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<Enums<"wo_status"> | null>(null);
  /** Per combined column: show only one of its statuses. */
  const [columnFilter, setColumnFilter] = useState<Record<string, Enums<"wo_status"> | undefined>>(
    {},
  );

  const [filters, setFilters] = useState({
    status: ALL,
    priority: ALL,
    category: ALL,
    property: ALL,
    source: ALL,
    healthSafety: ALL,
  });
  const [form, setForm] = useState({
    unit_id: null as string | null,
    category: "plomeria" as Enums<"wo_category">,
    priority: "media" as Enums<"wo_priority">,
    affects_health_safety: false,
    title: "",
    description: "",
    photos: [] as File[],
  });

  const orders = useQuery({
    queryKey: qk.workOrders,
    // Signed URLs live 10 minutes; re-sign a little before they lapse rather
    // than on every render.
    staleTime: 8 * 60 * 1000,
    queryFn: async () => {
      const { data, error: caught } = await supabase
        .from("work_orders")
        .select("*")
        .order("created_at", { ascending: false });
      if (caught) throw caught;
      // A photo of the leak is a different object from the words "leaking
      // faucet". Fetch the paths, then sign them all in ONE request — the
      // per-path helper would be forty round trips for a full board.
      const { data: photos } = await supabase
        .from("work_order_photos")
        .select("id, work_order_id, url")
        .order("created_at");

      const byOrder = new Map<string, string[]>();
      for (const photo of photos ?? []) {
        const list = byOrder.get(photo.work_order_id) ?? [];
        list.push(photo.url);
        byOrder.set(photo.work_order_id, list);
      }

      const shown = [...byOrder.values()].flatMap((list) => list.slice(0, PHOTOS_PER_CARD));
      let urls = new Map<string, string>();
      try {
        urls = await signedUrls("work-order-photos", shown);
      } catch (signError) {
        // A board that loses its thumbnails is still a working board.
        console.warn("work-order-photos sign failed", signError);
      }

      return (data ?? []).map((order) => {
        const paths = byOrder.get(order.id) ?? [];
        return {
          ...order,
          _photos: paths.length,
          _thumbs: paths
            .slice(0, PHOTOS_PER_CARD)
            .map((path) => urls.get(path))
            .filter((url): url is string => Boolean(url)),
        };
      });
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
          thumbnails: order._thumbs,
        };
      })
      .filter((row) => {
        if (filters.status !== ALL && row.status !== filters.status) return false;
        if (filters.priority !== ALL && row.priority !== filters.priority) return false;
        if (filters.category !== ALL && row.category !== filters.category) return false;
        if (filters.property !== ALL && row.propertyId !== filters.property) return false;
        if (filters.source !== ALL && row.source !== filters.source) return false;
        if (filters.healthSafety === "yes" && !row.affects_health_safety) return false;
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
    // §92.056 — 7 days presumed reasonable, counted from the tenant's
    // written notice. Past that is the number the client needs to see.
    const healthSafetyOverdue = open.filter(
      (order) =>
        order.affects_health_safety &&
        order.written_notice_at &&
        repairClock(order.written_notice_at, undefined, order.resolved_at).overdue,
    );
    return {
      open: open.length,
      healthSafetyOverdue: healthSafetyOverdue.length,
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
          affects_health_safety: form.affects_health_safety,
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
        affects_health_safety: false,
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
      cell: (row) => <span className="numeric">{formatDate(row.created_at)}</span>,
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
    {
      key: "healthSafetyOverdue",
      value: String(summary.healthSafetyOverdue),
      tone: summary.healthSafetyOverdue > 0 ? "text-danger" : "",
    },
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
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
            [
              "healthSafety",
              [{ value: "yes", label: t("maintenance.healthSafetyOnly") }],
              "maintenance.columns.healthSafety",
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
          <div className="grid gap-3 overflow-x-auto sm:grid-cols-2 xl:grid-cols-4">
            {BOARD_COLUMNS.map((column) => {
              const inColumn = rows.filter((row) =>
                (column.statuses as readonly Enums<"wo_status">[]).includes(row.status),
              );
              const counts = column.statuses.map((status) => ({
                status,
                count: inColumn.filter((row) => row.status === status).length,
              }));
              const only = columnFilter[column.key];
              const columnRows = (only ? inColumn.filter((row) => row.status === only) : inColumn)
                // resuelta first, then cerrada — the order they happen in.
                .slice()
                .sort(
                  (a, b) =>
                    column.statuses.indexOf(a.status as never) -
                    column.statuses.indexOf(b.status as never),
                );
              const status = column.drop;
              return (
                <section
                  key={column.key}
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
                  <header className="px-1.5 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t(`maintenance.board.${column.key}`)}
                      </h2>
                      <span className="numeric text-xs font-semibold text-muted-foreground">
                        {inColumn.length}
                      </span>
                    </div>
                    {column.statuses.length > 1 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {counts.map(({ status: each, count }) => (
                          <button
                            key={each}
                            type="button"
                            onClick={() =>
                              setColumnFilter((current) => ({
                                ...current,
                                [column.key]: current[column.key] === each ? undefined : each,
                              }))
                            }
                            aria-pressed={only === each}
                            className={cn(
                              "numeric rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                              only === each
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border text-muted-foreground hover:bg-muted",
                            )}
                          >
                            {t(`woStatus.${each}`)} {count}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </header>

                  <ul className="space-y-2">
                    {columnRows.map((row) => {
                      const CategoryIcon = CATEGORY_ICONS[row.category];
                      const SourceIcon = SOURCE_ICONS[row.source];
                      const repair =
                        row.affects_health_safety && row.written_notice_at
                          ? repairClock(row.written_notice_at, undefined, row.resolved_at)
                          : null;
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
                              {row.photoCount > row.thumbnails.length ? (
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

                            {/* §92.056. A legal deadline, not a workflow step —
                                so it does not look like the badges above. */}
                            {repair ? (
                              <div className="mt-2">
                                <StatutoryClock
                                  tone={repair.tone}
                                  // The card gets "Day 4 of 7"; the sentence
                                  // form belongs on the detail page.
                                  label={
                                    repair.overdue
                                      ? t("maintenance.repairOverdueShort", { count: repair.day })
                                      : t("maintenance.repairWindowShort", {
                                          day: repair.day,
                                          total: REPAIR_WINDOW_DAYS,
                                        })
                                  }
                                />
                              </div>
                            ) : null}

                            {row.thumbnails.length > 0 ? (
                              <div className="mt-2 flex gap-1.5">
                                {row.thumbnails.map((url) => (
                                  <img
                                    key={url}
                                    src={url}
                                    alt=""
                                    loading="lazy"
                                    width={56}
                                    height={56}
                                    className="size-14 shrink-0 rounded-md border border-border bg-muted object-cover"
                                  />
                                ))}
                                {row.photoCount > row.thumbnails.length ? (
                                  <span className="numeric grid size-14 shrink-0 place-items-center rounded-md border border-dashed border-border text-xs font-medium text-muted-foreground">
                                    +{row.photoCount - row.thumbnails.length}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
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
        {/* §92.052 — this is the flag that starts the 7-day repair clock. */}
        <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm">
          <Checkbox
            checked={form.affects_health_safety}
            onCheckedChange={(checked) =>
              setForm({ ...form, affects_health_safety: checked === true })
            }
          />
          <span>
            <span className="font-medium">{t("maintenance.fields.healthSafety")}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {t("maintenance.fields.healthSafetyHint")}
            </span>
          </span>
        </label>
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
