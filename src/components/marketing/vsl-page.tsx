import { Link } from "@tanstack/react-router";
import {
  CalendarCheck,
  Check,
  Mail,
  PlayCircle,
  ShieldCheck,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RentioMark } from "@/components/rentio/rentio-mark";
import { Container } from "@/components/marketing/ui/container";
import { Particles } from "@/components/marketing/ui/particles";
import { SectionHeading } from "@/components/marketing/section-heading";
import { Offer } from "@/components/marketing/offer";
import { Faq } from "@/components/marketing/faq";
import { LanguageToggle } from "@/components/marketing/language-toggle";
import { BOOKED_VIDEO_URL, clientProof } from "@/lib/marketing";
import { BRAND_NAME } from "@/lib/brand";

/**
 * The page a visitor sees once Cal.com confirms their walkthrough (set as the
 * event's "redirect on booking" URL, with "forward parameters" on so `?name=`
 * arrives). Its one job is the show-up rate: the co-founders' video, the three
 * things to do before the call, the call itself minute by minute, and the
 * value and guarantee restated. There is no booking button anywhere on it -
 * the visitor has already booked. VSL_POST_BOOKING.md at the folder root has
 * the copy rationale and the video script.
 */

const PREP: { key: "watch" | "reply" | "invite"; icon: LucideIcon }[] = [
  { key: "watch", icon: Video },
  { key: "reply", icon: Mail },
  { key: "invite", icon: Users },
];

const AGENDA = ["portfolio", "moments", "plan"] as const;
const DAY_ROWS = ["morning", "payment", "deposit", "night"] as const;
const STEPS = ["day0", "week1", "week2", "week3", "day30"] as const;

export function VslPage({ name }: { name?: string | undefined }) {
  const { t } = useTranslation("marketing");

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Logo only. Every nav link is an exit, and this page has one job. */}
      <header className="h-16 w-full">
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label={t("nav.home")} className="rounded-lg">
            <RentioMark subtitle={null} />
          </Link>
          <div className="flex items-center gap-2">
            <LanguageToggle className="h-8 text-xs" />
            <Badge variant="secondary" className="gap-1.5">
              <CalendarCheck className="size-3.5 text-primary" aria-hidden />
              {t("booked.badge")}
            </Badge>
          </div>
        </div>
      </header>

      <main>
        <Hero name={name} />
        <Prep />
        <Agenda />
        <DayInTheLife />
        <Path />
        <Offer cta={null} />
        <Faq />
        <Closing />
      </main>

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:px-6">
          <span className="numeric">
            &copy; {new Date().getFullYear()} {BRAND_NAME}. {t("footer.rights")}
          </span>
          <span>{t("booked.footer.disclaimer")}</span>
        </div>
      </footer>
    </div>
  );
}

