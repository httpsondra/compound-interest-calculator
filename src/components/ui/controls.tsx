import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useI18n } from '../../i18n'
import { Icon } from './Icon'
import { InfoTip } from './InfoTip'

/* ───────── Segmented control (radio group) ───────── */

interface SegOption<T extends string> {
  value: T
  label: ReactNode
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hideLabel,
  size = 'md',
  help,
  className,
}: {
  label: string
  value: T
  options: SegOption<T>[]
  onChange: (v: T) => void
  hideLabel?: boolean
  size?: 'xs' | 'sm' | 'md'
  help?: string
  className?: string
}) {
  const id = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const idx = Math.max(0, options.findIndex((o) => o.value === value))
  const onKey = (e: KeyboardEvent) => {
    let next: number
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % options.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + options.length) % options.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = options.length - 1
    else return
    e.preventDefault()
    onChange(options[next].value)
    refs.current[next]?.focus()
  }
  return (
    <div className={`seg-wrap seg-wrap--${size}${className ? ` ${className}` : ''}`}>
      <div className={`field-head${hideLabel ? ' sr-only' : ''}`}>
        <span id={`${id}-l`} className="nf-label">
          {label}
        </span>
        {help && <InfoTip label={label}>{help}</InfoTip>}
      </div>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-l`}
        className="seg"
        style={{ ['--n' as string]: options.length, ['--i' as string]: idx }}
        onKeyDown={onKey}
      >
        <span className="seg-thumb" aria-hidden="true" />
        {options.map((o, i) => (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            tabIndex={o.value === value ? 0 : -1}
            className="seg-btn"
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ───────── Switch ───────── */

export function Switch({
  label,
  checked,
  onChange,
  help,
  description,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  help?: string
  description?: string
}) {
  const id = useId()
  return (
    <div className="switch-row">
      <div className="switch-text">
        <span id={`${id}-l`} className="switch-label">
          {label}
        </span>
        {description && <span className="switch-desc">{description}</span>}
      </div>
      {help && <InfoTip label={label}>{help}</InfoTip>}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        className="switch"
        onClick={() => onChange(!checked)}
      >
        <span className="switch-knob" aria-hidden="true" />
      </button>
    </div>
  )
}

/* ───────── Select ───────── */

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  hideLabel,
  className,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  hideLabel?: boolean
  className?: string
}) {
  const id = useId()
  return (
    <div className={`select-field${className ? ` ${className}` : ''}`}>
      <label htmlFor={id} className={`nf-label${hideLabel ? ' sr-only' : ''}`}>
        {label}
      </label>
      <div className="select-box">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon name="chevron" size={16} className="select-chevron" />
      </div>
    </div>
  )
}

/* ───────── Disclosure (progressive sections) ───────── */

export function Disclosure({
  title,
  summary,
  icon,
  children,
  defaultOpen = false,
  active = false,
  id,
}: {
  title: string
  summary?: ReactNode
  icon?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  active?: boolean
  id?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const autoId = useId()
  const panelId = `${id ?? autoId}-panel`
  return (
    <section className={`disc${open ? ' is-open' : ''}${active ? ' is-active' : ''}`} id={id}>
      <h3 className="disc-h">
        <button type="button" className="disc-btn" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
          {icon && <span className="disc-icon">{icon}</span>}
          <span className="disc-title">{title}</span>
          {summary != null && <span className="disc-summary">{summary}</span>}
          <Icon name="chevron" size={16} className="disc-chevron" />
        </button>
      </h3>
      <div className="disc-panel" id={panelId} role="region" aria-label={title} inert={!open}>
        <div className="disc-inner">
          <div className="disc-content">{children}</div>
        </div>
      </div>
    </section>
  )
}

/* ───────── Toast ───────── */

export interface ToastMsg {
  id: number
  text: string
  action?: { label: string; run: () => void }
}

export function Toasts({ items, dismiss }: { items: ToastMsg[]; dismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((m) => (
        <ToastItem key={m.id} msg={m} dismiss={dismiss} />
      ))}
    </div>
  )
}

function ToastItem({ msg, dismiss }: { msg: ToastMsg; dismiss: (id: number) => void }) {
  const { t } = useI18n()
  useEffect(() => {
    const id = window.setTimeout(() => dismiss(msg.id), msg.action ? 6000 : 3800)
    return () => window.clearTimeout(id)
  }, [msg, dismiss])
  return (
    <div className="toast">
      <span>{msg.text}</span>
      {msg.action && (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => {
            msg.action!.run()
            dismiss(msg.id)
          }}
        >
          {msg.action.label}
        </button>
      )}
      <button type="button" className="icon-btn icon-btn--sm" aria-label={t.common.close} onClick={() => dismiss(msg.id)}>
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}

/* ───────── Menu (simple popover list) ───────── */

export function Menu({
  label,
  trigger,
  items,
  align = 'end',
  className,
}: {
  label: string
  trigger: ReactNode
  items: { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean }[]
  align?: 'start' | 'end'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    requestAnimationFrame(() => itemRefs.current.find((b) => b && !b.disabled)?.focus())
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [open])
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      ;(wrap.current?.querySelector('[aria-haspopup]') as HTMLElement | null)?.focus()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const btns = itemRefs.current.filter((b): b is HTMLButtonElement => !!b && !b.disabled)
    const i = btns.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length
    btns[next]?.focus()
  }
  return (
    <div className={`menu${className ? ` ${className}` : ''}`} ref={wrap} onKeyDown={onKey}>
      <button
        type="button"
        className="menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open && (
        <div className={`menu-pop menu-pop--${align}`} role="menu" id={id} aria-label={label}>
          {items.map((it, i) => (
            <button
              key={it.label}
              ref={(el) => {
                itemRefs.current[i] = el
              }}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              className={`menu-item${it.danger ? ' menu-item--danger' : ''}`}
              onClick={() => {
                setOpen(false)
                it.onSelect()
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
