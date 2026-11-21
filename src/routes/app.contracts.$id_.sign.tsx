import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  FileUp,
  Loader2,
  Mail,
  PenLine,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { agreementsKey, LinksDialog, type SentLink } from "@/components/rentio/agreements-panel";
import { EmptyState } from "@/components/rentio/empty-state";
import { Field } from "@/components/rentio/form-dialog";
import { PageHeader } from "@/components/rentio/page-header";
import { PdfPage, usePdf } from "@/components/rentio/pdf-page";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { db, errorText, invokeFn } from "@/lib/db";
import { isEmail, placeBox, type Box } from "@/lib/esign";
import { formatDate } from "@/lib/format";
import { leaseContexts } from "@/lib/portfolio";
import { logActivity, qk, useActorId, usePortfolio } from "@/lib/queries";
import { signedUrl, uploadFile } from "@/lib/storage";
import { cn } from "@/lib/utils";
import i18n from "@/lib/i18n";
import { pageTitle } from "@/lib/brand";

export const Route = createFileRoute("/app/contracts/$id_/sign")({
  head: () => ({ meta: [{ title: pageTitle(i18n.t("esign.send")) }] }),
  component: SendForSignaturePage,
});

/** One colour per signer, from the Harbor tokens. */
const TONES = [
  { dot: "bg-primary", spot: "border-primary bg-primary/10 text-primary" },
  {
    dot: "bg-accent-foreground",
    spot: "border-accent-foreground bg-accent text-accent-foreground",
  },
  { dot: "bg-warning", spot: "border-warning bg-warning/10 text-warning" },
  { dot: "bg-info", spot: "border-info bg-info/10 text-info" },
];
const tone = (index: number) => TONES[index % TONES.length]!;

interface Signer {
  key: string;
  name: string;
  email: string;
  tenantId: string | null;
  required: boolean;
  spot: (Box & { page: number }) | null;
}

