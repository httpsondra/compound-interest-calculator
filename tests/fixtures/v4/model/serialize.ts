import type { Frequency } from '../engine/types'
import {
  CURRENCIES,
  FREQUENCIES,
  WITHDRAWAL_STRATEGIES,
  type WithdrawalStrategy,
  defaultScenario,
  uid,
  type Currency,
  type GrowthMode,
  type Scenario,
} from './scenario'

/*
 * Scenario (de)serialisation for share links and local storage.
 * Input is never trusted: every field is type-checked, clamped and rebuilt
 * from defaults. Nothing is ever evaluated. Schema version: 2.
 */

export const SHARE_VERSION = 2
const MAX_LIST = 40

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
const int = (v: unknown, min: number, max: number, fallback: number) => Math.round(num(v, min, max, fallback))
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback
}
const str = (v: unknown, max: number, fallback: string) =>
  typeof v === 'string' ? Array.from(v).filter((ch) => ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127).join('').slice(0, max) : fallback

const MONEY_MAX = 1e13

export function sanitizeScenario(input: unknown, fallbackCurrency: Currency = 'CZK'): Scenario | null {
  if (!isObj(input)) return null
  const currency = oneOf<Currency>(input.currency, CURRENCIES, fallbackCurrency)
  const d = defaultScenario(currency)
  const c = isObj(input.constant) ? input.constant : {}
  const f = isObj(input.fees) ? input.fees : {}
  const w = isObj(input.withdrawal) ? input.withdrawal : {}
  const g = isObj(input.goal) ? input.goal : {}
  const r = isObj(input.retirement) ? input.retirement : {}
  const periods = Array.isArray(input.periods)
    ? input.periods.slice(0, MAX_LIST).filter(isObj).map((p) => ({
        id: uid('p'),
        years: int(p.years, 1, 100, 5),
        amount: num(p.amount, 0, MONEY_MAX, 0),
        frequency: oneOf<Frequency>(p.frequency, FREQUENCIES, 'monthly'),
        paused: bool(p.paused, false),
      }))
    : d.periods
  const lumpSums = Array.isArray(input.lumpSums)
    ? input.lumpSums.slice(0, MAX_LIST).filter(isObj).map((l) => ({
        id: uid('l'),
        year: int(l.year, 1, 100, 1),
        amount: num(l.amount, 0, MONEY_MAX, 0),
      }))
    : []
  const startAge = input.startAge == null ? null : int(input.startAge, 0, 120, 30)
  return {
    v: 2,
    id: typeof input.id === 'string' && /^[\w-]{1,64}$/.test(input.id) ? input.id : uid('sc'),
    name: str(input.name, 60, ''),
    currency,
    initial: num(input.initial, 0, MONEY_MAX, d.initial),
    horizonYears: int(input.horizonYears, 0, 100, d.horizonYears),
    horizonMonths: int(input.horizonMonths, 0, 11, 0),
    annualReturn: num(input.annualReturn, -99, 100, d.annualReturn),
    timing: oneOf(input.timing, ['start', 'end'] as const, d.timing),
    contribMode: oneOf(input.contribMode, ['constant', 'schedule'] as const, 'constant'),
    constant: {
      amount: num(c.amount, 0, MONEY_MAX, d.constant.amount),
      frequency: oneOf<Frequency>(c.frequency, FREQUENCIES, 'monthly'),
    },
    periods: periods.length ? periods : d.periods,
    lumpSums,
    growthMode: oneOf<GrowthMode>(input.growthMode, ['none', 'custom', 'inflation'], 'none'),
    growthRate: num(input.growthRate, -50, 50, 3),
    inflationEnabled: bool(input.inflationEnabled, true),
    inflation: num(input.inflation, -50, 50, d.inflation),
    startAge,
    feesEnabled: bool(input.feesEnabled, false),
    fees: {
      annual: num(f.annual, 0, 99, d.fees.annual),
      entry: num(f.entry, 0, 100, 0),
      fixed: num(f.fixed, 0, MONEY_MAX, 0),
    },
    withdrawal: {
      enabled: bool(w.enabled, false),
      startYear: int(w.startYear, 1, 100, d.withdrawal.startYear),
      endYear: w.endYear == null ? null : int(w.endYear, 1, 100, 30),
      amount: num(w.amount, 0, MONEY_MAX, d.withdrawal.amount),
      frequency: oneOf<Frequency>(w.frequency, ['monthly', 'quarterly', 'annual'], 'monthly'),
      indexed: bool(w.indexed, true),
      stopContributions: bool(w.stopContributions, true),
      strategy: oneOf<WithdrawalStrategy>(w.strategy, WITHDRAWAL_STRATEGIES, 'fixed'),
      rate: num(w.rate, 0, 20, 4),
      maxIncrease: num(w.maxIncrease, 0, 100, 5),
      maxDecrease: num(w.maxDecrease, 0, 100, 2.5),
      floor: num(w.floor, 0, MONEY_MAX, 0),
    },
    retirement: {
      income: num(r.income, 0, MONEY_MAX, d.retirement.income),
      real: bool(r.real, true),
    },
    goal: {
      enabled: bool(g.enabled, false),
      target: num(g.target, 0, MONEY_MAX, d.goal.target),
      year: int(g.year, 1, 100, 30),
      real: bool(g.real, false),
    },
  }
}

/** Strip runtime ids so the share payload stays short. */
function toPortable(s: Scenario) {
  const { id: _id, ...rest } = s
  void _id
  return {
    ...rest,
    periods: s.periods.map(({ id: _p, ...p }) => (void _p, p)),
    lumpSums: s.lumpSums.map(({ id: _l, ...l }) => (void _l, l)),
  }
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function encodeShare(s: Scenario): string {
  return toBase64Url(JSON.stringify({ sv: SHARE_VERSION, s: toPortable(s) }))
}

export function decodeShare(data: string): Scenario | null {
  if (!data || data.length > 8000 || !/^[\w-]+$/.test(data)) return null
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(data))
    if (!isObj(parsed) || parsed.sv !== SHARE_VERSION) return null
    return sanitizeScenario(parsed.s)
  } catch {
    return null
  }
}
