import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { BookingLink } from "@/components/marketing/booking-link";
import { Container } from "@/components/marketing/ui/container";
import { SectionHeading } from "@/components/marketing/section-heading";
import { ItemStatusBadge, type ItemStatus } from "@/components/marketing/item-status";
import { PRICE_VARS } from "@/lib/marketing";

type Item = {
  key: string;
  status: ItemStatus;
  /** Has a researched market price (audit.md §6.3). */
  market?: true;
  /** Shows a qualifying note instead of a plain status (website, welcome kit). */
  note?: true;
};

/**
 * "live" = software in Rentio today; "done" = a service our team sets up for
 * the client. The "money" group is on the roadmap (owner decision 2026-10-28:
 * sell it, build it when a client signs), so it is "done", never "live".
 */
const GROUPS: { key: string; items: Item[] }[] = [
  {
    key: "software",
    items: [
      { key: "modules", status: "live" },
      { key: "clocks", status: "live" },
      { key: "pdfs", status: "live" },
      { key: "payments", status: "live" },
      { key: "portal", status: "live" },
    ],
  },
  {
    key: "money",
    items: [
      { key: "onlineRent", status: "done" },
      { key: "ownerPortal", status: "done" },
      { key: "ownerStatements", status: "done" },
      { key: "quickbooks", status: "done" },
    ],
  },
  {
    key: "ai",
    items: [
      { key: "voice", status: "done", market: true },
      { key: "intake", status: "done" },
      { key: "textback", status: "done", market: true },
      { key: "reminders", status: "done" },
    ],
  },
  {
    key: "people",
    items: [
      { key: "migration", status: "done", market: true },
      { key: "manager", status: "done", market: true },
      { key: "training", status: "done" },
      { key: "audit", status: "done" },
      { key: "website", status: "done", market: true, note: true },
      { key: "welcome", status: "done", note: true },
    ],
  },
];

/**
 * `cta` replaces the booking button in the price card. `/vsl` passes `null`:
 * the visitor has already booked, so the card ends on the guarantee instead.
 */
export function Offer({ cta }: { cta?: ReactNode | undefined } = {}) {
  const { t } = useTranslation("marketing");
  return (
    <section id="offer" className="w-full scroll-mt-20 py-16 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow={t("offer.eyebrow")}
          lead={t("offer.headingLead")}
          emphasis={t("offer.headingEmphasis")}
          subhead={t("offer.subhead")}
        />

        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
          <Container>
            <Card className="py-6">
              <CardContent className="space-y-6 px-6">
                {GROUPS.map((group, groupIndex) => (
                  <div key={group.key}>
                    {groupIndex > 0 ? <Separator className="mb-6" /> : null}
                    <Badge variant="secondary">{t(`offer.groups.${group.key}`)}</Badge>
                    <ul className="mt-4 space-y-4">
                      {group.items.map((item) => (
                        <li key={item.key} className="flex gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold">
                                {t(`offer.items.${item.key}.title`)}
                              </p>
                              <ItemStatusBadge status={item.status} />
                            </div>
                            <p className="mt-0.5 text-sm text-muted-foreground">
                              {t(`offer.items.${item.key}.body`)}
                            </p>
                            {item.note ? (
                              <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                                {t(`offer.items.${item.key}.note`)}
                              </p>
                            ) : null}
                          </div>
                          {item.market ? (
                            <p className="hidden w-44 shrink-0 text-right text-xs text-muted-foreground sm:block">
                              {t(`offer.items.${item.key}.market`)}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </CardContent>
            </Card>
          </Container>

          <Container delay={0.15} className="flex flex-col gap-6">
            <Card className="border-primary/40 py-6 shadow-sm">
              <CardContent className="flex flex-col gap-4 px-6">
                <p className="text-sm text-muted-foreground">{t("offer.valueLabel")}</p>
                <p className="font-heading text-4xl font-semibold numeric text-muted-foreground line-through decoration-1">
                  {t("offer.valueFigure")}
                </p>
                <p className="text-xs text-muted-foreground">{t("offer.valueNote")}</p>
                <Separator />
                <p className="text-sm font-medium">{t("offer.priceLabel")}</p>
                <p className="flex items-baseline gap-2">
                  <span className="text-4xl font-semibold numeric">{PRICE_VARS.monthlyPrice}</span>
                  <span className="text-sm text-muted-foreground">{t("offer.priceUnit")}</span>
                </p>
                <p className="text-sm">{t("offer.setup", PRICE_VARS)}</p>
                {cta === undefined ? (
                  <BookingLink size="lg" className="w-full">
                    {t("offer.cta")}
                  </BookingLink>
                ) : (
                  cta
                )}
                <p className="text-xs text-muted-foreground">{t("offer.qualifier", PRICE_VARS)}</p>
              </CardContent>
            </Card>

            <Card className="bg-accent py-5 text-accent-foreground ring-0">
              <CardContent className="flex gap-3 px-5">
                <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
                <div className="space-y-2 text-sm">
                  <p className="font-semibold">{t("offer.guarantee.title")}</p>
                  <p>{t("offer.guarantee.body")}</p>
                  <p>
                    <span className="font-semibold">{t("offer.guarantee.exitTitle")}</span>{" "}
                    {t("offer.guarantee.exit")}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Container>
        </div>
      </div>
    </section>
  );
}
