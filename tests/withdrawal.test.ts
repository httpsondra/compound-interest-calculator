import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { simulate } from '../src/engine/simulate'
import type { Frequency, PlanInput, WithdrawalPlan, WithdrawalPolicy } from '../src/engine/types'

const base = (o: Partial<PlanInput> = {}): PlanInput => ({
  horizonMonths: 36,
  initial: 6_000_000,
  annualReturn: 0,
  timing: 'start',
  streams: [],
  lumpSums: [],
  contributionGrowth: 0,
  inflation: 0,
  fees: { annualRate: 0, entryRate: 0, fixedPerDeposit: 0 },
  withdrawal: null,
  ...o,
})
const wd = (policy: WithdrawalPolicy, o: Partial<WithdrawalPlan> = {}): WithdrawalPlan => ({
  startMonth: 0,
  endMonth: Infinity,
  amount: 0,
  frequency: 'monthly',
  stopContributions: true,
  indexRate: 0,
  timing: 'start',
  policy,
  ...o,
})
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)

describe('initial-portfolio percentage (“4 % rule”)', () => {
  it('Test A: 6 000 000 at 4 % → 240 000 a year, 20 000 a month', () => {
    const r = simulate(base({ withdrawal: wd({ kind: 'initialPct', rate: 0.04 }) }))
    close(r.withdrawalYears[0].requested, 240_000)
    close(r.withdrawalYears[0].reviewBalance, 6_000_000)
    close(r.withdrawalYears[0].requested / 12, 20_000)
  })
  it('Test B: indexed by inflation → 240 000, 246 000, 252 150', () => {
    const r = simulate(base({ inflation: 0.025, withdrawal: wd({ kind: 'initialPct', rate: 0.04 }, { indexRate: 0.025 }) }))
    close(r.withdrawalYears[0].requested, 240_000)
    close(r.withdrawalYears[1].requested, 246_000)
    close(r.withdrawalYears[2].requested, 252_150)
  })
  it('ignores later portfolio values (unlike current-portfolio %)', () => {
    const r = simulate(base({ annualReturn: -0.3, withdrawal: wd({ kind: 'initialPct', rate: 0.04 }) }))
    close(r.withdrawalYears[1].requested, 240_000)
    expect(r.withdrawalYears[1].reviewBalance).toBeLessThan(5_000_000)
  })
  it('without inflation adjustment, withdrawals stay constant in nominal terms', () => {
    const r = simulate(base({ inflation: 0.05, withdrawal: wd({ kind: 'initialPct', rate: 0.04 }, { indexRate: 0 }) }))
    close(r.withdrawalYears[2].requested, 240_000)
  })
  it('records a shortfall and depletion when the portfolio runs out', () => {
    const r = simulate(base({ initial: 1_000_000, horizonMonths: 240, withdrawal: wd({ kind: 'initialPct', rate: 0.1 }, { indexRate: 0.05 }) }))
    expect(r.totals.depletedAtMonth).not.toBeNull()
    expect(r.totals.shortfall).toBeGreaterThan(0)
    const last = r.withdrawalYears[r.withdrawalYears.length - 1]
    expect(last.paid).toBeLessThan(last.requested)
  })
})

