import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { en, type Dict } from './en'
import { cs } from './cs'
import { createFormatter, type Formatter } from '../lib/format'

export type Lang = 'cs' | 'en'
export const LANGS: Lang[] = ['cs', 'en']
export const DICTS: Record<Lang, Dict> = { en, cs }

type PluralForms = { one: string; few: string; many: string; other: string }

/** Replace {name} placeholders. */
export function fill(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
}

const pluralRules: Partial<Record<Lang, Intl.PluralRules>> = {}
export function plural(lang: Lang, n: number, forms: PluralForms, display?: string): string {
  const rules = (pluralRules[lang] ??= new Intl.PluralRules(lang === 'cs' ? 'cs-CZ' : 'en-US'))
  const cat = rules.select(n) as keyof PluralForms
  return fill(forms[cat] ?? forms.other, { n: display ?? String(n) })
}

export interface I18n {
  lang: Lang
  t: Dict
  f: Formatter
  fill: typeof fill
  /** "30 years", "1 year 6 months", localised. */
  duration: (months: number) => string
  years: (n: number) => string
}

export function createI18n(lang: Lang): I18n {
  const t = DICTS[lang]
  const f = createFormatter(lang)
  const years = (n: number) => plural(lang, n, t.units.years, f.num(n))
  const duration = (months: number) => {
    const y = Math.floor(months / 12)
    const m = months % 12
    if (m === 0) return years(y)
    const mm = plural(lang, m, t.units.months)
    return y === 0 ? mm : `${years(y)} ${mm}`
  }
  return { lang, t, f, fill, duration, years }
}

const Ctx = createContext<I18n>(createI18n('en'))

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const value = useMemo(() => createI18n(lang), [lang])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useI18n = () => useContext(Ctx)

export function detectLang(): Lang {
  try {
    const q = new URLSearchParams(location.search).get('lang')
    if (q === 'cs' || q === 'en') return q
    const stored = localStorage.getItem('investcalc.lang')
    if (stored === 'cs' || stored === 'en') return stored
  } catch {
    /* storage unavailable */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.languages?.[0] ?? navigator.language : 'en'
  return /^(cs|sk)\b/i.test(nav ?? '') ? 'cs' : 'en'
}
