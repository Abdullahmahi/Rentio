import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/db";
import type { Tables } from "@/lib/database.types";
import type { LeaseContext } from "@/lib/portfolio";

export type Vehicle = Tables<"vehicles">;

export const vehiclesKey = ["vehicles"] as const;

/** Every vehicle the caller may see: RLS gives staff the company's, a tenant their own. */
export function useVehicles() {
  return useQuery({
    queryKey: vehiclesKey,
    queryFn: async () => {
      const { data, error } = await db.from("vehicles").select("*").order("created_at");
      if (error) throw error;
      return data;
    },
  });
}

/** "ABC 123 · TX" */
export function vehiclePlate(vehicle: Vehicle) {
  return vehicle.state ? `${vehicle.plate} · ${vehicle.state}` : vehicle.plate;
}

/** "Red Toyota Corolla" */
export function vehicleDescription(vehicle: Vehicle) {
  return [vehicle.color, vehicle.make, vehicle.model].filter(Boolean).join(" ");
}

/** Vehicles on the lease, plus unattached ones of its residents (guarantors don't park). */
export function vehiclesOfLease(vehicles: Vehicle[], context: LeaseContext) {
  const residents = new Set(
    [context.primaryTenant, ...context.coTenants].map((tenant) => tenant?.id),
  );
  return vehicles.filter((vehicle) =>
    vehicle.lease_id ? vehicle.lease_id === context.lease.id : residents.has(vehicle.tenant_id),
  );
}
