import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import esMX from "@/locales/es-MX.json";
import en from "@/locales/en.json";
import marketingEn from "@/locales/marketing.en.json";

export const LANGUAGE_STORAGE_KEY = "rentio-language";
export type AppLanguage = "es-MX" | "en";

/**
 * Spanish stays a first-class language — El Paso is roughly 81% Hispanic and
 * `es-MX` is exactly the right Spanish for that market. Only the *defaults*
 * differ: staff work in English, tenants land in Spanish.
 */
export const PORTAL_DEFAULT_LANGUAGE: AppLanguage = "es-MX";
export const INTERNAL_DEFAULT_LANGUAGE: AppLanguage = "en";

export function isAppLanguage(value: unknown): value is AppLanguage {
  return value === "en" || value === "es-MX";
}

/**
 * A user's own choice always wins, whether it came from this browser or from
 * `profiles.locale`. A NULL profile locale means "never chosen", so the
 * portal's default applies.
 */
export function resolveLanguage(
  stored: string | null | undefined,
  profileLocale: string | null | undefined,
  fallback: AppLanguage,
): AppLanguage {
  if (isAppLanguage(profileLocale)) return profileLocale;
  if (isAppLanguage(stored)) return stored;
  return fallback;
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    /**
     * Two namespaces. `translation` is the product, at exact parity in both
     * locales. `marketing` is the public site, which ships English-only on
     * purpose: it sells to landlords, who work in English, while the bilingual
     * tenant portal is the thing being sold. Keeping it in a locale file
     * anyway means translating it later is a translation job, not a refactor -
     * add `src/locales/marketing.es-MX.json` and register it here.
     *
     * Spanish falls back to the English marketing copy rather than rendering
     * raw key paths if a tenant-defaulted browser ever reaches the page.
     */
    resources: {
      "es-MX": { translation: esMX, marketing: marketingEn },
      en: { translation: en, marketing: marketingEn },
    },
    defaultNS: "translation",
    lng: INTERNAL_DEFAULT_LANGUAGE,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });
}

export default i18n;
