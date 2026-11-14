import { useCallback, useEffect, useReducer, useRef } from 'react'
import { defaultScenario, type Currency, type Scenario } from '../model/scenario'
import { sanitizeScenario } from '../model/serialize'

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
  }
}

export function loadDoc(currency: Currency, name: string): Doc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Doc).scenarios)) {
        const scenarios = (parsed as Doc).scenarios
          .map((s) => sanitizeScenario(s, currency))
          .filter((s): s is Scenario => s !== null)
          .slice(0, MAX_SCENARIOS)
        if (scenarios.length) {
          const wanted = (parsed as Doc).activeId
          const activeId = scenarios.some((s) => s.id === wanted) ? wanted : scenarios[0].id
          return { scenarios, activeId }
        }
      }
    }
  } catch {
    /* corrupted or unavailable storage → start fresh */
  }
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

  // Persist (debounced) — local only, never sent anywhere. Flushed when the page is hidden or unloaded.
  const persist = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(docRef.current))
    } catch {
      /* quota / private mode */
    }
  }, [])
  useEffect(() => {
    const id = window.setTimeout(persist, 250)
    return () => window.clearTimeout(id)
  }, [state.doc, persist])
  useEffect(() => {
    const flush = () => persist()
    const onVis = () => document.visibilityState === 'hidden' && persist()
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [persist])

  const setDoc = useCallback((next: Doc | ((d: Doc) => Doc), key?: string) => {
    const doc = typeof next === 'function' ? next(docRef.current) : next
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

  const undo = useCallback(() => dispatch({ type: 'undo' }), [])

  const active = state.doc.scenarios.find((s) => s.id === state.doc.activeId) ?? state.doc.scenarios[0]
  return { doc: state.doc, active, setDoc, update, undo, canUndo: state.past.length > 0 }
}

export type Store = ReturnType<typeof useStore>
