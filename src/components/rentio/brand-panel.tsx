import { FileText, ReceiptText, Wrench, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Brand column beside the auth forms. Collapses away on mobile.
 *
 * The three value rows replace what used to be a large empty gap in the
 * middle of the panel. Row markup matches the marketing site's feature cards
 * (src/components/marketing/features.tsx) so the public page and the front
 * door read as one product.
 */
const VALUE_ROWS: { key: string; icon: LucideIcon }[] = [
  { key: "leases", icon: FileText },
  { key: "payments", icon: ReceiptText },
  { key: "maintenance", icon: Wrench },
];

export function BrandPanel() {
  const { t } = useTranslation();
  return (
    <div className="hidden border-l border-border bg-secondary lg:flex lg:flex-col lg:justify-center lg:p-12">
      <div className="max-w-md">
        <p className="text-2xl font-semibold leading-snug text-foreground">
          {t("auth.brandHeadline")}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">{t("auth.brandBody")}</p>

        <ul className="mt-10 space-y-6">
          {VALUE_ROWS.map((row) => (
            <li key={row.key}>
              <h2 className="flex items-center gap-2.5 text-base font-semibold">
                <row.icon className="size-5 shrink-0 text-primary" aria-hidden />
                {t(`auth.valueRows.${row.key}.title`)}
              </h2>
              <p className="mt-1.5 pl-[1.9rem] text-sm leading-relaxed text-muted-foreground">
                {t(`auth.valueRows.${row.key}.body`)}
              </p>
            </li>
          ))}
        </ul>

        <p className="mt-12 text-xs text-muted-foreground">{t("auth.brandFooter")}</p>
      </div>
    </div>
  );
}
