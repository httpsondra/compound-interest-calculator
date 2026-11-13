import { simulate, toReal } from '../engine/simulate'
import { PER_YEAR, type PlanInput, type SimResult, type WithdrawalYear } from '../engine/types'
import { analyzeGoal, extendPlan, solveMonotone, type GoalAnalysis } from '../engine/solvers'
import { evaluateIncome } from '../engine/income'
import {
  contributionVariable,
  inflationRate,
  scaledAmount,
  toPlan,
  totalMonths,
  withdrawalPolicy,
  type Scenario,
  type WithdrawalStrategy,
} from './scenario'

/*
 * Retirement & financial-independence analysis.
 *
 * Everything here is read from — or solved with — the single `simulate()`
 * engine. No separate retirement formulas, except the explicitly labelled
 * planning identity "required capital = annual income ÷ withdrawal rate".
 *
 * Income conventions
 * • Income of a withdrawal year = what was actually paid in that year ÷ 12
 *   (monthly equivalent, regardless of payment frequency).
 * • Real income deflates by (1 + π)^(year start / 12), i.e. at the start of
 *   each withdrawal year. Withdrawal years begin on plan-year boundaries, so
 *   inflation-indexed fixed withdrawals are exactly constant in real terms.
 * • Only full 12-month withdrawal years enter min / max / final statistics;
 *   a partial final year inside the horizon is shown but not ranked.
 */

export interface IncomeYear extends WithdrawalYear {
  monthly: number
  monthlyRequested: number
  monthlyReal: number
}

export function incomeYears(res: SimResult, inflation: number): IncomeYear[] {
  return res.withdrawalYears.map((y) => {
    const monthly = y.paid / 12
    return { ...y, monthly, monthlyRequested: y.requested / 12, monthlyReal: toReal(monthly, y.startMonth, inflation) }
  })
}

export interface IncomeStats {
  years: IncomeYear[]
  initial: number
  initialReal: number
  final: number
  finalReal: number
  min: number
  minReal: number
  max: number
  maxReal: number
  /** Change in real monthly income from the first to the last full year, in percent. */
  realChange: number
  totalWithdrawn: number
  remaining: number
  depletedAtMonth: number | null
  /** Withdrawal years in which a guardrail changed the budget. */
  adjusted: { year: number; limit: NonNullable<WithdrawalYear['limit']> }[]
  shortfall: number
}

export function incomeStats(res: SimResult, inflation: number): IncomeStats | null {
  const years = incomeYears(res, inflation)
  if (!years.length) return null
  const full = years.filter((y) => y.months === 12)
  const ranked = full.length ? full : years
  const first = years[0]
  const last = ranked[ranked.length - 1]
  const by = (k: 'monthly' | 'monthlyReal', f: (a: number, b: number) => number) => ranked.map((y) => y[k]).reduce((a, b) => f(a, b))
  return {
    years,
    initial: first.monthly,
    initialReal: first.monthlyReal,
    final: last.monthly,
    finalReal: last.monthlyReal,
    min: by('monthly', Math.min),
    minReal: by('monthlyReal', Math.min),
    max: by('monthly', Math.max),
    maxReal: by('monthlyReal', Math.max),
    realChange: first.monthlyReal > 0 ? (last.monthlyReal / first.monthlyReal - 1) * 100 : 0,
    totalWithdrawn: res.totals.withdrawn,
    remaining: res.totals.final,
    depletedAtMonth: res.totals.depletedAtMonth,
    adjusted: years.filter((y) => y.limit).map((y) => ({ year: y.index + 1, limit: y.limit! })),
    shortfall: res.totals.shortfall,
  }
}

/** Monthly income per plan month (step series for the income chart). NaN outside the withdrawal phase. */
export function incomeSeries(res: SimResult, horizon: number, inflation: number, real: boolean, requested = false): number[] {
  const out = new Array<number>(horizon + 1).fill(NaN)
  for (const y of incomeYears(res, inflation)) {
    const v = requested ? (real ? toReal(y.monthlyRequested, y.startMonth, inflation) : y.monthlyRequested) : real ? y.monthlyReal : y.monthly
    for (let m = y.startMonth; m <= Math.min(horizon, y.startMonth + y.months); m++) out[m] = v
  }
  return out
}

/* ───────── Financial independence ───────── */

/** Planning identity: capital needed so that `rate` of it equals the annual income. */
export function requiredCapital(annualIncome: number, ratePct: number): number {
  return ratePct > 0 ? annualIncome / (ratePct / 100) : Infinity
}

/** Plan-year indexation used everywhere in the engine: (1 + π)^(plan year − 1). */
const yearIndex = (inflation: number, month: number) => Math.pow(1 + inflation, Math.floor(month / 12))

