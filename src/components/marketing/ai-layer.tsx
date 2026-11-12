import {
  BellRing,
  MessageSquareText,
  PhoneCall,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Container } from "@/components/marketing/ui/container";
import { SectionHeading } from "@/components/marketing/section-heading";
import { ItemStatusBadge, type ItemStatus } from "@/components/marketing/item-status";

/**
 * The night shift: a service our team sets up and runs for each client, not
 * a Rentio software module. Describe it that way (owner decision 2026-10-28).
 */
const ITEMS: { key: string; icon: LucideIcon; status: ItemStatus }[] = [
  { key: "voice", icon: PhoneCall, status: "done" },
  { key: "intake", icon: Wrench, status: "done" },
  { key: "textback", icon: MessageSquareText, status: "done" },
  { key: "reminders", icon: BellRing, status: "done" },
];

export function AiLayer() {
  const { t } = useTranslation("marketing");
  return (
    <section id="ai" className="w-full scroll-mt-20 bg-muted/50 py-16 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow={t("ai.eyebrow")}
          lead={t("ai.headingLead")}
          emphasis={t("ai.headingEmphasis")}
          subhead={t("ai.subhead")}
        />
        <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
          {ITEMS.map(({ key, icon: Icon, status }, index) => (
            <Container key={key} delay={0.1 + index * 0.08}>
              <Card className="h-full py-5">
                <CardContent className="flex gap-4 px-5">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div>
                    <ItemStatusBadge status={status} />
                    <h3 className="mt-2 text-base font-semibold">{t(`ai.items.${key}.title`)}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {t(`ai.items.${key}.body`)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Container>
          ))}
        </div>
        <Container delay={0.4}>
          <p className="mx-auto mt-8 flex max-w-2xl items-start justify-center gap-2 text-center text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            {t("ai.guardrail")}
          </p>
        </Container>
      </div>
    </section>
  );
}
