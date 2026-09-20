import { useMemo, useState, type DragEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, CheckCircle2, Download, FileUp, Loader2, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { StatusBadge } from "@/components/rentio/status-badge";
import { downloadCsv, parseCsv } from "@/lib/csv";
import {
  IMPORT_SCHEMAS,
  autoMapColumns,
  summarize,
  templateFor,
  validateRows,
  type ImportKind,
  type ValidatedRow,
  type ValidationContext,
} from "@/lib/import";
import { logActivity, qk, useActorId, usePortfolio, useToastMutation } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/app/import/")({
  head: () => ({ meta: [{ title: `${i18n.t("import.title")} — Rentio` }] }),
  component: ImportPage,
});

const KINDS: ImportKind[] = ["units", "tenants", "leases"];
const NONE = "__none__";

function Importer({ kind }: { kind: ImportKind }) {
  const { t } = useTranslation();
  const portfolio = usePortfolio();
  const actorId = useActorId();
  const schema = IMPORT_SCHEMAS[kind];

  const [step, setStep] = useState(1);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [dragOver, setDragOver] = useState(false);
  const [summary, setSummary] = useState<{ inserted: number; updated: number } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const context = useMemo<ValidationContext>(() => {
    const lower = (value: string | null | undefined) => (value ?? "").trim().toLocaleLowerCase();
    const propertyById = new Map(
      (portfolio.data?.properties ?? []).map((row) => [row.id, row.name]),
    );
    return {
      propertyNames: new Set((portfolio.data?.properties ?? []).map((row) => lower(row.name))),
      unitKeys: new Set(
        (portfolio.data?.units ?? []).map(
          (unit) => `${lower(propertyById.get(unit.property_id))}|${lower(unit.unit_number)}`,
        ),
      ),
      tenantEmails: new Set(
        (portfolio.data?.tenants ?? []).map((row) => lower(row.email)).filter(Boolean),
      ),
      tenantPhones: new Set(
        (portfolio.data?.tenants ?? []).map((row) => lower(row.phone)).filter(Boolean),
      ),
      leaseKeys: new Set(
        (portfolio.data?.leases ?? []).map((lease) => {
          const unit = portfolio.data?.units.find((row) => row.id === lease.unit_id);
          return `${lower(propertyById.get(unit?.property_id ?? ""))}|${lower(unit?.unit_number)}|${lease.start_date}`;
        }),
      ),
    };
  }, [portfolio.data]);

  const validated = useMemo<ValidatedRow[]>(
    () => (rows.length > 0 ? validateRows(rows, mapping, schema, context) : []),
    [rows, mapping, schema, context],
  );
  const counts = summarize(validated);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setFileError(null);
    try {
      const parsed = parseCsv(await file.text());
      if (parsed.length < 2) {
        setFileError(t("import.errors.emptyFile"));
        return;
      }
      const [head, ...body] = parsed;
      setHeaders(head ?? []);
      setRows(body);
      setMapping(autoMapColumns(head ?? [], schema));
      setStep(3);
    } catch {
      setFileError(t("import.errors.unreadable"));
    }
  };

  const downloadTemplate = () => {
    const template = templateFor(schema);
    downloadCsv(`plantilla-${kind}`, template.headers, [template.example]);
  };

  const downloadErrors = () => {
    const bad = validated.filter((row) => row.status === "error");
    downloadCsv(
      `errores-${kind}`,
      [...headers, t("import.errorColumn")],
      bad.map((row) => [...row.raw, row.reason ? t(row.reason.key, row.reason.params ?? {}) : ""]),
    );
  };

  const commit = useToastMutation({
    mutationFn: async () => {
      const importable = validated.filter((row) => row.status !== "error");
      const propertyByName = new Map(
        (portfolio.data?.properties ?? []).map((row) => [
          row.name.trim().toLocaleLowerCase(),
          row.id,
        ]),
      );
      let inserted = 0;
      let updated = 0;

      for (const row of importable) {
        const value = row.values;

        if (kind === "units") {
          const propertyId = propertyByName.get(
            String(value["property"] ?? "")
              .trim()
              .toLocaleLowerCase(),
          );
          if (!propertyId) continue;
          const payload = {
            property_id: propertyId,
            unit_number: String(value["unit_number"]),
            floor: value["floor"] as number | null,
            bedrooms: value["bedrooms"] as number | null,
            bathrooms: value["bathrooms"] as number | null,
            sqm: value["sqm"] as number | null,
            base_rent: Number(value["base_rent"] ?? 0),
          };
          // The (property_id, unit_number) unique index makes this idempotent.
          const { error } = await supabase
            .from("units")
            .upsert(payload, { onConflict: "property_id,unit_number" });
          if (error) throw error;
        }

        if (kind === "tenants") {
          const email = String(value["email"] ?? "")
            .trim()
            .toLocaleLowerCase();
          const phone = String(value["phone"] ?? "").trim();
          const existing = (portfolio.data?.tenants ?? []).find(
            (tenant) =>
              (email && tenant.email?.toLocaleLowerCase() === email) ||
              (phone && tenant.phone === phone),
          );
          const payload = {
            full_name: String(value["full_name"]),
            email: (value["email"] as string | null) || null,
            phone: (value["phone"] as string | null) || null,
            emergency_contact_name: (value["emergency_contact_name"] as string | null) || null,
            emergency_contact_phone: (value["emergency_contact_phone"] as string | null) || null,
            notes: (value["notes"] as string | null) || null,
          };
          const { error } = existing
            ? await supabase.from("tenants").update(payload).eq("id", existing.id)
            : await supabase.from("tenants").insert(payload);
          if (error) throw error;
        }

        if (kind === "leases") {
          const propertyId = propertyByName.get(
            String(value["property"] ?? "")
              .trim()
              .toLocaleLowerCase(),
          );
          const unit = (portfolio.data?.units ?? []).find(
            (candidate) =>
              candidate.property_id === propertyId &&
              candidate.unit_number.toLocaleLowerCase() ===
                String(value["unit_number"]).toLocaleLowerCase(),
          );
          const needle = String(value["tenant"] ?? "")
            .trim()
            .toLocaleLowerCase();
          const tenant = (portfolio.data?.tenants ?? []).find(
            (candidate) =>
              candidate.email?.toLocaleLowerCase() === needle ||
              candidate.phone?.toLocaleLowerCase() === needle,
          );
          if (!unit || !tenant) continue;

          const existing = (portfolio.data?.leases ?? []).find(
            (lease) => lease.unit_id === unit.id && lease.start_date === value["start_date"],
          );
          const payload = {
            unit_id: unit.id,
            start_date: String(value["start_date"]),
            end_date: String(value["end_date"]),
            rent_amount: Number(value["rent_amount"] ?? 0),
            rent_due_day: (value["rent_due_day"] as number | null) ?? 1,
            deposit_amount: Number(value["deposit_amount"] ?? 0),
            status: "activo" as const,
          };

          if (existing) {
            const { error } = await supabase.from("leases").update(payload).eq("id", existing.id);
            if (error) throw error;
          } else {
            const { data: lease, error } = await supabase
              .from("leases")
              .insert(payload)
              .select("id")
              .single();
            if (error) throw error;
            await supabase
              .from("lease_tenants")
              .insert({ lease_id: lease.id, tenant_id: tenant.id, role: "primary" });
            await supabase.from("units").update({ status: "ocupada" }).eq("id", unit.id);
          }
        }

        if (row.isUpdate) updated += 1;
        else inserted += 1;
      }

      await logActivity(actorId, kind, null, "import", { inserted, updated });
      return { inserted, updated };
    },
    successKey: "import.done",
    invalidate: [qk.portfolio],
    onSuccess: (result) => {
      setSummary(result);
      setStep(5);
    },
  });

  const reset = () => {
    setStep(1);
    setHeaders([]);
    setRows([]);
    setMapping({});
    setSummary(null);
    setFileError(null);
  };

  const stepTitles = [
    "import.steps.template",
    "import.steps.upload",
    "import.steps.mapping",
    "import.steps.preview",
    "import.steps.done",
  ];

  return (
    <div className="space-y-5">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium">
        {stepTitles.map((key, index) => (
          <li key={key} className="flex items-center gap-2">
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full border",
                index + 1 < step
                  ? "border-primary bg-primary text-primary-foreground"
                  : index + 1 === step
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground",
              )}
            >
              {index + 1 < step ? <CheckCircle2 className="size-3.5" /> : index + 1}
            </span>
            <span className={index + 1 === step ? "text-foreground" : "text-muted-foreground"}>
              {t(key)}
            </span>
          </li>
        ))}
      </ol>

      {/* ---------------------------------------------- 1. template */}
      {step === 1 ? (
        <section className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
          <h2 className="text-base font-semibold">{t("import.steps.template")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("import.templateHint")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={downloadTemplate}>
              <Download className="size-4" />
              {t("import.downloadTemplate")}
            </Button>
            <Button onClick={() => setStep(2)}>{t("contracts.nextStep")}</Button>
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------ 2. upload */}
      {step === 2 ? (
        <section className="space-y-3">
          <label
            htmlFor={`file-${kind}`}
            onDragOver={(event: DragEvent) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event: DragEvent) => {
              event.preventDefault();
              setDragOver(false);
              void readFile(event.dataTransfer.files?.[0]);
            }}
            className={cn(
              "flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center",
              dragOver ? "border-primary bg-primary/5" : "border-border bg-surface",
            )}
          >
            <FileUp className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">{t("import.dropHere")}</p>
            <p className="text-xs text-muted-foreground">{t("import.dropHint")}</p>
          </label>
          <input
            id={`file-${kind}`}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(event) => void readFile(event.target.files?.[0])}
          />
          {fileError ? (
            <p
              role="alert"
              className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {fileError}
            </p>
          ) : null}
          <Button variant="ghost" onClick={() => setStep(1)}>
            {t("contracts.previousStep")}
          </Button>
        </section>
      ) : null}

      {/* ----------------------------------------------- 3. mapping */}
      {step === 3 ? (
        <section className="space-y-4">
          <div className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
            <h2 className="text-base font-semibold">{t("import.steps.mapping")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("import.mappingHint", { count: rows.length })}
            </p>
            <ul className="mt-4 space-y-3">
              {schema.fields.map((field) => (
                <li
                  key={field.key}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3"
                >
                  <span className="min-w-0 truncate text-sm font-medium">
                    {t(field.label)}
                    {field.required ? <span className="ml-1 text-danger">*</span> : null}
                  </span>
                  <Select
                    value={
                      mapping[field.key] === null || mapping[field.key] === undefined
                        ? NONE
                        : String(mapping[field.key])
                    }
                    onValueChange={(value) =>
                      setMapping({ ...mapping, [field.key]: value === NONE ? null : Number(value) })
                    }
                  >
                    <SelectTrigger aria-label={t(field.label)}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t("import.notMapped")}</SelectItem>
                      {headers.map((header, index) => (
                        <SelectItem key={`${header}-${index}`} value={String(index)}>
                          {header || `#${index + 1}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setStep(2)}>
              {t("contracts.previousStep")}
            </Button>
            <Button onClick={() => setStep(4)}>{t("import.goToPreview")}</Button>
          </div>
        </section>
      ) : null}

      {/* ---------------------------------- 4. validation preview (mandatory) */}
      {step === 4 ? (
        <section className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ["valid", counts.valid, "text-success", CheckCircle2],
                ["warning", counts.warning, "text-warning", TriangleAlert],
                ["error", counts.error, "text-danger", AlertCircle],
              ] as const
            ).map(([key, value, tone, Icon]) => (
              <div
                key={key}
                className="rounded-lg border border-border bg-surface p-4 shadow-subtle"
              >
                <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Icon className={`size-4 ${tone}`} />
                  {t(`import.counts.${key}`)}
                </p>
                <p className={`numeric mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
              </div>
            ))}
          </div>

          <div className="max-h-96 overflow-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 text-left text-xs font-semibold text-muted-foreground">
                <tr>
                  <th className="h-9 px-3">#</th>
                  <th className="h-9 px-3">{t("receipts.columns.status")}</th>
                  <th className="h-9 px-3">{t("import.reason")}</th>
                  {headers.map((header, index) => (
                    <th key={`${header}-${index}`} className="h-9 px-3">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {validated.map((row) => (
                  <tr
                    key={row.index}
                    className={cn(
                      "border-t border-border",
                      row.status === "error" && "bg-danger/5",
                    )}
                  >
                    <td className="numeric px-3 py-2 text-muted-foreground">{row.index + 2}</td>
                    <td className="px-3 py-2">
                      <StatusBadge
                        status={t(`import.counts.${row.status}`)}
                        variant={
                          row.status === "valid"
                            ? "success"
                            : row.status === "warning"
                              ? "warning"
                              : "danger"
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {row.reason ? t(row.reason.key, row.reason.params ?? {}) : "—"}
                    </td>
                    {row.raw.map((cell, index) => (
                      <td key={index} className="max-w-48 truncate px-3 py-2">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-sm text-muted-foreground">{t("import.previewNote")}</p>

          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setStep(3)}>
              {t("contracts.previousStep")}
            </Button>
            {counts.error > 0 ? (
              <Button variant="outline" onClick={downloadErrors}>
                <Download className="size-4" />
                {t("import.downloadErrors")}
              </Button>
            ) : null}
            <Button
              disabled={counts.valid + counts.warning === 0 || commit.isPending}
              onClick={() => commit.mutate(undefined)}
            >
              {commit.isPending ? <Loader2 className="animate-spin" /> : null}
              {t("import.commit", { count: counts.valid + counts.warning })}
            </Button>
          </div>
        </section>
      ) : null}

      {/* -------------------------------------------------- 5. summary */}
      {step === 5 && summary ? (
        <section className="rounded-lg border border-success/25 bg-success/5 p-6 text-center">
          <CheckCircle2 className="mx-auto size-10 text-success" />
          <h2 className="mt-3 text-lg font-semibold">
            {t(`import.summary.${kind}`, { inserted: summary.inserted, updated: summary.updated })}
          </h2>
          <Button className="mt-5" variant="outline" onClick={reset}>
            {t("import.importAnother")}
          </Button>
        </section>
      ) : null}
    </div>
  );
}

function ImportPage() {
  const { t } = useTranslation();
  const portfolio = usePortfolio();

  return (
    <div className="space-y-6">
      <PageHeader title={t("import.title")} description={t("import.description")} />

      <QueryState
        isLoading={portfolio.isLoading}
        error={portfolio.error}
        onRetry={() => void portfolio.refetch()}
        skeleton={<RowsSkeleton count={5} />}
      >
        <Tabs defaultValue="units">
          <TabsList>
            {KINDS.map((kind) => (
              <TabsTrigger key={kind} value={kind}>
                {t(`import.kinds.${kind}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          {KINDS.map((kind) => (
            <TabsContent key={kind} value={kind} className="mt-4">
              <Importer kind={kind} />
            </TabsContent>
          ))}
        </Tabs>
      </QueryState>
    </div>
  );
}
