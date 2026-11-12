import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/marketing/ui/container";
import { SectionHeading } from "@/components/marketing/section-heading";
import { PRICE_VARS } from "@/lib/marketing";

/**
 * In the order they come up on calls. The first five (price, switching, fees,
 * contract, AI) are the deal-killers and are what the home page shows; /faq
 * shows them all.
 */
const QUESTIONS = [
  "cost",
  "switching",
  "hiddenFees",
  "contract",
  "ai",
  "setupFee",
  "live",
  "migration",
  "staff",
  "afterHours",
  "money",
  "ownerPortal",
  "quickbooks",
  "tenantPortal",
  "payMethods",
  "fees",
  "spanish",
  "texas",
  "data",
  "doors",
] as const;

const HOME_COUNT = 5;

/** `full` lists every question; otherwise the first five and a link to /faq. */
export function Faq({ full = false }: { full?: boolean }) {
  const { t } = useTranslation("marketing");
  const questions = full ? QUESTIONS : QUESTIONS.slice(0, HOME_COUNT);
  return (
    <section id="faq" className="w-full scroll-mt-20 py-16 lg:py-24">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
        <SectionHeading lead={t("faq.headingLead")} emphasis={t("faq.headingEmphasis")} />
        <Container delay={0.1}>
          <Accordion type="single" collapsible className="mt-8">
            {questions.map((key) => (
              <AccordionItem key={key} value={key}>
                <AccordionTrigger className="text-left text-base">
                  {t(`faq.items.${key}.q`)}
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                  {t(`faq.items.${key}.a`, PRICE_VARS)}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          {!full && (
            <div className="mt-8 flex justify-center">
              <Button asChild variant="outline">
                <Link to="/faq">{t("faq.seeAll", { count: QUESTIONS.length })}</Link>
              </Button>
            </div>
          )}
        </Container>
      </div>
    </section>
  );
}
