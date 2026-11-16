import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { simulate, toReal } from '../src/engine/simulate'
import { defaultScenario, toPlan, type Scenario } from '../src/model/scenario'
import { compareStrategies, fiAnalysis, goalComparison, incomeCheck, incomeStats, plannedIncome } from '../src/model/retirement'
import { runMonteCarlo } from '../src/engine/montecarlo'
import { incomeTarget } from '../src/model/scenario'
import { decodeShare, encodeShare, sanitizeScenario } from '../src/model/serialize'
import { buildPreset } from '../src/model/presets'
import { createFormatter } from '../src/lib/format'
import * as v4s from './fixtures/v4/model/scenario'
import * as v4z from './fixtures/v4/model/serialize'
import { simulate as v4simulate } from './fixtures/v4/engine/simulate'
import * as v4r from './fixtures/v4/model/retirement'
import { runMonteCarlo as v4MonteCarlo } from './fixtures/v4/engine/montecarlo'

/**
 * The plan from the V4.1 brief: 32 years of saving, then a fixed withdrawal from year 33.
 * income/real = the planned withdrawal and how it is entered; goal = the optional income goal.
 */
function plan(o: { income?: number; real?: boolean; indexed?: boolean; inflation?: number; startYear?: number; initial?: number; frequency?: Scenario['withdrawal']['frequency']; goal?: { income: number; real: boolean } } = {}): Scenario {
  const s = defaultScenario('CZK')
  return {
    ...s,
    initial: o.initial ?? 3_000_000,
    horizonYears: 100,
    horizonMonths: 0,
    annualReturn: 7,
    startAge: 30,
    contribMode: 'constant',
    constant: { amount: 20_000, frequency: 'monthly' },
    inflationEnabled: true,
    inflation: o.inflation ?? 2.5,
    retirement: o.goal ? { enabled: true, ...o.goal } : { ...s.retirement, enabled: false },
    withdrawal: {
      ...s.withdrawal,
      enabled: true,
      amount: o.income ?? 40_000,
      amountReal: o.real ?? true,
      strategy: 'fixed',
      startYear: o.startYear ?? 33,
      endYear: null,
      frequency: o.frequency ?? 'monthly',
      indexed: o.indexed ?? true,
    },
  }
}
const run = (s: Scenario) => simulate(toPlan(s))
/** Monthly equivalent of the planned withdrawal in withdrawal year k (0-based). */
const monthly = (s: Scenario, k: number) => {
  const y = run(s).withdrawalYears[k]
  return y.requested / y.months
}

describe('V4.1 case A — today’s money, raised every year', () => {
  const s = plan()
  it('40 000 today at 2.5 % → ≈ 88 150 a month in year 33 (after 32 years)', () => {
    const first = monthly(s, 0)
    expect(first).toBeCloseTo(40_000 * Math.pow(1.025, 32), 6)
    expect(Math.round(first)).toBe(88_150)
    expect(run(s).withdrawalYears[0].startMonth).toBe(32 * 12)
  })
  it('keeps purchasing power: real value stays 40 000 every withdrawal year', () => {
    const r = run(s)
    for (const y of r.withdrawalYears.slice(0, 20)) expect(toReal(y.requested / y.months, y.startMonth, 0.025)).toBeCloseTo(40_000, 6)
  })
  it('the breakdown model reports the same numbers', () => {
    const p = plannedIncome(s, run(s))!
    expect(p.startYear).toBe(33)
    expect(p.age).toBe(62)
    expect(p.yearsBefore).toBe(32)
    expect(p.firstMonthly).toBeCloseTo(40_000 * Math.pow(1.025, 32), 6)
    expect(p.firstMonthlyReal).toBeCloseTo(40_000, 6)
    expect(p.secondMonthly!).toBeCloseTo(40_000 * Math.pow(1.025, 33), 6)
    expect(p.firstAnnual).toBeCloseTo(12 * p.firstMonthly, 6)
  })
})

describe('V4.1 case B — at retirement, nominal', () => {
  it('the first withdrawal is exactly the entered 40 000', () => {
    const s = plan({ real: false, indexed: true })
    expect(monthly(s, 0)).toBe(40_000)
    expect(plannedIncome(s, run(s))!.firstMonthly).toBe(40_000)
  })
})

describe('V4.1 case C — at retirement, raised during retirement', () => {
  it('40 000 → 41 000 → 42 025', () => {
    const s = plan({ real: false, indexed: true })
    expect(monthly(s, 0)).toBeCloseTo(40_000, 9)
    expect(monthly(s, 1)).toBeCloseTo(41_000, 9)
    expect(monthly(s, 2)).toBeCloseTo(42_025, 9)
  })
})

