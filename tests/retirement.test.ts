import { describe, expect, it } from 'vitest'
import { simulate } from '../src/engine/simulate'
import { runMonteCarlo } from '../src/engine/montecarlo'
import { buildPreset } from '../src/model/presets'
import { defaultScenario, toPlan, type Scenario } from '../src/model/scenario'
import { decodeShare, encodeShare, sanitizeScenario } from '../src/model/serialize'
import {
  compareStrategies,
  fiAnalysis,
  firstYearBudget,
  incomeSeries,
  incomeStats,
  requiredCapital,
  stressOptions,
  stressTest,
} from '../src/model/retirement'

const retiree = (o: Partial<Scenario['withdrawal']> = {}, extra: Partial<Scenario> = {}): Scenario => {
  const s = defaultScenario('CZK')
  return {
    ...s,
    initial: 6_000_000,
    contribMode: 'constant',
    constant: { amount: 0, frequency: 'monthly' },
    horizonYears: 30,
    horizonMonths: 0,
    annualReturn: 5,
    inflation: 2.5,
    inflationEnabled: true,
    withdrawal: { ...s.withdrawal, enabled: true, startYear: 1, endYear: null, strategy: 'initialPct', rate: 4, indexed: true, ...o },
    ...extra,
  }
}

describe('required capital (Test D)', () => {
  it('50 000 a month at 4 % → 15 000 000 (planning identity)', () => {
    expect(requiredCapital(50_000 * 12, 4)).toBeCloseTo(15_000_000, 6)
    expect(requiredCapital(600_000, 0)).toBe(Infinity)
  })
  it('income in today’s money is inflated to the retirement start', () => {
    const s = retiree({ startYear: 21 }, { initial: 0, constant: { amount: 20_000, frequency: 'monthly' }, retirement: { income: 50_000, real: true } })
    const fi = fiAnalysis(s, simulate(toPlan(s)))!
    expect(fi.annualAtStart).toBeCloseTo(600_000 * Math.pow(1.025, 20), 4)
    expect(fi.capital).toBeCloseTo(fi.annualAtStart / 0.04, 4)
    expect(fi.capitalReal).toBeCloseTo(15_000_000, 0)
    expect(fi.method).toBe('identity')
  })
  it('nominal income is used as entered', () => {
    const s = retiree({ startYear: 21 }, { retirement: { income: 50_000, real: false } })
    expect(fiAnalysis(s, simulate(toPlan(s)))!.capital).toBeCloseTo(15_000_000, 6)
  })
  it('fixed strategy capital is solved with the engine and actually sustains the income', () => {
    const s = retiree({ strategy: 'fixed', startYear: 11, amount: 30_000 }, { initial: 0, constant: { amount: 30_000, frequency: 'monthly' }, retirement: { income: 30_000, real: true } })
    const fi = fiAnalysis(s, simulate(toPlan(s)))!
    expect(fi.method).toBe('simulated')
    // Feed the capital into a retirement-only plan: it must last, and 1 % less must not.
    const p = toPlan(s)
    const months = p.horizonMonths - fi.startMonth
    const sub = (c: number) =>
      simulate({ ...p, horizonMonths: months, initial: c, streams: [], lumpSums: [], withdrawal: { ...p.withdrawal!, startMonth: 0, endMonth: Infinity, amount: fi.monthlyAtStart, policy: { kind: 'fixed' } } })
    expect(sub(fi.capital).totals.depletedAtMonth).toBeNull()
    expect(sub(fi.capital * 0.99).totals.depletedAtMonth).not.toBeNull()
  })
  it('time to FI and required contribution come from the same engine', () => {
    const s = buildPreset('fi', 'CZK')
    const fi = fiAnalysis(s, simulate(toPlan(s)))!
    expect(fi.projectedAtStart).toBe(simulate(toPlan(s)).balances[fi.startMonth])
    if (fi.goal.contribution.status === 'ok') expect(fi.goal.contribution.value).toBeGreaterThan(0)
    if (fi.fiMonth != null && fi.fiMonthWithMore?.month != null) expect(fi.fiMonthWithMore.month).toBeLessThanOrEqual(fi.fiMonth)
  })
})

