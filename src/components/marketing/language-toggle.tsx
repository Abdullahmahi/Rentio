import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { INTERNAL_DEFAULT_LANGUAGE } from "@/lib/i18n";
import { useLanguagePreference } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * EN/ES for the public site, through the same hook the staff shell uses: it
 * stores the choice, updates `<html lang>` and, if someone is signed in,
 * their profile. The label names the language you switch TO.
 */
export function LanguageToggle({ className }: { className?: string | undefined }) {
  const { t, i18n } = useTranslation("marketing");
  const { setLanguage } = useLanguagePreference(INTERNAL_DEFAULT_LANGUAGE);
  return (
    <Button
      variant="ghost"
      className={cn("gap-1.5", className)}
      aria-label={t("nav.languageLabel")}
      lang={i18n.language === "es-MX" ? "en" : "es-MX"}
      onClick={() => setLanguage(i18n.language === "es-MX" ? "en" : "es-MX")}
    >
      <Languages className="size-4" aria-hidden />
      {t("nav.languageToggle")}
    </Button>
  );
}
