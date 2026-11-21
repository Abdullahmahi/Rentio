import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/rentio/form-dialog";
import { MoneyInput } from "@/components/rentio/money-input";
import { db } from "@/lib/db";
import { openSigned, uploadFile } from "@/lib/storage";
import { formatMoney } from "@/lib/format";
import { useToastMutation } from "@/lib/queries";
import type { Tables, TablesUpdate } from "@/lib/database.types";

export type Application = Tables<"applications">;
export type HistoryRow = {
  address?: string;
  landlord_name?: string;
  landlord_phone?: string;
  rent?: number | "";
  from?: string;
  to?: string;
};

const STEPS = ["personal", "work", "history", "coApplicants", "documents", "review"] as const;
const KINDS = ["id", "pay_stub", "other"] as const;

export const applicationKey = (id: string) => ["application", id] as const;

export const APPLICATION_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "denied",
  "lease_sent",
] as const;

export function applicationStatusVariant(status: string) {
  if (status === "approved" || status === "lease_sent") return "success" as const;
  if (status === "denied") return "danger" as const;
  if (status === "submitted" || status === "under_review") return "warning" as const;
  return "neutral" as const;
}

/** The application, its co-applicants and files; RLS scopes it to the caller. */
export function useApplication(id: string) {
  return useQuery({
    queryKey: applicationKey(id),
    queryFn: async () => {
      const [application, people, files] = await Promise.all([
        db.from("applications").select("*").eq("id", id).maybeSingle(),
        db
          .from("application_co_applicants")
          .select("*")
          .eq("application_id", id)
          .order("created_at"),
        db.from("application_files").select("*").eq("application_id", id).order("created_at"),
      ]);
      if (application.error) throw application.error;
      if (people.error) throw people.error;
      if (files.error) throw files.error;
      return { application: application.data, people: people.data, files: files.data };
    },
  });
}

