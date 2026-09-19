import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import esMX from "@/locales/es-MX.json";
import en from "@/locales/en.json";

export const LANGUAGE_STORAGE_KEY = "rentio-language";
export type AppLanguage = "es-MX" | "en";

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: { "es-MX": { translation: esMX }, en: { translation: en } },
    lng: "es-MX",
    fallbackLng: "es-MX",
    interpolation: { escapeValue: false }
  });
}

export default i18n;
