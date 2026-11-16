import { sanitizeScenario } from '../model/serialize'
import { uid, type Scenario } from '../model/scenario'

/*
 * User-controlled export / import of the saved plans (pure, unit-tested).
 *
 * Export: a small, human-readable JSON document with exactly the saved scenarios. No undo history, no UI state,
 * no simulation results, nothing about the browser.
 * Import: nothing is trusted. Size is limited first, then every scenario is rebuilt through the same
 * sanitizer as share links and saved plans (which also upgrades the historical scenario formats it knows).
 * Unknown file formats or newer versions are refused, not guessed at.
 */

export const EXPORT_FORMAT = 'investcalc-plans'
export const EXPORT_VERSION = 1
export const MAX_IMPORT_BYTES = 1_500_000
export const MAX_SCENARIOS = 4

export interface PlansDoc {
  scenarios: Scenario[]
  activeId: string
}

export function buildExport(doc: PlansDoc, now: Date = new Date()): string {
  return JSON.stringify(
    { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now.toISOString(), activeId: doc.activeId, scenarios: doc.scenarios },
    null,
    2,
  )
}

export function exportFileName(now: Date = new Date()): string {
  return `investcalc-plans-${now.toISOString().slice(0, 10)}.json`
}

export type ImportError = 'size' | 'json' | 'format' | 'version' | 'empty' | 'tooMany'

export type ImportResult =
  | { ok: true; doc: PlansDoc; legacy: boolean; skipped: number }
  | { ok: false; error: ImportError }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Validates and sanitizes an export file (or, as a documented historical case, the bare saved-plans document). */
export function parseImport(text: string): ImportResult {
  if (typeof text !== 'string' || text.length > MAX_IMPORT_BYTES) return { ok: false, error: 'size' }
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return { ok: false, error: 'json' }
  }
  if (!isObj(v)) return { ok: false, error: 'format' }
  const legacy = v.format === undefined
  if (!legacy) {
    if (v.format !== EXPORT_FORMAT) return { ok: false, error: 'format' }
    if (typeof v.version !== 'number' || !Number.isInteger(v.version) || v.version < 1 || v.version > EXPORT_VERSION) return { ok: false, error: 'version' }
  }
  if (!Array.isArray(v.scenarios)) return { ok: false, error: 'format' }
  if (v.scenarios.length === 0) return { ok: false, error: 'empty' }
  if (v.scenarios.length > MAX_SCENARIOS) return { ok: false, error: 'tooMany' }
  const seen = new Set<string>()
  const scenarios: Scenario[] = []
  for (const raw of v.scenarios) {
    const s = sanitizeScenario(raw)
    if (!s) continue
    if (seen.has(s.id)) s.id = uid('sc')
    seen.add(s.id)
    scenarios.push(s)
  }
  if (!scenarios.length) return { ok: false, error: 'empty' }
  const wanted = typeof v.activeId === 'string' ? v.activeId : ''
  return {
    ok: true,
    legacy,
    skipped: v.scenarios.length - scenarios.length,
    doc: { scenarios, activeId: scenarios.some((s) => s.id === wanted) ? wanted : scenarios[0].id },
  }
}

/** What an import does to the current plans. `add` keeps them and appends as many as fit. */
export function applyImport(current: PlansDoc, incoming: PlansDoc, mode: 'replace' | 'add'): { doc: PlansDoc; added: number; dropped: number } {
  if (mode === 'replace') return { doc: incoming, added: incoming.scenarios.length, dropped: 0 }
  const used = new Set(current.scenarios.map((s) => s.id))
  const room = Math.max(0, MAX_SCENARIOS - current.scenarios.length)
  const take = incoming.scenarios.slice(0, room).map((s) => (used.has(s.id) ? { ...s, id: uid('sc') } : s))
  return {
    doc: { scenarios: [...current.scenarios, ...take], activeId: current.activeId },
    added: take.length,
    dropped: incoming.scenarios.length - take.length,
  }
}