function Hero({ name }: { name?: string | undefined }) {
  const { t, i18n } = useTranslation("marketing");
  return (
    <section className="w-full py-12 lg:py-20">
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center px-4 text-center sm:px-6">
        <Container>
          <p className="mb-3 text-sm font-medium uppercase tracking-wider text-primary">
            {t("booked.hero.eyebrow")}
          </p>
          <h1 className="mx-auto max-w-3xl text-balance text-4xl font-bold !leading-tight lg:text-6xl">
            {name ? t("booked.hero.headlineLeadNamed", { name }) : t("booked.hero.headlineLead")}{" "}
            <span className="font-subheading italic">{t("booked.hero.headlineEmphasis")}</span>
          </h1>
        </Container>
        <Container delay={0.15}>
          <p className="mx-auto mt-4 max-w-xl text-balance text-base text-muted-foreground lg:text-lg">
            {t("booked.hero.subhead")}
          </p>
        </Container>

        <Container delay={0.25} className="mt-10">
          <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-card lg:rounded-3xl">
            <AspectRatio ratio={16 / 9}>
              {BOOKED_VIDEO_URL ? (
                <iframe
                  src={BOOKED_VIDEO_URL}
                  title={t("booked.hero.videoTitle")}
                  allow="autoplay; fullscreen; picture-in-picture"
                  allowFullScreen
                  className="size-full"
                />
              ) : (
                <div className="flex size-full flex-col items-center justify-center gap-4 bg-muted/50 p-6 text-left">
                  <PlayCircle className="size-12 text-primary" aria-hidden />
                  <p className="text-sm font-medium">{t("booked.hero.videoPending")}</p>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {(["who", "call", "ask"] as const).map((point) => (
                      <li key={point} className="flex gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                        {t(`booked.hero.videoPoints.${point}`)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </AspectRatio>
          </div>
        </Container>

        <Container delay={0.3}>
          {/* The only proof the owner approved (CLIENT_PROOF): no quotes, no logos. */}
          <p className="mx-auto mt-6 flex w-fit items-center gap-2 rounded-full border border-border px-4 py-1.5 text-sm font-medium">
            <ShieldCheck className="size-4 shrink-0 text-success" aria-hidden />
            {clientProof(i18n.language)}
          </p>
          <p className="mx-auto mt-4 max-w-xl text-sm text-muted-foreground">
            {t("booked.hero.checkEmail")}
          </p>
        </Container>
      </div>
    </section>
  );
}

/** The three micro-commitments. Each one raises the odds the call happens. */
function Prep() {
  const { t } = useTranslation("marketing");
  return (
    <section id="prep" className="w-full scroll-mt-20 bg-muted/50 py-16 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow={t("booked.prep.eyebrow")}
          lead={t("booked.prep.headingLead")}
          emphasis={t("booked.prep.headingEmphasis")}
          subhead={t("booked.prep.subhead")}
        />
        <ol className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
          {PREP.map(({ key, icon: Icon }, index) => (
            <li key={key}>
              <Container delay={0.1 + index * 0.08}>
                <Card className="h-full py-5">
                  <CardContent className="flex h-full flex-col gap-3 px-5">
                    <div className="flex items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <span className="numeric text-sm font-medium text-muted-foreground">
                        {index + 1}/3
                      </span>
                    </div>
                    <h3 className="text-base font-semibold">
                      {t(`booked.prep.items.${key}.title`)}
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {t(`booked.prep.items.${key}.body`)}
                    </p>
                  </CardContent>
                </Card>
              </Container>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** The call, minute by minute. Knowing the agenda removes the fear of a pitch. */
function Agenda() {
  const { t } = useTranslation("marketing");
  return (
    <section id="agenda" className="w-full scroll-mt-20 py-16 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow={t("booked.agenda.eyebrow")}
          lead={t("booked.agenda.headingLead")}
          emphasis={t("booked.agenda.headingEmphasis")}
          subhead={t("booked.agenda.subhead")}
        />
        <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
          {AGENDA.map((key, index) => (
            <Container key={key} delay={0.1 + index * 0.08}>
              <Card className="h-full py-5">
                <CardContent className="flex h-full flex-col gap-3 px-5">
                  <Badge variant="outline" className="numeric w-fit">
                    {t(`booked.agenda.items.${key}.time`)}
                  </Badge>
                  <h3 className="text-base font-semibold">
                    {t(`booked.agenda.items.${key}.title`)}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {t(`booked.agenda.items.${key}.body`)}
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

/** The dream outcome, drawn as one day before and after. */
function DayInTheLife() {
  const { t } = useTranslation("marketing");
  const columns = [
    { key: "before", title: t("booked.day.before"), tone: "text-danger" },
    { key: "after", title: t("booked.day.after"), tone: "text-success" },
  ] as const;
  return (
    <section className="w-full bg-muted/50 py-16 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow={t("booked.day.eyebrow")}
          lead={t("booked.day.headingLead")}
          emphasis={t("booked.day.headingEmphasis")}
          subhead={t("booked.day.subhead")}
        />
        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {columns.map(({ key, title, tone }, index) => (
            <Container key={key} delay={0.1 + index * 0.1}>
              <Card className="h-full py-5">
                <CardContent className="px-5">
                  <h3 className={`text-sm font-semibold uppercase tracking-wide ${tone}`}>
                    {title}
                  </h3>
                  <ol className="mt-4 divide-y divide-border">
                    {DAY_ROWS.map((row) => (
                      <li key={row} className="flex gap-4 py-3">
                        <span className="numeric w-16 shrink-0 text-sm text-muted-foreground">
                          {t(`booked.day.rows.${row}.time`)}
                        </span>
                        <p className="text-sm leading-relaxed">
                          {t(`booked.day.rows.${row}.${key}`)}
                        </p>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            </Container>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The mechanism: done for you, in 30 days, ending on the guarantee. */
function Path() {
  const { t } = useTranslation("marketing");
  return (
    <section className="w-full py-16 lg:py-24">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
        <SectionHeading
          eyebrow={t("booked.path.eyebrow")}
          lead={t("booked.path.headingLead")}
          emphasis={t("booked.path.headingEmphasis")}
          subhead={t("booked.path.subhead")}
        />
        <ol className="mt-10 border-l border-border">
          {STEPS.map((step, index) => (
            <li key={step} className="relative pb-8 pl-8 last:pb-0">
              <span
                aria-hidden
                className="absolute -left-[5px] top-1.5 size-2.5 rounded-full bg-primary"
              />
              <Container delay={0.1 + index * 0.06}>
                <p className="numeric text-xs font-medium uppercase tracking-wider text-primary">
                  {t(`booked.path.steps.${step}.label`)}
                </p>
                <h3 className="mt-1 text-base font-semibold">
                  {t(`booked.path.steps.${step}.title`)}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {t(`booked.path.steps.${step}.body`)}
                </p>
              </Container>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Closing() {
  const { t } = useTranslation("marketing");
  return (
    <section className="relative isolate w-full overflow-hidden py-20 lg:py-28">
      <Particles className="absolute inset-0 -z-10" quantity={80} color="var(--primary)" />
      <div className="absolute inset-0 -bottom-[12.5%] -z-20 mx-auto h-1/2 w-3/4 rounded-full bg-primary/20 blur-[8rem]" />
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <Container>
          <h2 className="text-balance font-heading text-3xl font-medium !leading-snug md:text-4xl lg:text-5xl">
            {t("booked.closing.headingLead")}{" "}
            <span className="font-subheading italic">{t("booked.closing.headingEmphasis")}</span>
          </h2>
        </Container>
        <Container delay={0.1}>
          <p className="mx-auto mt-5 max-w-xl text-balance text-base text-muted-foreground lg:text-lg">
            {t("booked.closing.body")}
          </p>
          <p className="mx-auto mt-4 max-w-xl text-balance text-sm text-muted-foreground">
            {t("booked.closing.reschedule")}
          </p>
        </Container>
        <Container delay={0.2}>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <a href="#prep">{t("booked.prep.headingLead")}</a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/">{t("booked.closing.home")}</Link>
            </Button>
          </div>
        </Container>
      </div>
    </section>
  );
}
