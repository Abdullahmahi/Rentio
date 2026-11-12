import { useEffect, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  BOOKING_URL,
  EXTERNAL_LINK,
  calEmbedLoaded,
  calLinkFor,
  loadCalEmbed,
} from "@/lib/marketing";
import { cn } from "@/lib/utils";

/**
 * The only call to action on the site.
 *
 * Every CTA goes through this component so the URL lives in exactly one place
 * and the new-tab hygiene - rel="noopener noreferrer" plus an accessible name
 * that says it opens in a new tab - cannot be forgotten on one of them.
 *
 * With JavaScript, a Cal.com link opens as Cal.com's popup on this page
 * (`data-cal-link`), and a confirmed booking sends the visitor to `/vsl` -
 * see `loadCalEmbed`. Without it, or if the embed script is blocked, the plain
 * link still opens cal.com in a new tab.
 */
export function BookingLink({
  children,
  className,
  variant = "default",
  size = "default",
  href = BOOKING_URL,
}: {
  children: ReactNode;
  className?: string | undefined;
  variant?: "default" | "outline" | "secondary" | undefined;
  size?: "default" | "lg" | undefined;
  /** Another Cal.com event, e.g. AUDIT_BOOKING_URL. Defaults to the walkthrough. */
  href?: string | undefined;
}) {
  const { t } = useTranslation("marketing");
  const calLink = calLinkFor(href);

  useEffect(() => {
    if (calLink) loadCalEmbed();
  }, [calLink]);

  // Cal.com's own click listener opens the popup; this only stops the new tab,
  // and only once the embed has actually loaded.
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (calLink && calEmbedLoaded()) event.preventDefault();
  };

  return (
    <Button asChild variant={variant} size={size} className={cn(className)}>
      <a
        href={href}
        {...EXTERNAL_LINK}
        onClick={onClick}
        {...(calLink
          ? {
              "data-cal-link": calLink,
              "data-cal-namespace": "rentio",
              "data-cal-config": '{"layout":"month_view"}',
            }
          : {})}
      >
        {children}
        <span className="sr-only"> {t("external.newTab")}</span>
      </a>
    </Button>
  );
}
