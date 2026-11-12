import { useTranslation } from "react-i18next";
import { Container } from "@/components/marketing/ui/container";
import { SectionHeading } from "@/components/marketing/section-heading";
import { BookingLink } from "@/components/marketing/booking-link";
import { AUDIT_BOOKING_URL } from "@/lib/marketing";

/**
 * The lead magnet (audit.md §5.3): a free 15-minute call where the founder
 * runs supabase/audits/late_fee_audit.sql on the visitor's export. There is
 * deliberately no upload form: the file never touches this site.
 */
export function LateFeeAudit() {
  const { t } = useTranslation("marketing");
  return (
    <section id="audit" className="w-full scroll-mt-20 bg-muted/50 py-16 lg:py-24">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
        <SectionHeading
          eyebrow={t("audit.eyebrow")}
          lead={t("audit.headingLead")}
          emphasis={t("audit.headingEmphasis")}
          subhead={t("audit.body")}
        />
        <Container delay={0.1}>
          <div className="mt-8 flex flex-col items-center gap-3 text-center">
            <BookingLink size="lg" href={AUDIT_BOOKING_URL}>
              {t("audit.button")}
            </BookingLink>
            <p className="text-xs text-muted-foreground">{t("audit.fineprint")}</p>
          </div>
        </Container>
      </div>
    </section>
  );
}
