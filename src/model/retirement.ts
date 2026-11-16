import { simulate, toReal } from '../engine/simulate'
import { PER_YEAR, type PlanInput, type SimResult, type WithdrawalYear } from '../engine/types'
import { analyzeGoal, extendPlan, solveMonotone, type GoalAnalysis } from '../engine/solvers'
import { countedYears, evaluateIncome } from '../engine/income'
import {
  contributionVariable,
  incomeTarget,
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
  // A partial year with no payment inside the horizon is not part of the paid income.
  return countedYears(res.withdrawalYears).map((y) => {
    // Full year: paid ÷ 12. A year cut short by the horizon shows its full-year rate (planned ÷ 12,
    // scaled by the share actually paid) instead of a misleadingly low partial total ÷ 12.
    const partial = y.months < 12
    const share = y.requested > 0 ? Math.min(1, y.paid / y.requested) : 1
    const monthly = partial ? (y.planned / 12) * share : y.paid / 12
    const monthlyRequested = partial ? y.planned / 12 : y.requested / 12
    return { ...y, monthly, monthlyRequested, monthlyReal: toReal(monthly, y.startMonth, inflation) }
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

/**
 * The plan without withdrawals, used to see when the savings reach the capital need.
 * When "stop contributions when withdrawals start" is on, contributions end at the
 * retirement start here too — the projection must not keep saving after retiring.
 */
function withoutWithdrawals(p: PlanInput, s: Scenario): PlanInput {
  const startMonth = (s.withdrawal.startYear - 1) * 12
  const cut = s.withdrawal.stopContributions
  return {
    ...p,
    withdrawal: null,
    streams: cut ? p.streams.map((st) => ({ ...st, endMonth: Math.min(st.endMonth, startMonth) })).filter((st) => st.endMonth > st.startMonth) : p.streams,
  }
}

function accumulationPlan(s: Scenario): PlanInput {
  return withoutWithdrawals(toPlan(s), s)
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
    // Sized for the GOAL: a goal in today's money keeps its purchasing power every year, a
    // nominal goal stays flat — independent of how the planned withdrawal is indexed.
    withdrawal: { ...w, startMonth: 0, endMonth: Infinity, amount: annualAtStart / perYear, indexRate: s.retirement.real ? inflationRate(s) : 0, preIndexRate: 0, policy: { kind: 'fixed' } },
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

/** Financial independence needs an income goal: the capital is sized for the DESIRED income, not the planned withdrawal. */
export function fiAnalysis(s: Scenario, res: SimResult): FiAnalysis | null {
  if (!s.withdrawal.enabled || !s.retirement.enabled) return null
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

  const variable = (x: number) => withoutWithdrawals(contributionVariable(s)(x), s)
  const goal = analyzeGoal(acc, { target: capital, month: startMonth, real: false }, variable)

  let fiMonthWithMore: FiAnalysis['fiMonthWithMore']
  const delta = scaledAmount(2000, s.currency)
  {
    // `delta` is MONTHLY (the card says "a month"); a quarterly/annual contribution gets its equivalent.
    // Schedule mode adds a separate monthly stream, so the delta is used as it is.
    const current = s.contribMode === 'constant' ? s.constant.amount : 0
    const step = s.contribMode === 'constant' ? delta * (12 / PER_YEAR[s.constant.frequency]) : delta
    const more = simulate(extendPlan(withoutWithdrawals(contributionVariable(s)(current + step), s)), { lean: true })
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
  const target = incomeTarget(s)!
  const ev = evaluateIncome(res.withdrawalYears, infl, target.monthly, target.real)
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

/* ───────── Strategy comparison (normalized first-year income) ───────── */

export interface StrategyRow {
  strategy: WithdrawalStrategy
  /** The scenario this row was simulated from (the user's scenario with only the withdrawal rule changed). */
  variant: Scenario
  /** Null when the rule cannot be matched to the target (see `unmatched`). */
  result: SimResult | null
  stats: IncomeStats | null
  /** Percentage rate derived from the matched budget (percent-based rules), else null. */
  rate: number | null
  /** Planned first-year budget actually produced by the engine (annual, nominal). */
  plannedAnnual: number | null
  /** Paid in the first withdrawal year (annual, nominal). */
  paidAnnual: number | null
  /** Why the row is not comparable: the needed rate is outside 0–20 %, or a floor lifted the first year. */
  unmatched: 'rate' | null
  flooredStart: boolean
}

export interface StrategyComparison {
  /** ok = comparable; noIncome = the current withdrawal setting plans no income; noPortfolio = nothing at retirement. */
  status: 'ok' | 'noIncome' | 'noPortfolio'
  /** Strategy the target was read from (the user's selected rule). */
  basis: WithdrawalStrategy
  /** Planned first-year budget (annual, nominal at retirement). */
  annual: number
  monthly: number
  monthlyReal: number
  /** Portfolio at the first annual review. */
  portfolio: number
  startYear: number
  startMonth: number
  rows: StrategyRow[]
}

export const STRATEGIES: WithdrawalStrategy[] = ['fixed', 'initialPct', 'currentPct', 'guardrails']
const MAX_RATE = 20

/**
 * Normalized comparison. The first-year spending budget B is read from the engine run of the user's
 * own withdrawal setting; every strategy then starts from that same B:
 *   fixed        — B/12 per month as a nominal amount at retirement (never re-scaled by inflation before it);
 *   initialPct   — rate = B ÷ portfolio at the first review;  currentPct / guardrails — the same rate.
 * Retirement start, portfolio, returns, fees, inflation, contribution rules, payment frequency, indexing
 * and guardrail limits are the user's. The user's scenario is never modified (variants are copies).
 * No arbitrary income is invented: a zero budget returns `noIncome`.
 */
export function compareStrategies(s: Scenario): StrategyComparison | null {
  if (!s.withdrawal.enabled) return null
  const infl = inflationRate(s)
  const basisRes = simulate(toPlan(s))
  const y0 = basisRes.withdrawalYears[0]
  const empty = (status: StrategyComparison['status'], annual = 0, portfolio = 0, startMonth = 0): StrategyComparison => ({
    status,
    basis: s.withdrawal.strategy,
    annual,
    monthly: annual / 12,
    monthlyReal: toReal(annual / 12, startMonth, infl),
    portfolio,
    startYear: s.withdrawal.startYear,
    startMonth,
    rows: [],
  })
  if (!y0 || y0.months <= 0) return empty('noIncome')
  const annual = y0.planned
  const portfolio = y0.reviewBalance
  if (!(annual > 0)) return empty('noIncome', 0, portfolio, y0.startMonth)
  if (!(portfolio > 0)) return empty('noPortfolio', annual, portfolio, y0.startMonth)
  const rate = (annual / portfolio) * 100
  const rows = STRATEGIES.map((strategy): StrategyRow => {
    const pct = strategy !== 'fixed'
    const variant: Scenario = {
      ...s,
      withdrawal: pct
        ? { ...s.withdrawal, strategy, rate }
        : { ...s.withdrawal, strategy, amount: annual / 12, amountReal: false },
    }
    if (pct && rate > MAX_RATE) {
      return { strategy, variant, result: null, stats: null, rate, plannedAnnual: null, paidAnnual: null, unmatched: 'rate', flooredStart: false }
    }
    const result = simulate(toPlan(variant))
    const first = result.withdrawalYears[0]
    return {
      strategy,
      variant,
      result,
      stats: incomeStats(result, infl),
      rate: pct ? rate : null,
      plannedAnnual: first ? first.planned : null,
      paidAnnual: first ? first.paid : null,
      unmatched: null,
      flooredStart: !!first && Math.abs(first.planned - annual) > annual * 0.005,
    }
  })
  return {
    status: 'ok',
    basis: s.withdrawal.strategy,
    annual,
    monthly: annual / 12,
    monthlyReal: toReal(annual / 12, y0.startMonth, infl),
    portfolio,
    startYear: Math.floor(y0.startMonth / 12) + 1,
    startMonth: y0.startMonth,
    rows,
  }
}

/** First-year budget preview for the strategy controls (same engine run as the results). */
export function firstYearBudget(res: SimResult | null): { annual: number; monthly: number; portfolio: number; startMonth: number } | null {
  const y = res?.withdrawalYears[0]
  if (!y) return null
  const annual = y.planned
  return { annual, monthly: annual / 12, portfolio: y.reviewBalance, startMonth: y.startMonth }
}

export { withdrawalPolicy, solveMonotone }

/** Cheap desired-income check for the headline (no solving). Null without an income goal. */
export function incomeCheck(s: Scenario, res: SimResult) {
  const goal = incomeTarget(s)
  if (!goal || !s.withdrawal.enabled || !res.withdrawalYears.length) return null
  const ev = evaluateIncome(res.withdrawalYears, inflationRate(s), goal.monthly, goal.real)
  // No payment inside the horizon: there is no income to judge (the headline falls back to the balance).
  if (ev.evaluatedYears === 0) return null
  return { ...ev, firstShortYear: ev.firstShortIndex != null ? s.withdrawal.startYear + ev.firstShortIndex : null }
}

/* ───────── Planned income breakdown (withdrawal controls) ───────── */

export interface PlannedIncome {
  strategy: WithdrawalStrategy
  startMonth: number
  startYear: number
  age: number | null
  /** Whole plan years between today and the start of withdrawals. */
  yearsBefore: number
  /** Inflation in percent (0 when inflation is off). */
  inflationPct: number
  /** Planned (requested) monthly amount in the first withdrawal year, nominal. */
  firstMonthly: number
  /** The same in today's purchasing power. */
  firstMonthlyReal: number
  /** Planned monthly amount in the second withdrawal year (shows the in-retirement adjustment). */
  secondMonthly: number | null
  firstAnnual: number
  /** Portfolio value at the first annual review (start of withdrawals). */
  portfolioAtStart: number
  /** Actually paid in the first withdrawal year, monthly equivalent. */
  firstPaidMonthly: number
  /** Planned but not paid in the first year, monthly equivalent. */
  firstUnfundedMonthly: number
  /** Amount of one payment at the selected frequency (first year). */
  perPayment: number
}

/**
 * Reads the planned first-year income from the engine's own withdrawal records. Monthly values
 * are monthly equivalents (annual ÷ 12); a partial first year inside the horizon is pro-rated.
 */
export function plannedIncome(s: Scenario, res: SimResult | null): PlannedIncome | null {
  if (!res || !s.withdrawal.enabled) return null
  const y0 = res.withdrawalYears[0]
  if (!y0 || y0.months <= 0) return null
  const infl = inflationRate(s)
  // Full-year planned budget from the engine: a year cut short by the horizon is not extrapolated.
  const firstAnnual = y0.planned
  const firstMonthly = firstAnnual / 12
  const paidShare = y0.requested > 0 ? Math.min(1, y0.paid / y0.requested) : 1
  const y1 = res.withdrawalYears[1]
  const startYear = Math.floor(y0.startMonth / 12) + 1
  return {
    strategy: s.withdrawal.strategy,
    startMonth: y0.startMonth,
    startYear,
    age: s.startAge != null ? s.startAge + startYear - 1 : null,
    yearsBefore: Math.floor(y0.startMonth / 12),
    inflationPct: infl * 100,
    firstMonthly,
    firstMonthlyReal: toReal(firstMonthly, y0.startMonth, infl),
    secondMonthly: y1 ? y1.planned / 12 : null,
    firstAnnual,
    portfolioAtStart: y0.reviewBalance,
    firstPaidMonthly: firstMonthly * paidShare,
    firstUnfundedMonthly: firstMonthly * (1 - paidShare),
    perPayment: firstAnnual / PER_YEAR[s.withdrawal.frequency],
  }
}

/* ───────── Planned income vs the optional goal ───────── */

export interface GoalComparison {
  /** Goal basis: true = both values in today's money, false = both nominal. */
  real: boolean
  /** Planned monthly income in the first withdrawal year, in the goal's units. */
  planned: number
  goal: number
  /** planned − goal (same units, same month). */
  diff: number
  /** diff ÷ goal, as a fraction (null when the goal is 0). */
  diffShare: number | null
  startYear: number
  /** The whole-retirement funding verdict (same rule as Monte Carlo). */
  funded: boolean
  firstShortYear: number | null
  lowest: number
  evaluatedYears: number
  /** At least one full 12-month withdrawal year inside the plan. */
  fullYears: boolean
}

/**
 * Compare the planned first-year income with the goal in matching units: both monthly, both in
 * the first withdrawal year, both in today's money when the goal is, otherwise both nominal.
 */
export function goalComparison(s: Scenario, res: SimResult | null): GoalComparison | null {
  const target = incomeTarget(s)
  const p = plannedIncome(s, res)
  if (!target || !p || !res) return null
  const planned = target.real ? p.firstMonthlyReal : p.firstMonthly
  const ev = evaluateIncome(res.withdrawalYears, inflationRate(s), target.monthly, target.real)
  return {
    real: target.real,
    planned,
    goal: target.monthly,
    diff: planned - target.monthly,
    diffShare: target.monthly > 0 ? planned / target.monthly - 1 : null,
    startYear: p.startYear,
    funded: ev.funded,
    firstShortYear: ev.firstShortIndex != null ? s.withdrawal.startYear + ev.firstShortIndex : null,
    lowest: ev.lowest,
    evaluatedYears: ev.evaluatedYears,
    fullYears: res.withdrawalYears.some((y) => y.months === 12),
  }
}
