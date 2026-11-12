import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/rentio/status-badge";

/**
 * The only two labels the public site may put on an item (owner decision
 * 2026-10-28): live = software that exists in Rentio today; done = a service
 * our team sets up and runs for the client. Roadmap features the owner has
 * chosen to sell (offer.tsx "money" group) go under done, never live.
 */
export type ItemStatus = "live" | "done";

const VARIANT = { live: "success", done: "info" } as const;

export function ItemStatusBadge({ status }: { status: ItemStatus }) {
  const { t } = useTranslation("marketing");
  return <StatusBadge status={t(`status.${status}`)} variant={VARIANT[status]} />;
}
