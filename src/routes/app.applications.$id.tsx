import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Combobox, type ComboboxOption } from "@/components/rentio/combobox";
import { Field, FormDialog } from "@/components/rentio/form-dialog";
import { MoneyInput } from "@/components/rentio/money-input";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { StatusBadge } from "@/components/rentio/status-badge";
import {
  ApplicationAnswers,
  ApplicationFiles,
  applicationKey,
  applicationStatusVariant,
  useApplication,
} from "@/components/rentio/application-form";
import { db } from "@/lib/db";
import type { TablesInsert } from "@/lib/database.types";
import { formatMoney, todayIso } from "@/lib/format";
import {
  capPercentFor,
  exceedsCap,
  LARGE_STRUCTURE_CAP_PERCENT,
  MINIMUM_GRACE_DAYS,
  unitsInStructure,
} from "@/lib/late-fee";
import { turnoverRowsFor } from "@/lib/texas";
import {
  logActivity,
  qk,
  useActorId,
  usePortfolio,
  useSettings,
  useToastMutation,
} from "@/lib/queries";
import i18n from "@/lib/i18n";
import { pageTitle } from "@/lib/brand";

export const Route = createFileRoute("/app/applications/$id")({
  head: () => ({ meta: [{ title: pageTitle(i18n.t("applications.title")) }] }),
  component: ApplicationDetail,
});

function plusYear(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const end = new Date(y! + 1, m! - 1, d! - 1);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
}

/**
 * One application: every answer, the background-check result staff ran
 * outside Rentio, and the decision. Approve runs approve_application (tenant
 * + draft lease in one transaction); the lease then goes out for signature
 * from its Documents tab, which the e-sign lane owns.
 */