describe('V4.1 case D — at retirement, not raised', () => {
  it('stays 40 000 nominal while its real value declines', () => {
    const s = plan({ real: false, indexed: false })
    const r = run(s)
    const real = r.withdrawalYears.slice(0, 10).map((y) => {
      expect(y.requested / y.months).toBe(40_000)
      return toReal(40_000, y.startMonth, 0.025)
    })
    for (let i = 1; i < real.length; i++) expect(real[i]).toBeLessThan(real[i - 1])
  })
})

describe('V4.1 case E — 4 % rule gets no pre-retirement inflation multiplier', () => {
  it('10 000 000 at 4 % → 400 000 a year, 33 333.33 a month', () => {
    const s0 = defaultScenario('CZK')
    const s: Scenario = {
      ...s0,
      initial: 10_000_000,
      contribMode: 'constant',
      constant: { amount: 0, frequency: 'monthly' },
      annualReturn: 0,
      horizonYears: 40,
      horizonMonths: 0,
      inflationEnabled: true,
      inflation: 2.5,
      retirement: { enabled: true, income: 40_000, real: true },
      withdrawal: { ...s0.withdrawal, enabled: true, strategy: 'initialPct', rate: 4, startYear: 11, endYear: null, indexed: true },
    }
    const r = run(s)
    expect(r.withdrawalYears[0].reviewBalance).toBe(10_000_000)
    expect(r.withdrawalYears[0].requested).toBeCloseTo(400_000, 6)
    const p = plannedIncome(s, r)!
    expect(p.firstMonthly).toBeCloseTo(33_333.333333, 5)
    expect(p.firstAnnual).toBeCloseTo(400_000, 6)
    // …and the in-retirement switch still raises later years.
    expect(r.withdrawalYears[1].requested).toBeCloseTo(410_000, 6)
    // Neither the goal basis nor the fixed-amount basis changes the 4 % amount.
    const nominal = run({ ...s, retirement: { enabled: true, income: 40_000, real: false }, withdrawal: { ...s.withdrawal, amountReal: false } })
    expect(nominal.withdrawalYears.map((y) => y.requested)).toEqual(r.withdrawalYears.map((y) => y.requested))
  })
})

describe('V4.1 combination matrix (basis × raise during retirement)', () => {
  const pi = 0.025
  const cases: Array<[boolean, boolean, (k: number) => number]> = [
    [true, true, (k) => 40_000 * Math.pow(1 + pi, 32 + k)],
    [true, false, () => 40_000 * Math.pow(1 + pi, 32)],
    [false, true, (k) => 40_000 * Math.pow(1 + pi, k)],
    [false, false, () => 40_000],
  ]
  it.each(cases)('real=%s indexed=%s', (real, indexed, expected) => {
    const s = plan({ real, indexed })
    for (let k = 0; k < 5; k++) expect(monthly(s, k)).toBeCloseTo(expected(k), 6)
  })
  it('inflation is never applied twice: real value never exceeds what was entered in today’s money', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), fc.double({ min: -2, max: 8, noNaN: true }), fc.boolean(), (startYear, infl, indexed) => {
        const s = plan({ startYear, inflation: infl, indexed, real: true, initial: 1e9 })
        const r = run(s)
        const y0 = r.withdrawalYears[0]
        expect(toReal(y0.requested / y0.months, y0.startMonth, infl / 100)).toBeCloseTo(40_000, 5)
      }),
      { numRuns: 60 },
    )
  })
})

