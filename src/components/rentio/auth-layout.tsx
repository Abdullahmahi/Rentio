import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BrandPanel } from "@/components/rentio/brand-panel";
import { RentioMark } from "@/components/rentio/rentio-mark";
import { INTERNAL_DEFAULT_LANGUAGE, type AppLanguage } from "@/lib/i18n";
import { usePublicSettings, useLanguagePreference } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * The shell every auth screen sits in.
 *
 * Previously each of the four screens repeated this markup inline and had
 * already drifted apart — signup.tsx ended up with an h-11 button and an
 * unsized input where the others use h-12. One component, one set of
 * decisions.
 */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string | undefined;
  children: ReactNode;
  /** Extra line under the card, e.g. the link across to another screen. */
  footer?: ReactNode | undefined;
}) {
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[55fr_45fr]">
      {/* 20px gutters on mobile, per the spec. */}
      <main className="flex flex-col px-5 py-8 sm:px-8">
        <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center">
          {/* The lockup belongs above the heading, not orphaned in the far
              corner of the brand panel. */}
          <RentioMark subtitle={null} />

          <div className="mt-6 rounded-xl border border-border bg-surface p-5 shadow-subtle">
            <div className="mx-auto w-full max-w-[400px]">
              <h1 className="text-2xl font-semibold">{title}</h1>
              {description ? (
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              ) : null}
              {children}
            </div>
          </div>

          {footer ? <div className="mt-5 max-w-[440px] text-sm">{footer}</div> : null}
        </div>

        <AuthFooter />
      </main>

      <BrandPanel />
    </div>
  );
}

/** Support contact and a language switch. Deliberately no terms/privacy links
 *  — those pages do not exist yet, and a footer link to a 404 is worse than
 *  no link. */
function AuthFooter() {
  const { t } = useTranslation();
  const settings = usePublicSettings();
  const { language, setLanguage } = useLanguagePreference(INTERNAL_DEFAULT_LANGUAGE);

  const email = settings.data?.email;
  const phone = settings.data?.phone;

  return (
    <div className="mx-auto mt-8 flex w-full max-w-[440px] flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {email ? (
          <a className="hover:text-foreground hover:underline" href={`mailto:${email}`}>
            {email}
          </a>
        ) : null}
        {phone ? (
          <a
            className="numeric hover:text-foreground hover:underline"
            href={`tel:${phone.replace(/[^\d+]/g, "")}`}
          >
            {phone}
          </a>
        ) : null}
      </div>

      <div
        className="flex rounded-lg border border-border p-0.5"
        aria-label={t("actions.changeLanguage")}
      >
        {(["es-MX", "en"] as const).map((option: AppLanguage) => (
          <button
            key={option}
            type="button"
            onClick={() => setLanguage(option)}
            aria-pressed={language === option}
            className={cn(
              "h-7 rounded-md px-2.5 text-xs font-semibold",
              language === option
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {t(`language.${option}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