export interface FiAnalysis {
  strategy: WithdrawalStrategy
  startMonth: number
  /** Desired annual income in nominal money at retirement start. */
  annualAtStart: number
  monthlyAtStart: number
  /** Capital needed at retirement start (nominal). */
  capital: number
  capitalReal: number
  /** How the capital was derived. */
  method: 'identity' | 'simulated'
  /** Withdrawal rate the capital implies (annual income ÷ capital), percent. */
  impliedRate: number
  projectedAtStart: number
  gap: number
  /** First month the accumulating portfolio reaches the (inflation-growing) capital need. */
  fiMonth: number | null
  /** Solved contribution to reach the capital by the retirement start. */
  goal: GoalAnalysis
  /** FI month with a larger monthly contribution (insight). */
  fiMonthWithMore: { delta: number; month: number | null } | null
  /** Deterministic check of the selected strategy against the desired income. */
  sustain: { meets: boolean; firstShortYear: number | null; yearsChecked: number; lowest: number }
}

function accumulationPlan(s: Scenario): PlanInput {
  return { ...toPlan(s), withdrawal: null }
}

/** Smallest capital at retirement that keeps fixed (optionally indexed) withdrawals paid until the horizon. */
function capitalForFixed(s: Scenario, annualAtStart: number, months: number): number {
  const p = toPlan(s)
  const w = p.withdrawal!
  const perYear = PER_YEAR[w.frequency]
  const sub = (c: number): PlanInput => ({
    ...p,
    horizonMonths: Math.max(1, months),
    initial: c,
    streams: [],
    lumpSums: [],
    fees: { ...p.fees, entryRate: 0, fixedPerDeposit: 0 },
    withdrawal: { ...w, startMonth: 0, endMonth: Infinity, amount: annualAtStart / perYear, policy: { kind: 'fixed' } },
  })
  // Find the smallest capital with no depletion: survival is monotone in capital.
  const ok = (c: number) => simulate(sub(c), { lean: true }).totals.depletedAtMonth === null
  let hi = Math.max(annualAtStart, 1)
  for (let i = 0; i < 80 && !ok(hi); i++) hi *= 2
  let lo = 0
  for (let i = 0; i < 200 && hi - lo > 0.5; i++) {
    const mid = (lo + hi) / 2
    if (ok(mid)) hi = mid
    else lo = mid
  }
  return hi
}

export function fiAnalysis(s: Scenario, res: SimResult): FiAnalysis | null {
  if (!s.withdrawal.enabled) return null
  const H = totalMonths(s)
  const startMonth = (s.withdrawal.startYear - 1) * 12
  if (startMonth >= H) return null
  const infl = inflationRate(s)
  const strategy = s.withdrawal.strategy
  const annualToday = s.retirement.income * 12
  const annualAtStart = s.retirement.real ? annualToday * yearIndex(infl, startMonth) : annualToday
  const endMonth = s.withdrawal.endYear != null ? Math.min(H, s.withdrawal.endYear * 12) : H

  let capital: number
  let method: FiAnalysis['method']
  if (strategy === 'fixed') {
    capital = capitalForFixed(s, annualAtStart, endMonth - startMonth)
    method = 'simulated'
  } else {
    capital = requiredCapital(annualAtStart, s.withdrawal.rate)
    method = 'identity'
  }
  const impliedRate = capital > 0 && Number.isFinite(capital) ? (annualAtStart / capital) * 100 : 0
  const capitalAt = (month: number) => (capital * (s.retirement.real ? yearIndex(infl, month) : 1)) / (s.retirement.real ? yearIndex(infl, startMonth) : 1)

  const acc = accumulationPlan(s)
  const projectedAtStart = res.balances[startMonth]
  const extended = simulate(extendPlan(acc), { lean: true })
  let fiMonth: number | null = null
  for (let m = 0; m < extended.balances.length; m++) {
    if (Number.isFinite(capital) && extended.balances[m] >= capitalAt(m)) {
      fiMonth = m
      break
    }
  }

  const variable = (x: number) => ({ ...contributionVariable(s)(x), withdrawal: null })
  const goal = analyzeGoal(acc, { target: capital, month: startMonth, real: false }, variable)

  let fiMonthWithMore: FiAnalysis['fiMonthWithMore']
  const delta = scaledAmount(2000, s.currency)
  {
    const current = s.contribMode === 'constant' ? s.constant.amount : 0
    const more = simulate(extendPlan({ ...contributionVariable(s)(current + delta), withdrawal: null }), { lean: true })
    let m2: number | null = null
    for (let m = 0; m < more.balances.length; m++) {
      if (Number.isFinite(capital) && more.balances[m] >= capitalAt(m)) {
        m2 = m
        break
      }
    }
    fiMonthWithMore = { delta, month: m2 }
  }

  // Does the selected strategy (deterministically) pay at least the desired income? Same rule as Monte Carlo.
  const ev = evaluateIncome(res.withdrawalYears, infl, s.retirement.income, s.retirement.real)
  const firstShortYear = ev.firstShortIndex != null ? s.withdrawal.startYear + ev.firstShortIndex : null

  return {
    strategy,
    startMonth,
    annualAtStart,
    monthlyAtStart: annualAtStart / 12,
    capital,
    capitalReal: toReal(capital, startMonth, infl),
    method,
    impliedRate,
    projectedAtStart,
    gap: capital - projectedAtStart,
    fiMonth,
    goal,
    fiMonthWithMore,
    sustain: { meets: ev.funded, firstShortYear, yearsChecked: ev.evaluatedYears, lowest: ev.lowest },
  }
}

