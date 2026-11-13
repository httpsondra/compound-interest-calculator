import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { I18nProvider, createI18n, detectLang, type Lang } from './i18n'
import { computeScenario } from './model/compute'
import { defaultScenario, type Currency, type Scenario } from './model/scenario'
import { decodeShare, encodeShare } from './model/serialize'
import { MAX_SCENARIOS, loadDoc, useStore, type Doc } from './state/store'
import { AppCtx, type AppCtxValue } from './state/context'
import { Header, type Theme, type View } from './components/Header'
import { PlanView } from './components/plan/PlanView'
import { Toasts, type ToastMsg } from './components/ui/controls'

const CompareView = lazy(() => import('./components/compare/CompareView'))
const RiskView = lazy(() => import('./components/risk/RiskView'))

const viewFromHash = (): View => {
  const h = typeof location !== 'undefined' ? location.hash : ''
  return h.startsWith('#/compare') ? 'compare' : h.startsWith('#/risk') ? 'risk' : 'plan'
}

function readTheme(): Theme {
  try {
    const v = localStorage.getItem('investcalc.theme')
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* ignore */
  }
  return 'system'
}

/** A scenario decoded from `?s=`; applied after mount so the previous state stays in the undo history. */
let pendingShared: Scenario | null = null

function initialDoc(lang: Lang): Doc {
  const currency: Currency = lang === 'cs' ? 'CZK' : 'EUR'
  // Unnamed scenarios stay '' so the placeholder name follows the UI language.
  const doc = loadDoc(currency, '')
  const params = new URLSearchParams(location.search)
  const shared = params.get('s')
  if (shared) {
    const sc = decodeShare(shared)
    if (sc) pendingShared = sc
    params.delete('s')
    const qs = params.toString()
    history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`)
  }
  return doc
}

export default function App() {
  const [lang, setLang] = useState<Lang>(detectLang)
  const [theme, setTheme] = useState<Theme>(readTheme)
  const [view, setView] = useState<View>(viewFromHash)
  const [showReal, setShowReal] = useState(false)
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const toastId = useRef(0)
  const store = useStore(() => initialDoc(lang))
  const i18n = useMemo(() => createI18n(lang), [lang])
  const { t } = i18n

  const toast = useCallback((text: string, action?: ToastMsg['action']) => {
    const id = ++toastId.current
    setToasts((xs) => [...xs.slice(-2), { id, text, action }])
  }, [])
  const dismiss = useCallback((id: number) => setToasts((xs) => xs.filter((x) => x.id !== id)), [])

  useEffect(() => {
    const sc = pendingShared
    if (!sc) return
    pendingShared = null
    // Add the shared scenario as an undoable step. When the list is full the
    // oldest non-active scenario makes room — Undo brings it back.
    store.setDoc((d) => {
      const others = d.scenarios.filter((x) => x.id !== sc.id)
      while (others.length >= MAX_SCENARIOS) {
        const i = others.findIndex((x) => x.id !== d.activeId)
        others.splice(i >= 0 ? i : 0, 1)
      }
      return { scenarios: [...others, sc], activeId: sc.id }
    })
    toast(t.app.sharedLoaded, { label: t.app.undo, run: store.undo })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Language: <html lang>, title, persistence
  useEffect(() => {
    document.documentElement.lang = lang
    document.title = t.meta.title
    try {
      localStorage.setItem('investcalc.lang', lang)
    } catch {
      /* ignore */
    }
  }, [lang, t])

  // Theme
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('investcalc.theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  // Hash routing (deep links: #/compare, #/risk)
  useEffect(() => {
    const onHash = () => setView(viewFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const navigate = (v: View) => {
    const hash = v === 'plan' ? '' : `#/${v}`
    if (location.hash !== hash) history.pushState(null, '', `${location.pathname}${location.search}${hash}`)
    setView(v)
    window.scrollTo({ top: 0 })
  }

  // Undo shortcut (outside text inputs, where the browser's own undo applies)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        const el = e.target as HTMLElement
        if (el.closest('input, textarea, [contenteditable]')) return
        e.preventDefault()
        if (store.canUndo) {
          store.undo()
          toast(t.app.undone)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store, t, toast])

  const active = store.active
  const deferred = useDeferredValue(active)
  const computed = useMemo(() => computeScenario(deferred), [deferred])

  const share = async () => {
    const url = `${location.origin}${location.pathname}?s=${encodeShare(active)}${lang === 'cs' ? '&lang=cs' : '&lang=en'}`
    try {
      await navigator.clipboard.writeText(url)
      toast(t.app.shareCopied)
    } catch {
      history.replaceState(null, '', url)
      toast(t.app.shareFailed)
    }
  }

  const reset = () => {
    store.update((s) => ({ ...defaultScenario(s.currency, s.name), id: s.id }))
    toast(t.app.resetDone, { label: t.app.undo, run: store.undo })
  }

  const ctx: AppCtxValue = {
    store,
    scenario: active,
    update: store.update,
    computed,
    stale: deferred !== active,
    showReal,
    setShowReal,
    toast,
  }

  return (
    <I18nProvider lang={lang}>
      <AppCtx.Provider value={ctx}>
        <a className="skip-link" href="#main">
          {t.app.skip}
        </a>
        <div className="aurora-bg" aria-hidden="true" />
        <Header
          view={view}
          onView={navigate}
          lang={lang}
          onLang={setLang}
          theme={theme}
          onTheme={setTheme}
          onShare={share}
        />
        <main id="main" className="page" tabIndex={-1}>
          {view === 'plan' && <PlanView onReset={reset} />}
          {view !== 'plan' && (
            <Suspense fallback={<div className="view-loading" aria-busy="true" />}>
              {view === 'compare' ? <CompareView onOpen={() => navigate('plan')} /> : <RiskView />}
            </Suspense>
          )}
        </main>
        <footer className="footer">
          <p>{t.app.disclaimer}</p>
          <p className="footer-meta">InvestCalc · investcalc.dev</p>
        </footer>
        <Toasts items={toasts} dismiss={dismiss} />
      </AppCtx.Provider>
    </I18nProvider>
  )
}

export type { Scenario }
