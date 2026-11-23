'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Lang } from './site';

type Ctx = { lang: Lang; setLang: (l: Lang) => void; toggle: () => void; tx: (en: string, ar: string) => string };

const LangContext = createContext<Ctx | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ar');

  useEffect(() => {
    const saved = localStorage.getItem('sadeem-lang');
    if (saved === 'en' || saved === 'ar') setLangState(saved);
    else setLangState(navigator.language.toLowerCase().startsWith('ar') ? 'ar' : 'en');
  }, []);

  useEffect(() => {
    const dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    document.documentElement.dataset.lang = lang;
    localStorage.setItem('sadeem-lang', lang);
  }, [lang]);

  const value: Ctx = {
    lang,
    setLang: setLangState,
    toggle: () => setLangState((l) => (l === 'ar' ? 'en' : 'ar')),
    tx: (en, ar) => (lang === 'ar' ? ar : en),
  };
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): Ctx {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used inside LangProvider');
  return ctx;
}
