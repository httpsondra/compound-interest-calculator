/*
 * Multi-tab safety rules (pure, unit-tested).
 *
 * Every tab remembers the exact stored text it last loaded or wrote (`known`). Before writing, a tab
 * compares the stored text with `known`: a difference means another tab has saved since, so the
 * write is a CONFLICT and nothing is overwritten. Both versions are kept: this tab's unsaved version
 * is backed up when the conflict is raised, and whichever version is not kept is backed up when the
 * user decides. Backups are capped (the oldest is dropped first) and stored in this browser only.
 */

export const BACKUP_LIMIT = 10
export const BACKUP_KEY = 'investcalc.v2.backups'

export interface Backup {
  savedAt: number
  raw: string
}

/** A conflict exists when storage holds text this tab has not seen (another tab saved). */
export function isConflict(known: string | null, stored: string | null): boolean {
  return stored !== null && stored !== known
}

/** Newest first, capped. Never reorders or merges the stored text. */
export function withBackup(list: Backup[], raw: string, now: number): Backup[] {
  return [{ savedAt: now, raw }, ...list].slice(0, BACKUP_LIMIT)
}

/** Tolerant parse: anything unreadable becomes an empty list instead of an error. */
export function parseBackups(text: string | null): Backup[] {
  if (!text) return []
  try {
    const v: unknown = JSON.parse(text)
    if (!Array.isArray(v)) return []
    return v
      .filter((x): x is Backup => !!x && typeof x === 'object' && typeof (x as Backup).raw === 'string' && typeof (x as Backup).savedAt === 'number')
      .slice(0, BACKUP_LIMIT)
  } catch {
    return []
  }
}
