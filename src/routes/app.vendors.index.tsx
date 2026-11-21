import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { HardHat, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type DataTableColumn } from "@/components/rentio/data-table";
import { EmptyState } from "@/components/rentio/empty-state";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { StatusBadge } from "@/components/rentio/status-badge";
import { VendorDialog } from "@/components/rentio/vendor-dialog";
import { db } from "@/lib/db";
import type { Tables } from "@/lib/database.types";
import { formatDate, todayIso } from "@/lib/format";
import { logActivity, useActorId, useToastMutation } from "@/lib/queries";
import { insuranceStatus, useVendors, vendorsKey } from "@/lib/vendors";
import i18n from "@/lib/i18n";
import { pageTitle } from "@/lib/brand";

export const Route = createFileRoute("/app/vendors/")({
  head: () => ({
    meta: [
      { title: pageTitle(i18n.t("vendors.title")) },
      { name: "description", content: i18n.t("vendors.description") },
    ],
  }),
  component: VendorsPage,
});

type Vendor = Tables<"vendors">;

function VendorsPage() {
  const { t } = useTranslation();
  const actorId = useActorId();
  const vendors = useVendors();
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const today = todayIso();

  const rows = useMemo(
    () => (vendors.data ?? []).filter((row) => showInactive || row.active),
    [vendors.data, showInactive],
  );

  const toggleActive = useToastMutation({
    mutationFn: async (row: Vendor) => {
      const { error } = await db.from("vendors").update({ active: !row.active }).eq("id", row.id);
      if (error) throw error;
      await logActivity(actorId, "vendor", row.id, row.active ? "deactivate" : "reactivate", {});
    },
    successKey: "vendors.saved",
    invalidate: [vendorsKey],
  });

  const openForm = (row?: Vendor) => {
    setEditing(row ?? null);
    setFormOpen(true);
  };

  const columns: DataTableColumn<Vendor>[] = [
    {
      key: "company",
      header: t("vendors.fields.company"),
      sortValue: (row) => row.company_name,
      cell: (row) => (
        <div className="min-w-0">
          <div className="font-medium">{row.company_name}</div>
          {row.contact_name ? (
            <div className="text-xs text-muted-foreground">{row.contact_name}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: "trade",
      header: t("vendors.fields.trade"),
      sortValue: (row) => row.trade ?? "",
      cell: (row) => row.trade ?? "—",
    },
    {
      key: "phone",
      header: t("vendors.fields.phone"),
      cell: (row) =>
        row.phone ? (
          <a className="numeric hover:underline" href={`tel:${row.phone}`}>
            {row.phone}
          </a>
        ) : (
          "—"
        ),
    },
    {
      key: "email",
      header: t("vendors.fields.email"),
      cell: (row) => row.email ?? "—",
    },
    {
      key: "insurance",
      header: t("vendors.fields.insurance"),
      sortValue: (row) => row.insurance_expires_on ?? "9999",
      cell: (row) => {
        const status = insuranceStatus(row.insurance_expires_on, today);
        if (status === "missing") return "—";
        const date = formatDate(row.insurance_expires_on!);
        if (status === "ok") return <span className="numeric">{date}</span>;
        return (
          <StatusBadge
            status={t(`vendors.insurance.${status}`, { date })}
            variant={status === "expired" ? "danger" : "warning"}
          />
        );
      },
    },
    {
      key: "w9",
      header: t("vendors.fields.w9Short"),
      cell: (row) => (row.w9_on_file ? t("vendors.yes") : t("vendors.no")),
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          {row.active ? null : <StatusBadge status={t("vendors.inactive")} />}
          <Button
            size="sm"
            variant="ghost"
            disabled={toggleActive.isPending}
            onClick={() => toggleActive.mutate(row)}
          >
            {t(row.active ? "vendors.deactivate" : "vendors.reactivate")}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("vendors.title")}
        description={t("vendors.description")}
        actions={
          <Button onClick={() => openForm()}>
            <Plus className="size-4" />
            {t("vendors.new")}
          </Button>
        }
      />

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={showInactive}
          onCheckedChange={(checked) => setShowInactive(checked === true)}
        />
        {t("vendors.showInactive")}
      </label>

      <QueryState
        isLoading={vendors.isLoading}
        error={vendors.error}
        isEmpty={rows.length === 0}
        onRetry={() => void vendors.refetch()}
        skeleton={<RowsSkeleton count={6} />}
        empty={
          <EmptyState
            icon={HardHat}
            message={t("vendors.emptyTitle")}
            description={t("vendors.emptyDescription")}
            actionLabel={t("vendors.new")}
            onAction={() => openForm()}
          />
        }
      >
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          onRowClick={openForm}
          searchValue={(row) =>
            `${row.company_name} ${row.contact_name ?? ""} ${row.trade ?? ""} ${row.phone ?? ""} ${row.email ?? ""}`
          }
          pageSize={25}
        />
      </QueryState>

      <VendorDialog open={formOpen} onOpenChange={setFormOpen} vendor={editing} />
    </div>
  );
}
