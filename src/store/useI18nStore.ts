import { create } from "zustand";
import { persist } from "zustand/middleware";
import { translations } from "../i18n/translations";

export type Lang = "en" | "zh";

interface I18nState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      lang: "zh" as Lang,
      setLang: (lang) => set({ lang }),
    }),
    { name: "gists-client-lang" }
  )
);

/** Returns the full translation object for the current language. */
export function useT() {
  const lang = useI18nStore((s) => s.lang);
  return translations[lang];
}