describe('V4.1 edge cases', () => {
  it('zero inflation: all four combinations give the same constant income', () => {
    for (const real of [true, false]) for (const indexed of [true, false]) {
      const s = plan({ real, indexed, inflation: 0 })
      expect(monthly(s, 0)).toBe(40_000)
      expect(monthly(s, 3)).toBe(40_000)
    }
  })
  it('negative inflation lowers a today’s-money amount, and inflation off disables both adjustments', () => {
    expect(monthly(plan({ inflation: -1 }), 0)).toBeCloseTo(40_000 * Math.pow(0.99, 32), 6)
    const off = { ...plan(), inflationEnabled: false }
    expect(monthly(off, 0)).toBe(40_000)
    expect(monthly(off, 1)).toBe(40_000)
  })
  it('withdrawals starting in year 1 need no pre-retirement adjustment', () => {
    for (const real of [true, false]) expect(monthly(plan({ startYear: 1, real }), 0)).toBe(40_000)
  })
  it('quarterly and annual payouts keep the same monthly equivalent', () => {
    for (const frequency of ['quarterly', 'annual'] as const) {
      const s = plan({ frequency })
      expect(monthly(s, 0)).toBeCloseTo(40_000 * Math.pow(1.025, 32), 6)
      const p = plannedIncome(s, run(s))!
      expect(p.perPayment).toBeCloseTo(p.firstAnnual / (frequency === 'quarterly' ? 4 : 1), 6)
    }
  })
  it('a fractional horizon prorates the last withdrawal year', () => {
    const s = { ...plan({ real: false, indexed: false }), horizonYears: 33, horizonMonths: 6 }
    const r = run(s)
    expect(r.withdrawalYears).toHaveLength(2)
    expect(r.withdrawalYears[1].months).toBe(6)
    expect(r.withdrawalYears[1].requested).toBeCloseTo(6 * 40_000, 6)
  })
  it('depletion: planned stays planned, paid stops at the balance and the gap is unfunded', () => {
    const s = plan({ initial: 0, real: false, indexed: false, income: 200_000 })
    const r = run(s)
    expect(r.totals.depletedAtMonth).not.toBeNull()
    const last = r.withdrawalYears[r.withdrawalYears.length - 1]
    expect(last.requested).toBe(12 * 200_000)
    expect(last.paid).toBeLessThan(last.requested)
    expect(r.totals.shortfall).toBeGreaterThan(0)
    const dep = r.withdrawalYears.find((y) => y.paid < y.requested)!
    const p = plannedIncome({ ...s }, { ...r, withdrawalYears: [dep, ...r.withdrawalYears.slice(r.withdrawalYears.indexOf(dep) + 1)] })!
    expect(p.firstUnfundedMonthly).toBeGreaterThan(0)
    expect(p.firstPaidMonthly + p.firstUnfundedMonthly).toBeCloseTo(p.firstMonthly, 6)
  })
  it('currency formatting of the brief’s example in cs, en and each currency', () => {
    const v = 40_000 * Math.pow(1.025, 32)
    const cs = createFormatter('cs')
    const en = createFormatter('en')
    expect(cs.money(v, 'CZK')).toMatch(/^88\s150\sKč$/)
    expect(en.money(v, 'CZK')).toMatch(/88,150/)
    expect(en.money(v, 'EUR')).toMatch(/€\s?88,150|88,150\s?€/)
    expect(en.money(v, 'USD')).toMatch(/\$88,150/)
  })
})

describe('V4.2 audit: FI capital is sized for the goal, independent of the withdrawal’s indexing', () => {
  // Closed form: PV at retirement of 360 monthly-in-advance payments growing g a year, discounted at 5 %.
  const pv = (first: number, g: number) => {
    const m = Math.pow(1.05, 1 / 12)
    let s = 0
    for (let k = 0; k < 360; k++) s += (first * Math.pow(1 + g, Math.floor(k / 12))) / Math.pow(m, k)
    return s
  }
  it.each([[true, true], [false, true], [true, false], [false, false]])('withdrawal indexed=%s, goal real=%s', (indexed, real) => {
    const s0 = defaultScenario('CZK')
    const s: Scenario = { ...s0, horizonYears: 50, timing: 'start', annualReturn: 5, withdrawal: { ...s0.withdrawal, enabled: true, startYear: 21, indexed }, retirement: { enabled: true, income: real ? 40_000 : 40_000 * Math.pow(1.025, 20), real } }
    const fi = fiAnalysis(s, run(s))!
    const ref = pv(40_000 * Math.pow(1.025, 20), real ? 0.025 : 0)
    expect(Math.abs(fi.capital - ref) / ref).toBeLessThan(1e-6)
  })
})

describe('V4.2 audit: “with X more a month” really is per month (GF-2)', () => {
  it('annual contributions get 12 × the monthly delta; same result as a monthly plan', () => {
    const base = (frequency: 'monthly' | 'annual', amount: number): Scenario => {
      const s0 = defaultScenario('CZK')
      return { ...s0, constant: { amount, frequency }, timing: 'start', withdrawal: { ...s0.withdrawal, enabled: true, startYear: 25 }, retirement: { enabled: true, income: 40_000, real: true }, horizonYears: 60 }
    }
    const a = base('annual', 60_000) // 5 000 a month, paid yearly
    const fa = fiAnalysis(a, run(a))!
    // An explicit check: annual 60 000 + 24 000 must reach the capital in the reported month.
    const plus = { ...a, constant: { amount: 84_000, frequency: 'annual' as const } }
    const fp = fiAnalysis(plus, run(plus))!
    expect(fa.fiMonthWithMore!.month).toBe(fp.fiMonth)
  })
})

