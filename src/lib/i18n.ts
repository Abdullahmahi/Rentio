import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import esMX from "@/locales/es-MX.json";
import en from "@/locales/en.json";
import { BRAND_NAME } from "@/lib/brand";
import marketingEn from "@/locales/marketing.en.json";
import marketingEsMX from "@/locales/marketing.es-MX.json";

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
     * Two namespaces. `translation` is the product; `marketing` is the public
     * site. Both ship in English and Mexican Spanish at exact key parity
     * (i18n.test.ts), and the public page has its own EN/ES toggle.
     */
    resources: {
      "es-MX": { translation: esMX, marketing: marketingEsMX },
      en: { translation: en, marketing: marketingEn },
    },
    defaultNS: "translation",
    lng: INTERNAL_DEFAULT_LANGUAGE,
    fallbackLng: "en",
    // `{{brand}}` resolves everywhere without every call site remembering to
    // pass it. The alternative — `t(key, { brand: BRAND_NAME })` at four and
    // counting call sites — is a rename waiting to be half-done.
    interpolation: { escapeValue: false, defaultVariables: { brand: BRAND_NAME } },
  });
}

export default i18n;
