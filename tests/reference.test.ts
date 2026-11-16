import { describe, expect, it } from 'vitest'
import { simulate, toReal } from '../src/engine/simulate'
import { solveMonotone } from '../src/engine/solvers'
import type { Frequency, PlanInput, Timing, WithdrawalPolicy } from '../src/engine/types'

/*
 * Independent reference cases (V4.2 audit). Every expected value below is a closed-form
 * financial identity written out by hand — none of it calls engine helpers — so these tests
 * catch convention errors that comparing two engine paths would not.
 */

const plan = (o: Partial<PlanInput> = {}): PlanInput => ({
  horizonMonths: 120,
  initial: 0,
  annualReturn: 0,
  timing: 'end',
  streams: [],
  lumpSums: [],
  contributionGrowth: 0,
  inflation: 0,
  fees: { annualRate: 0, entryRate: 0, fixedPerDeposit: 0 },
  withdrawal: null,
  ...o,
})
const rel = (a: number, b: number, tol = 1e-10) => expect(Math.abs(a - b) / Math.max(1, Math.abs(b))).toBeLessThan(tol)
const PER: Record<Frequency, number> = { weekly: 52, monthly: 12, quarterly: 4, semiannual: 2, annual: 1 }

describe('reference: lump sum compounding (effective annual rate)', () => {
  it.each([0, 0.07, -0.3, 2.5, -0.999])('P·(1+R)^years for R = %s, incl. fractional years', (R) => {
    for (const months of [1, 6, 12, 30, 121, 1200]) {
      const r = simulate(plan({ initial: 1_000_000, annualReturn: R, horizonMonths: months }))
      rel(r.totals.final, 1_000_000 * Math.pow(1 + R, months / 12))
    }
  })
  it('10 % a year is 110 000 after a year — not (1 + 0.1/12)^12', () => {
    rel(simulate(plan({ initial: 100_000, annualReturn: 0.1, horizonMonths: 12 })).totals.final, 110_000)
  })
})

describe('reference: regular contributions (annuity formulas, effective periodic rate)', () => {
  const cases: Array<[Frequency, Timing]> = []
  for (const f of ['weekly', 'monthly', 'quarterly', 'semiannual', 'annual'] as Frequency[]) for (const t of ['start', 'end'] as Timing[]) cases.push([f, t])
  it.each(cases)('%s deposits at the %s of each interval', (frequency, timing) => {
    const R = 0.06
    const years = 10
    const pmt = 1_000
    const n = PER[frequency] * years
    const i = Math.pow(1 + R, 1 / PER[frequency]) - 1
    const ordinary = (pmt * (Math.pow(1 + i, n) - 1)) / i
    const expected = timing === 'start' ? ordinary * (1 + i) : ordinary
    const r = simulate(plan({ annualReturn: R, horizonMonths: years * 12, timing, streams: [{ startMonth: 0, endMonth: Infinity, amount: pmt, frequency }] }))
    rel(r.totals.final, expected, 1e-9)
    rel(r.totals.contributed, pmt * n)
  })
  it('zero return: final equals the sum of deposits (no deposit beyond the horizon)', () => {
    for (const frequency of ['weekly', 'monthly', 'quarterly', 'semiannual', 'annual'] as Frequency[]) {
      for (const timing of ['start', 'end'] as Timing[]) {
        const r = simulate(plan({ horizonMonths: 30, timing, streams: [{ startMonth: 0, endMonth: Infinity, amount: 100, frequency }] }))
        // 30 months: count of deposits inside [0, 30] (start: t = 0, Δ, …; end: t = Δ, 2Δ, … ≤ 30)
        const step = 12 / PER[frequency]
        let count = 0
        for (let k = 0; ; k++) {
          const t = timing === 'start' ? k * step : (k + 1) * step
          if (timing === 'start' ? t >= 30 - 1e-9 : t > 30 + 1e-9) break
          count++
        }
        rel(r.totals.final, 100 * count)
      }
    }
  })
  it('growing contributions: amount × (1+g)^(plan year − 1), annual deposits at the start', () => {
    const g = 0.03
    const R = 0.05
    const r = simulate(plan({ annualReturn: R, horizonMonths: 60, timing: 'start', contributionGrowth: g, streams: [{ startMonth: 0, endMonth: Infinity, amount: 10_000, frequency: 'annual' }] }))
    let fv = 0
    for (let y = 0; y < 5; y++) fv += 10_000 * Math.pow(1 + g, y) * Math.pow(1 + R, 5 - y)
    rel(r.totals.final, fv)
  })
})

