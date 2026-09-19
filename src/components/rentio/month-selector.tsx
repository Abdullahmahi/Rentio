import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { shiftPeriod } from "@/lib/invoicing";

/** "septiembre de 2026", capitalised, in whichever locale is active. */
export function formatPeriod(period: string, locale: string) {
  const [year, month] = period.split("-").map(Number);
  const label = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    new Date(year!, month! - 1, 1),
  );
  return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
}

export function MonthSelector({
  period,
  onChange,
}: {
  period: string;
  onChange: (period: string) => void;
}) {
  const { t, i18n } = useTranslation();

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
      <Button
        size="icon"
        variant="ghost"
        aria-label={t("month.previous")}
        onClick={() => onChange(shiftPeriod(period, -1))}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <span className="numeric min-w-44 text-center text-sm font-semibold">
        {formatPeriod(period, i18n.language)}
      </span>
      <Button
        size="icon"
        variant="ghost"
        aria-label={t("month.next")}
        onClick={() => onChange(shiftPeriod(period, 1))}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
