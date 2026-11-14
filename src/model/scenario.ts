import { PER_YEAR, type ContributionStream, type Frequency, type PlanInput, type Timing, type WithdrawalPolicy } from '../engine/types'
import { MAX_HORIZON_MONTHS } from '../engine/simulate'

export type Currency = 'CZK' | 'EUR' | 'USD'
export const CURRENCIES: Currency[] = ['CZK', 'EUR', 'USD']
export const FREQUENCIES: Frequency[] = ['weekly', 'monthly', 'quarterly', 'semiannual', 'annual']
/** Slider range multiplier per frequency (relative to a monthly amount). */
export const PER_YEAR_SCALE: Record<Frequency, number> = { weekly: 0.25, monthly: 1, quarterly: 3, semiannual: 6, annual: 12 }
export const WITHDRAWAL_FREQUENCIES: Frequency[] = ['monthly', 'quarterly', 'annual']

/**
 * One segment of the contribution timeline. Segments are contiguous: segment
 * i starts the year after segment i−1 ends, so overlaps are impossible by
 * construction and a gap is an explicit "paused" segment.
 */
export interface Period {
  id: string
  /** Length of the segment in whole years (≥ 1). */
  years: number
  /** Amount per occurrence. */
  amount: number
  frequency: Frequency
  paused: boolean
}

export interface LumpSumInput {
  id: string
  /** Deposited at the start of this plan year (1-based). */
  year: number
  amount: number
}

export type GrowthMode = 'none' | 'custom' | 'inflation'
export type WithdrawalStrategy = 'fixed' | 'initialPct' | 'currentPct' | 'guardrails'
export const WITHDRAWAL_STRATEGIES: WithdrawalStrategy[] = ['fixed', 'initialPct', 'currentPct', 'guardrails']

export interface Scenario {
  /** 3 = V4.1 withdrawal model (explicit amount basis). Older versions are migrated in serialize.ts. */
  v: 3
  id: string
  name: string
  currency: Currency
  initial: number
  horizonYears: number
  /** Extra months on top of whole years (0–11). */
  horizonMonths: number
  /** Effective annual return in percent. */
  annualReturn: number
  timing: Timing
  contribMode: 'constant' | 'schedule'
  constant: { amount: number; frequency: Frequency }
  periods: Period[]
  lumpSums: LumpSumInput[]
  growthMode: GrowthMode
  /** Custom annual contribution growth in percent. */
  growthRate: number
  inflationEnabled: boolean
  /** Annual inflation in percent. */
  inflation: number
  startAge: number | null
  feesEnabled: boolean
  fees: { annual: number; entry: number; fixed: number }
  withdrawal: {
    enabled: boolean
    startYear: number
    /** Inclusive last year, null = until the end of the plan. */
    endYear: number | null
    frequency: Frequency
    /**
     * Raise income with inflation once a year DURING retirement (fixed amount, initial % and the
     * inflation adjustment of dynamic spending). Independent of how the amount was entered.
     */
    indexed: boolean
    stopContributions: boolean
    /** How the yearly withdrawal budget is set (see engine WithdrawalPolicy). */
    strategy: WithdrawalStrategy
    /** Withdrawal rate in percent for the percentage-based strategies. */
    rate: number
    /** Guardrails: maximum yearly increase / decrease of spending, in percent. */
    maxIncrease: number
    maxDecrease: number
    /** Guardrails: optional minimum monthly income (0 = none). */
    floor: number
    /** Guardrails: the minimum income is in today's money (rises with inflation every plan year). */
    floorReal: boolean
  }
  /**
   * The monthly income the user wants in retirement. For the fixed-amount strategy this IS the
   * planned withdrawal; for percentage strategies it is the target the results are checked against.
   */
  retirement: {
    /** Desired monthly income. */
    income: number
    /**
     * How `income` was entered: true = today's purchasing power (grown with inflation until
     * withdrawals begin), false = the nominal amount at the start of withdrawals.
     */
    real: boolean
  }
  goal: { enabled: boolean; target: number; year: number; real: boolean }
}

