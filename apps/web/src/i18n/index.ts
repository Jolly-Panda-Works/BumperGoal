import { useSyncExternalStore } from 'react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { settingsStore } from '../services/settings';
import {
  customLanguages,
  defaultLanguage,
  isLanguage,
  languageRegistry,
  subscribeLanguages,
  type Language,
} from './languages';

export interface LanguageOption {
  id: Language;
  label: string;
  dir: 'ltr' | 'rtl';
}

let languageList: LanguageOption[] = [];
function rebuildList(): void {
  languageList = Object.entries(languageRegistry()).map(([id, definition]) => ({
    id,
    label: definition.label,
    dir: definition.dir,
  }));
}
rebuildList();

/** Languages players can pick; includes those added in the admin panel. */
export const languages = (): LanguageOption[] => languageList;
export function useLanguages(): LanguageOption[] {
  return useSyncExternalStore(subscribeLanguages, languages);
}

export const dirOf = (lang: Language): 'ltr' | 'rtl' => languageRegistry()[lang]?.dir ?? 'ltr';
function applyDocumentLanguage(lang: Language): void {
  document.documentElement.lang = lang;
  document.documentElement.dir = dirOf(lang);
}
void i18n.use(initReactI18next).init({
  resources: Object.fromEntries(
    Object.entries(languageRegistry()).map(([id, entry]) => [id, { translation: entry.translation }]),
  ),
  lng: settingsStore.get().language,
  fallbackLng: defaultLanguage,
  interpolation: { escapeValue: false },
  returnNull: false,
});
applyDocumentLanguage(settingsStore.get().language);

// Admin-added languages arrive after start-up: register their strings and keep the choice valid.
subscribeLanguages(() => {
  rebuildList();
  for (const l of customLanguages()) i18n.addResourceBundle(l.code, 'translation', l.translation, true, true);
  const lang = settingsStore.get().language;
  if (!isLanguage(lang)) settingsStore.set({ language: defaultLanguage });
  else if (i18n.language === lang) void i18n.changeLanguage(lang).then(() => applyDocumentLanguage(lang));
});

settingsStore.subscribe(() => {
  const lang = settingsStore.get().language;
  if (i18n.language !== lang) {
    void i18n.changeLanguage(lang);
    applyDocumentLanguage(lang);
  }
});
export function formatNumber(value: number, lang: string = i18n.language): string {
  try {
    const locale = languageRegistry()[lang]?.locale ?? lang;
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}
export default i18n;
