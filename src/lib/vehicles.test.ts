import { describe, expect, test } from "bun:test";
import type { LeaseContext } from "@/lib/portfolio";
import { vehiclePlate, vehiclesOfLease, type Vehicle } from "@/lib/vehicles";

const car = (id: string, tenant_id: string, lease_id: string | null) =>
  ({ id, tenant_id, lease_id, plate: id.toUpperCase(), state: null }) as Vehicle;

const context = {
  lease: { id: "L1" },
  primaryTenant: { id: "T1" },
  coTenants: [{ id: "T2" }],
  guarantors: [{ id: "G1" }],
} as unknown as LeaseContext;

describe("vehiclesOfLease", () => {
  test("lease-linked cars, plus unattached cars of residents, never guarantors or other leases", () => {
    const vehicles = [
      car("a", "T1", "L1"),
      car("b", "T2", null),
      car("c", "T1", "L2"), // same tenant, older lease
      car("d", "G1", null),
      car("e", "X", "L1"),
    ];
    expect(vehiclesOfLease(vehicles, context).map((v) => v.id)).toEqual(["a", "b", "e"]);
  });

  test("plate shows the state when there is one", () => {
    expect(vehiclePlate({ ...car("x", "T1", null), state: "TX" })).toBe("X · TX");
    expect(vehiclePlate(car("x", "T1", null))).toBe("X");
  });
});
