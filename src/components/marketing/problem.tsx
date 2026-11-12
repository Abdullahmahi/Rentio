import { CircleDollarSign, Clock3, PhoneMissed, Repeat, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Container } from "@/components/marketing/ui/container";
import { SectionHeading } from "@/components/marketing/section-heading";

/** The pain, before the offer. Each card ends on what it costs. */
const PROBLEMS: { key: string; icon: LucideIcon }[] = [
  { key: "calls", icon: PhoneMissed },
  { key: "payments", icon: CircleDollarSign },
  { key: "deadlines", icon: Clock3 },
  { key: "switching", icon: Repeat },
];

export function Problem() {
  const { t } = useTranslation("marketing");
  return (
    <section className="w-full py-16 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          lead={t("problem.headingLead")}
          emphasis={t("problem.headingEmphasis")}
          subhead={t("problem.subhead")}
        />
        <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {PROBLEMS.map(({ key, icon: Icon }, index) => (
            <Container key={key} delay={0.1 + index * 0.08}>
              <Card className="h-full gap-3 py-5">
                <CardContent className="flex h-full flex-col gap-3 px-5">
                  <Icon className="size-5 text-muted-foreground" aria-hidden />
                  <h3 className="text-base font-semibold">{t(`problem.items.${key}.title`)}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {t(`problem.items.${key}.body`)}
                  </p>
                  <p className="mt-auto border-t border-border pt-3 text-sm font-medium text-danger">
                    {t(`problem.items.${key}.cost`)}
                  </p>
                </CardContent>
              </Card>
            </Container>
          ))}
        </div>
      </div>
    </section>
  );
}
