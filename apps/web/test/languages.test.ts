import { describe, expect, it } from 'vitest';
import {
  customLanguages,
  detectLanguage,
  isLanguage,
  languageRegistry,
  setCustomLanguages,
} from '../src/i18n/languages';
const keys = (value: object, prefix = ''): string[] =>
  Object.entries(value).flatMap(([key, entry]) =>
    typeof entry === 'object' && entry !== null ? keys(entry, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
describe('language registry', () => {
  it('detects registered locales and safely falls back for unsupported languages', () => {
    expect(detectLanguage('fa-IR')).toBe('fa');
    expect(detectLanguage('en-GB')).toBe('en');
    expect(detectLanguage('zz-ZZ')).toBe('en');
    expect(isLanguage('__proto__')).toBe(false);
  });
  it('keeps every registered translation complete with direction and locale metadata', () => {
    const expected = keys(languageRegistry().en!.translation).sort();
    for (const entry of Object.values(languageRegistry())) {
      expect(keys(entry.translation).sort()).toEqual(expected);
      expect(['rtl', 'ltr']).toContain(entry.dir);
      expect(() => new Intl.NumberFormat(entry.locale)).not.toThrow();
    }
  });
});

describe('admin-added languages', () => {
  it('registers valid server languages and rejects ones that shadow built-ins', () => {
    setCustomLanguages([
      {
        code: 'de',
        label: 'Deutsch',
        dir: 'ltr',
        locale: 'de-DE',
        version: 1,
        translation: { nav: { home: 'Start' } },
      },
      { code: 'fa', label: 'fake', dir: 'rtl', locale: 'fa', version: 1, translation: {} },
    ]);
    expect(customLanguages().map((l) => l.code)).toEqual(['de']);
    expect(isLanguage('de')).toBe(true);
    expect(detectLanguage('de-AT')).toBe('de');
    expect(languageRegistry().fa!.label).toBe('فارسی');
    setCustomLanguages([]);
    expect(isLanguage('de')).toBe(false);
  });
});
