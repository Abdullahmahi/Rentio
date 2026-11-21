/** Browser side of Stripe: what /api/stripe/account says about the company. */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/db";

export interface StripeAccountInfo {
  configured: boolean;
  publishableKey: string | null;
  account: {
    stripe_account_id: string | null;
    status: "not_connected" | "pending" | "ready";
    charges_enabled: boolean;
    payouts_enabled?: boolean;
    details_submitted: boolean;
    card_fee_enabled: boolean;
    card_fee_percent: number;
  } | null;
}

export const STRIPE_ACCOUNT_KEY = ["stripe-account"] as const;

export function useStripeAccount() {
  return useQuery({
    queryKey: STRIPE_ACCOUNT_KEY,
    queryFn: async (): Promise<StripeAccountInfo> => {
      const response = await apiFetch("/api/stripe/account");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as StripeAccountInfo;
    },
  });
}

/** True when the company can take rent online right now. */
export const canPayOnline = (info: StripeAccountInfo | undefined) =>
  Boolean(info?.configured && info.account?.charges_enabled);

/** POST to /api/stripe/<action>; throws the route's error message. */
export async function stripePost<T = unknown>(action: string, body?: unknown): Promise<T> {
  const response = await apiFetch(`/api/stripe/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
  return data as T;
}
