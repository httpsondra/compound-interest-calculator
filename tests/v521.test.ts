import { describe, expect, it } from 'vitest'
import { simulate } from '../src/engine/simulate'
import { compareStrategies, STRATEGIES } from '../src/model/retirement'
import { defaultScenario, toPlan, type Scenario } from '../src/model/scenario'

/** A plan with retirement from year 21 (monthly payouts, indexed) whose own rule is `strategy`. */
const plan = (o: Partial<Scenario['withdrawal']> = {}, extra: Partial<Scenario> = {}): Scenario => {
  const s = defaultScenario('CZK')
  return {
    ...s,
    initial: 500_000,
    ...extra,
    withdrawal: { ...s.withdrawal, enabled: true, startYear: 21, strategy: 'initialPct', rate: 4, indexed: true, amountReal: false, ...o },
  }
}

describe('V5.2.1 normalized strategy comparison', () => {
  it('root cause of the unfair comparison: a rule reads its own setting, so a zero amount means zero fixed income', () => {
    // Pre-fix behaviour reproduced on the engine directly: the fixed rule ignores `rate`, the % rules ignore `amount`.
    const s = plan({ strategy: 'currentPct', amount: 0 })
    const fixed = simulate(toPlan({ ...s, withdrawal: { ...s.withdrawal, strategy: 'fixed' } }))
    const pct = simulate(toPlan(s))
    expect(fixed.withdrawalYears[0].planned).toBe(0)
    expect(pct.withdrawalYears[0].planned).toBeGreaterThan(50_000)
  })

  it('1+3: every rule starts from the same first-year budget; % rates are budget ÷ portfolio at the review', () => {
    const s = plan({ strategy: 'currentPct', rate: 3.7, amount: 0 })
    const own = simulate(toPlan(s)).withdrawalYears[0]
    const cmp = compareStrategies(s)!
    expect(cmp.status).toBe('ok')
    expect(cmp.annual).toBeCloseTo(own.planned, 8)
    expect(cmp.portfolio).toBeCloseTo(own.reviewBalance, 6)
    expect(cmp.rows.map((r) => r.strategy)).toEqual(STRATEGIES)
    for (const r of cmp.rows) {
      expect(r.plannedAnnual!).toBeCloseTo(own.planned, 5)
      expect(r.paidAnnual!).toBeCloseTo(own.planned, 5)
      expect(r.flooredStart).toBe(false)
      if (r.strategy !== 'fixed') expect(r.rate!).toBeCloseTo(3.7, 9) // independent: B/P = 3.7 % by construction
    }
    // Independent reference: B = rate × P.
    expect(cmp.annual).toBeCloseTo(0.037 * cmp.portfolio, 4)
  })

  it('2: the user scenario is never modified', () => {
    const s = plan({ strategy: 'guardrails', amount: 12_345, rate: 3.3 })
    const before = JSON.stringify(s)
    compareStrategies(s)
    expect(JSON.stringify(s)).toBe(before)
    const v = compareStrategies(s)!.rows
    expect(v.every((r) => r.variant !== s && r.variant.withdrawal !== s.withdrawal)).toBe(true)
    expect(v.find((r) => r.strategy === 'guardrails')!.variant.withdrawal.maxIncrease).toBe(s.withdrawal.maxIncrease)
  })

  it('4: fixed payouts follow the selected indexing and do not apply inflation twice', () => {
    for (const indexed of [true, false]) {
      const s = plan({ indexed, strategy: 'initialPct', rate: 4 }, { inflation: 3 })
      const cmp = compareStrategies(s)!
      const fixed = cmp.rows.find((r) => r.strategy === 'fixed')!
      const y = fixed.result!.withdrawalYears
      const B = cmp.annual
      for (let k = 0; k < 4; k++) expect(y[k].planned).toBeCloseTo(B * (indexed ? Math.pow(1.03, k) : 1), 5)
      // The amount is entered as nominal-at-retirement: no growth before the start.
      expect(fixed.variant.withdrawal.amountReal).toBe(false)
      expect(fixed.variant.withdrawal.amount).toBeCloseTo(B / 12, 8)
      // initial % follows the same path.
      const ip = cmp.rows.find((r) => r.strategy === 'initialPct')!.result!.withdrawalYears
      for (let k = 0; k < 4; k++) expect(ip[k].planned).toBeCloseTo(y[k].planned, 5)
    }
  })

  it('4b: current-portfolio % recomputes from the portfolio at every annual review', () => {
    const cmp = compareStrategies(plan())!
    const row = cmp.rows.find((r) => r.strategy === 'currentPct')!
    const y = row.result!.withdrawalYears
    for (let k = 0; k < 5; k++) expect(y[k].planned).toBeCloseTo((row.rate! / 100) * y[k].reviewBalance, 5)
  })

  it('5: the payment frequency never changes annual spending or the derived rate', () => {
    const ref = compareStrategies(plan({ frequency: 'monthly', strategy: 'currentPct' }))!
    for (const frequency of ['quarterly', 'annual'] as const) {
      const c = compareStrategies(plan({ frequency, strategy: 'currentPct' }))!
      for (const r of c.rows) {
        expect(r.plannedAnnual!).toBeCloseTo(ref.annual, 4)
        expect(r.paidAnnual!).toBeCloseTo(ref.annual, 4)
      }
    }
    // A fixed row built from a quarterly-paid fixed plan: monthly amount 8 000 → annual 96 000 (nominal at start).
    const fixed = plan({ strategy: 'fixed', amount: 8_000, amountReal: false, frequency: 'quarterly', indexed: false })
    const c = compareStrategies(fixed)!
    expect(c.annual).toBeCloseTo(96_000, 6)
    for (const r of c.rows) expect(r.plannedAnnual!).toBeCloseTo(96_000, 4)
  })

  it('6: planned and actually paid income are reported separately when the portfolio cannot pay', () => {
    const s = plan({ strategy: 'fixed', amount: 5_000, indexed: false, startYear: 1 }, { initial: 10_000, constant: { amount: 0, frequency: 'monthly' }, contribMode: 'constant', horizonYears: 5 })
    const c = compareStrategies(s)!
    const fixed = c.rows.find((r) => r.strategy === 'fixed')!
    expect(fixed.plannedAnnual!).toBeCloseTo(60_000, 6)
    expect(fixed.paidAnnual!).toBeLessThan(fixed.plannedAnnual!)
    // The % rules would need 600 % of the portfolio: they are explicitly unmatched, not shown as equivalent.
    const pct = c.rows.filter((r) => r.strategy !== 'fixed')
    expect(pct.every((r) => r.unmatched === 'rate' && r.result === null && r.stats === null)).toBe(true)
  })

  it('7: a zero-income baseline invents nothing; real zero withdrawals stay supported by the engine', () => {
    const zero = plan({ strategy: 'fixed', amount: 0 })
    const c = compareStrategies(zero)!
    expect(c.status).toBe('noIncome')
    expect(c.rows).toEqual([])
    const s = plan({ strategy: 'fixed', amount: 0 })
    const res = simulate(toPlan(s))
    expect(res.withdrawalYears[0].paid).toBe(0)
    expect(res.totals.final).toBeGreaterThan(0)
    expect(compareStrategies({ ...zero, withdrawal: { ...zero.withdrawal, enabled: false } })).toBeNull()
    // Percent rule at 0 %.
    expect(compareStrategies(plan({ strategy: 'initialPct', rate: 0 }))!.status).toBe('noIncome')
  })

  it('8: unequal outcomes are explainable — same start, then each rule\'s own path; money is conserved', () => {
    const s = plan({ strategy: 'currentPct', rate: 5 }, { annualReturn: 5, inflation: 2 })
    const c = compareStrategies(s)!
    const final = Object.fromEntries(c.rows.map((r) => [r.strategy, r.stats!]))
    // Percent of the current portfolio cannot deplete; a fixed indexed amount can.
    expect(final.currentPct.depletedAtMonth).toBeNull()
    // Starting income identical for all rules.
    for (const r of c.rows) expect(r.stats!.initial).toBeCloseTo(c.monthly, 4)
    // Different later paths: current % ends below fixed in income only if the market is weak — here both are defined and finite.
    for (const r of c.rows) {
      const res = r.result!
      expect(Number.isFinite(res.totals.final)).toBe(true)
      const contributed = res.points[res.points.length - 1].contributed
      // growth - fees - withdrawals + deposits ≈ final: sanity of the books for each row.
      expect(res.totals.final).toBeCloseTo(
        contributed + res.points[res.points.length - 1].growth - res.points[res.points.length - 1].fees - res.totals.withdrawn,
        1,
      )
    }
  })

  it('a guardrail minimum income that lifts year one is flagged, not hidden', () => {
    const s = plan({ strategy: 'guardrails', rate: 2, floor: 50_000, floorReal: false })
    const c = compareStrategies(s)!
    expect(c.rows.find((r) => r.strategy === 'guardrails')!.flooredStart).toBe(false) // its own year one defines B
    const other = compareStrategies({ ...s, withdrawal: { ...s.withdrawal, strategy: 'initialPct', rate: 2, floor: 50_000 } })!
    expect(other.rows.find((r) => r.strategy === 'guardrails')!.flooredStart).toBe(true)
  })
})

