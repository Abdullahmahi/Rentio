import { useTranslation } from "react-i18next";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import type { LeaseContext } from "@/lib/portfolio";
import { useVehicles, vehicleDescription, vehiclePlate, vehiclesOfLease } from "@/lib/vehicles";

/** Staff view of the cars registered to a lease. Tenants add them from the portal. */
export function LeaseVehicles({ context }: { context: LeaseContext }) {
  const { t } = useTranslation();
  const vehicles = useVehicles();
  const mine = vehicles.data ? vehiclesOfLease(vehicles.data, context) : [];

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
      <h2 className="text-base font-semibold">{t("vehicles.title")}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{t("vehicles.staffHint")}</p>
      <QueryState
        isLoading={vehicles.isLoading}
        error={vehicles.error}
        isEmpty={mine.length === 0}
        onRetry={() => void vehicles.refetch()}
        skeleton={<RowsSkeleton count={2} />}
        empty={<p className="mt-3 text-sm text-muted-foreground">{t("vehicles.none")}</p>}
      >
        <ul className="mt-3 divide-y divide-border">
          {mine.map((vehicle) => (
            <li key={vehicle.id} className="py-2 text-sm">
              <p className="numeric font-medium">{vehiclePlate(vehicle)}</p>
              <p className="text-xs text-muted-foreground">
                {vehicleDescription(vehicle) || "—"}
                {vehicle.notes ? ` · ${vehicle.notes}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </QueryState>
    </section>
  );
}
