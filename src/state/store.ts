import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { defaultScenario, type Currency, type Scenario } from '../model/scenario'
import { sanitizeScenario } from '../model/serialize'
import { MAX_SCENARIOS } from './plans'
import { LEGACY_KEY, MIRROR_KEY, openBackend, type Backend, type BackupKind, type BackupRec, type Rec } from './storage'

export { MAX_SCENARIOS }
const HISTORY_LIMIT = 60
const COALESCE_MS = 900
const SAVE_DELAY_MS = 250
/** A draft that is still there this long after its last write belongs to a tab that no longer saves (a live tab clears it within ~250 ms of its last edit). */
const ORPHAN_MS = 4000
const DRAFT_PREFIX = 'investcalc.v3.draft.'

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

/* ───────── synchronous boot (localStorage only; never written here) ───────── */

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * Text used to paint the first frame: the v3 mirror (written after every successful save) or, for a user who
 * has never opened a V5.2.3 build, the original v2 key. The v2 key is only ever READ, never changed or removed,
 * so an older deployment keeps seeing exactly what it saved.
 */
function bootRaw(): string | null {
  return lsGet(MIRROR_KEY) ?? lsGet(LEGACY_KEY)
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
  const doc = parseStoredRaw(bootRaw(), currency)
  if (doc) return doc
  const s = defaultScenario(currency, name)
  return { scenarios: [s], activeId: s.id }
}

/** Per-tab id kept in sessionStorage: a reload of the same tab finds its own unsaved draft again. */
function tabId(): string {
  try {
    let id = sessionStorage.getItem('investcalc.tab')
    if (!id) {
      id = Math.random().toString(36).slice(2, 10)
      sessionStorage.setItem('investcalc.tab', id)
    }
    return id
  } catch {
    return 'x'
  }
}

interface Draft {
  baseRev: number
  raw: string
  at: number
  /** Written while the tab was being closed or unloaded: another open tab finishes the save if it did not land. */
  final?: boolean
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

  const be = useRef<Backend | null>(null)
  /** The record this tab last read or wrote. Every write is based on its revision. */
  const base = useRef<Rec | null>(null)
  const ready = useRef(false)
  // Only a real edit of this tab (setDoc or undo) makes it dirty. Opening, adopting or reloading never writes.
  const dirty = useRef(false)
  // Set when this tab adopted another tab's plans and has not written since (undo could reach back past them).
  const adoptedFlag = useRef(false)
  const conflictRef = useRef<Conflict | null>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [conflictError, setConflictError] = useState<ConflictError>(null)
  const [storageError, setStorageError] = useState(false)
  const [backupError, setBackupError] = useState(false)
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const bootText = useRef<string | null>(bootRaw())
  const myTab = useRef(tabId())
  const draftKey = DRAFT_PREFIX + myTab.current

  const backup = useCallback(async (raw: string, kind: BackupKind): Promise<boolean> => {
    const ok = (await be.current?.addBackup(raw, kind)) ?? false
    if (!ok) setBackupError(true)
    return ok
  }, [])

