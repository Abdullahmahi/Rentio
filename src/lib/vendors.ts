import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/db";
import { addDays } from "@/lib/format";

export const vendorsKey = ["vendors"] as const;

/** Suggested trades; vendors.trade stays free text. Keys under vendors.trades.* */
export const TRADES = [
  "plumbing",
  "electrical",
  "hvac",
  "appliances",
  "locksmith",
  "cleaning",
  "landscaping",
  "pest_control",
  "roofing",
  "painting",
  "general",
] as const;

export type InsuranceStatus = "expired" | "expiring" | "ok" | "missing";

/** `today` is a Denver `YYYY-MM-DD` (todayIso()). Expiring = within 30 days. */
export function insuranceStatus(expiresOn: string | null, today: string): InsuranceStatus {
  if (!expiresOn) return "missing";
  if (expiresOn < today) return "expired";
  if (expiresOn <= addDays(today, 30)) return "expiring";
  return "ok";
}

export function useVendors() {
  return useQuery({
    queryKey: vendorsKey,
    queryFn: async () => {
      const { data, error } = await db.from("vendors").select("*").order("company_name");
      if (error) throw error;
      return data ?? [];
    },
  });
}