describe('current-portfolio percentage', () => {
  it('Test C: next review at 4 000 000 → 160 000 a year (13 333.33 a month)', () => {
    // Annual payment at the start of the year, then a path that takes the balance from 5 760 000 to 4 000 000.
    const N = 24
    const f = Math.pow(4_000_000 / 5_760_000, 1 / 12)
    const factors = Array.from({ length: N }, () => f)
    const annual = simulate(base({ horizonMonths: N, withdrawal: wd({ kind: 'currentPct', rate: 0.04 }, { frequency: 'annual' }) }), {
      monthFactors: factors,
    })
    close(annual.withdrawalYears[0].requested, 240_000)
    close(annual.withdrawalYears[1].reviewBalance, 4_000_000, 1e-4)
    close(annual.withdrawalYears[1].requested, 160_000, 1e-4)
    close(annual.withdrawalYears[1].requested / 12, 13_333.333333, 1e-4)
  })
  it('budget is set once per review year and spread over monthly payments (not 4 % every month)', () => {
    const r = simulate(base({ annualReturn: 0.05, horizonMonths: 24, withdrawal: wd({ kind: 'currentPct', rate: 0.04 }) }))
    const y1 = r.withdrawalYears[1]
    close(y1.requested, 0.04 * y1.reviewBalance)
    close(r.totals.withdrawn, r.withdrawalYears[0].paid + y1.paid)
    // 12 equal payments in a year
    close(r.withdrawalYears[0].requested, 240_000)
  })
  it('never depletes a positive portfolio, but income follows the market', () => {
    const r = simulate(base({ annualReturn: -0.2, horizonMonths: 120, withdrawal: wd({ kind: 'currentPct', rate: 0.05 }) }))
    expect(r.totals.depletedAtMonth).toBeNull()
    expect(r.withdrawalYears[9].requested).toBeLessThan(r.withdrawalYears[0].requested / 3)
  })
  it('zero portfolio or zero rate gives zero withdrawals without errors', () => {
    expect(simulate(base({ initial: 0, withdrawal: wd({ kind: 'currentPct', rate: 0.04 }) })).totals.withdrawn).toBe(0)
    expect(simulate(base({ withdrawal: wd({ kind: 'currentPct', rate: 0 }) })).totals.withdrawn).toBe(0)
  })
})

describe('dynamic spending with guardrails', () => {
  const g = (o: Partial<Extract<WithdrawalPolicy, { kind: 'guardrails' }>> = {}): WithdrawalPolicy => ({
    kind: 'guardrails',
    rate: 0.04,
    maxIncrease: 0.05,
    maxDecrease: 0.025,
    floorAnnual: 0,
    ...o,
  })
  it('caps increases at +5 % of last year’s inflation-adjusted spending', () => {
    const r = simulate(base({ annualReturn: 0.3, inflation: 0.02, withdrawal: wd(g(), { indexRate: 0.02 }) }))
    close(r.withdrawalYears[1].requested, 240_000 * 1.02 * 1.05)
    expect(r.withdrawalYears[1].limit).toBe('increase')
    expect(r.withdrawalYears[1].target).toBeGreaterThan(r.withdrawalYears[1].requested)
  })
  it('caps decreases at −2.5 %', () => {
    const r = simulate(base({ annualReturn: -0.3, inflation: 0.02, withdrawal: wd(g(), { indexRate: 0.02 }) }))
    close(r.withdrawalYears[1].requested, 240_000 * 1.02 * 0.975)
    expect(r.withdrawalYears[1].limit).toBe('decrease')
  })
  it('within the band, spending follows the target', () => {
    const r = simulate(base({ annualReturn: 0.02, withdrawal: wd(g()) }))
    const y1 = r.withdrawalYears[1]
    close(y1.requested, 0.04 * y1.reviewBalance)
    expect(y1.limit).toBeNull()
  })
  it('the floor wins over the decrease limit and can cause a shortfall', () => {
    const r = simulate(
      base({ initial: 1_000_000, horizonMonths: 360, annualReturn: -0.1, withdrawal: wd(g({ floorAnnual: 60_000, maxDecrease: 0.5 })) }),
    )
    expect(r.withdrawalYears.some((y) => y.limit === 'floor')).toBe(true)
    for (const y of r.withdrawalYears) if (y.months === 12) expect(y.requested).toBeGreaterThanOrEqual(60_000 - 1e-6)
    expect(r.totals.shortfall).toBeGreaterThan(0)
  })
})

