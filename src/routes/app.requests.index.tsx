import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
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
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { StatusBadge } from "@/components/rentio/status-badge";
import { formatDate } from "@/lib/format";
import { logActivity, qk, useActorId, usePortfolio, useToastMutation } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/app/requests/")({
  head: () => ({
    meta: [
      { title: `${i18n.t("pages.requests.title")} — Rentio` },
      { name: "description", content: i18n.t("pages.requests.description") },
    ],
  }),
  component: RequestsPage,
});

const ALL = "__all__";
type Request = Tables<"access_requests">;

/**
 * The queue behind /request-access.
 *
 * Approving is deliberately two decisions, not one: which tenant this person
 * actually is, and then send the invite. The endpoint records a best-effort
 * email match but never acts on it — approving the wrong match would hand
 * someone another tenant's lease, receipts and payment history.
 */
function RequestsPage() {
  const { t } = useTranslation();
  const portfolio = usePortfolio();
  const actorId = useActorId();
  const [statusFilter, setStatusFilter] = useState("pending");
  const [reviewing, setReviewing] = useState<Request | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const requests = useQuery({
    queryKey: ["access-requests"],
    queryFn: async () => {
      const { data, error: caught } = await supabase
        .from("access_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (caught) throw caught;
      return data;
    },
  });

  const rows = useMemo(
    () =>
      (requests.data ?? []).filter((row) => statusFilter === ALL || row.status === statusFilter),
    [requests.data, statusFilter],
  );

  const pendingCount = (requests.data ?? []).filter((row) => row.status === "pending").length;

  const tenantOptions = useMemo<ComboboxOption[]>(
    () =>
      (portfolio.data?.tenants ?? []).map((tenant) => ({
        value: tenant.id,
        label: tenant.full_name,
        hint: [tenant.email, tenant.phone].filter(Boolean).join(" · "),
        keywords: `${tenant.email ?? ""} ${tenant.phone ?? ""}`,
      })),
    [portfolio.data],
  );

  const closeReview = () => {
    setReviewing(null);
    setTenantId(null);
    setNote("");
    setError(null);
  };

  const approve = useToastMutation({
    mutationFn: async ({ request, tenant }: { request: Request; tenant: string }) => {
      const match = (portfolio.data?.tenants ?? []).find((row) => row.id === tenant);
      // Reuses the staff invite path rather than a second implementation of
      // "create an account and email a link".
      const { error: caught } = await supabase.functions.invoke("send-tenant-invite", {
        body: {
          tenant_id: tenant,
          email: match?.email ?? request.email,
          full_name: match?.full_name,
        },
      });
      if (caught) throw caught;

      const { error: updateError } = await supabase
        .from("access_requests")
        .update({
          status: "approved",
          matched_tenant_id: tenant,
          note: note.trim() || null,
          reviewed_by: actorId,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", request.id);
      if (updateError) throw updateError;

      await logActivity(actorId, "access_request", request.id, "approve", {
        email: request.email,
        tenant_id: tenant,
      });
    },
    successKey: "requests.approved",
    invalidate: [["access-requests"], qk.portfolio],
    onSuccess: closeReview,
  });

  const decline = useToastMutation({
    mutationFn: async (request: Request) => {
      const { error: caught } = await supabase
        .from("access_requests")
        .update({
          status: "declined",
          note: note.trim() || null,
          reviewed_by: actorId,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", request.id);
      if (caught) throw caught;
      await logActivity(actorId, "access_request", request.id, "decline", {
        email: request.email,
      });
    },
    successKey: "requests.declined",
    invalidate: [["access-requests"]],
    onSuccess: closeReview,
  });

  const columns: DataTableColumn<Request>[] = [
    {
      key: "name",
      header: t("auth.fields.fullName"),
      sortValue: (row) => row.full_name,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.full_name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.email}</p>
        </div>
      ),
    },
    {
      key: "where",
      header: t("requests.columns.where"),
      sortValue: (row) => row.property_hint ?? "",
      cell: (row) => (
        <span className="text-sm">
          {[row.property_hint, row.unit_hint].filter(Boolean).join(" · ") || "—"}
        </span>
      ),
    },
    {
      key: "phone",
      header: t("auth.fields.phone"),
      sortValue: (row) => row.phone ?? "",
      cell: (row) => <span className="numeric">{row.phone ?? "—"}</span>,
    },
    {
      key: "match",
      header: t("requests.columns.match"),
      sortValue: (row) => (row.matched_tenant_id ? 1 : 0),
      cell: (row) => {
        const match = (portfolio.data?.tenants ?? []).find((t2) => t2.id === row.matched_tenant_id);
        return match ? (
          <StatusBadge status={match.full_name} variant="info" />
        ) : (
          <span className="text-xs text-muted-foreground">{t("requests.noMatch")}</span>
        );
      },
    },
    {
      key: "created",
      header: t("requests.columns.received"),
      numeric: true,
      sortValue: (row) => row.created_at,
      cell: (row) => <span className="numeric">{formatDate(row.created_at)}</span>,
    },
    {
      key: "status",
      header: t("requests.columns.status"),
      sortValue: (row) => row.status,
      cell: (row) => (
        <StatusBadge
          status={t(`requests.status.${row.status}`)}
          variant={
            row.status === "approved"
              ? "success"
              : row.status === "declined"
                ? "neutral"
                : "warning"
          }
        />
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (row) =>
        row.status === "pending" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setReviewing(row);
              setTenantId(row.matched_tenant_id);
              setNote("");
              setError(null);
            }}
          >
            {t("requests.review")}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("pages.requests.title")} description={t("pages.requests.description")} />

      <div className="max-w-xs">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger aria-label={t("requests.columns.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">
              {t("requests.status.pending")}
              {pendingCount > 0 ? ` (${pendingCount})` : ""}
            </SelectItem>
            <SelectItem value="approved">{t("requests.status.approved")}</SelectItem>
            <SelectItem value="declined">{t("requests.status.declined")}</SelectItem>
            <SelectItem value={ALL}>{t("contracts.filters.allStatuses")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <QueryState
        isLoading={requests.isLoading}
        error={requests.error}
        isEmpty={rows.length === 0}
        onRetry={() => void requests.refetch()}
        skeleton={<RowsSkeleton count={6} />}
        empty={
          <EmptyState
            icon={Inbox}
            message={t("requests.emptyTitle")}
            description={t("requests.emptyDescription")}
          />
        }
      >
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          searchValue={(row) => `${row.full_name} ${row.email} ${row.property_hint ?? ""}`}
          pageSize={15}
        />
      </QueryState>

      <FormDialog
        open={reviewing !== null}
        onOpenChange={(next) => {
          if (!next) closeReview();
        }}
        title={t("requests.reviewTitle")}
        description={t("requests.reviewDescription")}
        error={error}
        pending={approve.isPending || decline.isPending}
        submitLabel={t("requests.approve")}
        onSubmit={() => {
          setError(null);
          if (!reviewing) return;
          if (!tenantId) return setError(t("requests.errors.tenantRequired"));
          approve.mutate({ request: reviewing, tenant: tenantId });
        }}
        footerExtra={
          <Button
            type="button"
            variant="outline"
            disabled={decline.isPending || approve.isPending}
            onClick={() => reviewing && decline.mutate(reviewing)}
          >
            {t("requests.decline")}
          </Button>
        }
      >
        {reviewing ? (
          <dl className="rounded-lg border border-border">
            {(
              [
                [t("auth.fields.fullName"), reviewing.full_name],
                [t("auth.email"), reviewing.email],
                [t("auth.fields.phone"), reviewing.phone ?? "—"],
                [
                  t("requests.columns.where"),
                  [reviewing.property_hint, reviewing.unit_hint].filter(Boolean).join(" · ") || "—",
                ],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-border px-4 py-2 text-sm last:border-b-0"
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="truncate font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        <Field label={t("requests.fields.matchTo")} hint={t("requests.fields.matchToHint")}>
          <Combobox
            options={tenantOptions}
            value={tenantId}
            onChange={setTenantId}
            placeholder={t("contracts.fields.tenantPlaceholder")}
          />
        </Field>

        <Field label={t("requests.fields.note")} htmlFor="request-note">
          <Textarea
            id="request-note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </FormDialog>
    </div>
  );
}
