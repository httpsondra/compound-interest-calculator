import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../../i18n'
import { parseNumber } from '../../lib/format'
import { InfoTip } from './InfoTip'

export interface SliderSpec {
  min: number
  max: number
  /** 'pow' gives finer control at the low end — used for money amounts. */
  scale?: 'linear' | 'pow'
  step?: number
}

interface Props {
  id?: string
  label: ReactNode
  /** Plain-text label used for aria labels when `label` is not a string. */
  ariaLabel?: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  decimals?: number
  prefix?: string
  suffix?: string
  slider?: SliderSpec
  help?: string
  error?: string | null
  warning?: string | null
  size?: 'lg' | 'md' | 'sm'
  hideLabel?: boolean
  disabled?: boolean
  className?: string
}

const SLIDER_RES = 1000
const POW = 2.6

function niceSnap(v: number): number {
  if (v <= 0) return 0
  const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1)
  const step = mag >= 1 ? (mag * 5 > v / 10 ? mag : mag * 5) : mag
  return Math.round(v / step) * step
}

function toPos(v: number, s: SliderSpec): number {
  const t = Math.min(1, Math.max(0, (v - s.min) / (s.max - s.min)))
  return Math.round((s.scale === 'pow' ? Math.pow(t, 1 / POW) : t) * SLIDER_RES)
}
function fromPos(p: number, s: SliderSpec): number {
  const t = p / SLIDER_RES
  if (s.scale === 'pow') return niceSnap(s.min + (s.max - s.min) * Math.pow(t, POW))
  const raw = s.min + (s.max - s.min) * t
  const step = s.step ?? 1
  return Math.round(raw / step) * step
}

export function NumberField({
  id,
  label,
  ariaLabel,
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  decimals = 0,
  prefix,
  suffix,
  slider,
  help,
  error,
  warning,
  size = 'md',
  hideLabel,
  disabled,
  className,
}: Props) {
  const { lang, f, t, fill } = useI18n()
  const autoId = useId()
  const inputId = id ?? `nf${autoId}`
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const display = f.num(value, decimals)
  useEffect(() => {
    if (!focused) setDraft(display)
  }, [display, focused])

  const textLabel = ariaLabel ?? (typeof label === 'string' ? label : '')

  const commit = (v: number) => {
    if (v !== value) onChange(v)
  }

  const handleInput = (raw: string) => {
    setDraft(raw)
    const n = parseNumber(raw, lang)
    if (raw.trim() === '' || raw.trim() === '-') {
      setLocalError(null)
      return
    }
    if (n === null) {
      setLocalError(t.validation.number)
      return
    }
    if (n < min) {
      setLocalError(fill(t.validation.min, { min: f.num(min, decimals) }))
      return
    }
    if (n > max) {
      setLocalError(fill(t.validation.max, { max: f.num(max, decimals) }))
      return
    }
    setLocalError(null)
    commit(n)
  }

  const handleBlur = () => {
    setFocused(false)
    const n = parseNumber(draft, lang)
    if (n === null) {
      if (draft.trim() === '' && min <= 0 && max >= 0) commit(0)
      setDraft(f.num(draft.trim() === '' && min <= 0 ? 0 : value, decimals))
    } else {
      const clamped = Math.min(max, Math.max(min, n))
      commit(clamped)
      setDraft(f.num(clamped, decimals))
    }
    setLocalError(null)
  }

  const nudge = (dir: 1 | -1, big: boolean) => {
    const base = parseNumber(draft, lang) ?? value
    const next = Math.min(max, Math.max(min, Number((base + dir * step * (big ? 10 : 1)).toFixed(6))))
    setDraft(f.num(next, decimals))
    setLocalError(null)
    commit(next)
  }

  const shownError = error ?? localError
  const errId = `${inputId}-err`
  const warnId = `${inputId}-warn`
  const describedBy = [shownError ? errId : null, !shownError && warning ? warnId : null].filter(Boolean).join(' ') || undefined

  return (
    <div className={`nf nf--${size}${shownError ? ' is-invalid' : ''}${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}>
      <div className={`nf-head${hideLabel ? ' sr-only' : ''}`}>
        <label htmlFor={inputId} className="nf-label">
          {label}
        </label>
        {help && <InfoTip label={textLabel}>{help}</InfoTip>}
      </div>
      <div className="nf-box" onClick={() => inputRef.current?.focus()}>
        {prefix && (
          <span className="nf-affix" aria-hidden="true">
            {prefix}
          </span>
        )}
        <input
          ref={inputRef}
          id={inputId}
          className="nf-input"
          type="text"
          inputMode={decimals > 0 || min < 0 ? 'decimal' : 'numeric'}
          autoComplete="off"
          spellCheck={false}
          value={focused ? draft : display}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={describedBy}
          onFocus={(e) => {
            setFocused(true)
            setDraft(display)
            const el = e.currentTarget
            requestAnimationFrame(() => el.select())
          }}
          onBlur={handleBlur}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              nudge(1, e.shiftKey)
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              nudge(-1, e.shiftKey)
            } else if (e.key === 'Enter') {
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              setDraft(display)
              setLocalError(null)
              e.currentTarget.blur()
            }
          }}
        />
        {suffix && (
          <span className="nf-affix nf-affix--suffix" aria-hidden="true">
            {suffix}
          </span>
        )}
      </div>
      {slider && (
        <input
          type="range"
          className="nf-slider"
          min={0}
          max={SLIDER_RES}
          step={1}
          disabled={disabled}
          value={toPos(value, slider)}
          aria-label={fill(t.inputs.sliderLabel, { label: textLabel })}
          aria-valuetext={`${prefix ?? ''}${display}${suffix ? ` ${suffix}` : ''}`}
          style={{ ['--fill' as string]: `${(toPos(value, slider) / SLIDER_RES) * 100}%` }}
          onChange={(e) => {
            const v = fromPos(Number(e.target.value), slider)
            setLocalError(null)
            commit(Math.min(max, Math.max(min, v)))
          }}
        />
      )}
      {shownError && (
        <p id={errId} className="nf-msg nf-msg--error" role="alert">
          {shownError}
        </p>
      )}
      {!shownError && warning && (
        <p id={warnId} className="nf-msg nf-msg--warn">
          {warning}
        </p>
      )}
    </div>
  )
}
