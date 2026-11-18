import en from './en.json';
import fa from './fa.json';
import ar from './ar.json';

export interface LanguageDefinition {
  label: string;
  dir: 'ltr' | 'rtl';
  locale: string;
  translation: Record<string, unknown>;
}

/** Built-in languages. Add a translation JSON and one entry here to enable another language everywhere. */
export const builtInLanguages = {
  en: { label: 'English', dir: 'ltr', locale: 'en-US', translation: en },
  fa: { label: 'فارسی', dir: 'rtl', locale: 'fa-IR', translation: fa },
  ar: { label: 'العربية', dir: 'rtl', locale: 'ar', translation: ar },
} as const satisfies Record<string, LanguageDefinition>;
export type BuiltInLanguage = keyof typeof builtInLanguages;

/** A language code: built-in, or added in the admin panel and served by Nakama. */
export type Language = string;

/** Languages added in the admin panel (cached on the device, refreshed from the server). */
export interface CustomLanguage extends LanguageDefinition {
  code: string;
  version: number;
}

const CUSTOM_KEY = 'flickkick.languages.v1';
let custom: CustomLanguage[] = readCustom();
const listeners = new Set<() => void>();

function readCustom(): CustomLanguage[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(CUSTOM_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter(isCustomLanguage) : [];
  } catch {
    return [];
  }
}

function isCustomLanguage(v: unknown): v is CustomLanguage {
  const l = v as CustomLanguage;
  return (
    typeof l === 'object' &&
    l !== null &&
    typeof l.code === 'string' &&
    !Object.hasOwn(builtInLanguages, l.code) &&
    typeof l.label === 'string' &&
    (l.dir === 'ltr' || l.dir === 'rtl') &&
    typeof l.locale === 'string' &&
    typeof l.translation === 'object' &&
    l.translation !== null
  );
}

/** Every language players can pick, built-in first. */
export const languageRegistry = (): Record<Language, LanguageDefinition> => ({
  ...builtInLanguages,
  ...Object.fromEntries(custom.map((l) => [l.code, l])),
});

export const customLanguages = (): readonly CustomLanguage[] => custom;

/** Replaces the admin-added languages (and caches them for offline play). */
export function setCustomLanguages(list: CustomLanguage[]): void {
  custom = list.filter(isCustomLanguage);
  try {
    window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom));
  } catch {
    // storage full or blocked: the languages still work for this session
  }
  listeners.forEach((l) => l());
}

export function subscribeLanguages(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const isLanguage = (value: unknown): boolean =>
  typeof value === 'string' && (Object.hasOwn(builtInLanguages, value) || custom.some((l) => l.code === value));
export const defaultLanguage: Language = 'en';
export function detectLanguage(locale: string): Language {
  const lower = locale.toLowerCase();
  if (isLanguage(lower)) return lower;
  const base = lower.split('-')[0] ?? '';
  return isLanguage(base) ? base : defaultLanguage;
}