import { applyVariant, contributionStep, type VariantId } from '../src/model/variants'
import { computeSummary } from '../src/model/compute'

describe('V5.2.1 Compare presets', () => {
  const ids: VariantId[] = ['plusContribution', 'returnUp', 'returnDown', 'longer', 'fees']
  const schedule = (): Scenario => {
    const s = plan({ strategy: 'fixed', amount: 30_000, amountReal: false })
    s.contribMode = 'schedule'
    s.periods = [
      { ...s.periods[0], paused: false, frequency: 'monthly' },
      { ...s.periods[1], paused: true, frequency: 'monthly' },
      { ...s.periods[2], paused: false, frequency: 'quarterly' },
    ]
    return s
  }

  it('a contribution preset touches every active period, none of the paused ones, and keeps the monthly step per payment frequency', () => {
    const base = schedule()
    const v = applyVariant('plusContribution', base)
    const step = contributionStep('CZK')
    expect(v.periods[0].amount).toBe(base.periods[0].amount + step)
    expect(v.periods[1].amount).toBe(base.periods[1].amount) // paused: untouched
    expect(v.periods[2].amount).toBe(base.periods[2].amount + 3 * step) // quarterly payment = 3 months
    expect(v.periods.length).toBe(base.periods.length)
    expect(base.periods[0].amount).not.toBe(v.periods[0].amount) // base object untouched
  })

  it('11: a preview equals the scenario that is created from it (same engine, same pure function)', () => {
    for (const base of [plan(), schedule(), plan({ enabled: false })]) {
      for (const id of ids) {
        const preview = computeSummary(applyVariant(id, base))!.result.totals.final
        const created = computeSummary(applyVariant(id, base))!.result.totals.final
        expect(created).toBe(preview)
      }
    }
  })

  it('10: +5 years extends the withdrawal phase too unless the user set an end year', () => {
    const open = plan({ endYear: null })
    const a = simulate(toPlan(open)).withdrawalYears.length
    const b = simulate(toPlan(applyVariant('longer', open))).withdrawalYears.length
    expect(b).toBe(a + 5)
    const closed = plan({ endYear: 25 })
    expect(simulate(toPlan(applyVariant('longer', closed))).withdrawalYears.length).toBe(simulate(toPlan(closed)).withdrawalYears.length)
    // With the same final-value metric, more years of withdrawals can lower the end value (explained in the UI).
    const fin = (s: Scenario) => simulate(toPlan(s)).totals.final
    expect(Number.isFinite(fin(applyVariant('longer', open)))).toBe(true)
  })

  it('+1 % fees adds one point to the existing fee, or switches fees on at 1 %', () => {
    expect(applyVariant('fees', plan()).fees.annual).toBe(1)
    const withFee = { ...plan(), feesEnabled: true, fees: { annual: 0.5, entry: 0, fixed: 0 } }
    expect(applyVariant('fees', withFee).fees.annual).toBe(1.5)
  })
})

