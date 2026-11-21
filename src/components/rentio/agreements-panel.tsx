import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Circle, Copy, FileCheck2, FileText, PenLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/rentio/confirm-dialog";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { StatusBadge } from "@/components/rentio/status-badge";
import { db, errorText, invokeFn } from "@/lib/db";
import { agreementStatus, formatStamp, STATUS_VARIANT } from "@/lib/esign";
import { formatDate } from "@/lib/format";
import { openSigned } from "@/lib/storage";
import { cn } from "@/lib/utils";

export const agreementsKey = (leaseId: string) => ["signature-requests", leaseId] as const;

/** Signer columns staff may read (token_hash is not granted). */
const SIGNER_COLUMNS = "id, request_id, name, email, position, emailed_at, viewed_at, signed_at";

export interface SentLink {
  name: string;
  email: string;
  link: string;
  emailed: boolean;
}

/** Links that did not go out by email (no email provider, or it failed). */
export function LinksDialog({ links, onClose }: { links: SentLink[]; onClose: () => void }) {
  const { t } = useTranslation();
  const absolute = (link: string) =>
    link.startsWith("/") ? `${window.location.origin}${link}` : link;
  return (
    <Dialog open={links.length > 0} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("esign.links.title")}</DialogTitle>
          <DialogDescription>{t("esign.links.description")}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-3">
          {links.map((item) => (
            <li key={item.link} className="space-y-1.5">
              <p className="text-sm font-medium">
                {item.name}{" "}
                <span className="font-normal text-muted-foreground">· {item.email}</span>
              </p>
              <div className="flex gap-2">
                <Input readOnly value={absolute(item.link)} onFocus={(e) => e.target.select()} />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={t("esign.links.copy")}
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(absolute(item.link))
                      .then(() => toast.success(t("esign.links.copied")))
                  }
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** S2: the agreements on a lease and where each signer is. */
export function AgreementsPanel({ leaseId }: { leaseId: string }) {
  const { t, i18n } = useTranslation();
  const [links, setLinks] = useState<SentLink[]>([]);

  const agreements = useQuery({
    queryKey: agreementsKey(leaseId),
    queryFn: async () => {
      const { data: requests, error } = await db
        .from("signature_requests")
        .select("*")
        .eq("lease_id", leaseId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const ids = requests.map((row) => row.id);
      const creators = [
        ...new Set(requests.flatMap((row) => (row.created_by ? [row.created_by] : []))),
      ];
      const [signers, profiles] = await Promise.all([
        ids.length
          ? db
              .from("signature_signers")
              .select(SIGNER_COLUMNS)
              .in("request_id", ids)
              .order("position")
          : Promise.resolve({ data: [], error: null }),
        creators.length
          ? db.from("profiles").select("id, full_name").in("id", creators)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (signers.error) throw signers.error;
      return requests.map((request) => ({
        request,
        signers: (signers.data ?? []).filter((row) => row.request_id === request.id),
        sender: profiles.data?.find((row) => row.id === request.created_by)?.full_name ?? null,
      }));
    },
  });

  const act = async (body: Record<string, string>) => {
    const { data, error } = await invokeFn<{ emailed?: boolean; link?: string }>("esign-manage", {
      body,
    });
    if (error) throw error;
    void agreements.refetch();
    return data;
  };

  const remind = async (signer: { id: string; name: string; email: string }) => {
    try {
      const data = await act({ action: "resend", signer_id: signer.id });
      if (data?.emailed) toast.success(t("esign.reminderSent", { name: signer.name }));
      else if (data?.link) setLinks([{ ...signer, link: data.link, emailed: false }]);
    } catch (caught) {
      toast.error(errorText(t, caught));
    }
  };

  const voidRequest = async (requestId: string) => {
    try {
      await act({ action: "void", request_id: requestId });
      toast.success(t("esign.voided"));
    } catch (caught) {
      toast.error(errorText(t, caught));
    }
  };

  const open = (path: string) =>
    void openSigned("contracts", path).catch((caught) => toast.error(errorText(t, caught)));

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-subtle">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">{t("esign.agreements")}</h2>
          <p className="text-sm text-muted-foreground">{t("esign.agreementsHint")}</p>
        </div>
        <Button asChild>
          <Link to="/app/contracts/$id/sign" params={{ id: leaseId }}>
            <PenLine className="size-4" />
            {t("esign.send")}
          </Link>
        </Button>
      </header>

      <QueryState
        isLoading={agreements.isLoading}
        error={agreements.error}
        isEmpty={(agreements.data?.length ?? 0) === 0}
        onRetry={() => void agreements.refetch()}
        skeleton={<RowsSkeleton count={2} />}
        empty={<p className="px-5 py-4 text-sm text-muted-foreground">{t("esign.none")}</p>}
      >
        <ul className="divide-y divide-border">
          {agreements.data?.map(({ request, signers, sender }) => {
            const status = agreementStatus(request, signers);
            const signedCount = signers.filter((signer) => signer.signed_at).length;
            const closed = status === "signed" || status === "voided";
            return (
              <li key={request.id} className="flex gap-3 px-5 py-4">
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-md",
                    status === "signed" ? "bg-success/10 text-success" : "bg-muted text-primary",
                  )}
                >
                  {status === "signed" ? (
                    <FileCheck2 className="size-4" />
                  ) : (
                    <FileText className="size-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{request.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {status === "signed" && request.completed_at
                          ? t("esign.metaSigned", {
                              count: request.page_count,
                              date: formatStamp(request.completed_at, i18n.language),
                            })
                          : t("esign.metaSent", {
                              count: request.page_count,
                              date: formatDate(request.created_at),
                              name: sender ?? "—",
                              end: formatDate(request.expires_at),
                            })}
                      </p>
                    </div>
                    <StatusBadge
                      variant={STATUS_VARIANT[status]}
                      status={t(`esign.status.${status}`, {
                        signed: signedCount,
                        total: signers.length,
                      })}
                    />
                    {status === "signed" && request.signed_path ? (
                      <Button
                        variant="link"
                        className="h-auto p-0"
                        onClick={() => open(request.signed_path!)}
                      >
                        {t("actions.download")}
                      </Button>
                    ) : (
                      <Button
                        variant="link"
                        className="h-auto p-0"
                        onClick={() => open(request.original_path)}
                      >
                        {t("esign.viewPdf")}
                      </Button>
                    )}
                  </div>

                  {!closed ? (
                    <ul className="space-y-1.5">
                      {signers.map((signer) => (
                        <li
                          key={signer.id}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                        >
                          {signer.signed_at ? (
                            <CheckCircle2 className="size-4 shrink-0 text-success" />
                          ) : (
                            <Circle className="size-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="w-40 truncate font-medium">{signer.name}</span>
                          <span className="min-w-0 flex-1 text-muted-foreground">
                            {signer.signed_at
                              ? t("esign.signerSigned", {
                                  date: formatStamp(signer.signed_at, i18n.language),
                                })
                              : signer.viewed_at
                                ? t("esign.signerViewed", {
                                    date: formatStamp(signer.viewed_at, i18n.language),
                                  })
                                : t("esign.signerNotOpened")}
                          </span>
                          {!signer.signed_at ? (
                            <Button
                              variant="link"
                              className="h-auto p-0"
                              onClick={() => void remind(signer)}
                            >
                              {t("esign.remind")}
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {!closed ? (
                    <ConfirmDialog
                      triggerLabel={t("esign.void")}
                      triggerVariant="ghost"
                      title={t("esign.voidTitle")}
                      description={t("esign.voidDescription")}
                      confirmLabel={t("esign.void")}
                      destructive
                      onConfirm={() => void voidRequest(request.id)}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </QueryState>
      <LinksDialog links={links} onClose={() => setLinks([])} />
    </section>
  );
}
