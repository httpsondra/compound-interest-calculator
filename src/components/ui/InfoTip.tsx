import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../../i18n'
import { Icon } from './Icon'

/** Small accessible explanation popover. Opens on click/tap or keyboard; closes on Escape or outside click. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const { t, fill } = useI18n()
  const [open, setOpen] = useState(false)
  const id = useId()
  const wrap = useRef<HTMLSpanElement>(null)
  const [alignEnd, setAlignEnd] = useState(false)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    const r = wrap.current?.getBoundingClientRect()
    if (r) setAlignEnd(r.left > window.innerWidth / 2)
    return () => {
      document.removeEventListener('pointerdown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span className="infotip" ref={wrap}>
      <button
        type="button"
        className="infotip-btn"
        aria-label={fill(t.common.info, { label })}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <Icon name="info" size={15} />
      </button>
      <span id={id} role="note" className={`infotip-pop${alignEnd ? ' infotip-pop--end' : ''}`} hidden={!open}>
        {children}
      </span>
    </span>
  )
}
