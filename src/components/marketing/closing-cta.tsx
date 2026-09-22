import { useTranslation } from "react-i18next";
import { Container } from "@/components/marketing/ui/container";
import { Particles } from "@/components/marketing/ui/particles";
import { BookingLink } from "@/components/marketing/booking-link";

/**
 * Ported from Vetra's `cta.tsx`: a particle field, a heading, a paragraph and
 * a single button. The shape is kept exactly — in particular there is no form.
 *
 * Cal.com collects the name, the email and the time. This site stores nothing:
 * no table, no policy, no migration, no notification mail.
 */
export function ClosingCta() {
  const { t } = useTranslation("marketing");

  return (
    <section className="relative isolate w-full overflow-hidden py-20 lg:py-28">
      <Particles className="absolute inset-0 -z-10" quantity={80} color="var(--primary)" />
      <div className="absolute inset-0 -bottom-[12.5%] -z-20 mx-auto h-1/2 w-3/4 rounded-full bg-primary/20 blur-[8rem]" />

      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <Container>
          <h2 className="text-balance font-heading text-3xl font-medium !leading-snug md:text-4xl lg:text-5xl">
            {t("cta.headingLead")}{" "}
            <span className="font-subheading italic">{t("cta.headingEmphasis")}</span>
          </h2>
        </Container>
        <Container delay={0.1}>
          <p className="mx-auto mt-5 max-w-xl text-balance text-base text-muted-foreground lg:text-lg">
            {t("cta.body")}
          </p>
        </Container>
        <Container delay={0.2}>
          <div className="mt-8 flex flex-col items-center gap-3">
            <BookingLink size="lg">{t("cta.button")}</BookingLink>
            <p className="text-sm text-muted-foreground">{t("cta.note")}</p>
          </div>
        </Container>
      </div>
    </section>
  );
}
