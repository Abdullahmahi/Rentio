import { Clock3, DoorClosed, FileWarning, Scale, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Container } from "@/components/marketing/ui/container";
import { Ripple } from "@/components/marketing/ui/ripple";

/**
 * The second differentiator.
 *
 * Deliberately NOT a port of Vetra's `integration.tsx`. That section is a
 * radial orbit — a centred logo with six icons pinned at fixed pixel offsets
 * over a full-viewport Ripple. Statute citations do not fit in circular icon
 * wells, and five items across six fixed positions leaves a visible hole. The
 * Ripple background is kept, because a wall of statute numbers benefits from
 * something behind it; the orbit is replaced with a plain grid.
 *
 * Every verb here is deliberate. The software tracks, warns, holds and
 * generates. It does not "keep you compliant" — that is a promise no software
 * can keep, and the closing line says so outright.
 */
const OBLIGATIONS = [
  { key: "lateFee", icon: Scale },
  { key: "deposit", icon: Clock3 },
  { key: "repair", icon: Wrench },
  { key: "rekey", icon: DoorClosed },
  { key: "notice", icon: FileWarning },
] as const;

export function Compliance() {
  const { t } = useTranslation("marketing");

  return (
    <section
      id="compliance"
      className="relative isolate flex w-full scroll-mt-20 flex-col items-center justify-center overflow-hidden py-16 lg:py-24"
    >
      <Ripple className="-z-10 opacity-60" />

      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <Container>
          <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              {t("compliance.eyebrow")}
            </p>
            <h2 className="mt-3 text-balance font-heading text-2xl font-medium !leading-snug md:text-4xl lg:text-5xl">
              {t("compliance.headingLead")}{" "}
              <span className="font-subheading italic">{t("compliance.headingEmphasis")}</span>
            </h2>
            <p className="mt-5 text-balance text-base text-muted-foreground md:text-lg">
              {t("compliance.subhead")}
            </p>
          </div>
        </Container>

        <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {OBLIGATIONS.map((item, index) => (
            <Container
              key={item.key}
              delay={0.1 + index * 0.08}
              className="rounded-2xl border border-border/60 bg-surface/80 p-5 backdrop-blur-sm transition-colors hover:border-border"
            >
              <div className="flex items-start justify-between gap-3">
                <item.icon className="size-5 shrink-0 text-primary" aria-hidden />
                {/* The citation is a bordered pill, the same form the app uses
                    for a statutory clock — a legal fact, not a feature badge. */}
                <span className="numeric inline-flex h-6 shrink-0 items-center rounded-md border border-border px-2 text-xs font-semibold text-muted-foreground">
                  {t(`compliance.items.${item.key}.cite`)}
                </span>
              </div>
              <h3 className="mt-3 text-base font-semibold">
                {t(`compliance.items.${item.key}.title`)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t(`compliance.items.${item.key}.body`)}
              </p>
            </Container>
          ))}
        </div>

        <Container delay={0.5}>
          <p className="mx-auto mt-8 max-w-2xl text-balance text-center text-sm text-muted-foreground">
            {t("compliance.disclaimer")}
          </p>
        </Container>
      </div>
    </section>
  );
}