describe('income statistics', () => {
  it('fixed inflation-indexed income is constant in real terms', () => {
    const s = retiree({ strategy: 'fixed', amount: 20_000 })
    const st = incomeStats(simulate(toPlan(s)), 0.025)!
    expect(st.initial).toBeCloseTo(20_000, 6)
    expect(st.minReal).toBeCloseTo(20_000, 6)
    expect(st.maxReal).toBeCloseTo(20_000, 6)
    expect(st.realChange).toBeCloseTo(0, 9)
  })
  it('current-portfolio income moves with the market; totals reconcile with the result', () => {
    const s = retiree({ strategy: 'currentPct' }, { annualReturn: 1 })
    const res = simulate(toPlan(s))
    const st = incomeStats(res, 0.025)!
    expect(st.final).toBeLessThan(st.initial)
    expect(st.totalWithdrawn).toBe(res.totals.withdrawn)
    expect(st.years.reduce((a, y) => a + y.paid, 0)).toBeCloseTo(res.totals.withdrawn, 4)
  })
  it('income series matches the per-year income at every month of the year', () => {
    const s = retiree({ strategy: 'initialPct', startYear: 6 })
    const res = simulate(toPlan(s))
    const series = incomeSeries(res, 360, 0.025, false)
    const y0 = res.withdrawalYears[0]
    expect(series[y0.startMonth]).toBeCloseTo(y0.paid / 12, 9)
    expect(Number.isNaN(series[0])).toBe(true)
  })
  it('first-year budget preview equals the engine’s first withdrawal year', () => {
    const res = simulate(toPlan(retiree()))
    const b = firstYearBudget(res)!
    expect(b.annual).toBeCloseTo(240_000, 6)
    expect(b.monthly).toBeCloseTo(20_000, 6)
    expect(b.portfolio).toBeCloseTo(6_000_000, 6)
  })
})

describe('stress tests', () => {
  it('a −30 % crash is one instantaneous loss, not also a negative period return', () => {
    const s = retiree()
    const plan = toPlan(s)
    const o = stressOptions('crash30', plan, 0)!
    expect(o.shocks).toEqual([{ month: 0, factor: 0.7 }])
    expect('monthFactors' in o).toBe(false)
    const st = stressTest(s, 'crash30')!
    expect(st.stress.withdrawalYears[0].requested).toBeCloseTo(240_000, 6) // budget set before the crash
    expect(st.stress.totals.final).toBeLessThan(st.base.totals.final)
  })
  it('poor first years apply the stated period returns only to withdrawal years 1–3', () => {
    const plan = toPlan(retiree({ startYear: 3 }))
    const o = stressOptions('badStart', plan, 24)!
    const f = o.monthFactors!
    expect(f[24]).toBeCloseTo(Math.pow(0.85, 1 / 12), 12)
    expect(f[36]).toBeCloseTo(Math.pow(0.9, 1 / 12), 12)
    expect(f[60]).toBeCloseTo(Math.pow(1.05, 1 / 12), 12)
    expect(f[0]).toBeCloseTo(Math.pow(1.05, 1 / 12), 12)
  })
  it('sequence matters: early losses hurt a fixed-income plan more than late ones', () => {
    const s = retiree({ strategy: 'fixed', amount: 20_000 })
    const plan = toPlan(s)
    const N = plan.horizonMonths
    const early = new Array(N).fill(Math.pow(1.05, 1 / 12))
    const late = early.slice()
    for (let m = 0; m < 36; m++) early[m] = Math.pow(0.8, 1 / 12)
    for (let m = N - 36; m < N; m++) late[m] = Math.pow(0.8, 1 / 12)
    expect(simulate(plan, { monthFactors: early }).totals.final).toBeLessThan(simulate(plan, { monthFactors: late }).totals.final)
  })
  it('custom sequences are used as entered', () => {
    const o = stressOptions('custom', toPlan(retiree()), 0, [-20, 10])!
    expect(o.monthFactors![0]).toBeCloseTo(Math.pow(0.8, 1 / 12), 12)
    expect(o.monthFactors![12]).toBeCloseTo(Math.pow(1.1, 1 / 12), 12)
  })
})

