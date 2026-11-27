import { describe, it, expect } from 'vitest';
import { TRANSLATIONS, LOCALE_OPTIONS } from '../translations';

describe('i18n translations', () => {
  it('all locales have the exact same keys as Indonesian base', () => {
    const idKeys = Object.keys(TRANSLATIONS.id).sort();
    for (const locale of ['en', 'zh', 'ja'] as const) {
      const localeKeys = Object.keys(TRANSLATIONS[locale]).sort();
      expect(localeKeys).toEqual(idKeys);
    }
  });

  it('LOCALE_OPTIONS contains 4 supported languages', () => {
    expect(LOCALE_OPTIONS).toHaveLength(4);
    expect(LOCALE_OPTIONS.map((o) => o.code)).toEqual(['id', 'en', 'zh', 'ja']);
  });
});
