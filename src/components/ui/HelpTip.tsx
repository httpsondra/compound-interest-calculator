import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../i18n'
import { getHelp, type HelpCtx, type HelpId } from '../../help'
import { useApp } from '../../state/context'
import { Icon } from './Icon'

/*
 * Contextual help popover.
 *
 * • Mouse: opens on hover (short delay) and stays open while the pointer is
 *   over the icon or the popover; a click pins it open.
 * • Touch / pen: a tap toggles it; tap outside or the close button dismisses.
 * • Keyboard: Enter/Space opens and moves focus into the popover; Escape
 *   closes and returns focus to the icon; Tab closes and returns focus.
 * • Rendered in a portal with fixed positioning and clamped to the viewport,
 *   so it is never clipped by the sticky sidebar or other scroll containers.
 * • Only one help popover is open at a time.
 */

let closeActive: (() => void) | null = null
const MARGIN = 12
const GAP = 8

type Mode = 'hover' | 'pinned' | null

export function HelpTip({ topic, label, extra, className }: { topic: HelpId; label?: string; extra?: HelpCtx['extra']; className?: string }) {
  const { lang, t, f, fill } = useI18n()
  const { scenario, computed } = useApp()
  const [mode, setMode] = useState<Mode>(null)
  const [expanded, setExpanded] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; side: 'top' | 'bottom' } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const openTimer = useRef<number | undefined>(undefined)
  const closeTimer = useRef<number | undefined>(undefined)
  const focusOnOpen = useRef(false)
  const modeRef = useRef<Mode>(null)
  modeRef.current = mode
  const id = useId()
  const popId = `help${id.replace(/[^a-zA-Z0-9]/g, '')}`

  const ctx: HelpCtx = {
    s: scenario,
    computed,
    f,
    money: (v: number) => f.money(v, scenario.currency),
    pct: (v: number, d = 2) => f.pct(v, d),
    extra,
  }
  // Title only depends on language and topic — computed once, used for the accessible name.
  const title = useMemo(() => label ?? getHelp(lang, topic, ctx).title, [lang, topic, label]) // eslint-disable-line react-hooks/exhaustive-deps
  const body = mode ? getHelp(lang, topic, ctx) : null

  const close = useCallback((restoreFocus = false) => {
    window.clearTimeout(openTimer.current)
    window.clearTimeout(closeTimer.current)
    setMode(null)
    setExpanded(false)
    setPos(null)
    if (closeActive === closeSelf.current) closeActive = null
    if (restoreFocus) btnRef.current?.focus()
  }, [])
  const closeSelf = useRef<() => void>(() => close())
  closeSelf.current = () => close()

  const open = (m: Exclude<Mode, null>) => {
    if (closeActive && closeActive !== closeSelf.current) closeActive()
    closeActive = closeSelf.current
    setMode(m)
  }

  // Position: below the icon when it fits, otherwise above; clamped horizontally.
  const place = useCallback(() => {
    const btn = btnRef.current
    const pop = popRef.current
    if (!btn || !pop) return
    const r = btn.getBoundingClientRect()
    const w = pop.offsetWidth
    const h = pop.offsetHeight
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight
    let left = r.left + r.width / 2 - w / 2
    left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN))
    let top = r.bottom + GAP
    let side: 'top' | 'bottom' = 'bottom'
    if (top + h > vh - MARGIN && r.top - GAP - h >= MARGIN) {
      top = r.top - GAP - h
      side = 'top'
    } else if (top + h > vh - MARGIN) {
      top = Math.max(MARGIN, vh - MARGIN - h)
    }
    setPos({ left: Math.round(left), top: Math.round(top), side })
  }, [])

  useLayoutEffect(() => {
    if (!mode) return
    place()
  }, [mode, expanded, place, lang])

  useEffect(() => {
    if (!mode) return
    const onScroll = () => place()
    const onDown = (e: PointerEvent) => {
      const tgt = e.target as Node
      if (btnRef.current?.contains(tgt) || popRef.current?.contains(tgt)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        const inside = popRef.current?.contains(document.activeElement) || document.activeElement === btnRef.current
        close(inside)
      }
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    if (focusOnOpen.current) {
      focusOnOpen.current = false
      requestAnimationFrame(() => popRef.current?.focus())
    }
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [mode, close, place])

  useEffect(() => () => close(), [close])

  const scheduleClose = () => {
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      if (modeRef.current === 'hover') close()
    }, 180)
  }

  const onClick = (e: ReactMouseEvent) => {
    window.clearTimeout(openTimer.current)
    if (mode === 'pinned') {
      close()
      return
    }
    // detail === 0 → activated from the keyboard: move focus into the popover.
    focusOnOpen.current = e.detail === 0
    open('pinned')
  }

  return (
    <span className={`help${className ? ` ${className}` : ''}`}>
      <button
        ref={btnRef}
        type="button"
        className={`help-btn${mode ? ' is-open' : ''}`}
        aria-label={fill(t.help.about, { label: title })}
        aria-expanded={mode != null}
        aria-controls={mode ? popId : undefined}
        aria-haspopup="dialog"
        onClick={onClick}
        onPointerEnter={(e) => {
          if (e.pointerType !== 'mouse' || mode === 'pinned') return
          window.clearTimeout(closeTimer.current)
          openTimer.current = window.setTimeout(() => open('hover'), 140)
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== 'mouse') return
          window.clearTimeout(openTimer.current)
          if (mode === 'hover') scheduleClose()
        }}
      >
        <Icon name="info" size={14} />
      </button>
      {mode &&
        body &&
        createPortal(
          <div
            ref={popRef}
            id={popId}
            role="dialog"
            aria-labelledby={`${popId}-t`}
            tabIndex={-1}
            className={`help-pop${pos ? ` is-${pos.side}` : ''}`}
            style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
            onPointerEnter={(e) => e.pointerType === 'mouse' && window.clearTimeout(closeTimer.current)}
            onPointerLeave={(e) => e.pointerType === 'mouse' && mode === 'hover' && scheduleClose()}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                const focusables = popRef.current?.querySelectorAll<HTMLElement>('button')
                const last = focusables?.[focusables.length - 1]
                if (!e.shiftKey && (document.activeElement === last || !last)) {
                  e.preventDefault()
                  close(true)
                } else if (e.shiftKey && document.activeElement === popRef.current) {
                  e.preventDefault()
                  close(true)
                }
              }
            }}
          >
            <div className="help-head">
              <p id={`${popId}-t`} className="help-title">
                {body.title}
              </p>
              <button type="button" className="help-close" aria-label={t.common.close} onClick={() => close(true)}>
                <Icon name="close" size={14} />
              </button>
            </div>
            <p className="help-what">{body.what}</p>
            {body.how && <p className="help-how">{body.how}</p>}
            {body.example && (
              <p className="help-example">
                <span className="help-k">{t.help.example}</span>
                {body.example}
              </p>
            )}
            {body.limit && (
              <p className="help-limit">
                <Icon name="warning" size={13} />
                <span>{body.limit}</span>
              </p>
            )}
            {body.more && (
              <>
                {expanded && <p className="help-more">{body.more}</p>}
                <button type="button" className="help-more-btn" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
                  {expanded ? t.help.less : t.help.learnMore}
                  <Icon name="chevron" size={13} className={expanded ? 'rot-180' : undefined} />
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </span>
  )
}
