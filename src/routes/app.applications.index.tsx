import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { StatusBadge } from "@/components/rentio/status-badge";
import {
  APPLICATION_STATUSES,
  applicationStatusVariant,
  type Application,
} from "@/components/rentio/application-form";
import { useAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { usePortfolio, useToastMutation } from "@/lib/queries";
import i18n from "@/lib/i18n";
import { pageTitle } from "@/lib/brand";

export const Route = createFileRoute("/app/applications/")({
  head: () => ({ meta: [{ title: pageTitle(i18n.t("applications.title")) }] }),
  component: ApplicationsPage,
});

const ALL = "__all__";

/** Review queue plus the links that feed it. */
function ApplicationsPage() {
  const { t } = useTranslation();
  const portfolio = usePortfolio();
  const [statusFilter, setStatusFilter] = useState<string>(ALL);

  const applications = useQuery({
    queryKey: ["applications"],
    queryFn: async () => {
      const { data, error } = await db
        .from("applications")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const unitLabel = useMemo(() => {
    const units = new Map((portfolio.data?.units ?? []).map((unit) => [unit.id, unit]));
    const properties = new Map((portfolio.data?.properties ?? []).map((p) => [p.id, p.name]));
    return (unitId: string | null) => {
      const unit = unitId ? units.get(unitId) : undefined;
      return unit
        ? `${properties.get(unit.property_id) ?? ""} · ${unit.unit_number}`
        : t("applications.queue.anyUnit");
    };
  }, [portfolio.data, t]);

  const rows = (applications.data ?? []).filter(
    (row) => statusFilter === ALL || row.status === statusFilter,
  );

  const columns: DataTableColumn<Application>[] = [
    {
      key: "applicant",
      header: t("applications.queue.applicant"),
      sortValue: (row) => row.full_name ?? "",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.full_name ?? "—"}</p>
          <p className="truncate text-xs text-muted-foreground">{row.email}</p>
        </div>
      ),
    },
    {
      key: "unit",
      header: t("applications.fields.unit"),
      sortValue: (row) => unitLabel(row.unit_id),
      cell: (row) => <span className="text-sm">{unitLabel(row.unit_id)}</span>,
    },
    {
      key: "income",
      header: t("applications.queue.income"),
      numeric: true,
      sortValue: (row) => Number(row.monthly_income ?? 0),
      cell: (row) => (
        <span className="numeric">
          {row.monthly_income === null ? "—" : formatMoney(Number(row.monthly_income))}
        </span>
      ),
    },
    {
      key: "received",
      header: t("applications.queue.received"),
      numeric: true,
      sortValue: (row) => row.submitted_at ?? row.created_at,
      cell: (row) => (
        <span className="numeric">{formatDate(row.submitted_at ?? row.created_at)}</span>
      ),
    },
    {
      key: "status",
      header: t("requests.columns.status"),
      sortValue: (row) => row.status,
      cell: (row) => (
        <StatusBadge
          status={t(`applications.status.${row.status}`)}
          variant={applicationStatusVariant(row.status)}
        />
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <Button asChild size="sm" variant="outline">
          <Link to="/app/applications/$id" params={{ id: row.id }}>
            {t("applications.queue.review")}
          </Link>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("applications.title")} description={t("applications.description")} />

      <div className="max-w-xs">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger aria-label={t("requests.columns.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("applications.queue.allStatuses")}</SelectItem>
            {APPLICATION_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {t(`applications.status.${status}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <QueryState
        isLoading={applications.isLoading}
        error={applications.error}
        isEmpty={rows.length === 0}
        onRetry={() => void applications.refetch()}
        skeleton={<RowsSkeleton count={6} />}
        empty={
          <EmptyState
            icon={ClipboardList}
            message={t("applications.queue.emptyTitle")}
            description={t("applications.queue.emptyDescription")}
          />
        }
      >
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          searchValue={(row) => `${row.full_name ?? ""} ${row.email ?? ""}`}
          pageSize={15}
        />
      </QueryState>

      <LinksPanel unitLabel={unitLabel} />
    </div>
  );
}

/** Per-company and per-unit application links, copy to clipboard. */
function LinksPanel({ unitLabel }: { unitLabel: (unitId: string | null) => string }) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const portfolio = usePortfolio();
  const [unitId, setUnitId] = useState<string | null>(null);

  const links = useQuery({
    queryKey: ["application-links"],
    queryFn: async () => {
      const [rows, org] = await Promise.all([
        db
          .from("application_links")
          .select("*")
          .eq("active", true)
          .order("created_at", { ascending: false }),
        db
          .from("organizations")
          .select("slug")
          .eq("id", profile?.org_id ?? "")
          .maybeSingle(),
      ]);
      if (rows.error) throw rows.error;
      return { rows: rows.data, slug: org.data?.slug ?? "" };
    },
  });

  const unitOptions = useMemo<ComboboxOption[]>(
    () =>
      (portfolio.data?.units ?? []).map((unit) => ({
        value: unit.id,
        label: unitLabel(unit.id),
        keywords: unit.unit_number,
      })),
    [portfolio.data, unitLabel],
  );

  const create = useToastMutation({
    mutationFn: async () => {
      const { error } = await db.from("application_links").insert({ unit_id: unitId });
      if (error) throw error;
    },
    successKey: "applications.links.created",
    invalidate: [["application-links"]],
    onSuccess: () => setUnitId(null),
  });

  const deactivate = useToastMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("application_links").update({ active: false }).eq("id", id);
      if (error) throw error;
    },
    successKey: "applications.links.deactivated",
    invalidate: [["application-links"]],
  });

  const urlFor = (token: string) =>
    `${window.location.origin}/apply/${links.data?.slug ?? ""}?link=${token}`;

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-4">
      <div>
        <h2 className="text-lg font-semibold">{t("applications.links.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("applications.links.description")}</p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Combobox
            options={unitOptions}
            value={unitId}
            onChange={setUnitId}
            placeholder={t("applications.links.unitOptional")}
          />
        </div>
        <Button type="button" disabled={create.isPending} onClick={() => create.mutate(undefined)}>
          {t("applications.links.create")}
        </Button>
      </div>
      {(links.data?.rows ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("applications.links.none")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {(links.data?.rows ?? []).map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-medium">{unitLabel(row.unit_id)}</p>
                <p className="truncate text-xs text-muted-foreground">{urlFor(row.token)}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(urlFor(row.token))
                      .then(() => toast.success(t("applications.links.copied")))
                  }
                >
                  {t("applications.links.copy")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => deactivate.mutate(row.id)}>
                  {t("applications.links.deactivate")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
