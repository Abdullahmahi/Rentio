import { useTranslation } from "react-i18next";
import { Container } from "@/components/marketing/ui/container";
import portalEn from "@/assets/marketing/portal-en.png";
import portalEs from "@/assets/marketing/portal-es.png";

/**
 * The lead differentiator.
 *
 * Deliberately NOT a port of Vetra's `lang-support.tsx`, which renders a long
 * list of language names and is laid out for about sixty entries. Two entries
 * in that component reads as a mistake. This is a purpose-built two-column
 * layout whose whole job is to show the same screen twice.
 *
 * The image does the arguing. Both shots are the real portal against the demo
 * seed, captured at the same viewport, so the claim "every screen, both
 * languages" is visible rather than asserted.
 */
export function Bilingual() {
  const { t } = useTranslation("marketing");

  return (
    <section
      id="bilingual"
      className="relative flex w-full scroll-mt-20 flex-col items-center justify-center py-16 lg:py-24"
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <Container>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              {t("bilingual.eyebrow")}
            </p>
            <h2 className="mt-3 text-balance font-heading text-2xl font-medium !leading-snug md:text-4xl">
              {t("bilingual.headingLead")}{" "}
              <span className="font-subheading italic">{t("bilingual.headingEmphasis")}</span>
            </h2>
            <p className="mt-5 text-base leading-relaxed text-muted-foreground">
              {t("bilingual.body")}
            </p>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              {t("bilingual.argument")}
            </p>

            <div className="mt-6 flex items-baseline gap-3 rounded-lg border border-border bg-surface px-4 py-3">
              <span className="numeric text-3xl font-semibold text-primary">983</span>
              <span className="text-sm text-muted-foreground">{t("bilingual.parityLabel")}</span>
            </div>
          </Container>

          <Container delay={0.15}>
            <figure className="m-0">
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                {[
                  { src: portalEn, caption: t("bilingual.captionEn") },
                  { src: portalEs, caption: t("bilingual.captionEs") },
                ].map((shot) => (
                  <div key={shot.caption} className="min-w-0">
                    <div className="overflow-hidden rounded-xl border border-border bg-background">
                      <img
                        src={shot.src}
                        alt=""
                        width={390}
                        height={530}
                        loading="lazy"
                        className="block h-auto w-full"
                      />
                    </div>
                    <p className="mt-2 text-center text-xs font-medium text-muted-foreground">
                      {shot.caption}
                    </p>
                  </div>
                ))}
              </div>
              {/* The two images are decorative on their own; the pair is what
                  carries meaning, so the caption describes the pair. */}
              <figcaption className="sr-only">{t("bilingual.imageAlt")}</figcaption>
            </figure>
          </Container>
        </div>
      </div>
    </section>
  );
}
