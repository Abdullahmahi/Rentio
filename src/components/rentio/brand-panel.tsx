import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Muted brand column beside the auth forms. Collapses away on mobile. */
export function BrandPanel({ icon: Icon }: { icon: LucideIcon }) {
  const { t } = useTranslation();
  return (
    <div className="hidden border-l border-border bg-secondary lg:flex lg:flex-col lg:justify-between lg:p-12">
      <div className="grid size-11 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Icon className="size-5" />
      </div>
      <div className="max-w-md">
        <p className="text-2xl font-semibold leading-snug text-foreground">{t("auth.brandHeadline")}</p>
        <p className="mt-3 text-sm text-muted-foreground">{t("auth.brandBody")}</p>
      </div>
      <p className="text-xs text-muted-foreground">{t("auth.brandFooter")}</p>
    </div>
  );
}
