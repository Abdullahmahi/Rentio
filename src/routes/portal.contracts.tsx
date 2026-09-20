import { createFileRoute } from "@tanstack/react-router";
import { Download, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/rentio/empty-state";
import { MoneyText } from "@/components/rentio/money-text";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { LeaseStatusBadge } from "@/components/rentio/status";
import { formatDate } from "@/lib/format";
import { useMyPortal } from "@/lib/queries";
import { describeError } from "@/lib/supabase";
import { openSigned } from "@/lib/storage";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/portal/contracts")({
  head: () => ({ meta: [{ title: `${i18n.t("pages.contracts.title")} — Rentio` }] }),
  component: PortalContract,
});

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 border-b border-border py-3 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium">{children}</dd>
    </div>
  );
}

function PortalContract() {
  const { t } = useTranslation();
  const portal = useMyPortal();
  const lease = portal.data?.lease;
  const details = portal.data?.details;

  const address = [
    details?.street,
    details?.address_line_2,
    details?.city,
    details?.state,
    details?.postal_code,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-5">
      <PageHeader title={t("pages.contracts.title")} description={t("portal.contractHint")} />

      <QueryState
        isLoading={portal.isLoading}
        error={portal.error}
        isEmpty={!lease && !portal.isLoading}
        onRetry={() => void portal.refetch()}
        skeleton={<RowsSkeleton count={5} />}
        empty={
          <EmptyState
            icon={FileText}
            message={t("portal.noLeaseTitle")}
            description={t("portal.noLeaseDescription")}
          />
        }
      >
        {lease ? (
          <>
            <section className="rounded-lg border border-border bg-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold">
                  {t("units.columns.unit")} {details?.unit_number ?? "—"}
                </h2>
                <LeaseStatusBadge value={lease.status} />
              </div>
              {details?.property_name ? (
                <p className="mt-1 text-sm text-muted-foreground">{details.property_name}</p>
              ) : null}
              {address ? <p className="text-sm text-muted-foreground">{address}</p> : null}

              <dl className="mt-4">
                <Row label={t("contracts.columns.start")}>
                  <span className="numeric">{formatDate(lease.start_date)}</span>
                </Row>
                <Row label={t("contracts.columns.end")}>
                  <span className="numeric">{formatDate(lease.end_date)}</span>
                </Row>
                <Row label={t("contracts.fields.rent")}>
                  <MoneyText value={Number(lease.rent_amount)} />
                </Row>
                <Row label={t("contracts.fields.dueDay")}>{lease.rent_due_day}</Row>
                <Row label={t("contracts.fields.deposit")}>
                  <MoneyText value={Number(lease.deposit_amount)} />
                </Row>
                <Row label={t("nav.parking")}>
                  {(portal.data?.parking.length ?? 0) > 0 ? (
                    portal.data?.parking.map((space) => space.label).join(", ")
                  ) : (
                    <span className="text-muted-foreground">{t("units.noParking")}</span>
                  )}
                </Row>
              </dl>
            </section>

            <Button
              variant="outline"
              className="h-12 w-full"
              disabled={!lease.contract_url}
              onClick={() => {
                if (!lease.contract_url) return;
                void openSigned("contracts", lease.contract_url).catch((caught) =>
                  toast.error(t(describeError(caught))),
                );
              }}
            >
              <Download className="size-4" />
              {t("portal.downloadContract")}
            </Button>
            {!lease.contract_url ? (
              <p className="text-center text-xs text-muted-foreground">
                {t("portal.noContractFile")}
              </p>
            ) : null}
          </>
        ) : null}
      </QueryState>
    </div>
  );
}