describe('V4.1 review fixes', () => {
  it('without an income goal there are no goal metrics; the plan is judged by what it pays', () => {
    const s = plan({ initial: 1e9 })
    const r = run(s)
    expect(incomeTarget(s)).toBeNull()
    expect(incomeCheck(s, r)).toBeNull()
    expect(fiAnalysis(s, r)).toBeNull()
    expect(r.totals.shortfall).toBe(0)
  })
  it('the goal is checked in its own units, independent of how the withdrawal was entered', () => {
    const cases: Array<[boolean, boolean, { income: number; real: boolean }, boolean]> = [
      // withdrawal basis, raised in retirement, goal, funded?
      [true, true, { income: 40_000, real: true }, true], // keeps purchasing power → meets a real goal
      [true, false, { income: 40_000, real: true }, false], // constant nominal → falls below a real goal from year 34
      [true, false, { income: 88_150, real: false }, true], // …but meets the same nominal amount
      [false, true, { income: 40_000, real: false }, true],
      [false, false, { income: 40_000, real: false }, true],
      [false, false, { income: 40_000, real: true }, false], // 40 000 nominal in year 33 ≈ 18 150 today
    ]
    for (const [real, indexed, goal, funded] of cases) {
      const s = plan({ real, indexed, initial: 1e9, goal })
      const r = run(s)
      expect(incomeCheck(s, r)!.funded).toBe(funded)
      expect(fiAnalysis(s, r)!.sustain.meets).toBe(funded)
      const mc = runMonteCarlo({ plan: toPlan(s), volatility: 0, simulations: 3, seed: 1, income: incomeTarget(s) })
      expect(mc.incomeProbability).toBe(funded ? 1 : 0)
    }
  })
  it('goal comparison uses matching units: first withdrawal year, monthly, real vs real or nominal vs nominal', () => {
    const real = goalComparison(plan({ goal: { income: 45_000, real: true } }), run(plan()))!
    expect(real.real).toBe(true)
    expect(real.planned).toBeCloseTo(40_000, 6) // 88 150 in year 33 = 40 000 today
    expect(real.diff).toBeCloseTo(-5_000, 6)
    expect(real.diffShare!).toBeCloseTo(-1 / 9, 9)
    const nominal = goalComparison(plan({ goal: { income: 80_000, real: false } }), run(plan()))!
    expect(nominal.real).toBe(false)
    expect(nominal.planned).toBeCloseTo(40_000 * Math.pow(1.025, 32), 6)
    expect(nominal.diff).toBeCloseTo(40_000 * Math.pow(1.025, 32) - 80_000, 6)
  })
  it('a goal copied from the planned income (rounded down) is reached, never “±0 but short”', () => {
    for (const startYear of [2, 11, 21, 33]) for (const real of [true, false]) {
      const base = plan({ startYear, initial: 1e9 })
      const r = run(base)
      const p = plannedIncome(base, r)!
      const income = Math.floor((real ? p.firstMonthlyReal : p.firstMonthly) + 1e-9)
      const s = { ...base, retirement: { enabled: true, income, real } }
      const cmp = goalComparison(s, r)!
      expect(cmp.diff).toBeGreaterThanOrEqual(0)
      expect(cmp.funded).toBe(true)
    }
  })
  it('goal comparison knows when no full retirement year exists', () => {
    const s = { ...plan({ goal: { income: 1, real: false } }), horizonYears: 32, horizonMonths: 6 }
    const cmp = goalComparison(s, run(s))!
    expect(cmp.fullYears).toBe(false)
    expect(goalComparison(plan({ goal: { income: 1, real: false } }), run(plan()))!.fullYears).toBe(true)
  })
  it('the goal never changes cashflows', () => {
    const a = run(plan())
    const b = run(plan({ goal: { income: 1, real: false } }))
    const c = run(plan({ goal: { income: 1e6, real: true } }))
    expect(b.balances).toEqual(a.balances)
    expect(c.withdrawalYears).toEqual(a.withdrawalYears)
  })
  it.each([
    ['monthly', 'start'], ['quarterly', 'start'], ['annual', 'start'],
    ['monthly', 'end'], ['quarterly', 'end'], ['annual', 'end'],
  ] as const)('a partial withdrawal phase (%s, %s) is judged at its full-year rate everywhere', (frequency, timing) => {
    for (const extra of [1, 4, 5, 7]) {
      const s = { ...plan({ real: false, indexed: false, frequency, initial: 1e8, goal: { income: 40_000, real: false } }), timing, horizonYears: 32, horizonMonths: extra }
      const r = run(s)
      const y0 = r.withdrawalYears[0]
      const p = plannedIncome(s, r)!
      expect(p.firstMonthly).toBeCloseTo(40_000, 6)
      expect(p.perPayment).toBeCloseTo(40_000 * (frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12), 6)
      expect(p.firstUnfundedMonthly).toBeCloseTo(0, 6)
      const t = incomeTarget(s)
      const mc = runMonteCarlo({ plan: toPlan(s), volatility: 0, simulations: 2, seed: 1, income: t })
      if (y0.requested > 0) {
        // A payment falls inside the horizon: everything agrees on 40 000 a month, funded.
        expect(incomeStats(r, 0.025)!.initial).toBeCloseTo(40_000, 6)
        expect(incomeCheck(s, r)!.funded).toBe(true)
        expect(incomeCheck(s, r)!.lowest).toBeCloseTo(40_000, 6)
        expect(fiAnalysis(s, r)!.sustain.meets).toBe(true)
        expect(mc.incomeProbability).toBe(1)
      } else {
        // Nothing is paid inside the horizon: no income is shown and nothing counts as funded.
        expect(incomeStats(r, 0.025)).toBeNull()
        expect(incomeCheck(s, r)).toBeNull()
        expect(mc.incomeProbability).toBe(0)
      }
    }
  })
  it('a partial phase never reports a percentage plan as funded above its true rate', () => {
    const base = plan({ real: false, indexed: false, initial: 1e8, frequency: 'quarterly' })
    const s: Scenario = { ...base, horizonYears: 32, horizonMonths: 5, timing: 'start', withdrawal: { ...base.withdrawal, strategy: 'currentPct', rate: 4 } }
    const r = run(s)
    const trueRate = r.withdrawalYears[0].planned / 12
    const above = { ...s, retirement: { enabled: true, income: trueRate * 1.15, real: false } }
    expect(incomeCheck(above, r)!.funded).toBe(false)
    expect(runMonteCarlo({ plan: toPlan(above), volatility: 0, simulations: 2, seed: 1, income: incomeTarget(above) }).incomeProbability).toBe(0)
    const below = { ...s, retirement: { enabled: true, income: trueRate * 0.99, real: false } }
    expect(incomeCheck(below, r)!.funded).toBe(true)
  })
  it('a zero budget in a partial year still counts as zero income (not as “no withdrawals”)', () => {
    const base = plan({ real: false, indexed: false, initial: 0, goal: { income: 1_000, real: false } })
    const s: Scenario = { ...base, constant: { amount: 0, frequency: 'monthly' }, horizonYears: 0, horizonMonths: 6, withdrawal: { ...base.withdrawal, strategy: 'currentPct', startYear: 1 } }
    const r = run(s)
    expect(incomeStats(r, 0)!.initial).toBe(0)
    const c = incomeCheck(s, r)!
    expect(c.funded).toBe(false)
    expect(c.firstShortYear).toBe(1)
  })
  it('the withdrawal summary budget uses the full-year rate', async () => {
    const { firstYearBudget } = await import('../src/model/retirement')
    const base = plan({ real: false, indexed: false, initial: 1e7, frequency: 'annual' })
    const s: Scenario = { ...base, constant: { amount: 0, frequency: 'monthly' }, annualReturn: 0, inflation: 0, horizonYears: 2, horizonMonths: 5, timing: 'start', withdrawal: { ...base.withdrawal, strategy: 'currentPct', rate: 4, startYear: 3 } }
    expect(firstYearBudget(run(s))!.monthly).toBeCloseTo(400_000 / 12, 6)
  })
  it('the engine reports the full-year planned budget for every strategy', () => {
    const s = { ...plan({ real: false, indexed: true, initial: 1e8 }), horizonYears: 33, horizonMonths: 3 }
    const r = run(s)
    expect(r.withdrawalYears[0].planned).toBeCloseTo(12 * 40_000, 6)
    expect(r.withdrawalYears[1].planned).toBeCloseTo(12 * 41_000, 6)
    expect(r.withdrawalYears[1].months).toBe(3)
    const pct = run({ ...s, withdrawal: { ...s.withdrawal, strategy: 'initialPct', rate: 4 } })
    expect(pct.withdrawalYears[0].planned).toBeCloseTo(0.04 * pct.withdrawalYears[0].reviewBalance, 6)
  })
})

