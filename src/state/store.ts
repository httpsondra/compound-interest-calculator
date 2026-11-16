import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { defaultScenario, type Currency, type Scenario } from '../model/scenario'
import { sanitizeScenario } from '../model/serialize'
import { BACKUP_KEY, isConflict, parseBackups, withBackup, type Backup } from './sync'

export const MAX_SCENARIOS = 4
const STORAGE_KEY = 'investcalc.v2.scenarios'
const HISTORY_LIMIT = 60
const COALESCE_MS = 900

export interface Doc {
  scenarios: Scenario[]
  activeId: string
}

interface State {
  doc: Doc
  past: Doc[]
  lastKey: string | null
  lastAt: number
}

type Action =
  | { type: 'set'; doc: Doc; key?: string; at: number }
  | { type: 'undo' }
  /** Another tab's saved plans adopted: this tab's undo history is kept, and no undo step is created. */
  | { type: 'adopt'; doc: Doc }

/** A version another tab saved while this tab had unsaved changes. */
/** Why a choice was refused: this tab's version could not be backed up, or the other tab's saved plans cannot be read. */
export type ConflictError = 'backup' | 'unreadable' | null

export interface Conflict {
  /** The other tab's saved plans, as read when the conflict was raised. */
  theirs: Doc
  theirRaw: string
  /** This tab's unsaved plans (what the dialog shows as "this tab"). */
  mine: Doc
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'set': {
      if (action.doc === state.doc) return state
      const coalesce = action.key != null && action.key === state.lastKey && action.at - state.lastAt < COALESCE_MS
      const past = coalesce ? state.past : [...state.past, state.doc].slice(-HISTORY_LIMIT)
      return { doc: action.doc, past, lastKey: action.key ?? null, lastAt: action.at }
    }
    case 'undo': {
      if (!state.past.length) return state
      const prev = state.past[state.past.length - 1]
      return { doc: prev, past: state.past.slice(0, -1), lastKey: null, lastAt: 0 }
    }
    case 'adopt':
      return { ...state, doc: action.doc, lastKey: null, lastAt: 0 }
  }
}

/* ───────── storage access (every call tolerates unavailable or full storage) ───────── */

export function readRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeRaw(raw: string): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, raw)
    return true
  } catch {
    return false
  }
}

function readBackups(): Backup[] {
  try {
    return parseBackups(localStorage.getItem(BACKUP_KEY))
  } catch {
    return []
  }
}

/**
 * Keep a copy of a version that would otherwise be overwritten. Returns false if it could not be
 * kept, and the caller must then not overwrite it. Identical consecutive copies are not repeated.
 */
export function keepBackup(raw: string): boolean {
  try {
    const list = readBackups()
    if (list[0]?.raw === raw) return true
    localStorage.setItem(BACKUP_KEY, JSON.stringify(withBackup(list, raw, Date.now())))
    return true
  } catch {
    return false
  }
}

export function parseStoredRaw(raw: string | null, currency: Currency = 'CZK'): Doc | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Doc).scenarios)) {
      const scenarios = (parsed as Doc).scenarios
        .map((x) => sanitizeScenario(x, currency))
        .filter((x): x is Scenario => x !== null)
        .slice(0, MAX_SCENARIOS)
      if (scenarios.length) {
        const wanted = (parsed as Doc).activeId
        const activeId = scenarios.some((x) => x.id === wanted) ? wanted : scenarios[0].id
        return { scenarios, activeId }
      }
    }
  } catch {
    /* unreadable */
  }
  return null
}

export function loadDoc(currency: Currency, name: string): Doc {
  const raw = readRaw()
  const doc = parseStoredRaw(raw, currency)
  if (doc) return doc
  // Stored text that cannot be read is kept as a backup before this tab does anything else with it.
  if (raw) keepBackup(raw)
  const s = defaultScenario(currency, name)
  return { scenarios: [s], activeId: s.id }
}

