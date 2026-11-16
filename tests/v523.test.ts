import { describe, expect, it } from 'vitest'
import { computeSummary } from '../src/model/compute'
import { buildPreset } from '../src/model/presets'
import { defaultScenario, uid, type Scenario } from '../src/model/scenario'
import { applyImport, buildExport, EXPORT_FORMAT, MAX_IMPORT_BYTES, parseImport } from '../src/state/plans'
import { AUTO_LIMIT, backupsToPrune, isDuplicateBackup, PROTECTED_LIMIT, type BackupKind, type BackupRec } from '../src/state/storage'

const rec = (id: number, kind: BackupKind, raw = String(id)): BackupRec => ({ id, at: id, raw, kind })

describe('V5.2.3 backup retention', () => {
  it('a burst of automatic copies never evicts a conflict copy', () => {
    const list = [rec(1, 'conflict'), rec(2, 'import'), ...Array.from({ length: 40 }, (_, i) => rec(10 + i, 'auto'))]
    const drop = new Set(backupsToPrune(list))
    expect(drop.has(1)).toBe(false)
    expect(drop.has(2)).toBe(false)
    expect(list.filter((b) => b.kind === 'auto' && !drop.has(b.id))).toHaveLength(AUTO_LIMIT)
    // newest automatic copies are the ones kept
    expect(drop.has(49)).toBe(false)
    expect(drop.has(10)).toBe(true)
  })
  it('protected copies are limited separately and oldest-first', () => {
    const list = Array.from({ length: PROTECTED_LIMIT + 5 }, (_, i) => rec(i + 1, i % 2 ? 'conflict' : 'restore'))
    const drop = backupsToPrune(list)
    expect(drop.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })
  it('identical consecutive copies of one kind are not repeated, other kinds are', () => {
    const list = [rec(1, 'conflict', 'x'), rec(2, 'auto', 'y')]
    expect(isDuplicateBackup(list, 'x', 'conflict')).toBe(true)
    expect(isDuplicateBackup(list, 'x', 'auto')).toBe(false)
    expect(isDuplicateBackup(list, 'z', 'conflict')).toBe(false)
  })
})

const fullPlan = (): Scenario => {
  const s = defaultScenario('EUR', 'Full plan')
  return {
    ...s,
    contribMode: 'schedule',
    inflation: 3.1,
    startAge: 33,
    feesEnabled: true,
    fees: { annual: 0.8, entry: 1, fixed: 2 },
    lumpSums: [{ id: uid('l'), year: 5, amount: 20000 }],
    goal: { enabled: true, target: 900_000, year: 25, real: true },
    retirement: { enabled: true, income: 2500, real: true },
    withdrawal: { ...s.withdrawal, enabled: true, strategy: 'guardrails', rate: 3.6, maxIncrease: 4, maxDecrease: 2, floor: 1200, startYear: 24, frequency: 'quarterly', indexed: true, amountReal: false },
  }
}

describe('V5.2.3 export / import', () => {
  it('round trip reproduces the financial settings and results of every plan', () => {
    const doc = { scenarios: [fullPlan(), buildPreset('fi', 'CZK'), defaultScenario('USD', 'Plain')], activeId: '' }
    doc.activeId = doc.scenarios[1].id
    const text = buildExport(doc, new Date('2026-01-02T03:04:05Z'))
    const parsed = JSON.parse(text)
    expect(parsed).toMatchObject({ format: EXPORT_FORMAT, version: 1, exportedAt: '2026-01-02T03:04:05.000Z' })
    const r = parseImport(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.doc.activeId).toBe(doc.activeId)
    expect(r.doc.scenarios.map((s) => [s.id, s.name, s.currency])).toEqual(doc.scenarios.map((s) => [s.id, s.name, s.currency]))
    doc.scenarios.forEach((s, i) => {
      const a = computeSummary(s)!.result
      const b = computeSummary(r.doc.scenarios[i])!.result
      expect(b.balances).toEqual(a.balances)
      expect(b.totals).toEqual(a.totals)
      expect(b.withdrawalYears.map((y) => y.planned)).toEqual(a.withdrawalYears.map((y) => y.planned))
      // Settings, ignoring the regenerated ids of list rows.
      const strip = (x: Scenario) => JSON.stringify({ ...x, periods: x.periods.map(({ id: _i, ...p }) => p), lumpSums: x.lumpSums.map(({ id: _l, ...p }) => p) })
      expect(strip(r.doc.scenarios[i])).toBe(strip(s))
    })
  })
  it('the export holds plans only: no history, results or browser state', () => {
    const text = buildExport({ scenarios: [defaultScenario('CZK', 'A')], activeId: 'x' })
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['activeId', 'exportedAt', 'format', 'scenarios', 'version'])
    expect(text).not.toMatch(/balances|past|draft|backup/)
  })
  it('refuses malformed, foreign, newer, empty, oversized and over-limit files without guessing', () => {
    expect(parseImport('{not json')).toEqual({ ok: false, error: 'json' })
    expect(parseImport('[]')).toEqual({ ok: false, error: 'format' })
    expect(parseImport(JSON.stringify({ format: 'something-else', version: 1, scenarios: [{}] }))).toEqual({ ok: false, error: 'format' })
    expect(parseImport(JSON.stringify({ format: EXPORT_FORMAT, version: 2, scenarios: [{}] }))).toEqual({ ok: false, error: 'version' })
    expect(parseImport(JSON.stringify({ format: EXPORT_FORMAT, version: 1, scenarios: [] }))).toEqual({ ok: false, error: 'empty' })
    expect(parseImport(JSON.stringify({ format: EXPORT_FORMAT, version: 1, scenarios: [1, 'x', null] }))).toEqual({ ok: false, error: 'empty' })
    expect(parseImport(JSON.stringify({ format: EXPORT_FORMAT, version: 1, scenarios: Array.from({ length: 5 }, () => ({ v: 4 })) }))).toEqual({ ok: false, error: 'tooMany' })
    expect(parseImport(' '.repeat(MAX_IMPORT_BYTES + 1))).toEqual({ ok: false, error: 'size' })
  })
  it('sanitizes values: nothing from the file is trusted', () => {
    const r = parseImport(JSON.stringify({ format: EXPORT_FORMAT, version: 1, scenarios: [{ v: 4, id: '<script>', name: 'x'.repeat(500), currency: 'BTC', initial: -5, annualReturn: 1e9, horizonYears: 9999 }] }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const s = r.doc.scenarios[0]
    expect(s.id).toMatch(/^[\w-]+$/)
    expect(s.name.length).toBeLessThanOrEqual(60)
    expect(['CZK', 'EUR', 'USD']).toContain(s.currency)
    expect(s.initial).toBeGreaterThanOrEqual(0)
    expect(s.annualReturn).toBeLessThan(1000)
    expect(s.horizonYears).toBeLessThanOrEqual(100)
  })
  it('accepts the bare saved-plans document (documented historical store format) and says so; skips unreadable entries', () => {
    const r = parseImport(JSON.stringify({ activeId: 'a', scenarios: [{ v: 4, id: 'a', name: 'Alpha', currency: 'EUR' }, 7] }))
    expect(r.ok && r.legacy && r.skipped === 1 && r.doc.scenarios.length === 1).toBe(true)
  })
  it('duplicate ids in a file are made unique', () => {
    const r = parseImport(JSON.stringify({ format: EXPORT_FORMAT, version: 1, scenarios: [{ id: 'same', name: 'A' }, { id: 'same', name: 'B' }] }))
    expect(r.ok && new Set(r.doc.scenarios.map((s) => s.id)).size === 2).toBe(true)
  })
  it('add keeps current plans and respects the maximum; replace takes the file as is', () => {
    const mk = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ ...defaultScenario('CZK', `${prefix}${i}`), id: `${prefix}${i}` }))
    const current = { scenarios: mk(3, 'c'), activeId: 'c0' }
    const incoming = { scenarios: mk(3, 'i'), activeId: 'i0' }
    const add = applyImport(current, incoming, 'add')
    expect(add.doc.scenarios.map((s) => s.id)).toEqual(['c0', 'c1', 'c2', 'i0'])
    expect(add).toMatchObject({ added: 1, dropped: 2 })
    expect(add.doc.activeId).toBe('c0')
    const rep = applyImport(current, incoming, 'replace')
    expect(rep.doc).toEqual(incoming)
    // id clash on add is resolved without touching the current plan
    const clash = applyImport({ scenarios: mk(1, 'c'), activeId: 'c0' }, { scenarios: [{ ...mk(1, 'c')[0], name: 'incoming' }], activeId: 'c0' }, 'add')
    expect(clash.doc.scenarios[0].name).toBe('c0')
    expect(new Set(clash.doc.scenarios.map((s) => s.id)).size).toBe(2)
  })
})