describe('timing, shocks and integration', () => {
  it('withdrawals beginning mid-plan review at the withdrawal anniversary, not the plan year', () => {
    const r = simulate(
      base({ initial: 0, horizonMonths: 240, annualReturn: 0.05, streams: [{ startMonth: 0, endMonth: Infinity, amount: 10_000, frequency: 'monthly' }], withdrawal: wd({ kind: 'initialPct', rate: 0.04 }, { startMonth: 120 }) }),
    )
    expect(r.withdrawalYears[0].startMonth).toBe(120)
    close(r.withdrawalYears[0].reviewBalance, r.balances[120])
    close(r.withdrawalYears[0].requested, 0.04 * r.balances[120])
    expect(r.totals.contributed).toBe(10_000 * 120) // contributions stop when withdrawals start
  })
  it('a −30 % shock is applied exactly once, after the review and before the first payment', () => {
    const r = simulate(base({ horizonMonths: 12, withdrawal: wd({ kind: 'initialPct', rate: 0.04 }) }), { shocks: [{ month: 0, factor: 0.7 }] })
    close(r.withdrawalYears[0].requested, 240_000) // budget set on the pre-shock value
    close(r.totals.final, 6_000_000 * 0.7 - 240_000)
    close(r.totals.growth, -1_800_000)
  })
  it('monthly vs annual payments: same budget, different timing', () => {
    const m = simulate(base({ horizonMonths: 12, withdrawal: wd({ kind: 'initialPct', rate: 0.04 }, { frequency: 'monthly' }) }))
    const a = simulate(base({ horizonMonths: 12, withdrawal: wd({ kind: 'initialPct', rate: 0.04 }, { frequency: 'annual' }) }))
    close(m.totals.withdrawn, a.totals.withdrawn)
  })
  it('fixed withdrawals also report per-year income', () => {
    const r = simulate(base({ horizonMonths: 24, withdrawal: wd({ kind: 'fixed' }, { amount: 20_000, indexRate: 0.1 }) }))
    close(r.withdrawalYears[0].requested, 240_000)
    close(r.withdrawalYears[1].requested, 264_000)
  })

  it('every policy reconciles: rows add up, paid ≤ requested, Σ paid = withdrawn', () => {
    const arb = fc.record({
      kind: fc.constantFrom('fixed', 'initialPct', 'currentPct', 'guardrails'),
      rate: fc.double({ min: 0, max: 0.12, noNaN: true }),
      ret: fc.double({ min: -0.4, max: 0.25, noNaN: true }),
      infl: fc.double({ min: 0, max: 0.1, noNaN: true }),
      start: fc.integer({ min: 0, max: 200 }),
      freq: fc.constantFrom<Frequency>('monthly', 'quarterly', 'annual'),
      timing: fc.constantFrom('start' as const, 'end' as const),
      fee: fc.double({ min: 0, max: 0.02, noNaN: true }),
      shock: fc.option(fc.double({ min: 0.4, max: 1, noNaN: true })),
    })
    fc.assert(
      fc.property(arb, (a) => {
        const policy: WithdrawalPolicy =
          a.kind === 'fixed'
            ? { kind: 'fixed' }
            : a.kind === 'guardrails'
              ? { kind: 'guardrails', rate: a.rate, maxIncrease: 0.05, maxDecrease: 0.025, floorAnnual: 0 }
              : { kind: a.kind as 'initialPct' | 'currentPct', rate: a.rate }
        const p = base({
          horizonMonths: 300,
          initial: 1_000_000,
          annualReturn: a.ret,
          inflation: a.infl,
          timing: a.timing,
          fees: { annualRate: a.fee, entryRate: 0, fixedPerDeposit: 0 },
          streams: [{ startMonth: 0, endMonth: Infinity, amount: 2000, frequency: 'monthly' }],
          withdrawal: wd(policy, { amount: 5000, startMonth: a.start, frequency: a.freq, timing: a.timing, indexRate: a.infl, stopContributions: false }),
        })
        const r = simulate(p, { shocks: a.shock != null ? [{ month: a.start, factor: a.shock }] : [] })
        let prev = 0
        for (const y of r.years) {
          expect(Math.abs(y.startBalance + y.contributions - y.withdrawals + y.growth - y.fees - y.endBalance)).toBeLessThan(1e-4)
          expect(y.startBalance).toBe(prev)
          prev = y.endBalance
        }
        const paid = r.withdrawalYears.reduce((s, y) => s + y.paid, 0)
        expect(Math.abs(paid - r.totals.withdrawn)).toBeLessThan(1e-4)
        for (const y of r.withdrawalYears) expect(y.paid).toBeLessThanOrEqual(y.requested + 1e-9)
        expect(Math.min(...r.balances)).toBeGreaterThanOrEqual(0)
      }),
      { numRuns: 250 },
    )
  })
})
