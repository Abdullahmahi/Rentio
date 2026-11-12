import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Container } from "@/components/marketing/ui/container";
import { SectionHeading } from "@/components/marketing/section-heading";
import { clientProof, SPANISH_STRINGS } from "@/lib/marketing";

/**
 * Text-only proof (audit.md §4.4): things a buyer can check on the
 * walkthrough. No testimonials, no logos, no production figures, no counts of
 * security tests, and no mock tables of invented tenants.
 */
export function Proof() {
  const { t, i18n } = useTranslation("marketing");
  const lines = [
    clientProof(i18n.language),
    t("proof.items.strings", { n: SPANISH_STRINGS }),
    t("proof.items.isolation"),
    t("proof.items.texas"),
  ];

  return (
    <section id="proof" className="w-full scroll-mt-20 py-16 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow={t("proof.eyebrow")}
          lead={t("proof.headingLead")}
          emphasis={t("proof.headingEmphasis")}
          subhead={t("proof.subhead")}
        />
        <ul className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
          {lines.map((line, index) => (
            <li key={line}>
              <Container delay={0.1 + index * 0.08}>
                <Card className="h-full py-5">
                  <CardContent className="flex gap-3 px-5">
                    <Check className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                    <p className="text-base font-medium">{line}</p>
                  </CardContent>
                </Card>
              </Container>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
