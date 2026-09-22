import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/marketing/ui/container";
import { OrbitingCircles } from "@/components/marketing/ui/orbiting-circles";
import { OrbitDot, OrbitRing } from "@/components/marketing/ui/icons";
import { BookingLink } from "@/components/marketing/booking-link";
import portalEsHero from "@/assets/marketing/portal-es-hero.png";

/**
 * Ported from Vetra's `hero.tsx`.
 *
 * Two changes of substance. Vetra has one call to action; this needs two, so
 * the secondary scrolls to the next section rather than leaving the page. And
 * the product image is the TENANT portal in Spanish, not the internal
 * dashboard — that image is the argument the headline is making, and a
 * screenshot of an admin dashboard would undercut it.
 */
export function Hero() {
  const { t } = useTranslation("marketing");

  return (
    <section className="relative isolate flex w-full flex-col items-center justify-center py-16 lg:py-24">
      {/* Mobile gets a single soft glow instead of the orbit rings. */}
      <div className="absolute left-1/2 top-0 -z-10 size-40 -translate-x-1/2 rounded-full bg-primary/40 blur-[10rem] lg:hidden" />

      <div className="relative flex flex-col items-center justify-center gap-y-8">
        <Container className="absolute inset-0 top-0 -z-10 mb-auto hidden min-h-screen w-full flex-col items-center justify-center lg:flex">
          <OrbitingCircles speed={0.5} radius={300}>
            <OrbitRing className="size-4 text-foreground/70" />
            <OrbitDot className="size-1 text-foreground/80" />
          </OrbitingCircles>
          <OrbitingCircles speed={0.25} radius={400}>
            <OrbitDot className="size-1 text-foreground/50" />
            <OrbitRing className="size-4 text-foreground/60" />
            <OrbitDot className="size-1 text-foreground/90" />
          </OrbitingCircles>
          <OrbitingCircles speed={0.1} radius={500}>
            <OrbitDot className="size-1 text-foreground/50" />
            <OrbitDot className="size-1 text-foreground/90" />
            <OrbitRing className="size-4 text-foreground/60" />
            <OrbitDot className="size-1 text-foreground/90" />
          </OrbitingCircles>
        </Container>

        <div className="flex flex-col items-center justify-center gap-y-4 px-4 text-center sm:px-6">
          {/* The spinning-border pill. Its two animations are the flip/rotate
              pair ported in prompt 33. */}
          <Container className="relative flex justify-center overflow-hidden">
            {/* The ring is `bg-border`; the spark is a conic gradient rotating
                over it, and `backdrop` covers the middle so only a travelling
                highlight on the edge shows. Vetra got the same effect from a
                1000px inset shadow, which only works on a dark page. */}
            <span className="relative inline-grid overflow-hidden rounded-full bg-border p-px">
              <span
                aria-hidden
                className="absolute inset-0 h-full w-full animate-flip overflow-hidden rounded-full [mask:linear-gradient(white,_transparent_70%)] before:absolute before:aspect-square before:w-[200%] before:rotate-[-90deg] before:animate-rotate before:bg-[conic-gradient(from_0deg,transparent_0_300deg,var(--primary)_360deg)] before:content-[''] before:[inset:0_auto_auto_50%] before:[translate:-50%_-15%]"
              />
              <span className="relative z-10 flex items-center rounded-full bg-background px-4 py-1.5 text-sm text-muted-foreground">
                {t("hero.eyebrow")}
              </span>
            </span>
          </Container>

          <Container delay={0.15}>
            <h1 className="mx-auto max-w-4xl text-balance text-4xl font-bold !leading-tight lg:text-7xl">
              {t("hero.headlineLead")}{" "}
              <span className="font-subheading italic">{t("hero.headlineEmphasis")}</span>
            </h1>
          </Container>

          <Container delay={0.2}>
            <p className="mx-auto mt-2 max-w-xl text-balance text-base text-muted-foreground lg:text-lg">
              {t("hero.subhead")}
            </p>
          </Container>

          <Container delay={0.25} className="z-20">
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <BookingLink size="lg">{t("hero.primaryCta")}</BookingLink>
              <Button asChild size="lg" variant="outline" className="group">
                <a href="#what-it-does">
                  {t("hero.secondaryCta")}
                  <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
                </a>
              </Button>
            </div>
          </Container>

          <Container delay={0.3} className="relative">
            <div className="relative mx-auto mt-10 w-fit rounded-xl border border-border p-2 backdrop-blur-lg lg:rounded-[32px]">
              <div className="absolute inset-0 left-1/2 top-[12.5%] -z-10 h-1/4 w-1/2 -translate-x-1/2 -translate-y-1/2 animate-image-glow bg-primary/70 blur-[4rem] lg:w-3/4 lg:blur-[10rem]" />
              <div className="absolute inset-0 left-1/2 top-[-12.5%] -z-20 hidden h-1/4 w-1/4 -translate-x-1/2 -translate-y-1/2 animate-image-glow bg-accent/60 blur-[10rem] lg:block" />

              <div className="overflow-hidden rounded-lg border border-border bg-background lg:rounded-[22px]">
                <img
                  src={portalEsHero}
                  alt={t("hero.imageAlt")}
                  width={390}
                  height={530}
                  loading="eager"
                  className="block h-auto w-[260px] lg:w-[300px]"
                />
              </div>
            </div>
            <div className="absolute inset-x-0 bottom-0 h-1/2 w-full bg-gradient-to-t from-background to-transparent" />
          </Container>
        </div>
      </div>
    </section>
  );
}