/** S1: pick the PDF, say who signs, click where each one signs, send. */
function SendForSignaturePage() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const actorId = useActorId();
  const portfolio = usePortfolio();
  const context = useMemo(
    () =>
      portfolio.data ? leaseContexts(portfolio.data).find((row) => row.lease.id === id) : undefined,
    [portfolio.data, id],
  );

  const [file, setFile] = useState<{ path: string; name: string } | null>(null);
  const [signers, setSigners] = useState<Signer[] | null>(null);
  const [active, setActive] = useState(0);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [links, setLinks] = useState<SentLink[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Default signers: everyone on the lease, with the email on file.
  useEffect(() => {
    if (!context || signers) return;
    const people = [context.primaryTenant, ...context.coTenants, ...context.guarantors].filter(
      (person) => person !== undefined,
    );
    setSigners(
      people.map((person) => ({
        key: person.id,
        name: person.full_name,
        email: person.email ?? "",
        tenantId: person.id,
        required: true,
        spot: null,
      })),
    );
    setTitle(t("esign.defaultTitle", { unit: context.unit?.unit_number ?? "" }));
  }, [context, signers, t]);

  const pdfs = useQuery({
    queryKey: qk.documents("lease", id),
    queryFn: async () => {
      const { data, error } = await db
        .from("documents")
        .select("*")
        .eq("owner_type", "lease")
        .eq("owner_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    select: (rows) => rows.filter((row) => row.url.toLowerCase().endsWith(".pdf")),
  });

  const url = useQuery({
    queryKey: ["signed-url", file?.path],
    enabled: Boolean(file),
    queryFn: () => signedUrl("contracts", file!.path, 3600),
    staleTime: 30 * 60_000,
  });
  const { doc, error: pdfError } = usePdf(url.data ?? null);
  // Signatures go at the end of a lease, so open on the last page.
  useEffect(() => {
    if (doc) setPage(doc.numPages);
  }, [doc]);

  const onUpload = async (picked: File | undefined) => {
    if (!picked) return;
    setUploading(true);
    try {
      const path = await uploadFile("contracts", id, picked);
      const { error } = await db.from("documents").insert({
        owner_type: "lease",
        owner_id: id,
        name: picked.name,
        url: path,
        uploaded_by: actorId,
      });
      if (error) throw error;
      await logActivity(actorId, "document", null, "upload", { ownerType: "lease", ownerId: id });
      void pdfs.refetch();
      setFile({ path, name: picked.name });
    } catch (caught) {
      toast.error(errorText(t, caught));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const list = signers ?? [];
  const update = (index: number, patch: Partial<Signer>) =>
    setSigners(list.map((signer, i) => (i === index ? { ...signer, ...patch } : signer)));
  const [problem, setProblem] = useState<string | null>(null);
  // What stops sending, in words: the server refuses the same things.
  const blocker = () => {
    if (!file || !doc) return t("esign.errors.noPdf");
    if (!title.trim()) return t("esign.errors.noTitle");
    if (list.length === 0) return t("esign.errors.noSigners");
    const unnamed = list.filter((signer) => !signer.name.trim() || !isEmail(signer.email));
    if (unnamed.length) return t("esign.errors.nameEmail");
    const unplaced = list.filter((signer) => !signer.spot).map((signer) => signer.name);
    if (unplaced.length) return t("esign.errors.unplaced", { names: unplaced.join(", ") });
    return null;
  };

  const backToDocuments = () =>
    void navigate({ to: "/app/contracts/$id", params: { id }, search: { tab: "documents" } });

  const send = async () => {
    const reason = blocker();
    setProblem(reason);
    if (reason || !file) return;
    setSending(true);
    try {
      const { data, error } = await invokeFn<{ signers: SentLink[] }>("esign-send", {
        body: {
          lease_id: id,
          path: file.path,
          title: title.trim(),
          message: message.trim(),
          signers: list.map((signer) => ({
            name: signer.name.trim(),
            email: signer.email.trim(),
            tenant_id: signer.tenantId,
            required: signer.required,
            ...signer.spot,
          })),
        },
      });
      if (error) throw error;
      void queryClient.invalidateQueries({ queryKey: agreementsKey(id) });
      const unsent = (data?.signers ?? []).filter((signer) => !signer.emailed);
      if (unsent.length) setLinks(unsent);
      else {
        toast.success(t("esign.sent", { count: list.length }));
        backToDocuments();
      }
    } catch (caught) {
      toast.error(errorText(t, caught));
    } finally {
      setSending(false);
    }
  };

  const tenants = [context?.primaryTenant, ...(context?.coTenants ?? [])]
    .filter((person) => person !== undefined)
    .map((person) => person.full_name)
    .join(" & ");

  return (
    <div className="space-y-6">
      <QueryState
        isLoading={portfolio.isLoading}
        error={portfolio.error}
        isEmpty={!context && !portfolio.isLoading}
        onRetry={() => void portfolio.refetch()}
        skeleton={<RowsSkeleton count={4} />}
        empty={<EmptyState icon={FileText} message={t("contracts.notFound")} />}
      >
        <PageHeader
          title={t("esign.send")}
          description={`${context?.unit?.unit_number ?? ""} · ${tenants} · ${t("esign.starts", {
            date: context ? formatDate(context.lease.start_date) : "",
          })}`}
          actions={
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <Link to="/app/contracts/$id" params={{ id }} search={{ tab: "documents" }}>
                  {t("actions.cancel")}
                </Link>
              </Button>
              <Button disabled={sending} onClick={() => void send()}>
                {sending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                {t("esign.sendTo", { count: list.length })}
              </Button>
            </div>
          }
        />

        {problem ? (
          <p
            role="alert"
            className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {problem}
          </p>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_348px]">
          {/* ------------------------------------------------ the document */}
          <section className="overflow-hidden rounded-lg border border-border bg-surface">
            <header className="flex items-center gap-3 border-b border-border px-4 py-3">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <p className="min-w-0 flex-1 truncate text-sm font-medium">
                {file?.name ?? t("esign.pickPdf")}
              </p>
              {doc ? (
                <>
                  <span className="numeric text-sm text-muted-foreground">
                    {t("esign.pageOf", { page, count: doc.numPages })}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-7"
                    aria-label={t("esign.previousPage")}
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-7"
                    aria-label={t("esign.nextPage")}
                    disabled={page >= doc.numPages}
                    onClick={() => setPage(page + 1)}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </>
              ) : null}
              {file ? (
                <Button variant="ghost" size="sm" onClick={() => setFile(null)}>
                  {t("esign.changePdf")}
                </Button>
              ) : null}
            </header>

            <div className="bg-muted/60 p-4 sm:p-6">
              {!file ? (
                <div className="mx-auto max-w-md space-y-3 rounded-lg border border-border bg-surface p-5">
                  <p className="text-sm text-muted-foreground">{t("esign.pickHint")}</p>
                  <ul className="divide-y divide-border">
                    {(pdfs.data ?? []).map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-3 py-2.5 text-left text-sm hover:text-primary"
                          onClick={() => setFile({ path: row.url, name: row.name })}
                        >
                          <FileText className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(row.created_at)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <input
                    ref={inputRef}
                    id="esign-upload"
                    type="file"
                    accept="application/pdf,.pdf"
                    className="sr-only"
                    onChange={(event) => void onUpload(event.target.files?.[0])}
                  />
                  <Button asChild variant="outline" disabled={uploading}>
                    <label htmlFor="esign-upload" className="cursor-pointer">
                      {uploading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <FileUp className="size-4" />
                      )}
                      {t("esign.uploadPdf")}
                    </label>
                  </Button>
                </div>
              ) : pdfError ? (
                <p className="text-sm text-danger">{t("esign.pdfUnreadable")}</p>
              ) : doc ? (
                <PdfPage
                  key={page}
                  doc={doc}
                  pageNumber={page}
                  className="mx-auto max-w-[520px] cursor-crosshair"
                  onClick={(point, bounds) => {
                    if (!list[active]) return;
                    update(active, { spot: { page, ...placeBox(point, bounds) } });
                    // On to the next person still without a spot.
                    const next = list.findIndex((signer, i) => i !== active && !signer.spot);
                    if (next >= 0) setActive(next);
                  }}
                  overlay={(toCss) =>
                    list.map((signer, index) =>
                      signer.spot?.page === page ? (
                        <div
                          key={signer.key}
                          style={toCss(signer.spot)}
                          className={cn(
                            "absolute flex items-center gap-1.5 overflow-hidden rounded-md border border-dashed px-2 text-xs font-semibold",
                            tone(index).spot,
                          )}
                        >
                          <PenLine className="size-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">
                            {t("esign.signsHere", { name: signer.name.split(" ")[0] })}
                          </span>
                          <button
                            type="button"
                            aria-label={t("esign.removeSpot")}
                            className="shrink-0"
                            onClick={(event) => {
                              event.stopPropagation();
                              update(index, { spot: null });
                              setActive(index);
                            }}
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      ) : null,
                    )
                  }
                />
              ) : (
                <RowsSkeleton count={6} />
              )}
            </div>
          </section>

          {/* ------------------------------------------------ who signs */}
          <aside className="space-y-4">
            <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
              <div>
                <h2 className="text-base font-semibold">{t("esign.whoSigns")}</h2>
                <p className="text-sm text-muted-foreground">{t("esign.whoSignsHint")}</p>
              </div>
              <ul className="space-y-2">
                {list.map((signer, index) => (
                  <li
                    key={signer.key}
                    className={cn(
                      "rounded-lg border p-3",
                      index === active ? "border-primary bg-primary/5" : "border-border",
                    )}
                  >
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 text-left"
                      onClick={() => setActive(index)}
                    >
                      <span className={cn("size-2 shrink-0 rounded-full", tone(index).dot)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {signer.name || t("esign.newSigner")}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {signer.email || "—"}
                        </span>
                      </span>
                      {signer.spot ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-success">
                          <Check className="size-3.5" />
                          {t("esign.onPage", { page: signer.spot.page })}
                        </span>
                      ) : (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {t("esign.notPlaced")}
                        </span>
                      )}
                    </button>
                    {index === active ? (
                      <div className="mt-3 space-y-2">
                        <Input
                          aria-label={t("esign.signerName")}
                          placeholder={t("esign.signerName")}
                          value={signer.name}
                          onChange={(event) => update(index, { name: event.target.value })}
                        />
                        <Input
                          type="email"
                          aria-label={t("esign.signerEmail")}
                          placeholder={t("esign.signerEmail")}
                          value={signer.email}
                          onChange={(event) => update(index, { email: event.target.value })}
                        />
                        <label className="flex min-h-9 items-center gap-2 text-sm">
                          <Checkbox
                            checked={signer.required}
                            onCheckedChange={(checked) =>
                              update(index, { required: checked === true })
                            }
                          />
                          {t("esign.mustSign")}
                        </label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSigners(list.filter((_, i) => i !== index));
                            setActive(0);
                          }}
                        >
                          <Trash2 className="size-4" />
                          {t("esign.removeSigner")}
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSigners([
                    ...list,
                    {
                      key: crypto.randomUUID(),
                      name: "",
                      email: "",
                      tenantId: null,
                      required: true,
                      spot: null,
                    },
                  ]);
                  setActive(list.length);
                }}
              >
                <Plus className="size-4" />
                {t("esign.addSigner")}
              </Button>
            </section>

            <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
              <Field label={t("esign.documentName")} htmlFor="esign-title">
                <Input
                  id="esign-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Field>
              <Field label={t("esign.note")} htmlFor="esign-note">
                <Textarea
                  id="esign-note"
                  rows={4}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </Field>
            </section>

            <ul className="space-y-3 px-1 text-sm text-muted-foreground">
              {(
                [
                  [PenLine, "esign.info.officeSigns"],
                  [Mail, "esign.info.email"],
                  [Clock, "esign.info.expiry"],
                  [FileText, "esign.info.final"],
                ] as const
              ).map(([Icon, key]) => (
                <li key={key} className="flex gap-3">
                  <Icon className="mt-0.5 size-4 shrink-0" />
                  <span>{t(key)}</span>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </QueryState>
      <LinksDialog
        links={links}
        onClose={() => {
          setLinks([]);
          backToDocuments();
        }}
      />
    </div>
  );
}