describe('reference: fees', () => {
  it('annual fee f is effective: P·((1+R)(1−f))^years; fees + lost growth reconcile', () => {
    const P = 1_000_000
    const R = 0.07
    const f = 0.01
    const r = simulate(plan({ initial: P, annualReturn: R, horizonMonths: 240, fees: { annualRate: f, entryRate: 0, fixedPerDeposit: 0 } }))
    rel(r.totals.final, P * Math.pow((1 + R) * (1 - f), 20))
    const noFee = P * Math.pow(1 + R, 20)
    // Ending value lost to fees = fees paid + growth those fees would have earned.
    expect(noFee - r.totals.final).toBeGreaterThan(r.totals.managementFees)
    rel(r.totals.final, P + r.totals.growth - r.totals.managementFees)
  })
  it('entry % and fixed fee come off every deposit, including the initial investment', () => {
    const r = simulate(plan({ initial: 10_000, horizonMonths: 12, streams: [{ startMonth: 0, endMonth: Infinity, amount: 1_000, frequency: 'monthly' }], fees: { annualRate: 0, entryRate: 0.02, fixedPerDeposit: 5 } }))
    rel(r.totals.final, 10_000 * 0.98 - 5 + 12 * (1_000 * 0.98 - 5))
  })
  it('fees with a negative return still shrink the balance by (1−f) per year', () => {
    const r = simulate(plan({ initial: 100_000, annualReturn: -0.2, horizonMonths: 36, fees: { annualRate: 0.02, entryRate: 0, fixedPerDeposit: 0 } }))
    rel(r.totals.final, 100_000 * Math.pow(0.8 * 0.98, 3))
  })
})

describe('reference: inflation and real values', () => {
  it('real = nominal ÷ (1+π)^(months/12), including fractional years and negative inflation', () => {
    for (const pi of [0.025, -0.01, 0]) {
      for (const months of [6, 12, 385]) {
        const r = simulate(plan({ initial: 500_000, annualReturn: 0.04, inflation: pi, horizonMonths: months }))
        rel(r.totals.finalReal, (500_000 * Math.pow(1.04, months / 12)) / Math.pow(1 + pi, months / 12))
        rel(toReal(1000, months, pi), 1000 / Math.pow(1 + pi, months / 12))
      }
    }
  })
})