/* ---------- Case F: backward compatibility with saved V4 plans ---------- */

type V4 = v4s.Scenario
const v4Base = (): V4 => v4s.defaultScenario('CZK')

const arbV4 = fc
  .record({
    initial: fc.integer({ min: 0, max: 20_000_000 }),
    contribution: fc.integer({ min: 0, max: 60_000 }),
    horizonYears: fc.integer({ min: 1, max: 60 }),
    horizonMonths: fc.integer({ min: 0, max: 11 }),
    annualReturn: fc.double({ min: -5, max: 15, noNaN: true }),
    inflationEnabled: fc.boolean(),
    inflation: fc.double({ min: -2, max: 10, noNaN: true }),
    timing: fc.constantFrom('start' as const, 'end' as const),
    growthMode: fc.constantFrom('none' as const, 'custom' as const, 'inflation' as const),
    strategy: fc.constantFrom('fixed' as const, 'initialPct' as const, 'currentPct' as const, 'guardrails' as const),
    startYear: fc.integer({ min: 1, max: 40 }),
    endYear: fc.option(fc.integer({ min: 1, max: 70 }), { nil: null }),
    amount: fc.integer({ min: 0, max: 150_000 }),
    frequency: fc.constantFrom('monthly' as const, 'quarterly' as const, 'annual' as const),
    indexed: fc.boolean(),
    stopContributions: fc.boolean(),
    rate: fc.double({ min: 0.5, max: 10, noNaN: true }),
    maxIncrease: fc.double({ min: 0, max: 20, noNaN: true }),
    maxDecrease: fc.double({ min: 0, max: 20, noNaN: true }),
    floor: fc.integer({ min: 0, max: 60_000 }),
    income: fc.integer({ min: 0, max: 150_000 }),
    real: fc.boolean(),
    feesEnabled: fc.boolean(),
  })
  .map((o): V4 => {
    const b = v4Base()
    return {
      ...b,
      initial: o.initial,
      constant: { amount: o.contribution, frequency: 'monthly' },
      horizonYears: o.horizonYears,
      horizonMonths: o.horizonMonths,
      annualReturn: o.annualReturn,
      inflationEnabled: o.inflationEnabled,
      inflation: o.inflation,
      timing: o.timing,
      growthMode: o.growthMode,
      feesEnabled: o.feesEnabled,
      withdrawal: {
        ...b.withdrawal,
        enabled: true,
        strategy: o.strategy,
        startYear: o.startYear,
        endYear: o.endYear != null && o.endYear >= o.startYear ? o.endYear : null,
        amount: o.amount,
        frequency: o.frequency,
        indexed: o.indexed,
        stopContributions: o.stopContributions,
        rate: o.rate,
        maxIncrease: o.maxIncrease,
        maxDecrease: o.maxDecrease,
        floor: o.floor,
      },
      retirement: { income: o.income, real: o.real },
    }
  })

