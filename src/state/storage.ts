/*
 * Persistence backends (V5.2.3).
 *
 * The saved plans are ONE document with a revision number. A write says which revision it is based on and is
 * accepted only if that is still the stored revision — checked and written inside one IndexedDB read-write
 * transaction, which the browser serialises across tabs. That is a real compare-and-swap, unlike a
 * localStorage read followed by a write (two separate steps another tab can slip between, and whose reads
 * WebKit may serve stale).
 *
 * Backends
 *  • IndexedDB (primary): document store + add-only backup store (one record per backup, so two tabs can never
 *    overwrite each other's backups).
 *  • localStorage (fallback when IndexedDB is unavailable, e.g. some private modes): the same interface, with the
 *    check-and-write under a Web Lock when available. This path is best effort and says so.
 *
 * Nothing here knows about React. All functions resolve; none throws.
 */

export interface Rec {
  rev: number
  raw: string
}

export type BackupKind = 'conflict' | 'restore' | 'import' | 'migration' | 'unreadable' | 'auto' | 'draft'

export interface BackupRec {
  id: number
  at: number
  raw: string
  kind: BackupKind
}

export type CommitResult = { ok: true; rec: Rec } | { ok: false; cur: Rec | null } | { ok: false; error: true }

export interface Backend {
  kind: 'idb' | 'ls'
  read(): Promise<Rec | null | undefined>
  /** Accepted only if the stored revision equals `baseRev` (0 = nothing stored yet). */
  commit(raw: string, baseRev: number): Promise<CommitResult>
  addBackup(raw: string, kind: BackupKind): Promise<boolean>
  listBackups(): Promise<BackupRec[]>
  /** Tell other tabs that a new revision exists (they re-read; the message itself is never trusted as data). */
  notify(rev: number): void
  onChange(cb: () => void): () => void
}

export const DB_NAME = 'investcalc'
export const MIRROR_KEY = 'investcalc.v3.mirror'
export const LEGACY_KEY = 'investcalc.v2.scenarios'
export const LEGACY_BACKUP_KEY = 'investcalc.v2.backups'
export const LS_REV_KEY = 'investcalc.v3.rev'
export const LS_BACKUP_KEY = 'investcalc.v3.backups'
const CHANNEL = 'investcalc-plans'

/* ───────── retention (pure) ───────── */

/** Backups a user may need to find again (conflicts, restores, imports, migration) are kept longer. */
export const PROTECTED_KINDS: BackupKind[] = ['conflict', 'restore', 'import', 'migration', 'unreadable']
export const PROTECTED_LIMIT = 20
export const AUTO_LIMIT = 10

/**
 * Which backups to delete. Routine automatic copies ('auto', 'draft') are limited separately from the protected
 * kinds, so a burst of automatic copies can never evict the only copy of a conflicting version.
 * Newest first by `at` (then id). Pure.
 */
export function backupsToPrune(list: BackupRec[]): number[] {
  const sorted = [...list].sort((a, b) => b.at - a.at || b.id - a.id)
  const out: number[] = []
  let prot = 0
  let auto = 0
  for (const b of sorted) {
    if (PROTECTED_KINDS.includes(b.kind)) {
      if (++prot > PROTECTED_LIMIT) out.push(b.id)
    } else if (++auto > AUTO_LIMIT) out.push(b.id)
  }
  return out
}

/** The backup is not stored again when the newest one of the same kind is identical. */
export function isDuplicateBackup(list: BackupRec[], raw: string, kind: BackupKind): boolean {
  const same = list.filter((b) => b.kind === kind)
  if (!same.length) return false
  const newest = same.reduce((a, b) => (b.at > a.at || (b.at === a.at && b.id > a.id) ? b : a))
  return newest.raw === raw
}

/* ───────── IndexedDB backend ───────── */

const STORE_DOC = 'doc'
const STORE_BK = 'backups'
const DOC_KEY = 'plans'

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) return resolve(null)
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_DOC)) db.createObjectStore(STORE_DOC)
        if (!db.objectStoreNames.contains(STORE_BK)) db.createObjectStore(STORE_BK, { keyPath: 'id', autoIncrement: true })
      }
      req.onsuccess = () => {
        const db = req.result
        // A newer schema in another tab asks this one to let go; reloading is the safe response.
        db.onversionchange = () => db.close()
        resolve(db)
      }
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function channel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null
  } catch {
    return null
  }
}

function makeNotifier() {
  const bc = channel()
  return {
    notify(rev: number) {
      try {
        bc?.postMessage({ rev })
      } catch {
        /* the 2 s check and the mirror's storage event still tell other tabs */
      }
    },
    onChange(cb: () => void) {
      const onMsg = () => cb()
      const onStorage = (e: StorageEvent) => {
        if (e.key === MIRROR_KEY || e.key === LS_REV_KEY || e.key === null) cb()
      }
      bc?.addEventListener('message', onMsg)
      window.addEventListener('storage', onStorage)
      return () => {
        bc?.removeEventListener('message', onMsg)
        window.removeEventListener('storage', onStorage)
      }
    },
  }
}

