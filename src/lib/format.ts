import type { Currency } from '../model/scenario'

export type LangCode = 'cs' | 'en'
export const localeOf = (lang: LangCode) => (lang === 'cs' ? 'cs-CZ' : 'en-US')

export interface MoneyOptions {
  compact?: boolean
  decimals?: number
  signed?: boolean
}

export interface Formatter {
  locale: string
  money: (value: number, currency: Currency, opts?: MoneyOptions) => string
  /** Plain grouped number (no currency). */
  num: (value: number, decimals?: number) => string
  /** Value given in percent units (7 → "7 %"). */
  pct: (value: number, decimals?: number, signed?: boolean) => string
  compact: (value: number) => string
  currencySymbol: (currency: Currency) => string
  /** Where the currency sign goes in this locale: { prefix } or { suffix }. */
  currencyAffix: (currency: Currency) => { prefix?: string; suffix?: string }
}

const cache = new Map<string, Intl.NumberFormat>()
function nf(locale: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = locale + JSON.stringify(opts)
  let f = cache.get(key)
  if (!f) {
    f = new Intl.NumberFormat(locale, opts)
    cache.set(key, f)
  }
  return f
}

/** Normalise negative zero and tiny float noise for display. */
const clean = (v: number, decimals: number) => {
  const r = Number(v.toFixed(decimals))
  return Object.is(r, -0) ? 0 : r
}

export function createFormatter(lang: LangCode): Formatter {
  const locale = localeOf(lang)
  return {
    locale,
    money(value, currency, opts = {}) {
      if (!Number.isFinite(value)) return '—'
      const decimals = opts.decimals ?? 0
      const o: Intl.NumberFormatOptions = {
        style: 'currency',
        currency,
        minimumFractionDigits: opts.compact ? 0 : decimals,
        maximumFractionDigits: opts.compact ? (Math.abs(value) >= 1e6 ? 2 : 1) : decimals,
        signDisplay: opts.signed ? 'exceptZero' : 'auto',
      }
      if (opts.compact) o.notation = 'compact'
      // "100 000 $" in Czech (not "US$"), "CZK 100,000" in English.
      o.currencyDisplay = currency === 'CZK' && lang === 'en' ? 'code' : 'narrowSymbol'
      return nf(locale, o).format(clean(value, opts.compact ? 2 : decimals))
    },
    num(value, decimals = 0) {
      if (!Number.isFinite(value)) return '—'
      return nf(locale, { maximumFractionDigits: decimals, minimumFractionDigits: 0 }).format(clean(value, decimals))
    },
    pct(value, decimals = 1, signed = false) {
      if (!Number.isFinite(value)) return '—'
      return nf(locale, {
        style: 'percent',
        maximumFractionDigits: decimals,
        minimumFractionDigits: 0,
        signDisplay: signed ? 'exceptZero' : 'auto',
      }).format(clean(value / 100, decimals + 2))
    },
    compact(value) {
      if (!Number.isFinite(value)) return '—'
      return nf(locale, { notation: 'compact', maximumFractionDigits: Math.abs(value) >= 1e6 ? 1 : 0 }).format(value)
    },
    currencySymbol(currency) {
      if (currency === 'CZK' && lang === 'en') return 'CZK'
      const parts = nf(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0)
      return parts.find((p) => p.type === 'currency')?.value ?? currency
    },
    currencyAffix(currency) {
      const sym = this.currencySymbol(currency)
      const parts = nf(locale, { style: 'currency', currency, currencyDisplay: lang === 'en' && currency === 'CZK' ? 'code' : 'narrowSymbol' }).formatToParts(1)
      const ci = parts.findIndex((p) => p.type === 'currency')
      const ii = parts.findIndex((p) => p.type === 'integer')
      return ci < ii ? { prefix: sym } : { suffix: sym }
    },
  }
}

/**
 * Locale-tolerant number parsing for user input.
 * Accepts spaces, NBSP (U+00A0) and narrow NBSP (U+202F) as group
 * separators, comma or dot as decimal separator, a leading minus or the
 * Unicode minus sign, and k / m / tis / mil suffixes ("5k", "1,2 mil").
 * Returns null for anything that is not clearly a number.
 */
export function parseNumber(raw: string, lang: LangCode): number | null {
  let s = raw.trim().toLowerCase()
  if (!s) return null
  s = s.replace(/[\s\u00a0\u202f'\u2019_]/g, '').replace(/\u2212/g, '-')
  s = s.replace(/(kč|czk|eur|usd|gbp|[€$£%])/g, '')
  let mult = 1
  const suffix = s.match(/(k|tis\.?|m|mil\.?|mio\.?|mld\.?|bn|b)$/)
  if (suffix) {
    const sx = suffix[1].replace('.', '')
    mult = sx === 'k' || sx === 'tis' ? 1e3 : sx === 'mld' || sx === 'bn' || sx === 'b' ? 1e9 : 1e6
    s = s.slice(0, -suffix[1].length)
  }
  if (!/^[-+]?[\d.,]+$/.test(s) || !/\d/.test(s)) return null
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  let normalized: string
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = lastComma > lastDot ? ',' : '.'
    const group = dec === ',' ? '.' : ','
    normalized = s.split(group).join('').replace(dec, '.')
  } else if (lastComma >= 0) {
    const groups = /^[-+]?\d{1,3}(,\d{3})+$/.test(s)
    normalized = lang === 'en' && groups ? s.replace(/,/g, '') : (s.match(/,/g)!.length > 1 ? null : s.replace(',', '.')) ?? ''
  } else if (lastDot >= 0) {
    const groups = /^[-+]?\d{1,3}(\.\d{3})+$/.test(s)
    normalized = (lang === 'cs' && groups) || (s.match(/\./g)!.length > 1 && groups) ? s.replace(/\./g, '') : s
  } else normalized = s
  if (!normalized || (normalized.match(/\./g)?.length ?? 0) > 1) return null
  const n = Number(normalized) * mult
  return Number.isFinite(n) ? n : null
}
