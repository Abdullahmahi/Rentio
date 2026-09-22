import {
  CalendarCheck,
  Inbox,
  Languages,
  Receipt,
  Scale,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Container } from "@/components/marketing/ui/container";
import { MagicCard } from "@/components/marketing/ui/magic-card";

/**
 * Ported from Vetra's `features.tsx` — a MagicCard grid fed from a constant.
 *
 * The order is the argument and is not arbitrary: the portal the tenant reads
 * comes first because it is the differentiator, and the monthly rent cycle
 * comes last because every competitor claims it.
 *
 * Vetra gave each card an image. Six product screenshots would be six more
 * chances to leak real data for no extra argument, so the cards carry an icon
 * and a sentence instead.
 */
const FEATURES: { key: string; icon: LucideIcon }[] = [
  { key: "portal", icon: Languages },
  { key: "queue", icon: Inbox },
  { key: "payments", icon: Receipt },
  { key: "maintenance", icon: Wrench },
  { key: "compliance", icon: Scale },
  { key: "cycle", icon: CalendarCheck },
];

export function Features() {
  const { t } = useTranslation("marketing");

  return (
    <section
      id="what-it-does"
      className="relative flex w-full scroll-mt-20 flex-col items-center justify-center py-16 lg:py-24"
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <Container>
          <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
            <h2 className="text-balance font-heading text-2xl font-medium !leading-snug md:text-4xl lg:text-5xl">
              {t("features.headingLead")}{" "}
              <span className="font-subheading italic">{t("features.headingEmphasis")}</span>
            </h2>
            <p className="mt-5 text-balance text-base text-muted-foreground md:text-lg">
              {t("features.subhead")}
            </p>
          </div>
        </Container>

        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <Container
              key={feature.key}
              delay={0.1 + index * 0.1}
              className="rounded-2xl border border-border/60 bg-card transition-colors hover:border-border lg:rounded-3xl"
            >
              <MagicCard className="p-5 lg:rounded-3xl lg:p-6">
                <h3 className="flex items-center gap-2.5 text-base font-semibold">
                  <feature.icon className="size-5 shrink-0 text-primary" aria-hidden />
                  {t(`features.items.${feature.key}.title`)}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {t(`features.items.${feature.key}.body`)}
                </p>
              </MagicCard>
            </Container>
          ))}
        </div>
      </div>
    </section>
  );
}