let idCounter = 0
export const uid = (prefix = 'id') =>
  `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** Rough unit scale so example amounts look sensible in each currency. */
export const CURRENCY_SCALE: Record<Currency, number> = { CZK: 1, EUR: 1 / 25, USD: 1 / 25 }

export function roundNice(v: number): number {
  if (v <= 0) return 0
  const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1)
  return Math.round(v / mag) * mag
}

export function scaledAmount(czk: number, currency: Currency): number {
  return roundNice(czk * CURRENCY_SCALE[currency])
}

export function defaultScenario(currency: Currency = 'CZK', name = ''): Scenario {
  const s = (v: number) => scaledAmount(v, currency)
  return {
    v: 3,
    id: uid('sc'),
    name,
    currency,
    initial: s(100_000),
    horizonYears: 30,
    horizonMonths: 0,
    annualReturn: 7,
    timing: 'end',
    contribMode: 'constant',
    constant: { amount: s(5_000), frequency: 'monthly' },
    periods: [
      { id: uid('p'), years: 10, amount: s(3_000), frequency: 'monthly', paused: false },
      { id: uid('p'), years: 10, amount: s(6_000), frequency: 'monthly', paused: false },
      { id: uid('p'), years: 10, amount: s(10_000), frequency: 'monthly', paused: false },
    ],
    lumpSums: [],
    growthMode: 'none',
    growthRate: 3,
    inflationEnabled: true,
    inflation: 2.5,
    startAge: null,
    feesEnabled: false,
    fees: { annual: 0.5, entry: 0, fixed: 0 },
    withdrawal: {
      enabled: false,
      startYear: 21,
      endYear: null,
      frequency: 'monthly',
      indexed: true,
      stopContributions: true,
      strategy: 'fixed',
      rate: 4,
      maxIncrease: 5,
      maxDecrease: 2.5,
      floor: 0,
      floorReal: true,
    },
    retirement: { income: s(40_000), real: true },
    goal: { enabled: false, target: s(5_000_000), year: 30, real: false },
  }
}

export const totalMonths = (s: Scenario) => s.horizonYears * 12 + s.horizonMonths
export const horizonYearsCeil = (s: Scenario) => Math.ceil(totalMonths(s) / 12)

export interface PeriodRange {
  period: Period
  /** 1-based inclusive. */
  startYear: number
  endYear: number
}

export function periodRanges(periods: Period[]): PeriodRange[] {
  let y = 1
  return periods.map((p) => {
    const r = { period: p, startYear: y, endYear: y + p.years - 1 }
    y += p.years
    return r
  })
}

export function scheduleStreams(s: Scenario): ContributionStream[] {
  const H = totalMonths(s)
  if (s.contribMode === 'constant') {
    return s.constant.amount > 0
      ? [{ startMonth: 0, endMonth: H, amount: s.constant.amount, frequency: s.constant.frequency }]
      : []
  }
  const out: ContributionStream[] = []
  for (const r of periodRanges(s.periods)) {
    if (r.period.paused || r.period.amount <= 0) continue
    const start = (r.startYear - 1) * 12
    if (start >= H) break
    out.push({ startMonth: start, endMonth: r.endYear * 12, amount: r.period.amount, frequency: r.period.frequency })
  }
  return out
}

export function inflationRate(s: Scenario): number {
  return s.inflationEnabled ? s.inflation / 100 : 0
}

/**
 * The monthly income the "funds your income" checks compare against (deterministic and Monte Carlo).
 * • real: the desired income must keep its purchasing power in every year (today's money).
 * • A fixed amount entered in today's money that is NOT raised during retirement is, by the user's
 *   own choice, a constant nominal amount from the first withdrawal year on: the target is that
 *   nominal amount, so a plan that pays exactly what it planned is never reported as short.
 */
export function incomeTarget(s: Scenario): { monthly: number; real: boolean } {
  const infl = inflationRate(s)
  const w = s.withdrawal
  if (w.strategy === 'fixed' && s.retirement.real && !w.indexed && infl !== 0) {
    const yearsBefore = Math.floor(((w.startYear - 1) * 12) / 12)
    return { monthly: s.retirement.income * Math.pow(1 + infl, yearsBefore), real: false }
  }
  return { monthly: s.retirement.income, real: s.retirement.real && infl !== 0 }
}

/** Months covered by one payment (monthly 1, quarterly 3, annual 12). */
const monthsPerPayment = (f: Frequency) => 12 / PER_YEAR[f]
/** Monthly income → amount per payment. Monthly is passed through untouched (exact). */
export const monthlyToPayment = (monthly: number, f: Frequency) => (f === 'monthly' ? monthly : monthly * monthsPerPayment(f))
/** Amount per payment → monthly equivalent. */
export const paymentToMonthly = (payment: number, f: Frequency) => (f === 'monthly' ? payment : payment / monthsPerPayment(f))

export function toPlan(s: Scenario): PlanInput {
  const H = Math.min(MAX_HORIZON_MONTHS, Math.max(1, totalMonths(s)))
  const infl = inflationRate(s)
  const growth = s.growthMode === 'none' ? 0 : s.growthMode === 'inflation' ? infl : s.growthRate / 100
  const w = s.withdrawal
  return {
    horizonMonths: H,
    initial: Math.max(0, s.initial),
    annualReturn: s.annualReturn / 100,
    timing: s.timing,
    streams: scheduleStreams(s),
    lumpSums: s.lumpSums.map((l) => ({ month: (l.year - 1) * 12, amount: l.amount })),
    contributionGrowth: growth,
    inflation: infl,
    fees: s.feesEnabled
      ? { annualRate: s.fees.annual / 100, entryRate: s.fees.entry / 100, fixedPerDeposit: s.fees.fixed }
      : { annualRate: 0, entryRate: 0, fixedPerDeposit: 0 },
    withdrawal: w.enabled
      ? {
          startMonth: (w.startYear - 1) * 12,
          endMonth: w.endYear == null ? H : w.endYear * 12,
          // Fixed strategy: the monthly income is the withdrawal; the engine wants it per payment.
          amount: monthlyToPayment(s.retirement.income, w.frequency),
          frequency: w.frequency,
          stopContributions: w.stopContributions,
          indexRate: w.indexed ? infl : 0,
          preIndexRate: s.retirement.real ? infl : 0,
          timing: s.timing,
          policy: withdrawalPolicy(s),
        }
      : null,
  }
}

export function withdrawalPolicy(s: Scenario): WithdrawalPolicy {
  const w = s.withdrawal
  const rate = Math.max(0, w.rate) / 100
  switch (w.strategy) {
    case 'initialPct':
      return { kind: 'initialPct', rate }
    case 'currentPct':
      return { kind: 'currentPct', rate }
    case 'guardrails':
      return {
        kind: 'guardrails',
        rate,
        maxIncrease: w.maxIncrease / 100,
        maxDecrease: w.maxDecrease / 100,
        floorAnnual: w.floor * 12,
        floorIndexRate: w.floorReal ? inflationRate(s) : 0,
      }
    default:
      return { kind: 'fixed' }
  }
}

/** Plan with fees removed but every other assumption identical (fee-impact comparison). */
export function toPlanWithoutFees(s: Scenario): PlanInput {
  return { ...toPlan(s), fees: { annualRate: 0, entryRate: 0, fixedPerDeposit: 0 } }
}

/**
 * Goal solver variable. In constant mode it replaces the regular contribution
 * (answering "how much do I need to invest per period?"); in schedule mode it
 * is an extra monthly amount on top of the timeline.
 */
export function contributionVariable(s: Scenario): (x: number) => PlanInput {
  const base = toPlan(s)
  if (s.contribMode === 'constant') {
    return (x) => toPlan({ ...s, constant: { ...s.constant, amount: x } })
  }
  return (x) => ({
    ...base,
    streams: [...base.streams, { startMonth: 0, endMonth: base.horizonMonths, amount: x, frequency: 'monthly' }],
  })
}

/* ─────────────── validation ─────────────── */

export type IssueCode =
  | 'horizonRange'
  | 'returnRange'
  | 'returnHigh'
  | 'inflationRange'
  | 'feeRange'
  | 'scheduleShort'
  | 'scheduleLong'
  | 'lumpBeyond'
  | 'withdrawalBeyond'
  | 'withdrawalOrder'
  | 'rateRange'
  | 'guardRange'
  | 'goalBeyond'
  | 'ageRange'
  | 'growthRange'

export interface Issue {
  code: IssueCode
  severity: 'error' | 'warning'
  field: string
  params?: Record<string, number | string>
}

export function validateScenario(s: Scenario): Issue[] {
  const out: Issue[] = []
  const H = totalMonths(s)
  const years = horizonYearsCeil(s)
  if (!(H >= 1 && H <= MAX_HORIZON_MONTHS)) out.push({ code: 'horizonRange', severity: 'error', field: 'horizon' })
  if (!(s.annualReturn > -100 && s.annualReturn <= 100))
    out.push({ code: 'returnRange', severity: 'error', field: 'annualReturn' })
  else if (s.annualReturn > 15) out.push({ code: 'returnHigh', severity: 'warning', field: 'annualReturn' })
  if (s.inflationEnabled && !(s.inflation > -50 && s.inflation <= 50))
    out.push({ code: 'inflationRange', severity: 'error', field: 'inflation' })
  if (s.growthMode === 'custom' && !(s.growthRate > -50 && s.growthRate <= 50))
    out.push({ code: 'growthRange', severity: 'error', field: 'growthRate' })
  if (s.feesEnabled) {
    if (!(s.fees.annual >= 0 && s.fees.annual < 100)) out.push({ code: 'feeRange', severity: 'error', field: 'fees.annual' })
    if (!(s.fees.entry >= 0 && s.fees.entry <= 100)) out.push({ code: 'feeRange', severity: 'error', field: 'fees.entry' })
  }
  if (s.startAge != null && !(s.startAge >= 0 && s.startAge <= 120))
    out.push({ code: 'ageRange', severity: 'error', field: 'startAge' })
  if (s.contribMode === 'schedule' && H >= 1) {
    const covered = s.periods.reduce((a, p) => a + p.years, 0)
    if (covered < years) out.push({ code: 'scheduleShort', severity: 'warning', field: 'periods', params: { year: covered + 1 } })
    if (covered > years) out.push({ code: 'scheduleLong', severity: 'warning', field: 'periods', params: { year: years } })
  }
  if (s.lumpSums.some((l) => (l.year - 1) * 12 >= H))
    out.push({ code: 'lumpBeyond', severity: 'warning', field: 'lumpSums' })
  if (s.withdrawal.enabled) {
    if ((s.withdrawal.startYear - 1) * 12 >= H)
      out.push({ code: 'withdrawalBeyond', severity: 'warning', field: 'withdrawal.startYear' })
    if (s.withdrawal.endYear != null && s.withdrawal.endYear < s.withdrawal.startYear)
      out.push({ code: 'withdrawalOrder', severity: 'error', field: 'withdrawal.endYear' })
    if (s.withdrawal.strategy !== 'fixed' && !(s.withdrawal.rate >= 0 && s.withdrawal.rate <= 20))
      out.push({ code: 'rateRange', severity: 'error', field: 'withdrawal.rate' })
    if (s.withdrawal.strategy === 'guardrails' && !(s.withdrawal.maxDecrease >= 0 && s.withdrawal.maxDecrease <= 100 && s.withdrawal.maxIncrease >= 0))
      out.push({ code: 'guardRange', severity: 'error', field: 'withdrawal.guard' })
  }
  if (s.goal.enabled && s.goal.year * 12 > MAX_HORIZON_MONTHS)
    out.push({ code: 'goalBeyond', severity: 'error', field: 'goal.year' })
  return out
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.severity === 'error')