const noIds = (x: unknown) => JSON.parse(JSON.stringify(x), (k, v) => (k === 'id' ? undefined : v))

/** Relative closeness for every number in two result structures. */
function deepClose(a: unknown, b: unknown, rel: number, path = ''): void {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Object.is(a, b) || (Number.isFinite(a) && Math.abs(a - b) <= rel * Math.max(1, Math.abs(a)))) return
    throw new Error(`${path}: ${a} ≠ ${b}`)
  }
  if (a && typeof a === 'object') {
    expect(Object.keys(b as object).sort()).toEqual(Object.keys(a).sort())
    for (const k of Object.keys(a)) deepClose((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], rel, `${path}.${k}`)
    return
  }
  expect(b).toEqual(a)
}

/**
 * Same balances, withdrawal years and totals. Bit-identical, except a quarterly or annual fixed
 * amount, which V4.1 stores as its monthly equivalent (÷ 3 or ÷ 12 and back): there the last
 * binary digit may differ (relative 1e-12, far below any displayed figure).
 */
function expectSame(old: V4, migrated: Scenario) {
  const a = v4simulate(v4s.toPlan(old))
  const b = simulate(toPlan(migrated))
  const w = old.withdrawal
  const exact = !w.enabled || w.strategy !== 'fixed' || w.frequency === 'monthly'
  // V4.1 adds `planned` (full-year budget) to each withdrawal year; every V4 field must match.
  const pick = (r: typeof a) => ({
    balances: r.balances,
    withdrawalYears: r.withdrawalYears.map(({ index, startMonth, months, reviewBalance, requested, paid, target, limit }) => ({ index, startMonth, months, reviewBalance, requested, paid, target, limit })),
    totals: r.totals,
  })
  if (exact) expect(pick(b)).toEqual(pick(a))
  else deepClose(pick(a), pick(b), 1e-12)
}

/**
 * V4.1 deliberately fixed one case of the income rule: a withdrawal phase shorter than a year
 * with quarterly/annual payouts (V4 divided lumpy payments by the months), or whose only payment
 * falls after the horizon. Everywhere else the goal metrics must match V4.
 */
const partialOnlyPhase = (old: V4) => {
  const ys = v4simulate(v4s.toPlan(old)).withdrawalYears
  return ys.length > 0 && !ys.some((y) => y.months === 12) && (old.withdrawal.frequency !== 'monthly' || ys.some((y) => y.requested === 0))
}