describe('strategy comparison and Monte Carlo', () => {
  it('compares strategies under identical assumptions (same accumulation, only the policy differs)', () => {
    const s = retiree({ startYear: 11 }, { initial: 1_000_000, constant: { amount: 20_000, frequency: 'monthly' } })
    const rows = compareStrategies(s)
    expect(rows.map((r) => r.strategy)).toEqual(['fixed', 'initialPct', 'currentPct', 'guardrails'])
    const b = rows.map((r) => r.result.balances[120])
    for (const v of b) expect(v).toBeCloseTo(b[0], 6)
  })
  it('current-portfolio % never depletes, yet can fail to fund the desired income', () => {
    const s = retiree({ strategy: 'currentPct', rate: 4 }, { retirement: { income: 22_000, real: true } })
    const plan = toPlan(s)
    const mc = runMonteCarlo({ plan, volatility: 0.18, simulations: 400, seed: 3, income: { monthly: 22_000, real: true } })
    expect(mc.depletionProbability).toBe(0)
    expect(mc.incomeProbability!).toBeLessThan(0.5)
    expect(mc.lowestIncome!.p10).toBeLessThan(mc.lowestIncome!.p90)
  })
  it('income probability is reproducible and equals 1 / 0 at zero volatility depending on the plan', () => {
    const plan = toPlan(retiree({ strategy: 'fixed', amount: 20_000 }))
    const a = runMonteCarlo({ plan, volatility: 0.15, simulations: 200, seed: 9, income: { monthly: 20_000, real: true } })
    const b = runMonteCarlo({ plan, volatility: 0.15, simulations: 200, seed: 9, income: { monthly: 20_000, real: true } })
    expect(a.incomeProbability).toBe(b.incomeProbability)
    const det = runMonteCarlo({ plan, volatility: 0, simulations: 5, seed: 1, income: { monthly: 20_000, real: true } })
    expect(det.incomeProbability).toBe(1)
    const tooMuch = runMonteCarlo({ plan, volatility: 0, simulations: 5, seed: 1, income: { monthly: 25_000, real: true } })
    expect(tooMuch.incomeProbability).toBe(0)
  })
})

describe('persistence', () => {
  it('share links and storage keep the strategy; old scenarios default to fixed', () => {
    const s = retiree({ strategy: 'guardrails', rate: 4.5, maxIncrease: 6, maxDecrease: 3, floor: 15_000 }, { retirement: { income: 45_000, real: false } })
    const back = decodeShare(encodeShare(s))!
    expect(back.withdrawal).toMatchObject({ strategy: 'guardrails', rate: 4.5, maxIncrease: 6, maxDecrease: 3, floor: 15_000 })
    expect(back.retirement).toEqual({ income: 45_000, real: false })
    const legacy = sanitizeScenario({ withdrawal: { enabled: true, amount: 1000 } })!
    expect(legacy.withdrawal.strategy).toBe('fixed')
    expect(legacy.withdrawal.amount).toBe(1000)
  })
})

describe('sustainable withdrawal per strategy', () => {
  it('fixed → amount, initial % and guardrails → rate, current % → none', async () => {
    const { computeScenario } = await import('../src/model/compute')
    const fixed = computeScenario(retiree({ strategy: 'fixed', amount: 20_000 }))
    expect(fixed.sustainable?.kind).toBe('amount')
    const init = computeScenario(retiree({ strategy: 'initialPct' }))
    expect(init.sustainable?.kind).toBe('rate')
    expect(init.sustainable!.value).toBeGreaterThan(0.04) // 4 % at 5 % return over 30 years lasts
    expect(init.sustainable!.value).toBeLessThan(1)
    const guard = computeScenario(retiree({ strategy: 'guardrails' }))
    expect(guard.sustainable?.kind).toBe('rate')
    expect(computeScenario(retiree({ strategy: 'currentPct' })).sustainable).toBeNull()
  })
  it('the sustainable rate is the boundary: slightly above it depletes', async () => {
    const { computeScenario } = await import('../src/model/compute')
    const s = retiree({ strategy: 'initialPct' }, { annualReturn: 2 })
    const r = computeScenario(s).sustainable!.value
    expect(simulate(toPlan({ ...s, withdrawal: { ...s.withdrawal, rate: r * 100 } })).totals.depletedAtMonth).toBeNull()
    expect(simulate(toPlan({ ...s, withdrawal: { ...s.withdrawal, rate: r * 100 * 1.01 } })).totals.depletedAtMonth).not.toBeNull()
  })
})

describe('one income rule for deterministic and Monte Carlo', () => {
  it('a withdrawal phase shorter than a year is evaluated pro-rata, not counted as success', () => {
    const s = retiree({ strategy: 'fixed', amount: 20_000, startYear: 30, indexed: false }, { horizonYears: 29, horizonMonths: 6, retirement: { income: 25_000, real: false } })
    const plan = toPlan(s)
    const fi = fiAnalysis(s, simulate(plan))!
    expect(fi.sustain.meets).toBe(false)
    const mc = runMonteCarlo({ plan, volatility: 0, simulations: 3, seed: 1, income: { monthly: 25_000, real: false } })
    expect(mc.incomeProbability).toBe(0)
    const ok = runMonteCarlo({ plan, volatility: 0, simulations: 3, seed: 1, income: { monthly: 20_000, real: false } })
    expect(ok.incomeProbability).toBe(1)
  })
})