function ApplicationDetail() {
  const { t } = useTranslation();
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const actorId = useActorId();
  const query = useApplication(id);
  const portfolio = usePortfolio();
  const settings = useSettings();
  const application = query.data?.application ?? null;

  const [screening, setScreening] = useState<{ result: string; note: string }>({
    result: "",
    note: "",
  });
  const [dialog, setDialog] = useState<"approve" | "deny" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [terms, setTerms] = useState({
    start_date: todayIso(),
    end_date: plusYear(todayIso()),
    rent_amount: "" as number | "",
    deposit_amount: "" as number | "",
    rent_due_day: "1",
    grace_days: String(MINIMUM_GRACE_DAYS),
    late_fee_percent: String(LARGE_STRUCTURE_CAP_PERCENT),
    late_fee_over_cap_ack: false,
  });

  // Staff-only table; the applicant's account never sees these.
  const reviewKey = ["application-review", id];
  const review = useQuery({
    queryKey: reviewKey,
    queryFn: async () => {
      const { data, error: caught } = await db
        .from("application_reviews")
        .select("*")
        .eq("application_id", id)
        .maybeSingle();
      if (caught) throw caught;
      return data;
    },
  });

  useEffect(() => {
    setScreening({
      result: review.data?.screening_result ?? "",
      note: review.data?.screening_note ?? "",
    });
  }, [review.data]);

  const writeReview = async (fields: TablesInsert<"application_reviews">) => {
    const { error: caught } = await db
      .from("application_reviews")
      .upsert({ ...fields, application_id: id }, { onConflict: "application_id" });
    if (caught) throw caught;
  };

  const units = useMemo(() => portfolio.data?.units ?? [], [portfolio.data]);
  const unit = units.find((row) => row.id === unitId);
  const property = portfolio.data?.properties.find((row) => row.id === unit?.property_id);

  const openApprove = () => {
    const start = application?.desired_move_in ?? todayIso();
    const chosen = units.find((row) => row.id === application?.unit_id);
    setUnitId(application?.unit_id ?? null);
    setTerms({
      start_date: start,
      end_date: plusYear(start),
      rent_amount: chosen ? Number(chosen.base_rent) : "",
      deposit_amount: chosen ? Number(chosen.base_rent) : "",
      rent_due_day: "1",
      grace_days: String(Math.max(settings.data?.default_grace_days ?? 2, MINIMUM_GRACE_DAYS)),
      late_fee_percent: String(
        settings.data?.default_late_fee_percent ?? LARGE_STRUCTURE_CAP_PERCENT,
      ),
      late_fee_over_cap_ack: false,
    });
    setNote("");
    setError(null);
    setDialog("approve");
  };

  const unitOptions = useMemo<ComboboxOption[]>(() => {
    const names = new Map((portfolio.data?.properties ?? []).map((p) => [p.id, p.name]));
    return units
      .filter((row) => row.status === "vacante" || row.status === "reservada")
      .map((row) => ({
        value: row.id,
        label: `${t("units.columns.unit")} ${row.unit_number}`,
        hint: names.get(row.property_id) ?? "",
        keywords: names.get(row.property_id) ?? "",
      }));
  }, [units, portfolio.data, t]);

  const capPercent = capPercentFor(
    unitsInStructure(property, units.filter((row) => row.property_id === property?.id).length),
  );
  const overCap = exceedsCap(
    {
      late_fee_type: "percent",
      late_fee_percent: Number(terms.late_fee_percent) || 0,
      late_fee_amount: 0,
      rent_amount: Number(terms.rent_amount) || 0,
    },
    capPercent,
  );

  const invalidate = [applicationKey(id), ["applications"], reviewKey];

  const saveScreening = useToastMutation({
    mutationFn: async () => {
      await writeReview({
        application_id: id,
        screening_result: screening.result || null,
        screening_note: screening.note.trim() || null,
        reviewed_by: actorId,
        reviewed_at: new Date().toISOString(),
      });
      if (application?.status === "submitted") {
        const { error: caught } = await db
          .from("applications")
          .update({ status: "under_review" })
          .eq("id", id);
        if (caught) throw caught;
      }
    },
    successKey: "applications.detail.screeningSaved",
    invalidate,
  });

  const approve = useToastMutation({
    mutationFn: async () => {
      const { data, error: caught } = await db.rpc("approve_application", {
        p_application: id,
        p_unit: unitId,
        p_note: note.trim() || null,
        p_terms: {
          start_date: terms.start_date,
          end_date: terms.end_date,
          rent_amount: terms.rent_amount === "" ? 0 : terms.rent_amount,
          rent_due_day: Number(terms.rent_due_day) || 1,
          grace_days: Math.max(Number(terms.grace_days) || 0, MINIMUM_GRACE_DAYS),
          late_fee_type: "percent",
          late_fee_percent: Number(terms.late_fee_percent) || 0,
          late_fee_amount: 0,
          late_fee_over_cap_ack: terms.late_fee_over_cap_ack,
          deposit_amount: terms.deposit_amount === "" ? 0 : terms.deposit_amount,
        },
        p_checklist: unitId
          ? turnoverRowsFor(unitId, "").map(({ item, item_key, position }) => ({
              item,
              item_key,
              position,
            }))
          : [],
      });
      if (caught) throw caught;
      return data;
    },
    successKey: "applications.detail.approved",
    invalidate: [...invalidate, qk.portfolio],
    onSuccess: () => setDialog(null),
  });

  const deny = useToastMutation({
    mutationFn: async () => {
      await writeReview({
        application_id: id,
        decision_note: note.trim() || null,
        decided_by: actorId,
        decided_at: new Date().toISOString(),
      });
      const { error: caught } = await db
        .from("applications")
        .update({ status: "denied" })
        .eq("id", id);
      if (caught) throw caught;
      await logActivity(actorId, "application", id, "deny", {});
    },
    successKey: "applications.detail.denied",
    invalidate,
    onSuccess: () => setDialog(null),
  });

  const submitApprove = () => {
    setError(null);
    if (!unitId) return setError(t("applications.detail.noUnit"));
    if (terms.rent_amount === "" || Number(terms.rent_amount) <= 0)
      return setError(t("contracts.errors.rentRequired"));
    if (terms.end_date <= terms.start_date) return setError(t("contracts.errors.datesInvalid"));
    const day = Number(terms.rent_due_day);
    if (!Number.isFinite(day) || day < 1 || day > 31)
      return setError(t("contracts.errors.dueDayRange"));
    if (overCap && !terms.late_fee_over_cap_ack)
      return setError(t("contracts.errors.lateFeeOverCapUnacknowledged"));
    approve.mutate(undefined);
  };

  const decidable = application?.status === "submitted" || application?.status === "under_review";

  return (
    <div className="space-y-6">
      <Link to="/app/applications" className="text-sm font-medium text-primary hover:underline">
        {t("applications.detail.back")}
      </Link>
      <QueryState
        isLoading={query.isLoading}
        error={query.error}
        isEmpty={!application}
        onRetry={() => void query.refetch()}
        skeleton={<RowsSkeleton count={8} />}
        empty={<p className="text-sm text-muted-foreground">{t("applications.detail.notFound")}</p>}
      >
        {application ? (
          <>
            <PageHeader
              title={application.full_name ?? application.email ?? "—"}
              description={application.email ?? undefined}
              actions={
                <StatusBadge
                  status={t(`applications.status.${application.status}`)}
                  variant={applicationStatusVariant(application.status)}
                />
              }
            />

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <section className="space-y-6">
                <div>
                  <h2 className="mb-3 text-lg font-semibold">{t("applications.detail.answers")}</h2>
                  <ApplicationAnswers application={application} />
                </div>
                <div>
                  <h2 className="mb-3 text-lg font-semibold">
                    {t("applications.steps.coApplicants")}
                  </h2>
                  {query.data!.people.length === 0 ? (
                    <p className="text-sm text-muted-foreground">—</p>
                  ) : (
                    <ul className="space-y-2">
                      {query.data!.people.map((row) => (
                        <li
                          key={row.id}
                          className="rounded-lg border border-border px-4 py-2 text-sm"
                        >
                          <p className="font-medium">{row.full_name}</p>
                          <p className="text-muted-foreground">
                            {[
                              row.relationship,
                              row.email,
                              row.phone,
                              row.monthly_income === null
                                ? null
                                : formatMoney(Number(row.monthly_income)),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h2 className="mb-3 text-lg font-semibold">
                    {t("applications.steps.documents")}
                  </h2>
                  <ApplicationFiles files={query.data!.files} />
                </div>
              </section>

              <aside className="space-y-6">
                <section className="space-y-4 rounded-xl border border-border bg-surface p-4">
                  <div>
                    <h2 className="text-lg font-semibold">{t("applications.detail.screening")}</h2>
                    <p className="text-sm text-muted-foreground">
                      {t("applications.detail.screeningHint")}
                    </p>
                  </div>
                  <Field label={t("applications.detail.screeningResult")}>
                    <Select
                      value={screening.result}
                      onValueChange={(result) => setScreening({ ...screening, result })}
                    >
                      <SelectTrigger aria-label={t("applications.detail.screeningResult")}>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="approved">
                          {t("applications.detail.result.approved")}
                        </SelectItem>
                        <SelectItem value="denied">
                          {t("applications.detail.result.denied")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={t("applications.detail.screeningNote")} htmlFor="screening-note">
                    <Textarea
                      id="screening-note"
                      rows={3}
                      value={screening.note}
                      onChange={(event) => setScreening({ ...screening, note: event.target.value })}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={saveScreening.isPending || application.status === "draft"}
                    onClick={() => saveScreening.mutate(undefined)}
                  >
                    {t("applications.detail.saveScreening")}
                  </Button>
                </section>

                <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
                  <h2 className="text-lg font-semibold">{t("applications.detail.decision")}</h2>
                  {review.data?.decision_note ? (
                    <p className="text-sm">{review.data.decision_note}</p>
                  ) : null}
                  {decidable ? (
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" onClick={openApprove}>
                        {t("applications.detail.approve")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setNote("");
                          setDialog("deny");
                        }}
                      >
                        {t("applications.detail.deny")}
                      </Button>
                    </div>
                  ) : null}
                  {application.lease_id ? (
                    <div className="flex flex-wrap gap-2">
                      {application.status === "approved" ? (
                        // The send flow lives on the lease's Documents tab; the
                        // status flips to lease_sent when the request is created.
                        <Button
                          type="button"
                          onClick={() =>
                            void navigate({
                              href: `/app/contracts/${application.lease_id}?tab=documents`,
                            })
                          }
                        >
                          {t("applications.detail.sendLease")}
                        </Button>
                      ) : null}
                      <Button asChild variant="outline">
                        <Link to="/app/contracts/$id" params={{ id: application.lease_id }}>
                          {t("applications.detail.openLease")}
                        </Link>
                      </Button>
                    </div>
                  ) : null}
                </section>
              </aside>
            </div>
          </>
        ) : null}
      </QueryState>

      <FormDialog
        open={dialog === "approve"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t("applications.detail.approveTitle")}
        description={t("applications.detail.approveDescription")}
        submitLabel={t("applications.detail.approve")}
        error={error}
        pending={approve.isPending}
        onSubmit={submitApprove}
      >
        {review.data?.screening_result === "denied" ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
            {t("applications.detail.screeningDenied")}
          </p>
        ) : null}
        <Field label={t("contracts.fields.unit")} hint={t("contracts.fields.unitHint")}>
          <Combobox
            options={unitOptions}
            value={unitId}
            onChange={setUnitId}
            placeholder={t("contracts.fields.unitPlaceholder")}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("contracts.fields.startDate")} htmlFor="approve-start">
            <Input
              id="approve-start"
              type="date"
              value={terms.start_date}
              onChange={(event) => setTerms({ ...terms, start_date: event.target.value })}
            />
          </Field>
          <Field label={t("contracts.fields.endDate")} htmlFor="approve-end">
            <Input
              id="approve-end"
              type="date"
              value={terms.end_date}
              onChange={(event) => setTerms({ ...terms, end_date: event.target.value })}
            />
          </Field>
          <Field label={t("contracts.fields.rent")} htmlFor="approve-rent">
            <MoneyInput
              id="approve-rent"
              value={terms.rent_amount}
              onChange={(value) => setTerms({ ...terms, rent_amount: value })}
            />
          </Field>
          <Field label={t("contracts.fields.deposit")} htmlFor="approve-deposit">
            <MoneyInput
              id="approve-deposit"
              value={terms.deposit_amount}
              onChange={(value) => setTerms({ ...terms, deposit_amount: value })}
            />
          </Field>
          <Field label={t("contracts.fields.dueDay")} htmlFor="approve-due">
            <Input
              id="approve-due"
              inputMode="numeric"
              value={terms.rent_due_day}
              onChange={(event) =>
                setTerms({ ...terms, rent_due_day: event.target.value.replace(/\D/g, "") })
              }
            />
          </Field>
          <Field label={t("contracts.fields.graceDays")} htmlFor="approve-grace">
            <Input
              id="approve-grace"
              inputMode="numeric"
              value={terms.grace_days}
              onChange={(event) =>
                setTerms({ ...terms, grace_days: event.target.value.replace(/\D/g, "") })
              }
            />
          </Field>
          <Field label={t("contracts.fields.lateFeePercent")} htmlFor="approve-fee">
            <Input
              id="approve-fee"
              inputMode="decimal"
              value={terms.late_fee_percent}
              onChange={(event) =>
                setTerms({
                  ...terms,
                  late_fee_percent: event.target.value.replace(/[^\d.]/g, "").slice(0, 5),
                  late_fee_over_cap_ack: false,
                })
              }
            />
          </Field>
        </div>
        {overCap ? (
          <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5">
            <p className="text-sm text-warning-foreground">
              {t("contracts.lateFeeOverCap", { cap: capPercent })}
            </p>
            <label className="flex items-start gap-2 text-sm text-warning-foreground">
              <Checkbox
                checked={terms.late_fee_over_cap_ack}
                onCheckedChange={(checked) =>
                  setTerms({ ...terms, late_fee_over_cap_ack: checked === true })
                }
              />
              <span>{t("contracts.lateFeeOverCapAck")}</span>
            </label>
          </div>
        ) : null}
        <Field label={t("applications.detail.decisionNote")} htmlFor="approve-note">
          <Textarea
            id="approve-note"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </FormDialog>

      <FormDialog
        open={dialog === "deny"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t("applications.detail.denyTitle")}
        description={t("applications.detail.denyDescription")}
        submitLabel={t("applications.detail.deny")}
        pending={deny.isPending}
        onSubmit={() => deny.mutate(undefined)}
      >
        <Field label={t("applications.detail.decisionNote")} htmlFor="deny-note">
          <Textarea
            id="deny-note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </FormDialog>
    </div>
  );
}
