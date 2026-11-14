import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { simulate, toReal } from '../src/engine/simulate'
import { defaultScenario, toPlan, type Scenario } from '../src/model/scenario'
import { plannedIncome } from '../src/model/retirement'
import { decodeShare, encodeShare, sanitizeScenario } from '../src/model/serialize'
import { buildPreset } from '../src/model/presets'
import { createFormatter } from '../src/lib/format'
import * as v4s from './fixtures/v4/model/scenario'
import * as v4z from './fixtures/v4/model/serialize'
import { simulate as v4simulate } from './fixtures/v4/engine/simulate'

/** The plan from the V4.1 brief: 32 years of saving, then a fixed income from year 33. */
function plan(o: { income?: number; real?: boolean; indexed?: boolean; inflation?: number; startYear?: number; initial?: number; frequency?: Scenario['withdrawal']['frequency'] } = {}): Scenario {
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
    retirement: { income: o.income ?? 40_000, real: o.real ?? true },
    withdrawal: {
      ...s.withdrawal,
      enabled: true,
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
      retirement: { income: 40_000, real: true },
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
    // The "today's money" basis only changes the goal comparison, never the 4 % amount.
    const nominal = run({ ...s, retirement: { income: 40_000, real: false } })
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
  const pick = (r: typeof a) => ({ balances: r.balances, withdrawalYears: r.withdrawalYears, totals: r.totals })
  if (exact) expect(pick(b)).toEqual(pick(a))
  else deepClose(pick(a), pick(b), 1e-12)
}

describe('V4.1 case F — saved V4 plans give identical results', () => {
  it('local storage (sanitize of the saved JSON) reproduces every V4 strategy exactly', () => {
    fc.assert(
      fc.property(arbV4, (old) => {
        const migrated = sanitizeScenario(JSON.parse(JSON.stringify(old)))!
        expect(migrated.v).toBe(3)
        expectSame(old, migrated)
      }),
      { numRuns: 300 },
    )
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
    expect(m.retirement).toEqual({ income: 30_000, real: true })
    expect(m.withdrawal.indexed).toBe(true)
    // 90 000 per quarter is shown as 30 000 a month.
    m = sanitizeScenario(JSON.parse(JSON.stringify({ ...old, withdrawal: { ...old.withdrawal, amount: 90_000, frequency: 'quarterly' } })))!
    expect(m.retirement.income).toBe(30_000)
    expect(toPlan(m).withdrawal!.amount).toBe(90_000)
    old.withdrawal.indexed = false
    m = sanitizeScenario(JSON.parse(JSON.stringify(old)))!
    expect(m.retirement).toEqual({ income: 30_000, real: false })
    expect(m.withdrawal.indexed).toBe(false)
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
    expectSame(old, now)
  })
})
