import React, { createContext, useContext, useEffect, useState } from 'react';
import { TRANSLATIONS, type Locale, type TranslationKey } from './translations';

const STORAGE_KEY = 'fuck_pdf_locale';

interface I18nContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

function getInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'id';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (saved && saved in TRANSLATIONS) return saved;
  } catch {
    // ignore storage errors
  }
  return 'id';
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'id',
  setLocale: () => {},
  t: (key, vars) => interpolate(TRANSLATIONS.id[key], vars),
});

function interpolate(
  template: string,
  vars?: Record<string, string | number>
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}`
  );
}

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage errors
    }
  };

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = (key: TranslationKey, vars?: Record<string, string | number>): string => {
    const dict = TRANSLATIONS[locale] || TRANSLATIONS.id;
    const raw = dict[key] ?? TRANSLATIONS.id[key] ?? key;
    return interpolate(raw, vars);
  };

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
