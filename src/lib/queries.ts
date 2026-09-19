import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { describeError, supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import type { Tables, Views } from "@/lib/database.types";

export const qk = {
  portfolio: ["portfolio"] as const,
  settings: ["settings"] as const,
  invoices: (period?: string) => ["invoices", period ?? "all"] as const,
  invoice: (id: string) => ["invoice", id] as const,
  payments: ["payments"] as const,
  utilities: (period?: string) => ["utilities", period ?? "all"] as const,
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
      const [properties, units, parking, leases, leaseTenants, tenants, balances] = await Promise.all([
        supabase.from("properties").select("*").order("name").then(unwrap<Tables<"properties">[]>),
        supabase.from("units").select("*").order("unit_number").then(unwrap<Tables<"units">[]>),
        supabase.from("parking_spaces").select("*").order("label").then(unwrap<Tables<"parking_spaces">[]>),
        supabase.from("leases").select("*").order("created_at").then(unwrap<Tables<"leases">[]>),
        supabase.from("lease_tenants").select("*").then(unwrap<Tables<"lease_tenants">[]>),
        supabase.from("tenants").select("*").order("full_name").then(unwrap<Tables<"tenants">[]>),
        supabase.from("lease_balances").select("*").then(unwrap<Views<"lease_balances">[]>),
      ]);
      return { properties, units, parking, leases, leaseTenants, tenants, balances };
    },
  });
}

export function useSettings() {
  return useQuery({
    queryKey: qk.settings,
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("*").limit(1).maybeSingle();
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
      const { data, error } = await supabase.from("public_settings").select("*").limit(1).maybeSingle();
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
  const { error } = await supabase.from("activity_log").insert({
    actor_id: actorId, entity_type: entityType, entity_id: entityId, action, meta: meta as never,
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
}

/** Every mutation ends in a toast — success or failure, never silence. */
export function useToastMutation<TVars, TData>({
  mutationFn, successKey, invalidate = [], onSuccess,
}: ToastMutationOptions<TVars, TData>) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (data, vars) => {
      toast.success(t(successKey));
      for (const key of invalidate) void queryClient.invalidateQueries({ queryKey: key });
      onSuccess?.(data, vars);
    },
    onError: (error) => {
      toast.error(t(describeError(error)));
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
      let invoiceQuery = supabase.from("invoices").select("*");
      let balanceQuery = supabase.from("invoice_balances").select("*");
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
  const { user } = useAuth();
  return user?.id ?? null;
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
  return useQuery({
    queryKey: ["my-portal"],
    queryFn: async (): Promise<MyPortal> => {
      const leases = await supabase.from("leases").select("*").order("start_date", { ascending: false })
        .then(unwrap<Tables<"leases">[]>);
      const lease = leases.find((row) => row.status === "activo" || row.status === "por_vencer") ?? leases[0] ?? null;

      if (!lease) {
        return { lease: null, details: null, parking: [], balance: null, invoices: [], payments: [], workOrders: [] };
      }

      const [details, parking, balances, invoices, invoiceBalances, payments, workOrders] = await Promise.all([
        supabase.from("my_lease_details").select("*").eq("lease_id", lease.id).then(unwrap<Views<"my_lease_details">[]>),
        supabase.from("parking_spaces").select("*").eq("lease_id", lease.id).then(unwrap<Tables<"parking_spaces">[]>),
        supabase.from("lease_balances").select("*").eq("lease_id", lease.id).then(unwrap<Views<"lease_balances">[]>),
        supabase.from("invoices").select("*").eq("lease_id", lease.id)
          .order("period_month", { ascending: false }).then(unwrap<Tables<"invoices">[]>),
        supabase.from("invoice_balances").select("*").eq("lease_id", lease.id).then(unwrap<Views<"invoice_balances">[]>),
        supabase.from("payments").select("*").eq("lease_id", lease.id)
          .order("paid_at", { ascending: false }).then(unwrap<Tables<"payments">[]>),
        supabase.from("work_orders").select("*").eq("lease_id", lease.id)
          .order("created_at", { ascending: false }).then(unwrap<Tables<"work_orders">[]>),
      ]);

      const paidByInvoice = new Map(invoiceBalances.map((row) => [row.invoice_id, Number(row.paid ?? 0)]));

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
      const { data, error } = await supabase.from("tenants").select("*").limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