/** Same desired-income goal, FI analysis and funding verdict as V4 computed. */
function expectSameGoals(old: V4, m: Scenario) {
  expect(m.retirement).toEqual({ enabled: true, income: old.retirement.income, real: old.retirement.real })
  const ra = v4simulate(v4s.toPlan(old))
  const rb = simulate(toPlan(m))
  const fa = v4r.fiAnalysis(old, ra)
  const fb = fiAnalysis(m, rb)
  if (fa == null) return expect(fb).toBeNull()
  expect(fb).not.toBeNull()
  const { sustain: sa, ...ka } = fa
  const { sustain: sb, ...kb } = fb!
  // V4.2 audit fix: V4 sized the FI capital of a FIXED plan with the withdrawal's indexing switch
  // instead of the goal's basis. Where the two agree V4 was right and must match exactly; where
  // they differ the capital (and everything derived from it) is intentionally corrected.
  const infl = old.inflationEnabled ? old.inflation / 100 : 0
  const corrected = old.withdrawal.strategy === 'fixed' && old.withdrawal.indexed !== old.retirement.real && infl !== 0
  if (corrected) {
    for (const k of ['strategy', 'startMonth', 'annualAtStart', 'monthlyAtStart', 'method', 'projectedAtStart'] as const) deepClose(ka[k], kb[k], 1e-9)
  } else deepClose(ka, kb, 1e-9)
  const ca = v4r.incomeCheck(old, ra)
  const cb = incomeCheck(m, rb)
  if (partialOnlyPhase(old)) return
  deepClose(sa, sb, 1e-9)
  expect(cb?.funded).toBe(ca?.funded)
  expect(cb?.firstShortYear ?? null).toBe(ca?.firstShortYear ?? null)
}

