import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import esMX from "@/locales/es-MX.json";
import en from "@/locales/en.json";

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
    resources: { "es-MX": { translation: esMX }, en: { translation: en } },
    lng: INTERNAL_DEFAULT_LANGUAGE,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });
}

export default i18n;