/** Label / value rows, shared by the applicant's review step and the staff detail. */
export function ApplicationAnswers({ application }: { application: Application }) {
  const { t } = useTranslation();
  const rows: [string, string | null][] = [
    [t("applications.fields.fullName"), application.full_name],
    [t("applications.fields.email"), application.email],
    [t("applications.fields.phone"), application.phone],
    [t("applications.fields.dateOfBirth"), application.date_of_birth],
    [t("applications.fields.currentAddress"), application.current_address],
    [t("applications.fields.desiredMoveIn"), application.desired_move_in],
    [t("applications.fields.employer"), application.employer],
    [t("applications.fields.jobTitle"), application.job_title],
    [t("applications.fields.employerPhone"), application.employer_phone],
    [t("applications.fields.employmentStart"), application.employment_start],
    [
      t("applications.fields.monthlyIncome"),
      application.monthly_income === null ? null : formatMoney(Number(application.monthly_income)),
    ],
    [t("applications.fields.notes"), application.notes],
  ];
  const history = (application.rental_history ?? []) as HistoryRow[];
  return (
    <div className="space-y-4">
      <dl className="rounded-lg border border-border">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="grid gap-1 border-b border-border px-4 py-2 text-sm last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] sm:gap-4"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words font-medium">{value || "—"}</dd>
          </div>
        ))}
      </dl>
      <div>
        <h3 className="text-sm font-semibold">{t("applications.steps.history")}</h3>
        {history.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{t("applications.form.noHistory")}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {history.map((row, index) => (
              <li key={index} className="rounded-lg border border-border px-4 py-2 text-sm">
                <p className="font-medium">{row.address || "—"}</p>
                <p className="text-muted-foreground">
                  {[
                    row.landlord_name,
                    row.landlord_phone,
                    row.rent ? formatMoney(Number(row.rent)) : null,
                    [row.from, row.to].filter(Boolean).join(" – "),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Files on an application, each opened through a short-lived signed link. */
export function ApplicationFiles({ files }: { files: Tables<"application_files">[] }) {
  const { t } = useTranslation();
  if (files.length === 0)
    return <p className="text-sm text-muted-foreground">{t("applications.form.noFiles")}</p>;
  return (
    <ul className="space-y-2">
      {files.map((file) => (
        <li key={file.id}>
          <button
            type="button"
            className="min-h-11 text-left text-sm font-medium text-primary hover:underline"
            onClick={() => void openSigned("applications", file.path)}
          >
            {t(`applications.kinds.${file.kind}`)} · {file.file_name ?? file.path}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The applicant's multi-step form. Every "Save and continue" writes the
 * draft, so closing the tab loses at most one step. Mobile-first: one
 * column, full-width controls.
 */
export function ApplicationForm({ id }: { id: string }) {
  const { t } = useTranslation();
  const query = useApplication(id);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<TablesUpdate<"applications">>({});
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [person, setPerson] = useState({
    full_name: "",
    email: "",
    phone: "",
    relationship: "",
    monthly_income: "" as number | "",
  });
  const [kind, setKind] = useState<(typeof KINDS)[number]>("id");
  const [file, setFile] = useState<File | null>(null);

  const application = query.data?.application;
  useEffect(() => {
    if (!application) return;
    setForm({
      full_name: application.full_name,
      phone: application.phone,
      date_of_birth: application.date_of_birth,
      current_address: application.current_address,
      desired_move_in: application.desired_move_in,
      employer: application.employer,
      job_title: application.job_title,
      employer_phone: application.employer_phone,
      employment_start: application.employment_start,
      monthly_income: application.monthly_income,
      notes: application.notes,
    });
    setHistory((application.rental_history ?? []) as HistoryRow[]);
    // Only when a different application loads; refetches must not wipe typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [application?.id]);

  const save = useToastMutation({
    mutationFn: async (status: "draft" | "submitted") => {
      const { error: caught } = await db
        .from("applications")
        .update({
          ...form,
          rental_history: history,
          ...(status === "submitted" ? { status } : {}),
        })
        .eq("id", id);
      if (caught) throw caught;
      return status;
    },
    successKey: "applications.form.saved",
    invalidate: [applicationKey(id), ["my-applications"]],
    onSuccess: () => setStep((current) => Math.min(current + 1, STEPS.length - 1)),
  });

  const addPerson = useToastMutation({
    mutationFn: async () => {
      const { error: caught } = await db.from("application_co_applicants").insert({
        application_id: id,
        full_name: person.full_name.trim(),
        email: person.email.trim() || null,
        phone: person.phone.trim() || null,
        relationship: person.relationship.trim() || null,
        monthly_income: person.monthly_income === "" ? null : person.monthly_income,
      });
      if (caught) throw caught;
    },
    successKey: "applications.form.coApplicantAdded",
    invalidate: [applicationKey(id)],
    onSuccess: () =>
      setPerson({ full_name: "", email: "", phone: "", relationship: "", monthly_income: "" }),
  });

  const removeRow = useToastMutation({
    mutationFn: async ({
      table,
      rowId,
    }: {
      table: "application_co_applicants" | "application_files";
      rowId: string;
    }) => {
      const { error: caught } = await db.from(table).delete().eq("id", rowId);
      if (caught) throw caught;
    },
    successKey: "applications.form.removed",
    invalidate: [applicationKey(id)],
  });

  const upload = useToastMutation({
    mutationFn: async (chosen: File) => {
      const path = await uploadFile("applications", id, chosen);
      const { error: caught } = await db
        .from("application_files")
        .insert({ application_id: id, kind, path, file_name: chosen.name });
      if (caught) throw caught;
    },
    successKey: "applications.form.uploaded",
    invalidate: [applicationKey(id)],
    onSuccess: () => setFile(null),
  });

  if (!query.data?.application) return null;
  const { people, files } = query.data;
  const current = STEPS[step]!;

  const text = (key: keyof TablesUpdate<"applications">, label: string, type = "text") => (
    <Field label={t(`applications.fields.${label}`)} htmlFor={`app-${label}`}>
      <Input
        id={`app-${label}`}
        type={type}
        className="h-11"
        value={(form[key] as string | null | undefined) ?? ""}
        onChange={(event) => setForm({ ...form, [key]: event.target.value || null })}
      />
    </Field>
  );

  const next = () => {
    setError(null);
    if (current === "personal" && (!form.full_name?.trim() || !form.phone?.trim()))
      return setError(t("applications.form.nameRequired"));
    if (current === "coApplicants" || current === "documents") return setStep((value) => value + 1); // saved row by row
    save.mutate("draft");
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium text-muted-foreground">
          {t("applications.stepOf", { current: step + 1, total: STEPS.length })}
        </p>
        <h2 className="mt-1 text-xl font-semibold">{t(`applications.steps.${current}`)}</h2>
      </div>

      {current === "personal" ? (
        <div className="space-y-4">
          {text("full_name", "fullName")}
          {text("phone", "phone", "tel")}
          {text("date_of_birth", "dateOfBirth", "date")}
          {text("current_address", "currentAddress")}
          {text("desired_move_in", "desiredMoveIn", "date")}
        </div>
      ) : null}

      {current === "work" ? (
        <div className="space-y-4">
          {text("employer", "employer")}
          {text("job_title", "jobTitle")}
          {text("employer_phone", "employerPhone", "tel")}
          {text("employment_start", "employmentStart", "date")}
          <Field label={t("applications.fields.monthlyIncome")} htmlFor="app-income">
            <MoneyInput
              id="app-income"
              value={form.monthly_income ?? ""}
              onChange={(value) =>
                setForm({ ...form, monthly_income: value === "" ? null : value })
              }
            />
          </Field>
          <Field label={t("applications.fields.notes")} htmlFor="app-notes">
            <Textarea
              id="app-notes"
              rows={3}
              value={form.notes ?? ""}
              onChange={(event) => setForm({ ...form, notes: event.target.value || null })}
            />
          </Field>
        </div>
      ) : null}

      {current === "history" ? (
        <div className="space-y-4">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("applications.form.noHistory")}</p>
          ) : null}
          {history.map((row, index) => {
            const set = (patch: HistoryRow) =>
              setHistory(history.map((item, i) => (i === index ? { ...item, ...patch } : item)));
            return (
              <fieldset key={index} className="space-y-3 rounded-lg border border-border p-4">
                {(
                  [
                    ["address", "text"],
                    ["landlord_name", "text"],
                    ["landlord_phone", "tel"],
                    ["from", "date"],
                    ["to", "date"],
                  ] as const
                ).map(([key, type]) => (
                  <Field
                    key={key}
                    label={t(
                      `applications.fields.${key === "landlord_name" ? "landlordName" : key === "landlord_phone" ? "landlordPhone" : key}`,
                    )}
                    htmlFor={`hist-${index}-${key}`}
                  >
                    <Input
                      id={`hist-${index}-${key}`}
                      type={type}
                      className="h-11"
                      value={row[key] ?? ""}
                      onChange={(event) => set({ [key]: event.target.value })}
                    />
                  </Field>
                ))}
                <Field label={t("applications.fields.rent")} htmlFor={`hist-${index}-rent`}>
                  <MoneyInput
                    id={`hist-${index}-rent`}
                    value={row.rent ?? ""}
                    onChange={(value) => set({ rent: value })}
                  />
                </Field>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setHistory(history.filter((_, i) => i !== index))}
                >
                  {t("actions.remove")}
                </Button>
              </fieldset>
            );
          })}
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            onClick={() => setHistory([...history, {}])}
          >
            {t("applications.form.addHistory")}
          </Button>
        </div>
      ) : null}

      {current === "coApplicants" ? (
        <div className="space-y-4">
          {people.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("applications.form.noCoApplicants")}</p>
          ) : (
            <ul className="space-y-2">
              {people.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{row.full_name}</span>
                    <span className="block truncate text-muted-foreground">
                      {[row.relationship, row.email, row.phone].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      removeRow.mutate({ table: "application_co_applicants", rowId: row.id })
                    }
                  >
                    {t("actions.remove")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <fieldset className="space-y-3 rounded-lg border border-border p-4">
            {(["full_name", "email", "phone", "relationship"] as const).map((key) => (
              <Field
                key={key}
                label={t(`applications.fields.${key === "full_name" ? "fullName" : key}`)}
                htmlFor={`co-${key}`}
              >
                <Input
                  id={`co-${key}`}
                  className="h-11"
                  type={key === "email" ? "email" : key === "phone" ? "tel" : "text"}
                  value={person[key]}
                  onChange={(event) => setPerson({ ...person, [key]: event.target.value })}
                />
              </Field>
            ))}
            <Field label={t("applications.fields.monthlyIncome")} htmlFor="co-income">
              <MoneyInput
                id="co-income"
                value={person.monthly_income}
                onChange={(value) => setPerson({ ...person, monthly_income: value })}
              />
            </Field>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              disabled={!person.full_name.trim() || addPerson.isPending}
              onClick={() => addPerson.mutate(undefined)}
            >
              {t("applications.form.addCoApplicant")}
            </Button>
          </fieldset>
        </div>
      ) : null}

      {current === "documents" ? (
        <div className="space-y-4">
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("applications.form.noFiles")}</p>
          ) : (
            <ul className="space-y-2">
              {files.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-2 text-sm"
                >
                  <button
                    type="button"
                    className="min-h-11 min-w-0 truncate text-left font-medium text-primary hover:underline"
                    onClick={() => void openSigned("applications", row.path)}
                  >
                    {t(`applications.kinds.${row.kind}`)} · {row.file_name}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRow.mutate({ table: "application_files", rowId: row.id })}
                  >
                    {t("actions.remove")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <fieldset className="space-y-3 rounded-lg border border-border p-4">
            <Field label={t("applications.fields.kind")}>
              <Select value={kind} onValueChange={(value) => setKind(value as typeof kind)}>
                <SelectTrigger className="h-11" aria-label={t("applications.fields.kind")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`applications.kinds.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("applications.fields.file")} htmlFor="app-file">
              <Input
                id="app-file"
                type="file"
                accept="image/*,application/pdf"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </Field>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              disabled={!file || upload.isPending}
              onClick={() => file && upload.mutate(file)}
            >
              {t("applications.form.upload")}
            </Button>
          </fieldset>
        </div>
      ) : null}

      {current === "review" ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("applications.form.reviewHint")}</p>
          <ApplicationAnswers
            application={{ ...application!, ...form, rental_history: history } as Application}
          />
          <div>
            <h3 className="text-sm font-semibold">{t("applications.steps.coApplicants")}</h3>
            <p className="mt-1 text-sm">{people.map((row) => row.full_name).join(", ") || "—"}</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold">{t("applications.steps.documents")}</h3>
            <div className="mt-1">
              <ApplicationFiles files={files} />
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={step === 0}
          onClick={() => setStep((value) => value - 1)}
        >
          {t("applications.form.back")}
        </Button>
        {current === "review" ? (
          <Button
            type="button"
            className="h-11"
            disabled={save.isPending}
            onClick={() => save.mutate("submitted")}
          >
            {t("applications.form.submit")}
          </Button>
        ) : (
          <Button type="button" className="h-11" disabled={save.isPending} onClick={next}>
            {t("applications.form.next")}
          </Button>
        )}
      </div>
    </div>
  );
}