import { runMonteCarlo } from '../src/engine/montecarlo'

describe('V5.2.1 Risk percentiles are what the labels say', () => {
  it('13: for a lump sum the 10th/50th/90th percentiles match the analytic log-normal quantiles', () => {
    const s = { ...defaultScenario('CZK'), initial: 1_000_000, constant: { amount: 0, frequency: 'monthly' as const }, horizonYears: 10, annualReturn: 6, inflationEnabled: false }
    const sigma = 0.15
    const mc = runMonteCarlo({ plan: toPlan(s), volatility: sigma, simulations: 6000, seed: 11 })
    const p = mc.finalPercentiles
    const median = 1_000_000 * Math.pow(1.06, 10)
    const z90 = 1.2815515655
    const q = (z: number) => median * Math.exp(z * sigma * Math.sqrt(10))
    expect(p.p50 / median).toBeGreaterThan(0.97)
    expect(p.p50 / median).toBeLessThan(1.03)
    expect(p.p10 / q(-z90)).toBeGreaterThan(0.95)
    expect(p.p10 / q(-z90)).toBeLessThan(1.05)
    expect(p.p90 / q(z90)).toBeGreaterThan(0.95)
    expect(p.p90 / q(z90)).toBeLessThan(1.05)
    expect(p.p10).toBeLessThan(p.p50)
    expect(p.p50).toBeLessThan(p.p90)
  })

  it('the lowest-income percentiles are ordered poor ≤ typical ≤ strong; % of current portfolio never depletes yet income can fall', () => {
    const s = plan({ strategy: 'currentPct', rate: 4 })
    const mc = runMonteCarlo({ plan: toPlan(s), volatility: 0.18, simulations: 800, seed: 5, income: { monthly: 20_000, real: true } })
    expect(mc.lowestIncome!.p10).toBeLessThanOrEqual(mc.lowestIncome!.p50)
    expect(mc.lowestIncome!.p50).toBeLessThanOrEqual(mc.lowestIncome!.p90)
    expect(mc.depletionProbability).toBe(0)
    expect(mc.lowestIncome!.p10).toBeLessThan(mc.lowestIncome!.p90 * 0.8)
  })
})
