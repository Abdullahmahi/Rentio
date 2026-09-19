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

/** The signed-in staff member's profile id, for recorded_by / actor_id columns. */
export function useActorId() {
  const { user } = useAuth();
  return user?.id ?? null;
}