describe('reference: withdrawals', () => {
  const policy = (p: WithdrawalPolicy) => p
  it('fixed monthly withdrawal at the start (annuity due): B·gⁿ − W·g·(gⁿ−1)/(g−1)', () => {
    const R = 0.05
    const g = Math.pow(1 + R, 1 / 12)
    const B0 = 5_000_000
    const W = 25_000
    const n = 120
    const r = simulate(plan({ initial: B0, annualReturn: R, horizonMonths: n, timing: 'start', withdrawal: { startMonth: 0, endMonth: Infinity, amount: W, frequency: 'monthly', stopContributions: true, indexRate: 0, timing: 'start', policy: policy({ kind: 'fixed' }) } }))
    rel(r.totals.final, B0 * Math.pow(g, n) - (W * g * (Math.pow(g, n) - 1)) / (g - 1), 1e-9)
    rel(r.totals.withdrawn, W * n)
  })
  it('a portfolio that cannot pay never goes negative; paid ≤ available', () => {
    const r = simulate(plan({ initial: 100_000, horizonMonths: 24, timing: 'start', withdrawal: { startMonth: 0, endMonth: Infinity, amount: 30_000, frequency: 'monthly', stopContributions: true, indexRate: 0, timing: 'start', policy: { kind: 'fixed' } } }))
    expect(r.totals.withdrawn).toBeCloseTo(100_000, 6)
    expect(r.totals.final).toBe(0)
    expect(r.totals.depletedAtMonth).toBe(4)
    rel(r.totals.shortfall, 24 * 30_000 - 100_000)
    for (const b of r.balances) expect(b).toBeGreaterThanOrEqual(0)
  })
  it('4 % rule: year 1 = 4 % of the starting portfolio, later years only indexed (portfolio ignored)', () => {
    const r = simulate(plan({ initial: 10_000_000, annualReturn: -0.2, inflation: 0.03, horizonMonths: 60, timing: 'start', withdrawal: { startMonth: 0, endMonth: Infinity, amount: 0, frequency: 'monthly', stopContributions: true, indexRate: 0.03, timing: 'start', policy: { kind: 'initialPct', rate: 0.04 } } }))
    r.withdrawalYears.forEach((y, k) => rel(y.requested, 400_000 * Math.pow(1.03, k)))
  })
  it('current %: rate × balance at each annual review, split evenly over the payments', () => {
    const r = simulate(plan({ initial: 1_000_000, annualReturn: 0, horizonMonths: 36, timing: 'start', withdrawal: { startMonth: 0, endMonth: Infinity, amount: 0, frequency: 'quarterly', stopContributions: true, indexRate: 0, timing: 'start', policy: { kind: 'currentPct', rate: 0.1 } } }))
    // 0 % return: B₀ = 1 000 000 → 100 000 withdrawn; B₁ = 900 000 → 90 000; B₂ = 810 000 → 81 000.
    expect(r.withdrawalYears.map((y) => Math.round(y.requested))).toEqual([100_000, 90_000, 81_000])
    rel(r.totals.final, 729_000)
  })
  it('guardrails: limits apply after last year’s inflation adjustment; the floor wins last', () => {
    // 0 % return, rate 10 %: target falls 10 % a year, decrease limit 5 % → spending −5 % (after +2 % inflation).
    const r = simulate(plan({ initial: 1_000_000, annualReturn: 0, inflation: 0.02, horizonMonths: 36, timing: 'start', withdrawal: { startMonth: 0, endMonth: Infinity, amount: 0, frequency: 'annual', stopContributions: true, indexRate: 0.02, timing: 'start', policy: { kind: 'guardrails', rate: 0.1, maxIncrease: 0.1, maxDecrease: 0.05, floorAnnual: 0 } } }))
    const y = r.withdrawalYears.map((w) => w.requested)
    rel(y[0], 100_000)
    // Year 2: target 10 % × 900 000 = 90 000; base 102 000; floor of the band 96 900 → 96 900.
    rel(y[1], 100_000 * 1.02 * 0.95)
    rel(y[2], Math.max(0.1 * (900_000 - y[1]), y[1] * 1.02 * 0.95))
  })
})

describe('reference: goal solver (V4.2 audit ENG-1)', () => {
  it('finds a solution when the function is flat at 0 for small inputs', () => {
    // f(x) = 0 until x = 5000, then 3·(x − 5000): f(x) = 9000 at x = 8000.
    const f = (x: number) => Math.max(0, 3 * (x - 5000))
    const r = solveMonotone(f, 9000)
    expect(r.status).toBe('ok')
    if (r.status === 'ok') expect(Math.abs(r.value - 8000)).toBeLessThan(0.01)
  })
  it('still reports unreachable when the variable has no effect at all', () => {
    expect(solveMonotone(() => 0, 1).status).toBe('unreachable')
  })
})
