import { describe, expect, it } from 'vitest'
import { HELP_IDS, getHelp, type HelpCtx } from '../src/help'
import { depositFee, feeDrag, grow, nextYearContribution, realOf, timingDifference } from '../src/help/examples'
import { computeScenario } from '../src/model/compute'
import { buildPreset } from '../src/model/presets'
import { defaultScenario, type Scenario } from '../src/model/scenario'
import { createFormatter } from '../src/lib/format'
import { simulate, toReal } from '../src/engine/simulate'

const ctxFor = (s: Scenario, lang: 'cs' | 'en', extra?: HelpCtx['extra']): HelpCtx => {
  const f = createFormatter(lang)
  return { s, computed: computeScenario(s), f, money: (v) => f.money(v, s.currency), pct: (v, d = 2) => f.pct(v, d), extra }
}

const scenarios: Scenario[] = [
  defaultScenario('CZK'),
  { ...buildPreset('rising', 'USD'), feesEnabled: true, fees: { annual: 0.8, entry: 1.5, fixed: 2 }, goal: { enabled: true, target: 1_000_000, year: 30, real: true } },
  buildPreset('lifecycle', 'EUR'),
  { ...defaultScenario('EUR'), horizonYears: 0, horizonMonths: 0 }, // invalid → no results
]

describe('help content', () => {
  it('every topic exists in both languages and renders cleanly for very different plans', () => {
    for (const lang of ['cs', 'en'] as const) {
      for (const s of scenarios) {
        const ctx = ctxFor(s, lang, { vol: 15, median: 123_456, p10: 50_000, p90: 300_000, goalProb: 0.42 })
        for (const id of HELP_IDS) {
          const b = getHelp(lang, id, ctx)
          expect(b.title.length, `${lang}/${id}`).toBeGreaterThan(1)
          expect(b.what.length, `${lang}/${id}`).toBeGreaterThan(10)
          const text = Object.values(b).filter(Boolean).join(' ')
          expect(text, `${lang}/${id}`).not.toMatch(/undefined|NaN|Infinity|\{\w+\}/)
        }
      }
    }
  })
  it('Czech and English differ (no untranslated copies)', () => {
    const s = defaultScenario('CZK')
    for (const id of HELP_IDS) {
      expect(getHelp('cs', id, ctxFor(s, 'cs')).what).not.toBe(getHelp('en', id, ctxFor(s, 'en')).what)
    }
  })
  it('examples use the selected currency and locale formatting', () => {
    const usd = { ...defaultScenario('USD'), annualReturn: 8 }
    expect(getHelp('en', 'return', ctxFor(usd, 'en')).example).toMatch(/\$4,000.*\$4,320/)
    expect(getHelp('cs', 'return', ctxFor(usd, 'cs')).example?.replace(/[\u00a0\u202f]/g, ' ')).toMatch(/4 000 \$.*4 320 \$/)
    const czk = { ...defaultScenario('CZK'), annualReturn: 8 }
    expect(getHelp('cs', 'return', ctxFor(czk, 'cs')).example?.replace(/[\u00a0\u202f]/g, ' ')).toMatch(/100 000 Kč.*108 000 Kč/)
  })
  it('dynamic texts reflect the current settings', () => {
    const s = { ...defaultScenario('CZK'), constant: { amount: 5000, frequency: 'monthly' as const } }
    const c = getHelp('en', 'contribution', ctxFor(s, 'en')).example!.replace(/\s/g, ' ')
    expect(c).toContain('CZK 5,000')
    expect(c).toContain('CZK 60,000')
  })
})

describe('help examples come from the engine', () => {
  it('match the reference values from the brief', () => {
    expect(grow(100_000, 8)).toBeCloseTo(108_000, 6)
    expect(realOf(100_000, 20, 2.5)).toBeCloseTo(100_000 / Math.pow(1.025, 20), 6)
    expect(Math.round(realOf(100_000, 20, 2.5))).toBe(61_027)
    expect(nextYearContribution(5000, 5)).toBeCloseTo(5250, 9)
    expect(depositFee(5000, 2, 0)).toBeCloseTo(100, 9)
  })
  it('agree with simulate() and toReal() directly', () => {
    const d = feeDrag(100_000, 7, 1, 30)
    expect(d.without).toBeCloseTo(100_000 * Math.pow(1.07, 30), 4)
    expect(d.withFee).toBeLessThan(d.without)
    const t = timingDifference(1000, 7)
    expect(t.start).toBeGreaterThan(t.end)
    expect(toReal(100_000, 240, 0.025)).toBeCloseTo(realOf(100_000, 20, 2.5), 9)
  })
  it('result-based texts quote the same numbers as the results', () => {
    const s = defaultScenario('EUR')
    const ctx = ctxFor(s, 'en')
    const final = simulate(computeScenario(s).plan!).totals.final
    expect(getHelp('en', 'projected', ctx).example).toContain(ctx.money(final))
  })
})
