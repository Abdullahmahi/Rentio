import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CarFront, Pencil, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/rentio/confirm-dialog";
import { EmptyState } from "@/components/rentio/empty-state";
import { Field, FormDialog } from "@/components/rentio/form-dialog";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { useAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { useMyPortal, useToastMutation } from "@/lib/queries";
import {
  useVehicles,
  vehicleDescription,
  vehiclePlate,
  vehiclesKey,
  type Vehicle,
} from "@/lib/vehicles";
import i18n from "@/lib/i18n";
import { pageTitle } from "@/lib/brand";

export const Route = createFileRoute("/portal/vehicles")({
  head: () => ({ meta: [{ title: pageTitle(i18n.t("vehicles.title")) }] }),
  component: PortalVehicles,
});

const BLANK = { make: "", model: "", color: "", plate: "", state: "TX", notes: "" };

function PortalVehicles() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const portal = useMyPortal();
  const vehicles = useVehicles();
  // null = closed, "new" = adding, otherwise the vehicle being edited
  const [editing, setEditing] = useState<Vehicle | "new" | null>(null);
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState<string | null>(null);

  const open = (vehicle: Vehicle | "new") => {
    setError(null);
    setEditing(vehicle);
    setForm(
      vehicle === "new"
        ? BLANK
        : {
            make: vehicle.make ?? "",
            model: vehicle.model ?? "",
            color: vehicle.color ?? "",
            plate: vehicle.plate,
            state: vehicle.state ?? "",
            notes: vehicle.notes ?? "",
          },
    );
  };

  const save = useToastMutation({
    mutationFn: async () => {
      const values = {
        make: form.make.trim() || null,
        model: form.model.trim() || null,
        color: form.color.trim() || null,
        plate: form.plate,
        state: form.state.trim() || null,
        notes: form.notes.trim() || null,
      };
      const { error: caught } =
        editing === "new"
          ? await db.from("vehicles").insert({
              ...values,
              tenant_id: profile?.tenant_id ?? "",
              lease_id: portal.data?.lease?.id ?? null,
            })
          : await db
              .from("vehicles")
              .update(values)
              .eq("id", editing?.id ?? "");
      if (caught) throw caught;
    },
    successKey: "vehicles.saved",
    invalidate: [vehiclesKey],
    onSuccess: () => setEditing(null),
  });

  const remove = useToastMutation({
    mutationFn: async (vehicle: Vehicle) => {
      const { error: caught } = await db.from("vehicles").delete().eq("id", vehicle.id);
      if (caught) throw caught;
    },
    successKey: "vehicles.removed",
    invalidate: [vehiclesKey],
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("vehicles.title")}
        description={t("vehicles.description")}
        actions={
          <Button className="h-11" onClick={() => open("new")}>
            <Plus className="size-4" />
            {t("vehicles.new")}
          </Button>
        }
      />

      <QueryState
        isLoading={vehicles.isLoading}
        error={vehicles.error}
        isEmpty={(vehicles.data?.length ?? 0) === 0}
        onRetry={() => void vehicles.refetch()}
        skeleton={<RowsSkeleton count={2} />}
        empty={
          <EmptyState
            icon={CarFront}
            message={t("vehicles.empty")}
            description={t("vehicles.emptyDescription")}
            actionLabel={t("vehicles.new")}
            onAction={() => open("new")}
          />
        }
      >
        <ul className="space-y-3">
          {vehicles.data?.map((vehicle) => (
            <li key={vehicle.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="numeric text-base font-semibold">{vehiclePlate(vehicle)}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {vehicleDescription(vehicle) || "—"}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-11 shrink-0"
                  aria-label={t("vehicles.edit")}
                  onClick={() => open(vehicle)}
                >
                  <Pencil className="size-4" />
                </Button>
              </div>
              <div className="mt-3">
                <ConfirmDialog
                  triggerLabel={t("vehicles.remove")}
                  triggerVariant="outline"
                  destructive
                  title={t("vehicles.removeTitle", { plate: vehicle.plate })}
                  description={t("vehicles.removeDescription")}
                  confirmLabel={t("vehicles.remove")}
                  onConfirm={() => remove.mutate(vehicle)}
                />
              </div>
            </li>
          ))}
        </ul>
      </QueryState>

      <FormDialog
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
        title={t(editing === "new" ? "vehicles.new" : "vehicles.edit")}
        error={error}
        pending={save.isPending}
        onSubmit={() => {
          setError(null);
          if (!form.plate.trim()) return setError(t("vehicles.errors.plateRequired"));
          if (form.state.trim() && !/^[A-Za-z]{2}$/.test(form.state.trim()))
            return setError(t("vehicles.errors.stateInvalid"));
          save.mutate(undefined);
        }}
      >
        <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3">
          <Field label={t("vehicles.fields.plate")} htmlFor="vehicle-plate">
            <Input
              id="vehicle-plate"
              className="numeric h-12 uppercase"
              autoCapitalize="characters"
              value={form.plate}
              onChange={(event) => setForm({ ...form, plate: event.target.value })}
            />
          </Field>
          <Field label={t("vehicles.fields.state")} htmlFor="vehicle-state">
            <Input
              id="vehicle-state"
              className="h-12 uppercase"
              maxLength={2}
              autoCapitalize="characters"
              value={form.state}
              onChange={(event) => setForm({ ...form, state: event.target.value })}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("vehicles.fields.make")} htmlFor="vehicle-make">
            <Input
              id="vehicle-make"
              className="h-12"
              value={form.make}
              onChange={(event) => setForm({ ...form, make: event.target.value })}
            />
          </Field>
          <Field label={t("vehicles.fields.model")} htmlFor="vehicle-model">
            <Input
              id="vehicle-model"
              className="h-12"
              value={form.model}
              onChange={(event) => setForm({ ...form, model: event.target.value })}
            />
          </Field>
          <Field label={t("vehicles.fields.color")} htmlFor="vehicle-color">
            <Input
              id="vehicle-color"
              className="h-12"
              value={form.color}
              onChange={(event) => setForm({ ...form, color: event.target.value })}
            />
          </Field>
        </div>
        <Field label={t("vehicles.fields.notes")} htmlFor="vehicle-notes">
          <Textarea
            id="vehicle-notes"
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </Field>
      </FormDialog>
    </div>
  );
}
