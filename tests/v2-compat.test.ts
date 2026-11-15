import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { simulate } from '../src/engine/simulate'
import { sanitizeScenario } from '../src/model/serialize'
import { toPlan } from '../src/model/scenario'
import * as v2s from './fixtures/v2/model/scenario'
import { simulate as v2simulate } from './fixtures/v2/engine/simulate'

/*
 * Production-data compatibility (V4.2): the first React redesign (commit 01d9ea0) stored plans
 * under the same key (`investcalc.v2.scenarios`) in schema v2. Random v2 plans are migrated
 * with the CURRENT loader and must reproduce the frozen v2 engine's balances and totals.
 */

const arbV2 = fc
  .record({
    currency: fc.constantFrom('CZK' as const, 'EUR' as const, 'USD' as const),
    initial: fc.integer({ min: 0, max: 5_000_000 }),
    horizonYears: fc.integer({ min: 1, max: 60 }),
    horizonMonths: fc.integer({ min: 0, max: 11 }),
    annualReturn: fc.double({ min: -5, max: 12, noNaN: true }),
    timing: fc.constantFrom('start' as const, 'end' as const),
    inflationEnabled: fc.boolean(),
    inflation: fc.double({ min: 0, max: 8, noNaN: true }),
    constant: fc.integer({ min: 0, max: 40_000 }),
    frequency: fc.constantFrom('weekly' as const, 'monthly' as const, 'quarterly' as const, 'annual' as const),
    withdrawalOn: fc.boolean(),
    startYear: fc.integer({ min: 1, max: 40 }),
    amount: fc.integer({ min: 0, max: 100_000 }),
    wFreq: fc.constantFrom('monthly' as const, 'quarterly' as const, 'annual' as const),
    indexed: fc.boolean(),
    stop: fc.boolean(),
  })
  .map((o) => {
    const s = v2s.defaultScenario(o.currency)
    return {
      ...s,
      initial: o.initial,
      horizonYears: o.horizonYears,
      horizonMonths: o.horizonMonths,
      annualReturn: o.annualReturn,
      timing: o.timing,
      inflationEnabled: o.inflationEnabled,
      inflation: o.inflation,
      contribMode: 'constant' as const,
      constant: { amount: o.constant, frequency: o.frequency },
      withdrawal: {
        enabled: o.withdrawalOn,
        startYear: o.startYear,
        endYear: null,
        amount: o.amount,
        frequency: o.wFreq,
        indexed: o.indexed,
        stopContributions: o.stop,
      },
    }
  })

describe('v2 (first React redesign) saved plans keep their portfolio results', () => {
  it('balances, totals and depletion match the frozen v2 engine', () => {
    fc.assert(
      fc.property(arbV2, (old) => {
        const migrated = sanitizeScenario(JSON.parse(JSON.stringify(old)))!
        const a = v2simulate(v2s.toPlan(old as never))
        const b = simulate(toPlan(migrated))
        expect(b.balances.length).toBe(a.balances.length)
        for (let m = 0; m < a.balances.length; m++) {
          const x = a.balances[m]
          const y = b.balances[m]
          expect(Math.abs(x - y)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(x)))
        }
        expect(b.totals.depletedAtMonth).toBe(a.totals.depletedAtMonth)
        expect(Math.abs(b.totals.withdrawn - a.totals.withdrawn)).toBeLessThanOrEqual(1e-6 * Math.max(1, a.totals.withdrawn))
      }),
      { numRuns: 150 },
    )
  })

  it('a v2 plan with withdrawals does NOT gain an income goal it never had', () => {
    fc.assert(
      fc.property(arbV2, (old) => {
        const migrated = sanitizeScenario(JSON.parse(JSON.stringify(old)))!
        expect(migrated.retirement.enabled).toBe(false)
      }),
      { numRuns: 60 },
    )
  })
})
