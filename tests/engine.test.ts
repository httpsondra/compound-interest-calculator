import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { simulate, streamEventTimes } from '../src/engine/simulate'
import { analyzeGoal, solveMonotone, sustainableWithdrawal } from '../src/engine/solvers'
import { runMonteCarlo } from '../src/engine/montecarlo'
import type { ContributionStream, Frequency, PlanInput } from '../src/engine/types'

const plan = (o: Partial<PlanInput> = {}): PlanInput => ({
  horizonMonths: 12,
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
const stream = (amount: number, startMonth = 0, endMonth = Infinity, frequency: Frequency = 'monthly'): ContributionStream => ({
  amount,
  startMonth,
  endMonth,
  frequency,
})
const close = (a: number, b: number, rel = 1e-10) => expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.max(1e-6, Math.abs(b) * rel))

describe('reference cases from the specification', () => {
  it('Test A: 100 000 + 1 000/month, 0 %, 12 months = 112 000', () => {
    const r = simulate(plan({ initial: 100_000, streams: [stream(1000)] }))
    close(r.totals.final, 112_000)
    close(r.totals.contributed, 112_000)
    close(r.totals.netGain, 0)
  })
  it('Test B: 100 000 at 10 % effective for 12 months = 110 000 (not 110 471 as with R/12)', () => {
    const r = simulate(plan({ initial: 100_000, annualReturn: 0.1 }))
    close(r.totals.final, 110_000)
  })
  it('Test C: 100 000 at 7 % for 2 years = 114 490', () => {
    const r = simulate(plan({ initial: 100_000, annualReturn: 0.07, horizonMonths: 24 }))
    close(r.totals.final, 114_490)
  })
})

describe('closed-form references', () => {
  const P = 50_000
  const C = 3_000
  const R = 0.07
  const N = 240
  const r = Math.pow(1 + R, 1 / 12) - 1
  const annuity = (C * (Math.pow(1 + r, N) - 1)) / r

  it('constant end-of-month contributions match FV = P(1+r)^N + C((1+r)^N − 1)/r', () => {
    const res = simulate(plan({ initial: P, annualReturn: R, horizonMonths: N, streams: [stream(C)] }))
    close(res.totals.final, P * Math.pow(1 + r, N) + annuity, 1e-11)
  })
  it('beginning-of-month contributions are an annuity due (×(1+r))', () => {
    const res = simulate(plan({ initial: P, annualReturn: R, horizonMonths: N, streams: [stream(C)], timing: 'start' }))
    close(res.totals.final, P * Math.pow(1 + r, N) + annuity * (1 + r), 1e-11)
  })
  it('r = 0 gives P + C·N', () => {
    const res = simulate(plan({ initial: P, horizonMonths: N, streams: [stream(C)] }))
    close(res.totals.final, P + C * N)
  })
  it.each([
    ['quarterly', 4],
    ['semiannual', 2],
    ['annual', 1],
    ['weekly', 52],
  ] as const)('%s contributions use the matching effective periodic rate', (freq, perYear) => {
    const years = 10
    const rp = Math.pow(1 + R, 1 / perYear) - 1
    const n = perYear * years
    const endRes = simulate(plan({ annualReturn: R, horizonMonths: years * 12, streams: [stream(C, 0, Infinity, freq)] }))
    close(endRes.totals.final, (C * (Math.pow(1 + rp, n) - 1)) / rp, 1e-9)
    close(endRes.totals.contributed, C * n)
    const startRes = simulate(
      plan({ annualReturn: R, horizonMonths: years * 12, streams: [stream(C, 0, Infinity, freq)], timing: 'start' }),
    )
    close(startRes.totals.final, ((C * (Math.pow(1 + rp, n) - 1)) / rp) * (1 + rp), 1e-9)
  })
  it('weekly stream produces exactly 52 events per year', () => {
    expect(streamEventTimes(0, 120, 'weekly', 'end', 120)).toHaveLength(520)
    expect(streamEventTimes(0, 120, 'weekly', 'start', 120)).toHaveLength(520)
  })
  it('fractional horizons compound with fractional exponents', () => {
    const res = simulate(plan({ initial: 10_000, annualReturn: 0.08, horizonMonths: 18 }))
    close(res.totals.final, 10_000 * Math.pow(1.08, 1.5))
    expect(res.years).toHaveLength(2)
    expect(res.years[1].months).toBe(6)
  })
  it('negative returns shrink the balance consistently', () => {
    const res = simulate(plan({ initial: 10_000, annualReturn: -0.2, horizonMonths: 36 }))
    close(res.totals.final, 10_000 * Math.pow(0.8, 3))
    expect(res.totals.growth).toBeLessThan(0)
  })
})

describe('dynamic contribution schedules', () => {
  it('splitting a stream into adjacent periods does not change the result', () => {
    const a = simulate(plan({ annualReturn: 0.06, horizonMonths: 120, streams: [stream(2000, 0, 120)] }))
    const b = simulate(
      plan({ annualReturn: 0.06, horizonMonths: 120, streams: [stream(2000, 0, 60), stream(2000, 60, 120)] }),
    )
    close(a.totals.final, b.totals.final, 1e-12)
  })
  it('life-stage schedule: contributed capital equals the sum of each period', () => {
    // Ages 20–25: 2 000, 25–30: 5 000, 30–40: 12 000, 40–55: 20 000 per month (35 years)
    const s = [stream(2000, 0, 60), stream(5000, 60, 120), stream(12_000, 120, 240), stream(20_000, 240, 420)]
    const res = simulate(plan({ annualReturn: 0.07, horizonMonths: 420, streams: s }))
    close(res.totals.contributed, 2000 * 60 + 5000 * 60 + 12_000 * 120 + 20_000 * 180)
    expect(res.totals.final).toBeGreaterThan(res.totals.contributed)
  })
  it('a gap between periods means no contributions in the gap', () => {
    const res = simulate(plan({ horizonMonths: 36, streams: [stream(1000, 0, 12), stream(1000, 24, 36)] }))
    close(res.totals.contributed, 24_000)
    close(res.years[1].contributions, 0)
  })
  it('overlapping periods add up (documented convention)', () => {
    const res = simulate(plan({ horizonMonths: 12, streams: [stream(1000, 0, 12), stream(500, 6, 12)] }))
    close(res.totals.contributed, 12_000 + 3_000)
  })
  it('lump sums grow from the start of their month', () => {
    const res = simulate(plan({ annualReturn: 0.05, horizonMonths: 60, lumpSums: [{ month: 24, amount: 10_000 }] }))
    close(res.totals.final, 10_000 * Math.pow(1.05, 3))
  })
  it('contribution growth steps up at each plan-year anniversary', () => {
    const res = simulate(plan({ horizonMonths: 24, streams: [stream(1000)], contributionGrowth: 0.1 }))
    close(res.years[0].contributions, 12_000)
    close(res.years[1].contributions, 13_200)
  })
})

describe('fees', () => {
  it('annual fee is an effective annual deduction', () => {
    const res = simulate(plan({ initial: 100_000, fees: { annualRate: 0.01, entryRate: 0, fixedPerDeposit: 0 } }))
    close(res.totals.final, 99_000)
    close(res.totals.managementFees, 1_000)
  })
  it('growth then fee: 100 000 × 1.07 × 0.99', () => {
    const res = simulate(
      plan({ initial: 100_000, annualReturn: 0.07, fees: { annualRate: 0.01, entryRate: 0, fixedPerDeposit: 0 } }),
    )
    close(res.totals.final, 100_000 * 1.07 * 0.99)
  })
  it('entry and fixed fees come off each deposit and never exceed it', () => {
    const res = simulate(
      plan({ initial: 10_000, streams: [stream(20)], fees: { annualRate: 0, entryRate: 0.02, fixedPerDeposit: 30 } }),
    )
    // initial: 10 000 − 200 − 30; monthly 20 is fully consumed by the fee cap
    close(res.totals.final, 9_770)
    close(res.totals.depositFees, 230 + 12 * 20)
  })
  it('fee impact exceeds the fees paid because of lost compounding', () => {
    const base = plan({ initial: 100_000, annualReturn: 0.07, horizonMonths: 360, streams: [stream(5000)] })
    const noFee = simulate(base).totals.final
    const withFee = simulate({ ...base, fees: { annualRate: 0.01, entryRate: 0, fixedPerDeposit: 0 } }).totals
    const diff = noFee - withFee.final
    expect(diff).toBeGreaterThan(withFee.fees)
    expect(diff - withFee.fees).toBeGreaterThan(0)
  })
})

describe('inflation', () => {
  it('real value = nominal / (1 + π)^t', () => {
    const res = simulate(plan({ initial: 100_000, annualReturn: 0.07, inflation: 0.03, horizonMonths: 120 }))
    close(res.totals.finalReal, res.totals.final / Math.pow(1.03, 10))
    close(res.points[120].real, res.totals.finalReal)
  })
  it('return equal to inflation preserves purchasing power', () => {
    const res = simulate(plan({ initial: 100_000, annualReturn: 0.03, inflation: 0.03, horizonMonths: 240 }))
    close(res.totals.finalReal, 100_000, 1e-12)
  })
})

describe('withdrawals', () => {
  it('pays withdrawals out of the balance', () => {
    const res = simulate(
      plan({
        initial: 120_000,
        withdrawal: { startMonth: 0, endMonth: Infinity, amount: 1000, frequency: 'monthly', stopContributions: true, indexRate: 0, timing: 'start' },
      }),
    )
    close(res.totals.final, 108_000)
    close(res.totals.withdrawn, 12_000)
    expect(res.totals.depletedAtMonth).toBeNull()
  })
  it('detects depletion and never goes negative', () => {
    const res = simulate(
      plan({
        initial: 5000,
        withdrawal: { startMonth: 0, endMonth: Infinity, amount: 1000, frequency: 'monthly', stopContributions: true, indexRate: 0, timing: 'start' },
      }),
    )
    expect(res.totals.final).toBe(0)
    close(res.totals.withdrawn, 5000)
    expect(res.totals.depletedAtMonth).toBe(6)
    close(res.totals.shortfall, 7000)
    expect(Math.min(...res.balances)).toBeGreaterThanOrEqual(0)
  })
  it('present value of an annuity is fully drawn down at the horizon', () => {
    const R = 0.05
    const r = Math.pow(1 + R, 1 / 12) - 1
    const W = 20_000
    const N = 300
    const P = (W * (1 - Math.pow(1 + r, -N))) / r
    const p = plan({
      initial: P,
      annualReturn: R,
      horizonMonths: N,
      withdrawal: { startMonth: 0, endMonth: Infinity, amount: W, frequency: 'monthly', stopContributions: true, indexRate: 0, timing: 'end' },
    })
    const res = simulate(p)
    expect(Math.abs(res.totals.final)).toBeLessThan(1e-3)
    const sus = sustainableWithdrawal(p)!
    expect(Math.abs(sus - W)).toBeLessThan(0.05)
  })
  it('stopping contributions at the withdrawal start', () => {
    const res = simulate(
      plan({
        horizonMonths: 24,
        streams: [stream(1000)],
        withdrawal: { startMonth: 12, endMonth: Infinity, amount: 500, frequency: 'monthly', stopContributions: true, indexRate: 0, timing: 'end' },
      }),
    )
    close(res.totals.contributed, 12_000)
    close(res.totals.withdrawn, 6_000)
  })
})

describe('solvers', () => {
  const base = plan({ annualReturn: 0.07, horizonMonths: 240, streams: [stream(5000)] })
  const withMonthly = (x: number): PlanInput => ({ ...base, streams: [stream(x)] })

  it('required monthly contribution reproduces the target exactly', () => {
    const g = analyzeGoal(base, { target: 5_000_000, month: 240, real: false }, withMonthly)
    expect(g.contribution.status).toBe('ok')
    if (g.contribution.status !== 'ok') return
    const check = simulate(withMonthly(g.contribution.value)).totals.final
    expect(Math.abs(check - 5_000_000)).toBeLessThan(0.02)
  })
  it('time to goal is the first month the trajectory crosses the target', () => {
    const p = plan({ annualReturn: 0.07, horizonMonths: 120, streams: [stream(8000)] })
    const g = analyzeGoal(p, { target: 10_000_000, month: 120, real: false }, (x) => ({ ...p, streams: [stream(x)] }))
    expect(g.timeToGoal).not.toBeNull()
    const ext = simulate({ ...p, horizonMonths: g.timeToGoal! })
    expect(ext.totals.final).toBeGreaterThanOrEqual(10_000_000)
    const before = simulate({ ...p, horizonMonths: g.timeToGoal! - 1 })
    expect(before.totals.final).toBeLessThan(10_000_000)
  })
  it('required extra initial investment', () => {
    const g = analyzeGoal(base, { target: 3_000_000, month: 240, real: false }, withMonthly)
    expect(g.extraInitial.status).toBe('ok')
    if (g.extraInitial.status !== 'ok') return
    const check = simulate({ ...base, initial: g.extraInitial.value }).totals.final
    expect(Math.abs(check - 3_000_000)).toBeLessThan(0.02)
  })
  it('reports not-needed and unreachable states instead of NaN', () => {
    expect(solveMonotone(() => 10, 5).status).toBe('not-needed')
    expect(solveMonotone(() => 1, 5).status).toBe('unreachable')
  })
  it('real goals are compared in today’s money', () => {
    const p = { ...base, inflation: 0.03 }
    const g = analyzeGoal(p, { target: 2_000_000, month: 240, real: true }, (x) => ({ ...p, streams: [stream(x)] }))
    if (g.contribution.status !== 'ok') throw new Error('expected ok')
    const res = simulate({ ...p, streams: [stream(g.contribution.value)] })
    expect(Math.abs(res.totals.finalReal - 2_000_000)).toBeLessThan(0.02)
  })
})

describe('Monte Carlo', () => {
  const base = plan({ initial: 100_000, annualReturn: 0.06, horizonMonths: 240, streams: [stream(2000)] })
  it('is reproducible with a seed', () => {
    const a = runMonteCarlo({ plan: base, volatility: 0.15, simulations: 200, seed: 42 })
    const b = runMonteCarlo({ plan: base, volatility: 0.15, simulations: 200, seed: 42 })
    expect(a.finalPercentiles.p50).toBe(b.finalPercentiles.p50)
  })
  it('zero volatility collapses to the deterministic projection', () => {
    const det = simulate(base).totals.final
    const mc = runMonteCarlo({ plan: base, volatility: 0, simulations: 20, seed: 1 })
    close(mc.finalPercentiles.p10, det, 1e-9)
    close(mc.finalPercentiles.p90, det, 1e-9)
  })
  it('percentiles are ordered and the median of a lump sum matches the geometric return', () => {
    const lump = plan({ initial: 100_000, annualReturn: 0.06, horizonMonths: 240 })
    const mc = runMonteCarlo({ plan: lump, volatility: 0.15, simulations: 4000, seed: 7 })
    const p = mc.finalPercentiles
    expect(p.p10).toBeLessThan(p.p50)
    expect(p.p50).toBeLessThan(p.p90)
    const det = simulate(lump).totals.final
    expect(Math.abs(p.p50 / det - 1)).toBeLessThan(0.05)
  })
})

/* ─────────────── property-based invariants ─────────────── */

const arbPlan = fc
  .record({
    horizonMonths: fc.integer({ min: 1, max: 480 }),
    initial: fc.double({ min: 0, max: 5e6, noNaN: true }),
    annualReturn: fc.double({ min: -0.5, max: 0.3, noNaN: true }),
    timing: fc.constantFrom('start' as const, 'end' as const),
    amount: fc.double({ min: 0, max: 50_000, noNaN: true }),
    freq: fc.constantFrom<Frequency>('weekly', 'monthly', 'quarterly', 'semiannual', 'annual'),
    split: fc.integer({ min: 1, max: 479 }),
    amount2: fc.double({ min: 0, max: 50_000, noNaN: true }),
    growth: fc.double({ min: 0, max: 0.1, noNaN: true }),
    inflation: fc.double({ min: 0, max: 0.1, noNaN: true }),
    fee: fc.double({ min: 0, max: 0.03, noNaN: true }),
    entry: fc.double({ min: 0, max: 0.05, noNaN: true }),
    withdraw: fc.option(
      fc.record({
        start: fc.integer({ min: 0, max: 479 }),
        amount: fc.double({ min: 0, max: 80_000, noNaN: true }),
        stop: fc.boolean(),
      }),
    ),
  })
  .map(
    (a): PlanInput => ({
      horizonMonths: a.horizonMonths,
      initial: a.initial,
      annualReturn: a.annualReturn,
      timing: a.timing,
      streams: [stream(a.amount, 0, a.split, a.freq), stream(a.amount2, a.split, Infinity, 'monthly')],
      lumpSums: [],
      contributionGrowth: a.growth,
      inflation: a.inflation,
      fees: { annualRate: a.fee, entryRate: a.entry, fixedPerDeposit: 0 },
      withdrawal: a.withdraw
        ? {
            startMonth: a.withdraw.start,
            endMonth: Infinity,
            amount: a.withdraw.amount,
            frequency: 'monthly',
            stopContributions: a.withdraw.stop,
            indexRate: a.inflation,
            timing: a.timing,
          }
        : null,
    }),
  )

describe('invariants', () => {
  it('every yearly row reconciles: start + contributions − withdrawals + growth − fees = end', () => {
    fc.assert(
      fc.property(arbPlan, (p) => {
        const r = simulate(p)
        let prev = 0
        for (const y of r.years) {
          expect(y.startBalance).toBe(prev)
          const recon = y.startBalance + y.contributions - y.withdrawals + y.growth - y.fees
          expect(Math.abs(recon - y.endBalance)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(y.endBalance) + y.contributions))
          prev = y.endBalance
        }
        // chart endpoint = summary = table
        expect(r.points[r.points.length - 1].balance).toBe(r.totals.final)
        expect(r.years[r.years.length - 1].endBalance).toBe(r.totals.final)
        const sumContrib = r.years.reduce((s, y) => s + y.contributions, 0)
        expect(Math.abs(sumContrib - r.totals.contributed)).toBeLessThan(1e-6 * Math.max(1, r.totals.contributed))
        expect(r.totals.final).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(r.totals.final)).toBe(true)
      }),
      { numRuns: 300 },
    )
  })
  it('zero return and zero fees imply zero growth', () => {
    fc.assert(
      fc.property(arbPlan, (p) => {
        const r = simulate({ ...p, annualReturn: 0, fees: { annualRate: 0, entryRate: 0, fixedPerDeposit: 0 }, withdrawal: null })
        expect(Math.abs(r.totals.growth)).toBeLessThan(1e-6)
        expect(Math.abs(r.totals.final - r.totals.contributed)).toBeLessThan(1e-6 * Math.max(1, r.totals.contributed))
      }),
      { numRuns: 150 },
    )
  })
  it('more contribution never lowers the ending balance or the contributed capital', () => {
    fc.assert(
      fc.property(arbPlan, fc.double({ min: 0, max: 10_000, noNaN: true }), (p, extra) => {
        const a = simulate(p)
        const b = simulate({ ...p, streams: [...p.streams, stream(extra)] })
        expect(b.totals.final).toBeGreaterThanOrEqual(a.totals.final - 1e-6)
        expect(b.totals.contributed).toBeGreaterThanOrEqual(a.totals.contributed)
      }),
      { numRuns: 150 },
    )
  })
  it('a lower non-negative management fee never worsens the result', () => {
    fc.assert(
      fc.property(arbPlan, (p) => {
        const hi = simulate(p)
        const lo = simulate({ ...p, fees: { ...p.fees, annualRate: p.fees.annualRate / 2 } })
        expect(lo.totals.final).toBeGreaterThanOrEqual(hi.totals.final - 1e-6)
      }),
      { numRuns: 150 },
    )
  })
})