/* ───────── Stress tests ───────── */

export type StressKind = 'crash20' | 'crash30' | 'crash40' | 'flat5' | 'badStart' | 'custom'
export const STRESS_KINDS: StressKind[] = ['crash20', 'crash30', 'crash40', 'flat5', 'badStart', 'custom']

/*
 * Stress conventions (all relative to the withdrawal start month S):
 * • crashX   — an instantaneous loss of X % at the start of month S, applied after the
 *              first annual review (so a "4 % rule" budget is set on the pre-crash value)
 *              and before the first payment. It is NOT also a negative period return.
 * • flat5    — period returns of 0 % a year for the first five withdrawal years.
 * • badStart — period returns of −15 %, −10 %, −5 % in withdrawal years 1–3.
 * • custom   — the user's annual returns for withdrawal years 1…n (period returns).
 * Outside the stressed years the normal expected return applies. Period returns are
 * spread evenly over the months of the year: (1 + r)^(1/12).
 */
export function stressOptions(kind: StressKind, plan: PlanInput, startMonth: number, custom: number[] = []) {
  const N = plan.horizonMonths
  const base = Math.pow(1 + plan.annualReturn, 1 / 12)
  const factors = new Array<number>(N).fill(base)
  const setYears = (rates: number[]) => {
    rates.forEach((r, k) => {
      const f = Math.pow(Math.max(1 + r, 1e-9), 1 / 12)
      for (let m = startMonth + 12 * k; m < Math.min(N, startMonth + 12 * (k + 1)); m++) factors[m] = f
    })
  }
  switch (kind) {
    case 'crash20':
    case 'crash30':
    case 'crash40': {
      const loss = kind === 'crash20' ? 0.2 : kind === 'crash30' ? 0.3 : 0.4
      return { shocks: [{ month: startMonth, factor: 1 - loss }] }
    }
    case 'flat5':
      setYears([0, 0, 0, 0, 0])
      return { monthFactors: factors }
    case 'badStart':
      setYears([-0.15, -0.1, -0.05])
      return { monthFactors: factors }
    case 'custom':
      setYears(custom.map((r) => r / 100))
      return { monthFactors: factors }
  }
}

export interface StressComparison {
  base: SimResult
  stress: SimResult
  baseStats: IncomeStats | null
  stressStats: IncomeStats | null
}

export function stressTest(s: Scenario, kind: StressKind, custom: number[] = []): StressComparison | null {
  if (!s.withdrawal.enabled) return null
  const plan = toPlan(s)
  const startMonth = (s.withdrawal.startYear - 1) * 12
  if (startMonth >= plan.horizonMonths) return null
  const infl = inflationRate(s)
  const base = simulate(plan)
  const stress = simulate(plan, stressOptions(kind, plan, startMonth, custom))
  return { base, stress, baseStats: incomeStats(base, infl), stressStats: incomeStats(stress, infl) }
}

/* ───────── Strategy comparison (identical assumptions) ───────── */

export interface StrategyRow {
  strategy: WithdrawalStrategy
  result: SimResult
  stats: IncomeStats | null
}

export function compareStrategies(s: Scenario): StrategyRow[] {
  if (!s.withdrawal.enabled) return []
  const infl = inflationRate(s)
  return (['fixed', 'initialPct', 'currentPct', 'guardrails'] as WithdrawalStrategy[]).map((strategy) => {
    const variant: Scenario = { ...s, withdrawal: { ...s.withdrawal, strategy } }
    const plan = toPlan(variant)
    const result = simulate(plan)
    return { strategy, result, stats: incomeStats(result, infl) }
  })
}

/** First-year budget preview for the strategy controls (same engine run as the results). */
export function firstYearBudget(res: SimResult | null): { annual: number; monthly: number; portfolio: number; startMonth: number } | null {
  const y = res?.withdrawalYears[0]
  if (!y) return null
  const annual = y.months === 12 ? y.requested : (y.requested / y.months) * 12
  return { annual, monthly: annual / 12, portfolio: y.reviewBalance, startMonth: y.startMonth }
}

export { withdrawalPolicy, solveMonotone }

/** Cheap desired-income check for the headline (no solving). */
export function incomeCheck(s: Scenario, res: SimResult) {
  if (!s.withdrawal.enabled || !res.withdrawalYears.length) return null
  const ev = evaluateIncome(res.withdrawalYears, inflationRate(s), s.retirement.income, s.retirement.real)
  return { ...ev, firstShortYear: ev.firstShortIndex != null ? s.withdrawal.startYear + ev.firstShortIndex : null }
}
