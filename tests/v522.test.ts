import { describe, expect, it } from 'vitest'
import { simulate } from '../src/engine/simulate'
import { incomeStats, incomeVerdict } from '../src/model/retirement'
import { defaultScenario, inflationRate, toPlan, type Scenario } from '../src/model/scenario'

const plan = (w: Partial<Scenario['withdrawal']> = {}, extra: Partial<Scenario> = {}): Scenario => {
  const s = defaultScenario('CZK')
  return { ...s, initial: 2_000_000, annualReturn: 6, ...extra, withdrawal: { ...s.withdrawal, enabled: true, startYear: 21, amountReal: false, ...w } }
}
const verdict = (s: Scenario) => {
  const res = simulate(toPlan(s))
  return incomeVerdict(s, res, incomeStats(res, inflationRate(s)))
}

describe('V5.2.2 income verdict (shared by Plan and Retirement)', () => {
  it('no withdrawals → no verdict', () => {
    const s = plan()
    expect(incomeVerdict({ ...s, withdrawal: { ...s.withdrawal, enabled: false } }, simulate(toPlan(s)))).toBeNull()
  })
  it('fixed nominal amount loses purchasing power; indexed does not', () => {
    const flat = verdict(plan({ strategy: 'fixed', amount: 10_000, indexed: false }, { inflation: 3 }))!
    // Real income of year k = (1/1.03)^(k): first→last over 10 full years = ~ -26 %.
    expect(flat.realChange).toBeLessThan(-10)
    expect(flat.powerLoss).toBe(true)
    const idx = verdict(plan({ strategy: 'fixed', amount: 10_000, indexed: true }, { inflation: 3 }))!
    expect(idx.realChange).toBeCloseTo(0, 6)
    expect(idx.powerLoss).toBe(false)
  })
  it('zero inflation never reports a loss; negative inflation raises real income', () => {
    expect(verdict(plan({ strategy: 'fixed', amount: 10_000, indexed: false }, { inflationEnabled: false }))!.powerLoss).toBe(false)
    const neg = verdict(plan({ strategy: 'fixed', amount: 10_000, indexed: false }, { inflation: -1 }))!
    expect(neg.realChange).toBeGreaterThan(0)
    expect(neg.powerLoss).toBe(false)
  })
  it('depletion and unpaid withdrawals are reported as such, never as a mere power loss', () => {
    const dep = verdict(plan({ strategy: 'fixed', amount: 40_000, indexed: true }, { inflation: 3, initial: 50_000 }))!
    expect(dep.depletedAtMonth).not.toBeNull()
    expect(dep.powerLoss).toBe(false)
    expect(dep.shortYear).not.toBeNull()
  })
  it('zero starting income: no percentage from a zero denominator', () => {
    const z = verdict(plan({ strategy: 'fixed', amount: 0, indexed: false }, { inflation: 3 }))
    expect(z === null || (z.realChange === 0 && !z.powerLoss)).toBe(true)
    const zr = verdict(plan({ strategy: 'initialPct', rate: 0 }, { inflation: 3 }))
    expect(zr === null || (Number.isFinite(zr.realChange) && zr.realChange === 0)).toBe(true)
  })
  it('a retirement phase shorter than a year has no spurious erosion', () => {
    const v = verdict(plan({ strategy: 'fixed', amount: 10_000, indexed: false, startYear: 30 }, { inflation: 3, horizonYears: 30, horizonMonths: 5 }))
    expect(v === null || v.powerLoss === false).toBe(true)
  })
  it('percentage strategies: current-% keeps paying (no depletion) and is judged by real income change', () => {
    const v = verdict(plan({ strategy: 'currentPct', rate: 4, indexed: true }, { inflation: 2.5 }))!
    expect(v.depletedAtMonth).toBeNull()
    expect(Number.isFinite(v.realChange)).toBe(true)
    const g = verdict(plan({ strategy: 'guardrails', rate: 4, indexed: true }, { inflation: 2.5 }))!
    expect(g.shortYear).toBeNull()
  })
})