describe('V4.1 case F — saved V4 plans give identical results', () => {
  it('local storage (sanitize of the saved JSON) reproduces every V4 strategy exactly', () => {
    fc.assert(
      fc.property(arbV4, (old) => {
        const migrated = sanitizeScenario(JSON.parse(JSON.stringify(old)))!
        expect(migrated.v).toBe(4)
        expectSame(old, migrated)
      }),
      { numRuns: 300 },
    )
  })
  it('saved V4 plans keep their desired-income goal, FI capital and funding verdict', () => {
    fc.assert(
      fc.property(arbV4, (old) => {
        expectSameGoals(old, sanitizeScenario(JSON.parse(JSON.stringify(old)))!)
      }),
      { numRuns: 120 },
    )
  })
  it('V4 share links keep the goal metrics too', () => {
    fc.assert(
      fc.property(arbV4, (old) => {
        expectSameGoals(old, decodeShare(v4z.encodeShare(old))!)
      }),
      { numRuns: 40 },
    )
  })
  it('Monte Carlo income probability and income distributions match V4', () => {
    fc.assert(
      fc.property(arbV4, fc.integer({ min: 1, max: 1000 }), (old, seed) => {
        if (partialOnlyPhase(old)) return
        const m = sanitizeScenario(JSON.parse(JSON.stringify(old)))!
        const a = v4MonteCarlo({ plan: v4s.toPlan(old), volatility: 0.15, simulations: 40, seed, income: { monthly: old.retirement.income, real: old.retirement.real } })
        const b = runMonteCarlo({ plan: toPlan(m), volatility: 0.15, simulations: 40, seed, income: incomeTarget(m) })
        expect(b.incomeProbability).toBe(a.incomeProbability)
        expect(b.depletionProbability).toBe(a.depletionProbability)
        deepClose(a.lowestIncome, b.lowestIncome, 1e-9)
        deepClose(a.firstIncome, b.firstIncome, 1e-9)
        deepClose(a.finalPercentiles, b.finalPercentiles, 1e-9)
      }),
      { numRuns: 30 },
    )
  })
  it('the V4 default with withdrawals on keeps both values: 20 000 withdrawn, 40 000 desired', () => {
    const old = v4Base()
    old.withdrawal = { ...old.withdrawal, enabled: true }
    const m = sanitizeScenario(JSON.parse(JSON.stringify(old)))!
    expect(m.withdrawal.amount).toBe(20_000)
    expect(m.retirement).toEqual({ enabled: true, income: 40_000, real: true })
    expectSame(old, m)
    expectSameGoals(old, m)
    const fi = fiAnalysis(m, simulate(toPlan(m)))!
    expect(fi.capital).toBeCloseTo(v4r.fiAnalysis(old, v4simulate(v4s.toPlan(old)))!.capital, 6)
  })
  it('V4 share links decode to the same results', () => {
    fc.assert(
      fc.property(arbV4, (old) => {
        expectSame(old, decodeShare(v4z.encodeShare(old))!)
      }),
      { numRuns: 120 },
    )
  })
  it('a V4 fixed plan maps onto the new controls without reinterpretation', () => {
    const old = v4Base()
    old.withdrawal = { ...old.withdrawal, enabled: true, amount: 30_000, indexed: true }
    let m = sanitizeScenario(JSON.parse(JSON.stringify(old)))!
    expect(m.withdrawal).toMatchObject({ amount: 30_000, amountReal: true, indexed: true })
    expect(m.retirement).toEqual({ enabled: true, income: old.retirement.income, real: old.retirement.real })
    // 90 000 per quarter is shown as 30 000 a month.
    m = sanitizeScenario(JSON.parse(JSON.stringify({ ...old, withdrawal: { ...old.withdrawal, amount: 90_000, frequency: 'quarterly' } })))!
    expect(m.withdrawal.amount).toBe(30_000)
    expect(toPlan(m).withdrawal!.amount).toBe(90_000)
    old.withdrawal.indexed = false
    m = sanitizeScenario(JSON.parse(JSON.stringify(old)))!
    expect(m.withdrawal).toMatchObject({ amount: 30_000, amountReal: false, indexed: false })
  })
  it('V4 guardrails floor keeps its old indexing; new plans default to today’s money', () => {
    const old = v4Base()
    old.withdrawal = { ...old.withdrawal, enabled: true, strategy: 'guardrails', floor: 20_000, indexed: false }
    expect(sanitizeScenario(JSON.parse(JSON.stringify(old)))!.withdrawal.floorReal).toBe(false)
    expect(defaultScenario('CZK').withdrawal.floorReal).toBe(true)
  })
  // Period ids are regenerated on load; everything else must survive.
  it('migrated scenarios round-trip through V4.1 storage and share links unchanged', () => {
    fc.assert(
      fc.property(arbV4, (old) => {
        const m = sanitizeScenario(JSON.parse(JSON.stringify(old)))!
        expect(noIds(sanitizeScenario(JSON.parse(JSON.stringify(m))))).toEqual(noIds(m))
        expect(noIds(decodeShare(encodeShare(m)))).toEqual(noIds(m))
      }),
      { numRuns: 80 },
    )
  })
  it('presets reproduce the V4 trajectories', () => {
    // V4 lifecycle preset: fixed 25 000 indexed from year 31.
    const now = buildPreset('lifecycle', 'CZK')
    const old: V4 = { ...v4Base(), ...JSON.parse(JSON.stringify(now)), v: 2 }
    old.withdrawal = { ...old.withdrawal, amount: 25_000 } as V4['withdrawal']
    old.retirement = { income: 40_000, real: true }
    expectSame(old, now)
    expectSameGoals(old, now)
  })
  it('the FI preset reproduces V4 including the strategy comparison', () => {
    const now = buildPreset('fi', 'CZK')
    const old: V4 = { ...v4Base(), ...JSON.parse(JSON.stringify(now)), v: 2 }
    old.withdrawal = { ...old.withdrawal, amount: 20_000 } as V4['withdrawal']
    old.retirement = { income: 45_000, real: true }
    expectSame(old, now)
    expectSameGoals(old, now)
    const a = v4r.compareStrategies(old)
    const b = compareStrategies(now)!.rows
    expect(b.map((r) => r.strategy)).toEqual(a.map((r) => r.strategy))
    // V4 compared each rule with its own settings; V5.2.1 normalizes the starting income. The row of the
    // user's own rule is that same simulation, so it must reproduce V4 exactly (to rounding of the derived rate).
    const own = b.findIndex((r) => r.strategy === now.withdrawal.strategy)
    for (let m = 0; m < a[own].result.balances.length; m++) expect(b[own].result!.balances[m]).toBeCloseTo(a[own].result.balances[m], 4)
  })
  it('v3 plans from the first V4.1 preview keep their withdrawal; a percentage plan keeps its goal', () => {
    const v3 = { ...plan(), v: 3, retirement: { income: 40_000, real: true }, withdrawal: { ...plan().withdrawal, amount: undefined, amountReal: undefined } }
    const m = sanitizeScenario(JSON.parse(JSON.stringify(v3)))!
    expect(m.withdrawal).toMatchObject({ amount: 40_000, amountReal: true })
    expect(m.retirement.enabled).toBe(false)
    expect(run(m).withdrawalYears[0].requested).toBeCloseTo(12 * 40_000 * Math.pow(1.025, 32), 6)
    const pct = sanitizeScenario(JSON.parse(JSON.stringify({ ...v3, withdrawal: { ...v3.withdrawal, strategy: 'initialPct' } })))!
    expect(pct.retirement).toEqual({ enabled: true, income: 40_000, real: true })
  })
  it('new plans have no goal; the planned withdrawal and the goal are separate fields', () => {
    const d = defaultScenario('CZK')
    expect(d.retirement.enabled).toBe(false)
    expect(d.withdrawal.amount).toBe(40_000)
    const back = sanitizeScenario(JSON.parse(JSON.stringify({ ...d, retirement: { enabled: true, income: 55_000, real: false } })))!
    expect(back.retirement).toEqual({ enabled: true, income: 55_000, real: false })
    expect(back.withdrawal.amount).toBe(40_000)
  })
})
