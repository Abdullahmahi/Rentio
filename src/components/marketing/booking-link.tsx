import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { BOOKING_URL, EXTERNAL_LINK } from "@/lib/marketing";
import { cn } from "@/lib/utils";

/**
 * The only call to action on the site.
 *
 * Every CTA goes through this component so the URL lives in exactly one place
 * and the new-tab hygiene - rel="noopener noreferrer" plus an accessible name
 * that says it opens in a new tab - cannot be forgotten on one of them.
 */
export function BookingLink({
  children,
  className,
  variant = "default",
  size = "default",
}: {
  children: ReactNode;
  className?: string | undefined;
  variant?: "default" | "outline" | "secondary" | undefined;
  size?: "default" | "lg" | undefined;
}) {
  const { t } = useTranslation("marketing");
  return (
    <Button asChild variant={variant} size={size} className={cn(className)}>
      <a href={BOOKING_URL} {...EXTERNAL_LINK}>
        {children}
        <span className="sr-only"> {t("external.newTab")}</span>
      </a>
    </Button>
  );
}
