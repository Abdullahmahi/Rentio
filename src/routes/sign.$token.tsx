import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Clock, Download, FileCheck2, Loader2, Mail, PenLine, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import "@fontsource/caveat/400.css";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PdfPage, usePdf } from "@/components/rentio/pdf-page";
import { RowsSkeleton } from "@/components/rentio/query-state";
import { formatStamp, SIGNATURE_FONT, type Box } from "@/lib/esign";
import i18n, { type AppLanguage } from "@/lib/i18n";
import { pageTitle } from "@/lib/brand";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/sign/$token")({
  head: () => ({
    meta: [
      { title: pageTitle(i18n.t("esign.sign.pageTitle")) },
      // A signing link is a credential: keep it out of search and referrers.
      { name: "robots", content: "noindex" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: SignPage,
});

interface Agreement {
  state: "open" | "signed" | "completed" | "declined" | "expired" | "voided" | "invalid";
  company: string;
  title: string;
  unit: string | null;
  page_count: number;
  signer: {
    name: string;
    email: string;
    locale: string;
    page: number;
    box: Box;
    signed_at: string | null;
    declined_at: string | null;
  };
  others: { name: string; signed: boolean }[];
  pdf_url: string | null;
  signed_pdf_url: string | null;
  error?: string;
}

/** POSTs to the signer's own endpoint. A reply without a state is a failure. */
async function post(token: string, body: unknown) {
  const response = await fetch(`/api/sign/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const next = (await response.json().catch(() => ({}))) as Partial<Agreement>;
  if (!next.state) throw new Error(next.error ?? `HTTP ${response.status}`);
  return next as Agreement;
}

/** A typed name drawn in the bundled cursive face, as the PNG the PDF gets. */
async function typedSignaturePng(text: string, color: string) {
  await document.fonts.load(`64px "${SIGNATURE_FONT}"`);
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 200;
  const context = canvas.getContext("2d")!;
  let size = 110;
  context.font = `${size}px "${SIGNATURE_FONT}"`;
  while (size > 24 && context.measureText(text).width > canvas.width - 40) {
    size -= 4;
    context.font = `${size}px "${SIGNATURE_FONT}"`;
  }
  context.fillStyle = color;
  context.textBaseline = "middle";
  context.fillText(text, 20, canvas.height / 2);
  return canvas.toDataURL("image/png");
}

/**
 * T1–T3: the signer's page. No login: the link is the credential. Works on
 * a 375px phone, every label in both languages, every tap target ≥ 44px.
 */
function SignPage() {
  const { token } = Route.useParams();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const agreement = useQuery({
    queryKey: ["sign", token],
    queryFn: async () => {
      const response = await fetch(`/api/sign/${encodeURIComponent(token)}`);
      return (await response.json()) as Agreement;
    },
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const data = agreement.data;
  const [language, setLanguage] = useState<AppLanguage | null>(null);

  // Their portal language; Spanish when they never chose, like the portal.
  useEffect(() => {
    if (data?.signer && !language) setLanguage(data.signer.locale === "en" ? "en" : "es-MX");
  }, [data, language]);
  useEffect(() => {
    if (language) {
      void i18n.changeLanguage(language);
      document.documentElement.lang = language;
    }
  }, [language]);

  const current: AppLanguage = language ?? (i18n.language === "en" ? "en" : "es-MX");
  const initials = (data?.company ?? "")
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();

  let body;
  if (agreement.isLoading) {
    body = (
      <div className="p-4">
        <RowsSkeleton count={5} />
      </div>
    );
  } else if (agreement.isError) {
    body = (
      <Notice title={t("esign.sign.loadFailedTitle")} body={t("esign.sign.loadFailedBody")}>
        <Button className="h-11" onClick={() => void agreement.refetch()}>
          {t("esign.sign.retry")}
        </Button>
      </Notice>
    );
  } else if (!data || data.state === "invalid") {
    body = <Notice title={t("esign.sign.invalidTitle")} body={t("esign.sign.invalidBody")} />;
  } else if (data.state === "expired") {
    body = (
      <Notice
        title={t("esign.sign.expiredTitle")}
        body={t("esign.sign.expiredBody", { company: data.company })}
      />
    );
  } else if (data.state === "voided") {
    body = (
      <Notice
        title={t("esign.sign.voidedTitle")}
        body={t("esign.sign.voidedBody", { company: data.company })}
      />
    );
  } else if (data.state === "declined") {
    body = data.signer.declined_at ? (
      <Notice
        title={t("esign.sign.youDeclinedTitle")}
        body={t("esign.sign.youDeclinedBody", { company: data.company })}
      />
    ) : (
      <Notice
        title={t("esign.sign.declinedTitle")}
        body={t("esign.sign.declinedBody", { company: data.company })}
      />
    );
  } else if (data.state === "open") {
    body = (
      <ReadAndSign
        token={token}
        agreement={data}
        onDone={(next) => queryClient.setQueryData(["sign", token], next)}
      />
    );
  } else {
    body = <Signed agreement={data} />;
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-20 flex items-center gap-2.5 border-b border-border bg-surface px-4 py-1.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
          {initials || "R"}
        </span>
        <span className="min-w-0 flex-1 truncate text-base font-semibold">
          {data?.company ?? ""}
        </span>
        <button
          type="button"
          lang={current === "en" ? "es" : "en"}
          className="min-h-11 rounded-md px-3 text-sm font-semibold text-muted-foreground hover:text-foreground"
          aria-label={t("actions.changeLanguage")}
          onClick={() => setLanguage(current === "en" ? "es-MX" : "en")}
        >
          {t("esign.sign.otherLanguage")}
        </button>
      </header>
      {body}
    </div>
  );
}

function Notice({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-md space-y-3 px-5 py-10">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-base text-muted-foreground">{body}</p>
      {children}
    </main>
  );
}

/** T1 (read every page, to the end) and T2 (the signature sheet). */
function ReadAndSign({
  token,
  agreement,
  onDone,
}: {
  token: string;
  agreement: Agreement;
  onDone: (next: Agreement) => void;
}) {
  const { t } = useTranslation();
  const { doc, error } = usePdf(agreement.pdf_url);
  const [current, setCurrent] = useState(1);
  const [sheet, setSheet] = useState<"sign" | "decline" | null>(null);
  const [readToEnd, setReadToEnd] = useState(false);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const { signer } = agreement;

  // Which page is on screen ("Page 1 of 6"), and whether they reached the end.
  useEffect(() => {
    if (!doc) return;
    const pages = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting)
            setCurrent(Number((entry.target as HTMLElement).dataset["page"]));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    pageRefs.current.forEach((element) => element && pages.observe(element));
    const end = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setReadToEnd(true);
    });
    if (endRef.current) end.observe(endRef.current);
    return () => {
      pages.disconnect();
      end.disconnect();
    };
  }, [doc]);

  const goToSignature = () => {
    pageRefs.current[signer.page - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setSheet("sign");
  };

  return (
    <>
      <main
        className={cn(
          "mx-auto w-full max-w-2xl flex-1 space-y-4 px-4 pt-5",
          sheet ? "pb-[560px]" : "pb-48",
        )}
      >
        <div className="space-y-1">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent-foreground">
            {agreement.unit
              ? t("esign.sign.eyebrow", { unit: agreement.unit })
              : t("esign.sign.eyebrowNoUnit")}
          </p>
          <h1 className="text-2xl font-semibold">{agreement.title}</h1>
          <p className="text-base text-muted-foreground">
            {t("esign.sign.intro", { company: agreement.company, count: agreement.page_count })}
          </p>
          <p className="text-sm text-muted-foreground">{t("esign.sign.zoomHint")}</p>
        </div>

        {error ? (
          <p className="text-sm text-danger">{t("esign.pdfUnreadable")}</p>
        ) : !doc ? (
          <RowsSkeleton count={6} />
        ) : (
          Array.from({ length: doc.numPages }, (_, index) => index + 1).map((pageNumber) => (
            <div
              key={pageNumber}
              data-page={pageNumber}
              ref={(element) => {
                pageRefs.current[pageNumber - 1] = element;
              }}
              className="scroll-mt-20"
            >
              <PdfPage
                doc={doc}
                pageNumber={pageNumber}
                overlay={
                  pageNumber === signer.page
                    ? (toCss) => (
                        // A marker, not a control: the 52px button below is
                        // what opens the signature sheet.
                        <div
                          aria-hidden
                          style={toCss(signer.box)}
                          className="pointer-events-none absolute flex items-center justify-center gap-1 overflow-hidden rounded-md border-2 border-primary bg-primary/10 px-1 text-xs font-semibold text-primary"
                        >
                          <PenLine className="size-3.5 shrink-0" />
                          <span className="truncate">{t("esign.sign.spot")}</span>
                        </div>
                      )
                    : undefined
                }
              />
            </div>
          ))
        )}
        <div ref={endRef} className="h-px" />
      </main>

      {doc && !sheet ? (
        <span className="numeric pointer-events-none fixed bottom-44 right-4 z-10 rounded-full bg-foreground px-3 py-1.5 text-sm font-semibold text-background">
          {t("esign.pageOf", { page: current, count: doc.numPages })}
        </span>
      ) : null}

      {sheet === "sign" ? (
        <SignatureSheet
          token={token}
          agreement={agreement}
          readToEnd={readToEnd}
          onClose={() => setSheet(null)}
          onDone={onDone}
        />
      ) : sheet === "decline" ? (
        <DeclineSheet
          token={token}
          agreement={agreement}
          onClose={() => setSheet(null)}
          onDone={onDone}
        />
      ) : (
        <footer className="fixed inset-x-0 bottom-0 z-10 space-y-1 border-t border-border bg-surface px-4 pb-4 pt-4">
          <Button className="h-[52px] w-full text-base" disabled={!doc} onClick={goToSignature}>
            <PenLine className="size-4" />
            {t("esign.sign.goToSignature")}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {t("esign.sign.nothingSent", { page: signer.page })}
          </p>
          <Button variant="ghost" className="h-11 w-full" onClick={() => setSheet("decline")}>
            {t("esign.sign.decline")}
          </Button>
        </footer>
      )}
    </>
  );
}

const SHEET =
  "fixed inset-x-0 bottom-0 z-30 mx-auto max-h-[85dvh] max-w-2xl space-y-3.5 overflow-y-auto rounded-t-[20px] bg-surface px-4 pb-7 pt-2.5 shadow-[0_-8px_24px_rgba(18,33,46,0.14)]";

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex justify-center">
        <span className="h-1 w-9 rounded-full bg-border" />
      </div>
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-xl font-semibold">{title}</h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={t("actions.close")}
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>
    </>
  );
}

/** T2. Draw with a finger (pointer events) or type; consent; sign. */
function SignatureSheet({
  token,
  agreement,
  readToEnd,
  onClose,
  onDone,
}: {
  token: string;
  agreement: Agreement;
  readToEnd: boolean;
  onClose: () => void;
  onDone: (next: Agreement) => void;
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const [mode, setMode] = useState<"drawn" | "typed">("drawn");
  const [typed, setTyped] = useState(agreement.signer.name);
  const [hasInk, setHasInk] = useState(false);
  // Unchecked until the signer checks it. Never pre-filled.
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLSpanElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);

  // Size the canvas to its box at device resolution.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (mode !== "drawn" || !canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * ratio);
    canvas.height = Math.floor(rect.height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 2.5;
    context.strokeStyle = getComputedStyle(canvas).color;
    setHasInk(false);
  }, [mode]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const clear = () => {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  };

  const hasSignature = mode === "drawn" ? hasInk : typed.trim().length > 0;
  const ready = consent && hasSignature && readToEnd;

  const submit = async () => {
    if (!ready) return;
    setPending(true);
    setFailed(false);
    try {
      const ink = getComputedStyle(inkRef.current!).color;
      const data =
        mode === "drawn"
          ? canvasRef.current!.toDataURL("image/png")
          : await typedSignaturePng(typed.trim(), ink);
      onDone(
        await post(token, {
          kind: mode,
          data,
          consent: true,
          locale: language === "en" ? "en" : "es-MX",
        }),
      );
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-label={t("esign.sign.yourSignature")} className={SHEET}>
      <SheetHeader title={t("esign.sign.yourSignature")} onClose={onClose} />
      <div className="flex rounded-[9px] bg-muted p-[3px]">
        {(["drawn", "typed"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={mode === option}
            onClick={() => setMode(option)}
            className={cn(
              "h-11 flex-1 rounded-[7px] px-3.5 text-sm",
              mode === option ? "bg-surface font-semibold" : "font-medium text-muted-foreground",
            )}
          >
            {t(option === "drawn" ? "esign.sign.draw" : "esign.sign.type")}
          </button>
        ))}
      </div>

      <div className="flex h-[148px] flex-col justify-end gap-1 rounded-xl border-[1.5px] border-dashed border-border bg-background px-4 pb-1">
        <span ref={inkRef} className="hidden text-foreground" />
        {mode === "drawn" ? (
          <canvas
            ref={canvasRef}
            aria-label={t("esign.sign.drawHint")}
            className="min-h-0 w-full flex-1 touch-none text-foreground"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              last.current = point(event);
            }}
            onPointerMove={(event) => {
              if (!last.current) return;
              const context = event.currentTarget.getContext("2d");
              const next = point(event);
              context?.beginPath();
              context?.moveTo(last.current.x, last.current.y);
              context?.lineTo(next.x, next.y);
              context?.stroke();
              last.current = next;
              setHasInk(true);
            }}
            onPointerUp={() => (last.current = null)}
            onPointerCancel={() => (last.current = null)}
          />
        ) : (
          <Input
            aria-label={t("esign.sign.typeHint")}
            value={typed}
            maxLength={80}
            onChange={(event) => setTyped(event.target.value)}
            style={{ fontFamily: `"${SIGNATURE_FONT}", cursive` }}
            className="h-16 border-0 bg-transparent px-1 text-4xl shadow-none focus-visible:ring-0"
          />
        )}
        <div className="h-px bg-border" />
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {t(mode === "drawn" ? "esign.sign.drawHint" : "esign.sign.typeHint")}
          </span>
          {mode === "drawn" ? (
            <button
              type="button"
              className="min-h-11 px-2 text-sm font-semibold text-primary"
              onClick={clear}
            >
              {t("esign.sign.clear")}
            </button>
          ) : (
            <span className="min-h-11" />
          )}
        </div>
      </div>

      <label htmlFor="esign-consent" className="flex min-h-11 cursor-pointer items-start gap-3">
        <Checkbox
          id="esign-consent"
          className="mt-0.5 size-[22px]"
          checked={consent}
          onCheckedChange={(checked) => setConsent(checked === true)}
        />
        <span className="text-sm leading-5">{t("esign.consent.short")}</span>
      </label>
      <details className="text-sm text-muted-foreground">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium text-primary">
          {t("esign.consent.more")}
        </summary>
        <ul className="mt-1 list-disc space-y-1.5 pl-5 leading-5">
          {(["scope", "paper", "withdraw", "system", "email", "effect"] as const).map((key) => (
            <li key={key}>{t(`esign.consent.items.${key}`, { company: agreement.company })}</li>
          ))}
        </ul>
      </details>

      {failed ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {t("esign.sign.failed")}
        </p>
      ) : null}

      <Button
        className="h-[52px] w-full text-base"
        disabled={!ready || pending}
        onClick={() => void submit()}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {t(failed ? "esign.sign.retry" : "esign.sign.finish")}
      </Button>
      {!readToEnd ? (
        <p className="text-center text-sm text-muted-foreground">{t("esign.sign.readToEnd")}</p>
      ) : null}
    </section>
  );
}

/** The signer says no, optionally why. Staff are told; the request closes. */
function DeclineSheet({
  token,
  agreement,
  onClose,
  onDone,
}: {
  token: string;
  agreement: Agreement;
  onClose: () => void;
  onDone: (next: Agreement) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async () => {
    setPending(true);
    setFailed(false);
    try {
      onDone(await post(token, { action: "decline", reason: reason.trim() }));
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-label={t("esign.sign.declineTitle")} className={SHEET}>
      <SheetHeader title={t("esign.sign.declineTitle")} onClose={onClose} />
      <p className="text-base text-muted-foreground">
        {t("esign.sign.declineBody", { company: agreement.company })}
      </p>
      <label htmlFor="esign-decline" className="block text-sm font-medium">
        {t("esign.sign.declineReason")}
      </label>
      <Textarea
        id="esign-decline"
        rows={3}
        maxLength={500}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      {failed ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {t("esign.sign.failed")}
        </p>
      ) : null}
      <Button
        variant="destructive"
        className="h-[52px] w-full text-base"
        disabled={pending}
        onClick={() => void submit()}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {t(failed ? "esign.sign.retry" : "esign.sign.declineConfirm")}
      </Button>
      <Button variant="ghost" className="h-11 w-full" onClick={onClose}>
        {t("esign.sign.declineBack")}
      </Button>
    </section>
  );
}

/** T3. */
function Signed({ agreement }: { agreement: Agreement }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const waiting = agreement.others.filter((person) => !person.signed).map((person) => person.name);
  const firstName = agreement.signer.name.split(" ")[0] ?? agreement.signer.name;
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 pb-8 pt-9">
      <span className="flex size-[52px] items-center justify-center rounded-full bg-success text-primary-foreground">
        <Check className="size-6" strokeWidth={3} />
      </span>
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{t("esign.sign.doneTitle")}</h1>
        <p className="text-base text-muted-foreground">
          {t("esign.sign.doneBody", {
            name: firstName,
            company: agreement.company,
            title: agreement.title,
          })}
        </p>
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-3 p-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-success/10 text-success">
            <FileCheck2 className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold">{agreement.title}</p>
            {agreement.signer.signed_at ? (
              <p className="text-sm text-muted-foreground">
                {t("esign.signerSigned", {
                  date: formatStamp(agreement.signer.signed_at, language),
                })}
              </p>
            ) : null}
          </div>
        </div>
        {agreement.signed_pdf_url ? (
          <a
            href={agreement.signed_pdf_url}
            className="flex min-h-12 items-center justify-center gap-2 border-t border-border font-semibold text-primary"
          >
            <Download className="size-4" />
            {t("esign.sign.download")}
          </a>
        ) : null}
      </section>

      <ul className="space-y-4 text-base">
        <li className="flex gap-3">
          <Mail className="mt-1 size-4 shrink-0 text-muted-foreground" />
          <span>{t("esign.sign.emailCopy", { email: agreement.signer.email })}</span>
        </li>
        <li className="flex gap-3">
          <Clock className="mt-1 size-4 shrink-0 text-muted-foreground" />
          <span>
            {waiting.length
              ? t("esign.sign.waiting", { names: waiting.join(", "), count: waiting.length })
              : t("esign.sign.everyoneSigned")}
          </span>
        </li>
      </ul>

      <Button asChild className="mt-auto h-[52px] w-full text-base">
        <a href="/portal">{t("esign.sign.portal")}</a>
      </Button>
    </main>
  );
}