function idbBackend(db: IDBDatabase): Backend {
  const n = makeNotifier()
  const txDone = <T,>(tx: IDBTransaction, get: () => T, fail: T): Promise<T> =>
    new Promise((resolve) => {
      tx.oncomplete = () => resolve(get())
      tx.onabort = () => resolve(fail)
      tx.onerror = () => resolve(fail)
    })
  return {
    kind: 'idb',
    async read() {
      try {
        const tx = db.transaction(STORE_DOC, 'readonly')
        const req = tx.objectStore(STORE_DOC).get(DOC_KEY)
        return await new Promise<Rec | null | undefined>((resolve) => {
          req.onsuccess = () => {
            const v = req.result as { rev?: number; raw?: string } | undefined
            resolve(v && typeof v.raw === 'string' && typeof v.rev === 'number' ? { rev: v.rev, raw: v.raw } : null)
          }
          req.onerror = () => resolve(undefined)
          tx.onabort = () => resolve(undefined)
        })
      } catch {
        return undefined
      }
    },
    commit(raw, baseRev) {
      try {
        // 'strict' asks for the write to reach disk before the transaction completes (ignored where unsupported).
        const tx = db.transaction(STORE_DOC, 'readwrite', { durability: 'strict' } as IDBTransactionOptions)
        const st = tx.objectStore(STORE_DOC)
        let result: CommitResult = { ok: false, error: true }
        const g = st.get(DOC_KEY)
        g.onsuccess = () => {
          const cur = g.result as { rev?: number; raw?: string } | undefined
          const curRev = typeof cur?.rev === 'number' ? cur.rev : 0
          if (curRev !== baseRev) {
            // Nothing is written: the transaction simply completes. The caller must resolve the conflict.
            result = { ok: false, cur: cur && typeof cur.raw === 'string' ? { rev: curRev, raw: cur.raw } : null }
            return
          }
          st.put({ rev: curRev + 1, raw, at: Date.now() }, DOC_KEY)
          result = { ok: true, rec: { rev: curRev + 1, raw } }
        }
        return txDone(tx, () => result, { ok: false, error: true } as CommitResult)
      } catch {
        return Promise.resolve({ ok: false, error: true } as CommitResult)
      }
    },
    addBackup(raw, kind) {
      try {
        const tx = db.transaction(STORE_BK, 'readwrite')
        const st = tx.objectStore(STORE_BK)
        const all = st.getAll()
        all.onsuccess = () => {
          const list = all.result as BackupRec[]
          if (isDuplicateBackup(list, raw, kind)) return
          const add = st.add({ at: Date.now(), raw, kind })
          add.onsuccess = () => {
            // Prune inside the same transaction, counting the record just added.
            const id = add.result as number
            const next = [...list, { id, at: Date.now(), raw, kind }]
            for (const old of backupsToPrune(next)) st.delete(old)
          }
        }
        return txDone(tx, () => true, false)
      } catch {
        return Promise.resolve(false)
      }
    },
    async listBackups() {
      try {
        const tx = db.transaction(STORE_BK, 'readonly')
        const req = tx.objectStore(STORE_BK).getAll()
        return await new Promise<BackupRec[]>((resolve) => {
          req.onsuccess = () =>
            resolve(
              (req.result as BackupRec[])
                .filter((b) => b && typeof b.raw === 'string')
                .sort((a, b) => b.at - a.at || b.id - a.id),
            )
          req.onerror = () => resolve([])
        })
      } catch {
        return []
      }
    },
    notify: n.notify,
    onChange: n.onChange,
  }
}

/* ───────── localStorage fallback ───────── */

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
function lsSet(k: string, v: string): boolean {
  try {
    localStorage.setItem(k, v)
    return true
  } catch {
    return false
  }
}

function lsBackend(): Backend {
  const n = makeNotifier()
  const readList = (): BackupRec[] => {
    try {
      const v: unknown = JSON.parse(lsGet(LS_BACKUP_KEY) ?? '[]')
      return Array.isArray(v) ? (v as BackupRec[]).filter((b) => b && typeof b.raw === 'string' && typeof b.at === 'number') : []
    } catch {
      return []
    }
  }
  const withLock = <T,>(name: string, fn: () => T): Promise<T> => {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (!locks || typeof locks.request !== 'function') return Promise.resolve(fn())
    return Promise.resolve(locks.request(name, () => fn())).catch(() => fn())
  }
  const read = (): Rec | null => {
    const raw = lsGet(MIRROR_KEY)
    if (raw === null) return null
    const rev = parseInt(lsGet(LS_REV_KEY) ?? '', 10)
    return { rev: Number.isFinite(rev) && rev > 0 ? rev : 1, raw }
  }
  return {
    kind: 'ls',
    read: async () => read(),
    commit: (raw, baseRev) =>
      withLock('investcalc-save', (): CommitResult => {
        const cur = read()
        const curRev = cur?.rev ?? 0
        if (curRev !== baseRev) return { ok: false, cur }
        if (!lsSet(MIRROR_KEY, raw) || !lsSet(LS_REV_KEY, String(curRev + 1))) return { ok: false, error: true }
        return { ok: true, rec: { rev: curRev + 1, raw } }
      }),
    addBackup: (raw, kind) =>
      withLock('investcalc-backup', () => {
        const list = readList()
        if (isDuplicateBackup(list, raw, kind)) return true
        const rec: BackupRec = { id: Date.now() * 1000 + Math.floor(Math.random() * 1000), at: Date.now(), raw, kind }
        const next = [...list, rec]
        const drop = new Set(backupsToPrune(next))
        return lsSet(LS_BACKUP_KEY, JSON.stringify(next.filter((b) => !drop.has(b.id))))
      }),
    listBackups: async () => readList().sort((a, b) => b.at - a.at || b.id - a.id),
    notify: n.notify,
    onChange: n.onChange,
  }
}

/** IndexedDB when it works, else localStorage. Resolves; never throws. */
export async function openBackend(): Promise<Backend> {
  const db = await openDb()
  if (db) {
    // A real probe: some private modes open the database but fail on first use.
    const be = idbBackend(db)
    if ((await be.read()) !== undefined) return be
  }
  return lsBackend()
}