  /* ── drafts: a synchronous copy of unsaved edits, so closing or suspending the tab cannot lose them ── */
  const finalDraft = useRef(false)
  const writeDraft = useCallback((final = false) => {
    if (final) finalDraft.current = true
    final = finalDraft.current // once the tab is closing, later (hidden/visibility) writes keep the flag
    try {
      const d: Draft = { baseRev: base.current?.rev ?? 0, raw: JSON.stringify(docRef.current), at: Date.now(), ...(final ? { final: true } : {}) }
      localStorage.setItem(draftKey, JSON.stringify(d))
    } catch {
      /* private mode or full: the IndexedDB save is the real one */
    }
  }, [draftKey])
  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(draftKey)
    } catch {
      /* nothing to do */
    }
  }, [draftKey])

  const mirror = useCallback((raw: string) => {
    try {
      localStorage.setItem(MIRROR_KEY, raw)
    } catch {
      /* the mirror only speeds up the next start; IndexedDB holds the plans */
    }
  }, [])

  const raiseConflict = useCallback(
    async (cur: Rec) => {
      const open = conflictRef.current
      const theirs = parseStoredRaw(cur.raw)
      if (open) {
        // Another save while the dialog is open: keep the older text as a backup and show the newer one.
        if (cur.raw === open.theirRaw) return
        if (!(await backup(open.theirRaw, 'conflict'))) return
        if (theirs) {
          const c: Conflict = { theirs, theirRaw: cur.raw, mine: open.mine }
          conflictRef.current = c
          setConflict(c)
        }
        return
      }
      // This tab's unsaved version is kept before anything else, so it survives a reload.
      // base is NOT advanced: this tab's unsaved edit (and its draft) still rest on the revision it last saw, so a
      // reload can never replay that edit on top of the other tab's newer version.
      if (!(await backup(JSON.stringify(docRef.current), 'conflict'))) setStorageError(true)
      if (!theirs) {
        // The other text cannot be read: keep it, then this tab's version replaces it.
        await backup(cur.raw, 'unreadable')
        const res = await be.current!.commit(JSON.stringify(docRef.current), cur.rev)
        if (res.ok) {
          base.current = res.rec
          dirty.current = false
          clearDraft()
          mirror(res.rec.raw)
          setStorageError(false)
        } else setStorageError(true)
        return
      }
      const c: Conflict = { theirs, theirRaw: cur.raw, mine: docRef.current }
      conflictRef.current = c
      setConflict(c)
      setConflictError(null)
    },
    [backup, clearDraft, mirror],
  )

  /** One save at a time. The write is based on the revision this tab last saw and is refused if that changed. */
  const persist = useCallback((): Promise<void> => {
    const run = async () => {
      const b = be.current
      if (!b || !ready.current || !dirty.current || conflictRef.current) return
      const raw = JSON.stringify(docRef.current)
      if (adoptedFlag.current && base.current && !(await backup(base.current.raw, 'auto'))) {
        setStorageError(true)
        return
      }
      const res = await b.commit(raw, base.current?.rev ?? 0)
      if (res.ok) {
        base.current = res.rec
        adoptedFlag.current = false
        mirror(raw)
        b.notify(res.rec.rev)
        setStorageError(false)
        // Edited again while saving: stay dirty (a save is already queued by that edit).
        if (JSON.stringify(docRef.current) === raw) {
          dirty.current = false
          clearDraft()
        }
      } else if ('cur' in res) {
        if (res.cur === null) {
          // The stored document disappeared (cleared by the user): this tab's plans are written again from scratch.
          base.current = null
          const again = await b.commit(raw, 0)
          if (again.ok) {
            base.current = again.rec
            dirty.current = JSON.stringify(docRef.current) !== raw
            mirror(raw)
            setStorageError(false)
          } else setStorageError(true)
        } else await raiseConflict(res.cur)
      } else {
        setStorageError(true)
      }
    }
    const p = chain.current.then(run, run)
    chain.current = p.catch(() => undefined)
    return p
  }, [backup, clearDraft, mirror, raiseConflict])

  /** Another tab may have saved: read the stored record (transactional, never stale) and adopt or raise a conflict. */
  const syncFromBackend = useCallback(async () => {
    const b = be.current
    if (!b || !ready.current) return
    const rec = await b.read()
    if (!rec) return
    const cur = base.current
    if (cur && rec.rev <= cur.rev) return
    if (conflictRef.current && rec.raw === conflictRef.current.theirRaw) return
    if (conflictRef.current || dirty.current) {
      await raiseConflict(rec)
      return
    }
    const theirs = parseStoredRaw(rec.raw)
    if (!theirs) return
    base.current = rec
    adoptedFlag.current = true
    mirror(rec.raw)
    dispatch({ type: 'adopt', doc: theirs })
  }, [mirror, raiseConflict])

  /**
   * Unsaved drafts left in localStorage.
   * • This tab's own draft (after a reload or a restored tab): replayed as an ordinary edit if nothing changed
   *   since its last read, else kept as a backup.
   * • Another tab's draft is touched only when it is final (that tab was closing: its save may not have landed) or
   *   older than ORPHAN_MS (that tab is gone or cannot save). It is then saved on its behalf if it still applies
   *   to the stored revision, else kept as a backup. A live tab's ordinary draft is never touched.
   */
  const scanDrafts = useCallback(
    async (backend: Backend) => {
      let keys: string[] = []
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (k && k.startsWith(DRAFT_PREFIX)) keys.push(k)
        }
      } catch {
        keys = []
      }
      for (const k of keys) {
        const d = ((): Draft | null => {
          try {
            return JSON.parse(localStorage.getItem(k) ?? 'null') as Draft | null
          } catch {
            return null
          }
        })()
        const drop = () => {
          try {
            localStorage.removeItem(k)
          } catch {
            /* nothing to do */
          }
        }
        if (!d || typeof d.raw !== 'string') {
          drop()
          continue
        }
        const own = k === draftKey
        if (!own && !(d.final || Date.now() - d.at > ORPHAN_MS)) continue
        const latest = await backend.read()
        if (d.raw === (latest?.raw ?? base.current?.raw ?? null)) {
          drop()
          continue
        }
        const doc = parseStoredRaw(d.raw)
        const usable = !!doc && !!latest && d.baseRev === latest.rev && !dirty.current && !conflictRef.current
        if (usable && own) {
          dirty.current = true
          docRef.current = doc!
          dispatch({ type: 'set', doc: doc!, at: performance.now() })
        } else if (usable) {
          const res = await backend.commit(d.raw, latest!.rev)
          if (res.ok) {
            base.current = res.rec
            adoptedFlag.current = false
            mirror(res.rec.raw)
            backend.notify(res.rec.rev)
            docRef.current = doc!
            dispatch({ type: 'adopt', doc: doc! })
          } else if (!(await backend.addBackup(d.raw, 'draft'))) continue
        } else if (!(await backend.addBackup(d.raw, 'draft'))) continue
        drop()
      }
    },
    [draftKey, mirror],
  )

  // A tab that is closing leaves a final draft; an open tab finishes that save if the closing tab could not.
  useEffect(() => {
    let t = 0
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !e.key.startsWith(DRAFT_PREFIX) || e.key === draftKey || !e.newValue) return
      window.clearTimeout(t)
      t = window.setTimeout(() => {
        if (be.current && ready.current) void scanDrafts(be.current)
      }, 700)
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.clearTimeout(t)
    }
  }, [draftKey, scanDrafts])

  /* ── start: open storage, migrate, reconcile, replay an own unsaved draft ── */
  useEffect(() => {
    let cancelled = false
    let off: (() => void) | undefined
    let timer = 0
    ;(async () => {
      const backend = await openBackend()
      if (cancelled) return
      be.current = backend
      let rec = await backend.read()
      if (cancelled) return
      const boot = bootText.current

      if (rec === null || rec === undefined) {
        // First run on this storage. The previous data (v3 mirror or the original v2 key) is read, never changed:
        // it is copied into a backup first, then the first revision is written and read back for verification.
        if (boot !== null && !(await backend.addBackup(boot, parseStoredRaw(boot) ? 'migration' : 'unreadable'))) {
          // The previous data could not be copied to a backup: nothing is migrated or written (the original stays
          // exactly as it is) and the user is told. This tab keeps working in memory.
          setStorageError(true)
          setBackupError(true)
          return
        }
        const raw = JSON.stringify(docRef.current)
        const res = await backend.commit(raw, 0)
        if (res.ok) {
          const back = await backend.read()
          if (back && back.raw === raw) {
            base.current = back
            mirror(raw)
          } else setStorageError(true)
        } else if ('cur' in res && res.cur) {
          rec = res.cur // another tab migrated at the same moment: continue from its record
        } else setStorageError(true)
      }

      if (rec) {
        const theirs = parseStoredRaw(rec.raw)
        if (!theirs) {
          // Stored text that cannot be read is kept, then replaced by this tab's plans (nothing else is lost).
          await backend.addBackup(rec.raw, 'unreadable')
          const res = await backend.commit(JSON.stringify(docRef.current), rec.rev)
          if (res.ok) {
            base.current = res.rec
            mirror(res.rec.raw)
          } else setStorageError(true)
        } else if (JSON.stringify(theirs) === JSON.stringify(docRef.current)) {
          base.current = rec
        } else if (!dirty.current) {
          base.current = rec
          mirror(rec.raw)
          dispatch({ type: 'adopt', doc: theirs })
        } else {
          ready.current = true
          await raiseConflict(rec)
        }
      }
      ready.current = true

      await scanDrafts(backend)

      off = backend.onChange(() => void syncFromBackend())
      // Safety net for a missed message: re-read every 2 s while visible, and whenever the tab returns.
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') {
          void syncFromBackend()
          // A missed storage event must not leave a closed tab's final draft unsaved.
          void scanDrafts(backend)
        }
      }, 2000)
      void persist()
    })()
    return () => {
      cancelled = true
      off?.()
      window.clearInterval(timer)
    }
    // Runs once: every value it uses is a stable ref or callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Every edit: a synchronous draft now, the transactional save shortly after.
  useEffect(() => {
    if (!dirty.current) return
    writeDraft()
    const id = window.setTimeout(() => void persist(), SAVE_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [state.doc, persist, writeDraft])

  // Leaving, hiding or suspending the tab: the draft is written synchronously (it survives) and a save is attempted.
  useEffect(() => {
    const flush = (e?: Event) => {
      if (dirty.current) {
        writeDraft(e?.type === 'pagehide' || e?.type === 'beforeunload')
        void persist()
      }
    }
    const refresh = () => void syncFromBackend()
    const onVis = () => (document.visibilityState === 'hidden' ? flush() : refresh())
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [persist, syncFromBackend, writeDraft])

  const setDoc = useCallback((next: Doc | ((d: Doc) => Doc), key?: string) => {
    const doc = typeof next === 'function' ? next(docRef.current) : next
    if (doc === docRef.current) return
    dirty.current = true // set synchronously, so a change from another tab cannot slip in between edit and save
    finalDraft.current = false // a new edit means the tab was not closing after all
    docRef.current = doc // and the save always sees the latest edit, even before React re-renders
    dispatch({ type: 'set', doc, key, at: performance.now() })
  }, [])

  /** Update the active scenario. `key` coalesces rapid edits of one field into a single undo step. */
  const update = useCallback(
    (fn: (s: Scenario) => Scenario, key?: string) => {
      setDoc((d) => ({ ...d, scenarios: d.scenarios.map((s) => (s.id === d.activeId ? fn(s) : s)) }), key)
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
   * Resolve a conflict. Resolves false (and changes nothing) if the choice cannot be carried out safely, for
   * example because a backup could not be kept.
   * 'other': show the other tab's saved plans here. 'mine': keep this tab's plans and overwrite.
   * In both cases every version that is not kept is backed up first.
   */
  const resolveConflict = useCallback(
    async (choice: 'other' | 'mine'): Promise<boolean> => {
      const c = conflictRef.current
      const b = be.current
      if (!c || !b) return false
      let error: ConflictError = null
      const mineRaw = JSON.stringify(docRef.current)
      const latest = await b.read()
      if (choice === 'other') {
        if (!(await backup(mineRaw, 'conflict'))) error = 'backup'
        else if (latest) {
          const doc = parseStoredRaw(latest.raw)
          if (!doc) error = 'unreadable'
          else if (latest.raw !== c.theirRaw && !(await backup(c.theirRaw, 'conflict'))) error = 'backup'
          else {
            base.current = latest
            adoptedFlag.current = true
            dirty.current = false
            clearDraft()
            mirror(latest.raw)
            dispatch({ type: 'adopt', doc })
          }
        } else {
          // Nothing is stored any more: this tab's plans are kept.
          const res = await b.commit(mineRaw, 0)
          if (res.ok) {
            base.current = res.rec
            dirty.current = false
            clearDraft()
            mirror(mineRaw)
          } else error = 'backup'
        }
      } else {
        // Back up what is stored now (it may be newer than the version shown), then write this tab's plans on top of it.
        if (latest && !(await backup(latest.raw, 'conflict'))) error = 'backup'
        else {
          const res = await b.commit(mineRaw, latest?.rev ?? 0)
          if (res.ok) {
            base.current = res.rec
            adoptedFlag.current = false
            dirty.current = false
            clearDraft()
            mirror(mineRaw)
            b.notify(res.rec.rev)
          } else if ('cur' in res && res.cur) {
            // Yet another save arrived while choosing: show it instead of overwriting it.
            await raiseConflict(res.cur)
            return false
          } else error = 'backup'
        }
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
    [backup, clearDraft, mirror, raiseConflict],
  )

  /* ── recovery, restore and import (used by the saved-plans menu) ── */

  const listBackups = useCallback(async (): Promise<BackupRec[]> => (await be.current?.listBackups()) ?? [], [])

  /**
   * Replace the plans with `doc` (restore or import). The current plans are backed up first, the change is an
   * ordinary undoable edit, and the result is read back from storage. Resolves false on any failure.
   */
  const applyDoc = useCallback(
    async (doc: Doc, kind: 'restore' | 'import'): Promise<boolean> => {
      const b = be.current
      if (!b || !ready.current || conflictRef.current) return false
      if (!(await backup(JSON.stringify(docRef.current), kind))) return false
      const raw = JSON.stringify(doc)
      setDoc(doc)
      docRef.current = doc // the save below runs before React re-renders
      await persist()
      const back = await b.read()
      const ok = !!back && back.raw === raw && !conflictRef.current
      if (!ok && !conflictRef.current) setStorageError(true)
      return ok
    },
    [backup, persist, setDoc],
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
    backupError,
    listBackups,
    applyDoc,
  }
}

export type Store = ReturnType<typeof useStore>
