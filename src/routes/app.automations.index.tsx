import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, AlertTriangle, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { useAuth } from "@/lib/auth";
import { pageTitle } from "@/lib/brand";
import { db, invokeFn } from "@/lib/db";
import { APP_TIMEZONE } from "@/lib/format";
import i18n from "@/lib/i18n";
import { logActivity, qk, useActorId, useSettings, useToastMutation } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { Tables } from "@/lib/database.types";

export const Route = createFileRoute("/app/automations/")({
  head: () => ({ meta: [{ title: pageTitle(i18n.t("pages.automations.title")) }] }),
  component: AutomationsPage,
});

/** What one nightly run did for this company (job_runs.summary). */
interface RunSummary {
  invoices_created?: number;
  invoices_emailed?: number;
  late_fee_warnings?: number;
  rent_reminders?: number;
  notifications_emailed?: number;
  notifications_portal?: number;
  errors?: string[];
}

const FIELDS = [
  "auto_invoice_day",
  "auto_invoice_send",
  "auto_rent_reminder",
  "auto_rent_reminder_days",
  "auto_late_fee_warning",
  "auto_payment_emails",
  "auto_repair_emails",
] as const;
type Form = Pick<Tables<"settings">, (typeof FIELDS)[number]>;

function AutomationsPage() {
  const { t } = useTranslation();
  const { isStaff } = useAuth();
  const actorId = useActorId();
  const settings = useSettings();

  const [form, setForm] = useState<Form | null>(null);
  useEffect(() => {
    if (!settings.data) return;
    const next = {} as Form;
    for (const key of FIELDS) (next as Record<string, unknown>)[key] = settings.data[key];
    setForm(next);
  }, [settings.data]);
  const dirty =
    form !== null &&
    settings.data !== null &&
    FIELDS.some((key) => form[key] !== settings.data?.[key]);

  const runs = useQuery({
    queryKey: ["job-runs"],
    queryFn: async () => {
      const { data, error } = await db
        .from("job_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });

  const save = useToastMutation({
    mutationFn: async () => {
      if (!settings.data || !form) throw new Error("incomplete");
      const { error } = await db
        .from("settings")
        .update({
          ...form,
          auto_invoice_day: Math.min(28, Math.max(1, Number(form.auto_invoice_day) || 1)),
          auto_rent_reminder_days: Math.min(
            14,
            Math.max(1, Number(form.auto_rent_reminder_days) || 3),
          ),
        })
        .eq("id", settings.data.id);
      if (error) throw error;
      await logActivity(actorId, "settings", settings.data.id, "update_automations", {
        ...form,
      });
    },
    successKey: "automations.saved",
    invalidate: [qk.settings],
  });

  const runNow = useToastMutation({
    mutationFn: async () => {
      const { data, error } = await invokeFn<RunSummary>("run-automations");
      if (error) throw error;
      return data;
    },
    successKey: "automations.ranNow",
    pendingKey: "automations.running",
    invalidate: [["job-runs"], ["invoices"], qk.portfolio],
    onSuccess: (data) => {
      if (data?.errors?.length)
        toast.warning(t("automations.ranWithErrors", { count: data.errors.length }));
    },
  });

  const update = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("automations.title")}
        description={t("automations.description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              disabled={!isStaff || runNow.isPending}
              onClick={() => runNow.mutate(undefined)}
            >
              <Play className="size-4" />
              {t("automations.runNow")}
            </Button>
            <Button
              disabled={!isStaff || !dirty || save.isPending}
              onClick={() => save.mutate(undefined)}
            >
              {t("automations.save")}
            </Button>
          </div>
        }
      />

      <LastRun runs={runs.data ?? []} loading={runs.isLoading} />

      <QueryState
        isLoading={settings.isLoading || form === null}
        error={settings.error}
        isEmpty={!settings.isLoading && settings.data === null}
        onRetry={() => void settings.refetch()}
        skeleton={<RowsSkeleton count={5} />}
        empty={<p className="text-sm text-muted-foreground">{t("errors.noCompany")}</p>}
      >
        {form ? (
          <section className="rounded-lg border border-border bg-surface shadow-subtle">
            <header className="border-b border-border px-6 pb-5 pt-6">
              <h2 className="text-[17px] font-semibold">{t("automations.panel.title")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("automations.panel.description")}
              </p>
            </header>

            <Row
              title={t("automations.invoices.title")}
              description={t("automations.invoices.description")}
            >
              <div className="flex flex-col items-end gap-2.5">
                <label className="flex items-center gap-2 text-sm">
                  {t("automations.invoices.dayBefore")}
                  <Input
                    inputMode="numeric"
                    disabled={!isStaff}
                    className="numeric h-9 w-14 text-center"
                    value={String(form.auto_invoice_day)}
                    onChange={(e) =>
                      update("auto_invoice_day", Number(e.target.value.replace(/\D/g, "")) || 0)
                    }
                    aria-label={t("automations.invoices.dayLabel")}
                  />
                  {t("automations.invoices.dayAfter")}
                </label>
                <Segmented
                  disabled={!isStaff}
                  value={form.auto_invoice_send ? "send" : "drafts"}
                  options={[
                    ["drafts", t("automations.invoices.drafts")],
                    ["send", t("automations.invoices.send")],
                  ]}
                  onChange={(value) => update("auto_invoice_send", value === "send")}
                />
              </div>
            </Row>

            <Row
              title={t("automations.reminder.title")}
              description={t("automations.reminder.description")}
            >
              <label className="flex items-center gap-2 text-sm">
                <Input
                  inputMode="numeric"
                  disabled={!isStaff || !form.auto_rent_reminder}
                  className="numeric h-9 w-14 text-center"
                  value={String(form.auto_rent_reminder_days)}
                  onChange={(e) =>
                    update(
                      "auto_rent_reminder_days",
                      Number(e.target.value.replace(/\D/g, "")) || 0,
                    )
                  }
                  aria-label={t("automations.reminder.daysLabel")}
                />
                {t("automations.reminder.daysAfter")}
              </label>
              <Switch
                disabled={!isStaff}
                checked={form.auto_rent_reminder}
                onCheckedChange={(checked) => update("auto_rent_reminder", checked)}
                aria-label={t("automations.reminder.title")}
              />
            </Row>

            <Row
              title={t("automations.lateFee.title")}
              description={t("automations.lateFee.description")}
            >
              <Switch
                disabled={!isStaff}
                checked={form.auto_late_fee_warning}
                onCheckedChange={(checked) => update("auto_late_fee_warning", checked)}
                aria-label={t("automations.lateFee.title")}
              />
            </Row>

            <Row
              title={t("automations.payments.title")}
              description={t("automations.payments.description")}
            >
              <Switch
                disabled={!isStaff}
                checked={form.auto_payment_emails}
                onCheckedChange={(checked) => update("auto_payment_emails", checked)}
                aria-label={t("automations.payments.title")}
              />
            </Row>

            <Row
              title={t("automations.repairs.title")}
              description={t("automations.repairs.description")}
            >
              <Switch
                disabled={!isStaff}
                checked={form.auto_repair_emails}
                onCheckedChange={(checked) => update("auto_repair_emails", checked)}
                aria-label={t("automations.repairs.title")}
              />
            </Row>
          </section>
        ) : null}
      </QueryState>
    </div>
  );
}

/** One automation: title and plain-language description left, controls right. */
function Row({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-border px-6 py-5 last:border-b-0 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1 sm:max-w-[600px]">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-4 sm:justify-end">{children}</div>
    </div>
  );
}

function Segmented({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: [value: string, label: string][];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" className="flex gap-0.5 rounded-lg bg-muted p-[3px]">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          disabled={disabled}
          onClick={() => onChange(key)}
          className={cn(
            "rounded-md px-3.5 py-1.5 text-[13px] disabled:cursor-not-allowed",
            value === key
              ? "bg-surface font-medium text-foreground shadow-subtle"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** "Ran last night · 42 invoices drafted · … · 0 errors", plus the last 30 on demand. */
function LastRun({ runs, loading }: { runs: Tables<"job_runs">[]; loading: boolean }) {
  const { t, i18n: i18next } = useTranslation();
  const [open, setOpen] = useState(false);
  const when = (iso: string) =>
    new Intl.DateTimeFormat(i18next.language, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: APP_TIMEZONE,
    }).format(new Date(iso));
  const counts = (run: Tables<"job_runs">) => {
    const s = (run.summary ?? {}) as RunSummary;
    return t("automations.lastRun.counts", {
      invoices: s.invoices_created ?? 0,
      reminders: s.rent_reminders ?? 0,
      warnings: s.late_fee_warnings ?? 0,
      updates: (s.notifications_emailed ?? 0) + (s.notifications_portal ?? 0),
      errors: s.errors?.length ?? 0,
    });
  };
  const latest = runs[0];
  const failed = Boolean(latest?.error);

  if (loading) return <RowsSkeleton count={1} />;
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-subtle sm:px-5">
      <div className="flex items-center gap-4">
        <div
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full",
            !latest ? "bg-muted" : failed ? "bg-danger/10" : "bg-success/10",
          )}
        >
          {failed ? (
            <AlertTriangle className="size-4 text-danger" />
          ) : (
            <CheckCircle2
              className={cn("size-4", latest ? "text-success" : "text-muted-foreground")}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {latest ? (
            <>
              <p className="text-sm font-semibold">
                {t(failed ? "automations.lastRun.failed" : "automations.lastRun.ok", {
                  when: when(latest.started_at),
                })}
              </p>
              <p className="truncate text-sm text-muted-foreground">{counts(latest)}</p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold">{t("automations.lastRun.never")}</p>
              <p className="text-sm text-muted-foreground">{t("automations.lastRun.neverHint")}</p>
            </>
          )}
        </div>
        <div className="hidden shrink-0 flex-col items-end gap-0.5 text-sm sm:flex">
          <span className="text-muted-foreground">{t("automations.lastRun.next")}</span>
          {runs.length > 1 ? (
            <button
              type="button"
              className="font-medium text-primary"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? t("automations.lastRun.hide") : t("automations.lastRun.history")}
            </button>
          ) : null}
        </div>
      </div>
      {open ? (
        <ul className="mt-4 divide-y divide-border border-t border-border text-sm">
          {runs.map((run) => (
            <li key={run.id} className="grid gap-1 py-2.5 sm:grid-cols-[180px_minmax(0,1fr)_auto]">
              <span className="numeric">{when(run.started_at)}</span>
              <span className={cn("truncate", run.error ? "text-danger" : "text-muted-foreground")}>
                {run.error ?? counts(run)}
              </span>
              <span className="text-xs text-muted-foreground">
                {t(`automations.lastRun.trigger.${run.trigger}`)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
