import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ar from "@/locales/ar.json";
import en from "@/locales/en.json";

export type Lang = "en" | "ar";
const KEY = "kiorly.lang";

export function applyDirection(lang: Lang): void {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.title = i18n.t("app.docTitle", { lng: lang }); // «كيورلي لاب من كيوريكس» in Arabic
}

export function savedLang(): Lang | null {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "ar" || saved === "en") return saved;
  } catch {
    /* storage unavailable */
  }
  return null;
}

/** A user's own choice wins, then the browser language (Arabic when it says neither), then the lab's default language (applied after login). */
function browserLang(): Lang {
  // No saved choice: follow the browser language (first Arabic or English entry of navigator.languages); Arabic (RTL) when it says neither. The AR/EN switch is always visible.
  try {
    for (const l of navigator.languages ?? [navigator.language]) {
      const base = String(l).toLowerCase().split("-")[0];
      if (base === "ar" || base === "en") return base;
    }
  } catch {
    /* no navigator */
  }
  return "ar";
}
function initialLang(): Lang {
  return savedLang() ?? browserLang();
}

/** Applies the lab's default language when the user has not chosen one (not persisted, so the lab setting stays authoritative). */
export function applyTenantDefault(lang: string | undefined): void {
  if (savedLang() || (lang !== "ar" && lang !== "en") || i18n.language === lang) return;
  void i18n.changeLanguage(lang);
  applyDirection(lang);
}

export function setLang(lang: Lang): void {
  void i18n.changeLanguage(lang);
  applyDirection(lang);
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* ignore */
  }
}

const lng = initialLang();
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnObjects: true,
});
applyDirection(lng);

export default i18n;
