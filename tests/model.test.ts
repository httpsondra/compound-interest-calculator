import { describe, expect, it } from 'vitest'
import { parseNumber, createFormatter } from '../src/lib/format'
import { decodeShare, encodeShare, sanitizeScenario } from '../src/model/serialize'
import { defaultScenario, periodRanges, toPlan, validateScenario, type Period } from '../src/model/scenario'
import { addPeriod, extendTo, movePeriod, removePeriod, setEndYear, splitPeriod, trimTo } from '../src/model/timeline'
import { computeScenario, computeSummary } from '../src/model/compute'
import { buildPreset, PRESET_IDS } from '../src/model/presets'
import { buildCsv } from '../src/lib/csv'
import { simulate } from '../src/engine/simulate'

describe('parseNumber', () => {
  it.each([
    ['1 000', 'cs', 1000],
    ['1 000,5', 'cs', 1000.5],
    ['1 234 567', 'cs', 1234567],
    ['2,5', 'cs', 2.5],
    ['2.5', 'cs', 2.5],
    ['1.000.000', 'cs', 1_000_000],
    ['1,234', 'en', 1234],
    ['1,234.56', 'en', 1234.56],
    ['1.234,56', 'en', 1234.56],
    ['2,5', 'en', 2.5],
    ['5k', 'en', 5000],
    ['1,2 mil', 'cs', 1_200_000],
    ['3 tis', 'cs', 3000],
    ['−7', 'en', -7],
    ['€ 12 500', 'en', 12500],
    ['12 500 Kč', 'cs', 12500],
    ['7 %', 'cs', 7],
  ] as const)('%s (%s) → %d', (raw, lang, expected) => {
    expect(parseNumber(raw, lang)).toBeCloseTo(expected, 9)
  })
  it.each(['', 'abc', '1..2', '1,2,3,4x', '--5'])('rejects %j', (raw) => {
    expect(parseNumber(raw, 'en')).toBeNull()
  })
})

describe('formatting', () => {
  it('uses locale-aware currency formatting and never shows NaN', () => {
    const cs = createFormatter('cs')
    const en = createFormatter('en')
    expect(cs.money(1234567, 'CZK').replace(/\s/g, ' ')).toBe('1 234 567 Kč')
    expect(en.money(1234567, 'EUR')).toBe('€1,234,567')
    expect(en.money(NaN, 'EUR')).toBe('—')
    expect(en.money(-0.0001, 'EUR')).toBe('€0')
  })
})

describe('share links', () => {
  it('round-trips a scenario', () => {
    const s = { ...defaultScenario('CZK'), name: 'Důchod – ETF', contribMode: 'schedule' as const, startAge: 25 }
    const back = decodeShare(encodeShare(s))!
    expect(back).not.toBeNull()
    expect(back.name).toBe('Důchod – ETF')
    expect(back.periods.map((p) => p.amount)).toEqual(s.periods.map((p) => p.amount))
    expect(simulate(toPlan(back)).totals.final).toBeCloseTo(simulate(toPlan(s)).totals.final, 6)
  })
  it('rejects malformed or hostile payloads', () => {
    expect(decodeShare('not base64!!')).toBeNull()
    expect(decodeShare(btoa('{"sv":2,"s":"x"}'))).toBeNull()
    expect(decodeShare('x'.repeat(9000))).toBeNull()
  })
  it('sanitises out-of-range values instead of trusting them', () => {
    const s = sanitizeScenario({
      currency: 'XXX',
      initial: -5,
      annualReturn: 1e9,
      horizonYears: 'abc',
      periods: [{ years: 0, amount: -1, frequency: 'hourly' }],
      name: '<script>alert(1)</script>\u0000',
    })!
    expect(s.currency).toBe('CZK')
    expect(s.initial).toBe(0)
    expect(s.annualReturn).toBe(100)
    expect(s.horizonYears).toBe(30)
    expect(s.periods[0]).toMatchObject({ years: 1, amount: 0, frequency: 'monthly' })
    expect(s.name).not.toContain('\u0000')
  })
})

const P = (years: number, amount = 1000): Period => ({ id: `p${years}-${amount}`, years, amount, frequency: 'monthly', paused: false })
const ends = (ps: Period[]) => periodRanges(ps).map((r) => [r.startYear, r.endYear])