export function useStore(initial: () => Doc) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    doc: initial(),
    past: [],
    lastKey: null,
    lastAt: 0,
  }))
  const docRef = useRef(state.doc)
  docRef.current = state.doc
  const hasPast = useRef(state.past.length > 0)
  hasPast.current = state.past.length > 0

  // The stored text this tab last loaded or wrote. Stored text that differs from it was saved by another tab.
  const known = useRef<string | null>(readRaw())
  // Only a real edit of this tab (set by setDoc or undo) makes it dirty. Opening, adopting or
  // reloading never writes, so a tab that has not been edited cannot overwrite anything.
  const dirty = useRef(false)
  // Set when this tab adopted another tab's saved plans and has not written since.
  const adoptedFlag = useRef(false)
  // When this tab last wrote (performance.now), for the simultaneous-save safety net.
  const lastWriteAt = useRef(-Infinity)
  const conflictRef = useRef<Conflict | null>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [conflictError, setConflictError] = useState<ConflictError>(null)
  const [storageError, setStorageError] = useState(false)

  /**
   * The only write path. Before this tab's version replaces the stored text, the stored text is backed
   * up if it is not the text this tab knows (another tab's data). If the backup cannot be kept, nothing
   * is written.
   */
  const save = useCallback((): boolean => {
    const cur = readRaw()
    // Stored text is backed up before it is replaced when it is not this tab's own last write, when this
    // tab has just adopted it (an undo could otherwise drop it), or when it cannot be read.
    if (cur !== null && (cur !== known.current || adoptedFlag.current || parseStoredRaw(cur) === null)) {
      if (!keepBackup(cur)) return false
    }
    const raw = JSON.stringify(docRef.current)
    if (!writeRaw(raw)) return false
    known.current = raw
    lastWriteAt.current = performance.now()
    adoptedFlag.current = false
    dirty.current = false
    return true
  }, [])

  const raiseConflict = useCallback(
    (theirRaw: string) => {
      const open = conflictRef.current
      if (open) {
        // Another save while the dialog is open: keep the older text as a backup and show the newer one.
        if (theirRaw === open.theirRaw) return
        if (!keepBackup(open.theirRaw)) return
        const newer = parseStoredRaw(theirRaw)
        if (newer) {
          const c: Conflict = { theirs: newer, theirRaw, mine: open.mine }
          conflictRef.current = c
          setConflict(c)
        }
        return
      }
      const mine = docRef.current
      // This tab's unsaved version is kept before anything else, so it survives a reload.
      if (!keepBackup(JSON.stringify(mine))) setStorageError(true)
      const theirs = parseStoredRaw(theirRaw)
      if (!theirs) {
        // The other tab's text cannot be read: keep it, then this tab's version replaces it.
        if (save()) setStorageError(false)
        else setStorageError(true)
        return
      }
      const c: Conflict = { theirs, theirRaw, mine }
      conflictRef.current = c
      setConflict(c)
      setConflictError(null)
    },
    [save],
  )

  // Persist (debounced). Local only, never sent anywhere. Flushed when the page is hidden or unloaded.
  const persist = useCallback(() => {
    if (!dirty.current || conflictRef.current) return
    const stored = readRaw()
    if (isConflict(known.current, stored)) {
      raiseConflict(stored!)
      return
    }
    if (save()) setStorageError(false)
    else setStorageError(true)
  }, [raiseConflict, save])

  // Timer-driven saves run under a cross-tab lock. Reading the stored text, comparing it and writing are
  // three steps; without the lock two tabs whose timers fire together can both read the old text and both
  // write, so the later write silently replaces the earlier one (seen in stress tests, V5.2.1). Inside the lock
  // `persist` reads fresh, so the second tab sees the first tab's save and raises the conflict instead.
  // Where Web Locks are unavailable the plain path is used and the adoption backup below is the safety net.
  const persistLocked = useCallback(() => {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (!locks || typeof locks.request !== 'function') {
      persist()
      return
    }
    locks.request('investcalc-save', () => persist()).catch(() => persist())
  }, [persist])

  useEffect(() => {
    if (!dirty.current) return
    const id = window.setTimeout(persistLocked, 250)
    return () => window.clearTimeout(id)
  }, [state.doc, persistLocked])

  useEffect(() => {
    const flush = () => persist()
    const onVis = () => document.visibilityState === 'hidden' && persist()
    // Another tab saved. Adopted silently when this tab has nothing unsaved; otherwise it is a conflict.
    // Triggered by the storage event, and also by a short check while the page is visible or focused, so a
    // missed event cannot leave a tab showing stale plans for long.
    const syncFromStorage = (raw: string | null) => {
      if (raw === null || raw === known.current) return
      if (dirty.current) {
        raiseConflict(raw)
        return
      }
      const theirs = parseStoredRaw(raw)
      if (!theirs) return
      // A save of this tab that another tab replaced within moments is kept: the two writes were effectively
      // simultaneous, so neither tab had the chance to show a conflict.
      if (known.current !== null && performance.now() - lastWriteAt.current < 3000 && !keepBackup(known.current)) return
      known.current = raw
      adoptedFlag.current = true
      dispatch({ type: 'adopt', doc: theirs })
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) syncFromStorage(e.newValue)
    }
    const onCheck = () => {
      if (document.visibilityState === 'visible') syncFromStorage(readRaw())
    }
    const timer = window.setInterval(onCheck, 2000)
    window.addEventListener('focus', onCheck)
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVis)
    document.addEventListener('visibilitychange', onCheck)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onCheck)
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVis)
      document.removeEventListener('visibilitychange', onCheck)
    }
  }, [persist, raiseConflict])

  const setDoc = useCallback((next: Doc | ((d: Doc) => Doc), key?: string) => {
    const doc = typeof next === 'function' ? next(docRef.current) : next
    if (doc === docRef.current) return
    dirty.current = true // set synchronously, so a storage event cannot slip in between edit and persist
    dispatch({ type: 'set', doc, key, at: performance.now() })
  }, [])

  /** Update the active scenario. `key` coalesces rapid edits of one field into a single undo step. */
  const update = useCallback(
    (fn: (s: Scenario) => Scenario, key?: string) => {
      setDoc(
        (d) => ({ ...d, scenarios: d.scenarios.map((s) => (s.id === d.activeId ? fn(s) : s)) }),
        key,
      )
    },
    [setDoc],
  )

  /** Undo is unavailable while a conflict is open: the dialog must show exactly what gets saved. */
  const undo = useCallback(() => {
    if (conflictRef.current || !hasPast.current) return
    dirty.current = true
    dispatch({ type: 'undo' })
  }, [])

  /**
   * Resolve a conflict. Returns false (and changes nothing) if the choice cannot be carried out
   * safely, for example because a backup could not be kept.
   * 'other': show the other tab's saved plans here. 'mine': keep this tab's plans and overwrite.
   * In both cases every version that is not kept is backed up first.
   */
  const resolveConflict = useCallback(
    (choice: 'other' | 'mine'): boolean => {
      const c = conflictRef.current
      if (!c) return false
      let error: ConflictError = null
      if (choice === 'other') {
        // This tab's version is kept before anything else; if that is impossible, nothing changes.
        if (!keepBackup(JSON.stringify(c.mine))) error = 'backup'
        else {
          const cur = readRaw()
          if (cur === null) {
            if (!save()) error = 'backup' // nothing is saved any more: this tab's plans are kept
          } else {
            const curDoc = parseStoredRaw(cur)
            if (!curDoc) error = 'unreadable'
            else if (cur !== c.theirRaw && !keepBackup(c.theirRaw)) error = 'backup'
            else {
              known.current = cur
              adoptedFlag.current = true
              dirty.current = false
              dispatch({ type: 'adopt', doc: curDoc })
            }
          }
        }
      } else {
        // Back up what is stored now (may be newer than the version shown) and the version shown.
        const cur = readRaw()
        if (cur !== null && cur !== c.theirRaw && !keepBackup(c.theirRaw)) error = 'backup'
        else if (!save()) error = 'backup'
      }
      if (error) {
        setConflictError(error)
        return false
      }
      conflictRef.current = null
      setConflict(null)
      setConflictError(null)
      setStorageError(false)
      return true
    },
    [save],
  )

  const active = state.doc.scenarios.find((s) => s.id === state.doc.activeId) ?? state.doc.scenarios[0]
  return {
    doc: state.doc,
    active,
    setDoc,
    update,
    undo,
    canUndo: state.past.length > 0,
    conflict,
    conflictError,
    resolveConflict,
    storageError,
  }
}

export type Store = ReturnType<typeof useStore>
