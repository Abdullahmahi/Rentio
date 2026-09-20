import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus, Users } from "lucide-react";
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
import { DataTable, type DataTableColumn } from "@/components/rentio/data-table";
import { EmptyState } from "@/components/rentio/empty-state";
import { Field, FormDialog } from "@/components/rentio/form-dialog";
import { MoneyText } from "@/components/rentio/money-text";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { LeaseStatusBadge } from "@/components/rentio/status";
import { isActive, leaseContexts } from "@/lib/portfolio";
import { PHONE_HINT, formatUsPhone } from "@/lib/us";
import { logActivity, qk, useActorId, usePortfolio, useToastMutation } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/app/tenants/")({
  head: () => ({
    meta: [
      { title: `${i18n.t("pages.tenants.title")} — Rentio` },
      { name: "description", content: i18n.t("pages.tenants.description") },
    ],
  }),
  component: TenantsPage,
});

interface TenantRow {
  tenant: Tables<"tenants">;
  unitNumber: string | null;
  lease: Tables<"leases"> | undefined;
  balance: number;
}

const EMPTY_FORM = {
  full_name: "",
  email: "",
  phone: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  notes: "",
};

const ALL = "__all__";

function TenantsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const portfolio = usePortfolio();
  const actorId = useActorId();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [leaseFilter, setLeaseFilter] = useState(ALL);

  const rows = useMemo<TenantRow[]>(() => {
    if (!portfolio.data) return [];
    const contexts = leaseContexts(portfolio.data);

    // Each tenant's current lease is the active one they are named on.
    const activeByTenant = new Map<string, (typeof contexts)[number]>();
    for (const context of contexts) {
      if (!isActive(context.lease)) continue;
      for (const person of [context.primaryTenant, ...context.coTenants, ...context.guarantors]) {
        if (person && !activeByTenant.has(person.id)) activeByTenant.set(person.id, context);
      }
    }

    return portfolio.data.tenants
      .map((tenant) => {
        const context = activeByTenant.get(tenant.id);
        return {
          tenant,
          unitNumber: context?.unit?.unit_number ?? null,
          lease: context?.lease,
          balance: Number(context?.balance?.balance ?? 0),
        };
      })
      .filter((row) => {
        if (leaseFilter === "with") return Boolean(row.lease);
        if (leaseFilter === "without") return !row.lease;
        return true;
      });
  }, [portfolio.data, leaseFilter]);

  const create = useToastMutation({
    mutationFn: async (values: typeof EMPTY_FORM) => {
      const { data, error: caught } = await supabase
        .from("tenants")
        .insert({
          full_name: values.full_name.trim(),
          email: values.email.trim() || null,
          phone: values.phone.trim() || null,
          emergency_contact_name: values.emergency_contact_name.trim() || null,
          emergency_contact_phone: values.emergency_contact_phone.trim() || null,
          notes: values.notes.trim() || null,
        })
        .select("id")
        .single();
      if (caught) throw caught;
      await logActivity(actorId, "tenant", data.id, "create", { full_name: values.full_name });
      return data;
    },
    successKey: "tenants.created",
    invalidate: [qk.portfolio],
    onSuccess: () => {
      setOpen(false);
      setForm(EMPTY_FORM);
    },
  });

  const columns: DataTableColumn<TenantRow>[] = [
    {
      key: "name",
      header: t("tenants.columns.name"),
      sortValue: (row) => row.tenant.full_name,
      cell: (row) => <span className="font-medium">{row.tenant.full_name}</span>,
    },
    {
      key: "phone",
      header: t("tenants.columns.phone"),
      sortValue: (row) => row.tenant.phone ?? "",
      cell: (row) => <span className="numeric">{row.tenant.phone ?? "—"}</span>,
    },
    {
      key: "email",
      header: t("tenants.columns.email"),
      sortValue: (row) => row.tenant.email ?? "",
      cell: (row) => row.tenant.email ?? "—",
    },
    {
      key: "unit",
      header: t("tenants.columns.unit"),
      sortValue: (row) => row.unitNumber ?? "",
      cell: (row) => row.unitNumber ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: "lease",
      header: t("tenants.columns.lease"),
      sortValue: (row) => row.lease?.status ?? "",
      cell: (row) =>
        row.lease ? (
          <LeaseStatusBadge value={row.lease.status} />
        ) : (
          <span className="text-sm text-muted-foreground">{t("tenants.noLease")}</span>
        ),
    },
    {
      key: "balance",
      header: t("tenants.columns.balance"),
      numeric: true,
      sortValue: (row) => row.balance,
      cell: (row) => (
        <MoneyText value={row.balance} className={row.balance > 0 ? "text-danger" : undefined} />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("pages.tenants.title")}
        description={t("pages.tenants.description")}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            {t("tenants.new")}
          </Button>
        }
      />

      <div className="max-w-xs">
        <Select value={leaseFilter} onValueChange={setLeaseFilter}>
          <SelectTrigger aria-label={t("tenants.filters.label")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("tenants.filters.all")}</SelectItem>
            <SelectItem value="with">{t("tenants.filters.withLease")}</SelectItem>
            <SelectItem value="without">{t("tenants.filters.withoutLease")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <QueryState
        isLoading={portfolio.isLoading}
        error={portfolio.error}
        isEmpty={rows.length === 0}
        onRetry={() => void portfolio.refetch()}
        skeleton={<RowsSkeleton count={8} />}
        empty={
          <EmptyState
            icon={Users}
            message={t("tenants.emptyTitle")}
            description={t("tenants.emptyDescription")}
            actionLabel={t("tenants.new")}
            onAction={() => setOpen(true)}
          />
        }
      >
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(row) => row.tenant.id}
          searchValue={(row) =>
            `${row.tenant.full_name} ${row.tenant.phone ?? ""} ${row.tenant.email ?? ""}`
          }
          onRowClick={(row) =>
            void navigate({ to: "/app/tenants/$id", params: { id: row.tenant.id } })
          }
          pageSize={15}
        />
      </QueryState>

      <FormDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        title={t("tenants.new")}
        error={error}
        pending={create.isPending}
        onSubmit={() => {
          setError(null);
          if (!form.full_name.trim()) return setError(t("tenants.errors.nameRequired"));
          if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim()))
            return setError(t("tenants.errors.emailInvalid"));
          create.mutate(form);
        }}
      >
        <Field label={t("tenants.fields.fullName")} htmlFor="tenant-name">
          <Input
            id="tenant-name"
            value={form.full_name}
            onChange={(event) => setForm({ ...form, full_name: event.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("tenants.fields.email")} htmlFor="tenant-email">
            <Input
              id="tenant-email"
              type="email"
              inputMode="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </Field>
          <Field label={t("tenants.fields.phone")} htmlFor="tenant-phone" hint={PHONE_HINT}>
            <Input
              id="tenant-phone"
              inputMode="tel"
              className="numeric"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: formatUsPhone(event.target.value) })}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("tenants.fields.emergencyName")} htmlFor="tenant-ename">
            <Input
              id="tenant-ename"
              value={form.emergency_contact_name}
              onChange={(event) => setForm({ ...form, emergency_contact_name: event.target.value })}
            />
          </Field>
          <Field
            label={t("tenants.fields.emergencyPhone")}
            htmlFor="tenant-ephone"
            hint={PHONE_HINT}
          >
            <Input
              id="tenant-ephone"
              inputMode="tel"
              className="numeric"
              value={form.emergency_contact_phone}
              onChange={(event) =>
                setForm({ ...form, emergency_contact_phone: formatUsPhone(event.target.value) })
              }
            />
          </Field>
        </div>
        <Field label={t("tenants.fields.notes")} htmlFor="tenant-notes">
          <Textarea
            id="tenant-notes"
            rows={3}
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </Field>
      </FormDialog>
    </div>
  );
}