describe('timeline operations keep the schedule contiguous', () => {
  it('moving a boundary shifts only the neighbour', () => {
    const ps = [P(10), P(10), P(10)]
    expect(ends(setEndYear(ps, 0, 5))).toEqual([[1, 5], [6, 20], [21, 30]])
    expect(ends(setEndYear(ps, 0, 25))).toEqual([[1, 19], [20, 20], [21, 30]])
    expect(ends(setEndYear(ps, 2, 40))).toEqual([[1, 10], [11, 20], [21, 40]])
  })
  it('split, add, remove, move, extend and trim', () => {
    expect(ends(splitPeriod([P(10)], 0))).toEqual([[1, 5], [6, 10]])
    expect(ends(addPeriod([P(10)], 10))).toEqual([[1, 5], [6, 10]])
    expect(ends(addPeriod([P(10)], 15))).toEqual([[1, 10], [11, 15]])
    expect(ends(removePeriod([P(5), P(5), P(10)], 1))).toEqual([[1, 10], [11, 20]])
    expect(ends(removePeriod([P(5), P(5)], 0))).toEqual([[1, 10]])
    expect(movePeriod([P(5, 1), P(10, 2)], 0, 1).map((p) => p.amount)).toEqual([2, 1])
    expect(ends(extendTo([P(5), P(5)], 30))).toEqual([[1, 5], [6, 30]])
    expect(ends(trimTo([P(10), P(10), P(10)], 15))).toEqual([[1, 10], [11, 15]])
  })
})

describe('scenario model', () => {
  it('flags schedule gaps and beyond-horizon periods as warnings, not errors', () => {
    const s = { ...defaultScenario(), contribMode: 'schedule' as const, periods: [P(10)] }
    expect(validateScenario(s).map((i) => i.code)).toContain('scheduleShort')
    const long = { ...s, periods: [P(40)] }
    expect(validateScenario(long).map((i) => i.code)).toContain('scheduleLong')
    expect(computeScenario(long).ok).toBe(true)
  })
  it('invalid horizon or return blocks results with a clear error', () => {
    expect(computeScenario({ ...defaultScenario(), horizonYears: 0, horizonMonths: 0 }).ok).toBe(false)
    expect(computeScenario({ ...defaultScenario(), annualReturn: -100 }).ok).toBe(false)
  })
  it('paused periods contribute nothing', () => {
    const s = { ...defaultScenario(), initial: 0, horizonYears: 20, contribMode: 'schedule' as const, periods: [P(10, 1000), { ...P(10, 5000), paused: true }] }
    expect(simulate(toPlan(s)).totals.contributed).toBe(120_000)
  })
  it('fee impact uses identical non-fee assumptions', () => {
    const s = { ...defaultScenario(), feesEnabled: true, fees: { annual: 1, entry: 0, fixed: 0 } }
    const c = computeScenario(s)
    const noFee = computeScenario({ ...s, feesEnabled: false })
    expect(c.noFee!.final).toBeCloseTo(noFee.result!.totals.final, 6)
  })
  it('goal solutions reproduce the target through the same pipeline', () => {
    const s = { ...defaultScenario('CZK'), goal: { enabled: true, target: 10_000_000, year: 25, real: false } }
    const c = computeScenario(s)
    expect(c.goal!.contribution.status).toBe('ok')
    if (c.goal!.contribution.status !== 'ok') return
    const solved = { ...s, horizonYears: 25, constant: { ...s.constant, amount: c.goal!.contribution.value } }
    expect(simulate(toPlan(solved)).totals.final).toBeCloseTo(10_000_000, 1)
  })
  it('every preset computes and reconciles', () => {
    for (const id of PRESET_IDS) {
      for (const cur of ['CZK', 'EUR'] as const) {
        const c = computeScenario(buildPreset(id, cur))
        expect(c.ok).toBe(true)
        expect(c.result!.points.at(-1)!.balance).toBe(c.result!.totals.final)
        expect(computeSummary(buildPreset(id, cur))!.result.totals.final).toBe(c.result!.totals.final)
      }
    }
  })
  it('lifecycle preset detects whether money lasts', () => {
    const c = computeScenario(buildPreset('lifecycle', 'CZK'))
    expect(c.result!.totals.withdrawn).toBeGreaterThan(0)
    expect(c.sustainable).toBeGreaterThan(0)
  })
})

describe('CSV', () => {
  it('uses ; and decimal comma for Czech, , and dot for English', () => {
    const cs = buildCsv({ lang: 'cs', meta: [], header: ['Rok', 'Hodnota'], rows: [[1, 1234.5]] })
    expect(cs.split('\r\n').at(-1)).toBe('1;1234,50')
    const en = buildCsv({ lang: 'en', meta: [['Note', 'a, b']], header: ['Year', 'Value'], rows: [[1, 1234.5]] })
    expect(en).toContain('"a, b"')
    expect(en.split('\r\n').at(-1)).toBe('1,1234.50')
  })
})
