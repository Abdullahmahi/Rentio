import { useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { db, errorText } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import i18n, { LANGUAGE_STORAGE_KEY, resolveLanguage, type AppLanguage } from "@/lib/i18n";
import type { Tables, Views } from "@/lib/database.types";

export const qk = {
  portfolio: ["portfolio"] as const,
  settings: ["settings"] as const,
  invoices: (period?: string) => ["invoices", period ?? "all"] as const,
  invoice: (id: string) => ["invoice", id] as const,
  payments: ["payments"] as const,
  utilities: (period?: string) => ["utilities", period ?? "all"] as const,
  expenses: (period?: string) => ["expenses", period ?? "all"] as const,
  workOrders: ["work-orders"] as const,
  workOrder: (id: string) => ["work-order", id] as const,
  documents: (ownerType: string, ownerId: string) => ["documents", ownerType, ownerId] as const,
  activity: ["activity"] as const,
};

function unwrap<T>({ data, error }: { data: T | null; error: unknown }): T {
  if (error) throw error;
  return (data ?? []) as T;
}

export interface Portfolio {
  properties: Tables<"properties">[];
  units: Tables<"units">[];
  parking: Tables<"parking_spaces">[];
  leases: Tables<"leases">[];
  leaseTenants: Tables<"lease_tenants">[];
  tenants: Tables<"tenants">[];
  balances: Views<"lease_balances">[];
}

/**
 * The whole portfolio in one cached fetch, joined in memory.
 *
 * ponytail: fine at the ~120 units this product targets; if the portfolio
 * grows past a few thousand, move the joins into per-page PostgREST queries
 * or a view rather than widening this.
 */
export function usePortfolio() {
  return useQuery({
    queryKey: qk.portfolio,
    queryFn: async (): Promise<Portfolio> => {
      const [properties, units, parking, leases, leaseTenants, tenants, balances] =
        await Promise.all([
          db
            .from("properties")
            .select("*")
            .order("name")
            .then(unwrap<Tables<"properties">[]>),
          db
            .from("units")
            .select("*")
            .order("unit_number")
            .then(unwrap<Tables<"units">[]>),
          db
            .from("parking_spaces")
            .select("*")
            .order("label")
            .then(unwrap<Tables<"parking_spaces">[]>),
          db
            .from("leases")
            .select("*")
            .order("created_at")
            .then(unwrap<Tables<"leases">[]>),
          db
            .from("lease_tenants")
            .select("*")
            .then(unwrap<Tables<"lease_tenants">[]>),
          db
            .from("tenants")
            .select("*")
            .order("full_name")
            .then(unwrap<Tables<"tenants">[]>),
          db
            .from("lease_balances")
            .select("*")
            .then(unwrap<Views<"lease_balances">[]>),
        ]);
      return { properties, units, parking, leases, leaseTenants, tenants, balances };
    },
  });
}

export function useSettings() {
  const { profile, isSuperAdmin } = useAuth();
  const platformView = isSuperAdmin && !profile?.org_id;
  return useQuery({
    queryKey: [...qk.settings, platformView ? "platform" : (profile?.org_id ?? "")],
    queryFn: async () => {
      // Across all companies there is no "the" settings row.
      if (platformView) return null;
      const { data, error } = await db.from("settings").select("*").limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/** Bank details for the tenant portal — the only slice of settings a tenant may read. */
export function usePublicSettings() {
  return useQuery({
    queryKey: ["public-settings"],
    queryFn: async () => {
      const { data, error } = await db.from("public_settings").select("*").limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/** Append-only audit trail. Never blocks the caller — a failed log is not a failed action. */
export async function logActivity(
  actorId: string | null,
  entityType: string,
  entityId: string | null,
  action: string,
  meta: Record<string, unknown> = {},
) {
  const { error } = await db.from("activity_log").insert({
    actor_id: actorId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    meta: meta as never,
  });
  if (error) console.warn("activity_log insert failed", error);
}

interface ToastMutationOptions<TVars, TData> {
  mutationFn: (vars: TVars) => Promise<TData>;
  /** i18n key for the success toast. */
  successKey: string;
  /** Query keys to invalidate once it lands. */
  invalidate?: QueryKey[];
  onSuccess?: (data: TData, vars: TVars) => void;
  /**
   * i18n key for a "working on it" toast. Set it on anything slow or
   * consequential — a 40-receipt send, an Edge Function that renders a PDF —
   * and sonner shows pending, then the result, in the one toast.
   */
  pendingKey?: string;
  /** Overrides the success line, so it can name the count that landed. */
  resultMessage?: (data: TData, vars: TVars) => string;
}

/** Every mutation ends in a toast — success or failure, never silence. */
export function useToastMutation<TVars, TData>({
  mutationFn,
  successKey,
  invalidate = [],
  onSuccess,
  pendingKey,
  resultMessage,
}: ToastMutationOptions<TVars, TData>) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: pendingKey
      ? (vars: TVars) => {
          const promise = mutationFn(vars);
          toast.promise(promise, {
            loading: t(pendingKey),
            success: (data: TData) => resultMessage?.(data, vars) ?? t(successKey),
            error: (error: unknown) => errorText(t, error),
          });
          return promise;
        }
      : mutationFn,
    onSuccess: (data, vars) => {
      // toast.promise already reported it; two toasts for one action is noise.
      if (!pendingKey) toast.success(t(successKey));
      for (const key of invalidate) void queryClient.invalidateQueries({ queryKey: key });
      onSuccess?.(data, vars);
    },
    onError: (error) => {
      if (!pendingKey) toast.error(errorText(t, error));
    },
  });
}

export interface InvoiceWithPaid extends Tables<"invoices"> {
  /** Confirmed money applied to this invoice. */
  paid: number;
  balance: number;
}

/**
 * Invoices with what has actually been paid against each one.
 *
 * `invoice_balances` is a view, so PostgREST embedding would need relationship
 * metadata the generated types don't carry — two small queries joined here
 * are simpler and type-safe.
 */
export function useInvoices({ leaseId, period }: { leaseId?: string; period?: string } = {}) {
  return useQuery({
    queryKey: ["invoices", leaseId ?? "all", period ?? "all"],
    queryFn: async (): Promise<InvoiceWithPaid[]> => {
      let invoiceQuery = db.from("invoices").select("*");
      let balanceQuery = db.from("invoice_balances").select("*");
      if (leaseId) {
        invoiceQuery = invoiceQuery.eq("lease_id", leaseId);
        balanceQuery = balanceQuery.eq("lease_id", leaseId);
      }
      if (period) invoiceQuery = invoiceQuery.eq("period_month", period);

      const [invoices, balances] = await Promise.all([
        invoiceQuery.order("period_month", { ascending: false }).then(unwrap<Tables<"invoices">[]>),
        balanceQuery.then(unwrap<Views<"invoice_balances">[]>),
      ]);

      const paidByInvoice = new Map(balances.map((row) => [row.invoice_id, Number(row.paid ?? 0)]));
      return invoices.map((invoice) => {
        const paid = paidByInvoice.get(invoice.id) ?? 0;
        return { ...invoice, paid, balance: Number(invoice.total) - paid };
      });
    },
  });
}

/** The signed-in staff member's profile id, for recorded_by / actor_id columns. */
export function useActorId() {
  const { profile } = useAuth();
  return profile?.id ?? null;
}

export interface MyPortal {
  lease: Tables<"leases"> | null;
  /** Unit number and building address, via the tenant-scoped view. */
  details: Views<"my_lease_details"> | null;
  parking: Tables<"parking_spaces">[];
  balance: Views<"lease_balances"> | null;
  invoices: InvoiceWithPaid[];
  payments: Tables<"payments">[];
  workOrders: Tables<"work_orders">[];
}

/**
 * Everything the tenant portal shows, for the signed-in tenant only.
 *
 * No filtering by tenant id happens here on purpose: RLS already fences every
 * one of these tables to `my_lease_ids()`. If a query ever returned another
 * tenant's row, that would be a policy bug, not a UI bug.
 */
export function useMyPortal() {
  const { profile } = useAuth();
  const myTenantId = profile?.tenant_id ?? null;
  return useQuery({
    queryKey: ["my-portal", myTenantId],
    queryFn: async (): Promise<MyPortal> => {
      const [leases, links] = await Promise.all([
        db
          .from("leases")
          .select("*")
          .order("start_date", { ascending: false })
          .then(unwrap<Tables<"leases">[]>),
        db
          .from("lease_tenants")
          .select("lease_id, role, tenant_id")
          .then(unwrap<Pick<Tables<"lease_tenants">, "lease_id" | "role" | "tenant_id">[]>),
      ]);
      // My residence: the active lease where I am primary, then co-tenant.
      // A lease I only guarantee is never "my" lease (A-06).
      const roleOf = new Map(
        links
          .filter((link) => link.tenant_id === myTenantId)
          .map((link) => [link.lease_id, link.role]),
      );
      const active = leases.filter((row) => row.status === "activo" || row.status === "por_vencer");
      const lease =
        active.find((row) => roleOf.get(row.id) === "primary") ??
        active.find((row) => roleOf.get(row.id) === "co_tenant") ??
        active[0] ??
        leases[0] ??
        null;

      if (!lease) {
        return {
          lease: null,
          details: null,
          parking: [],
          balance: null,
          invoices: [],
          payments: [],
          workOrders: [],
        };
      }

      const [details, parking, balances, invoices, invoiceBalances, payments, workOrders] =
        await Promise.all([
          db
            .from("my_lease_details")
            .select("*")
            .eq("lease_id", lease.id)
            .then(unwrap<Views<"my_lease_details">[]>),
          db
            .from("parking_spaces")
            .select("*")
            .eq("lease_id", lease.id)
            .then(unwrap<Tables<"parking_spaces">[]>),
          db
            .from("lease_balances")
            .select("*")
            .eq("lease_id", lease.id)
            .then(unwrap<Views<"lease_balances">[]>),
          db
            .from("invoices")
            .select("*")
            .eq("lease_id", lease.id)
            .order("period_month", { ascending: false })
            .then(unwrap<Tables<"invoices">[]>),
          db
            .from("invoice_balances")
            .select("*")
            .eq("lease_id", lease.id)
            .then(unwrap<Views<"invoice_balances">[]>),
          db
            .from("payments")
            .select("*")
            .eq("lease_id", lease.id)
            .order("paid_at", { ascending: false })
            .then(unwrap<Tables<"payments">[]>),
          db
            .from("work_orders")
            .select("*")
            .eq("lease_id", lease.id)
            .order("created_at", { ascending: false })
            .then(unwrap<Tables<"work_orders">[]>),
        ]);

      const paidByInvoice = new Map(
        invoiceBalances.map((row) => [row.invoice_id, Number(row.paid ?? 0)]),
      );

      return {
        lease,
        details: details[0] ?? null,
        parking,
        balance: balances[0] ?? null,
        invoices: invoices.map((invoice) => {
          const paid = paidByInvoice.get(invoice.id) ?? 0;
          return { ...invoice, paid, balance: Number(invoice.total) - paid };
        }),
        payments,
        workOrders,
      };
    },
  });
}

/** The tenant's own record, for the profile page. */
export function useMyTenant() {
  return useQuery({
    queryKey: ["my-tenant"],
    queryFn: async () => {
      const { data, error } = await db.from("tenants").select("*").limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/**
 * One place that changes the language: i18next, the <html lang>, this
 * browser's preference, and — so the choice follows the user to any device —
 * `profiles.locale`. A NULL locale means the user never chose, and the portal
 * default applies instead.
 */
export function useLanguagePreference(fallback: AppLanguage) {
  // The module singleton, not useTranslation()'s wrapper: react-i18next hands
  // out a new wrapper on every language change, which re-ran the resolve
  // effect below with the still-old profile locale and flipped the language
  // straight back (QA B-02).
  const { profile, patchProfile } = useAuth();

  const apply = useCallback((language: AppLanguage) => {
    void i18n.changeLanguage(language);
    if (typeof document !== "undefined") document.documentElement.lang = language;
  }, []);

  // Resolve on mount and whenever the profile arrives. Deferred a tick because
  // changing language during render warns in react-i18next.
  useEffect(() => {
    const stored =
      typeof window === "undefined" ? null : window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    const language = resolveLanguage(stored, profile?.locale, fallback);
    const timer = window.setTimeout(() => {
      if (i18n.language !== language) apply(language);
      else if (typeof document !== "undefined") document.documentElement.lang = language;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [apply, fallback, profile?.locale]);

  const setLanguage = useCallback(
    (language: AppLanguage) => {
      apply(language);
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
      if (!profile?.id) return;
      // Patch the in-memory profile now, so the resolve effect agrees with the
      // choice; the server copy follows.
      patchProfile({ locale: language });
      void db.from("profiles").update({ locale: language }).eq("id", profile.id);
    },
    [apply, profile?.id, patchProfile],
  );

  return { language: i18n.language as AppLanguage, setLanguage };
}
