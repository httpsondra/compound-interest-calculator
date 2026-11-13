import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { niceTicks, yearStep } from '../../lib/scale'

export interface Series {
  id: string
  label: string
  /** CSS colour (usually a var()). */
  color: string
  kind: 'area' | 'line' | 'band'
  values: number[]
  /** For bands: lower edge (values = upper edge). */
  lower?: number[]
  dashed?: boolean
  /** Area fill: gradient from the line colour. */
  fill?: 'gradient' | 'flat'
  fillColor?: string
  hidden?: boolean
  /** Exclude from tooltip. */
  quiet?: boolean
  /** Per-series tooltip formatter (e.g. each scenario in its own currency). */
  format?: (v: number) => string
  width?: number
}

export interface Marker {
  month: number
  label: string
  tone?: 'default' | 'pos' | 'warn' | 'neg'
}

interface Props {
  /** Month position of each sample (ascending). */
  xs: number[]
  series: Series[]
  yFormat: (v: number) => string
  tooltipFormat: (v: number) => string
  xTickLabel: (year: number) => string
  tooltipTitle: (month: number) => string
  goal?: { value: number; label: string } | null
  markers?: Marker[]
  /** Shaded phases, e.g. the withdrawal period. */
  regions?: { start: number; end: number; label: string }[]
  height?: number
  ariaLabel: string
  extraRows?: (index: number) => { label: string; value: string; color?: string }[]
  footer?: ReactNode
  /** Index to snap keyboard navigation to (default 12 months). */
  keyStepMonths?: number
}

const PAD = { top: 16, right: 14, bottom: 30, left: 8 }

function buildPath(xs: number[], ys: (number | null)[]): string {
  let d = ''
  let pen = false
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i]
    if (y == null || !Number.isFinite(y)) {
      pen = false
      continue
    }
    d += `${pen ? 'L' : 'M'}${xs[i].toFixed(1)} ${y.toFixed(1)}`
    pen = true
  }
  return d
}

export function XYChart({
  xs,
  series,
  yFormat,
  tooltipFormat,
  xTickLabel,
  tooltipTitle,
  goal,
  markers = [],
  regions = [],
  height = 320,
  ariaLabel,
  extraRows,
  footer,
  keyStepMonths = 12,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<number | null>(null)
  const [announce, setAnnounce] = useState('')
  const gid = useId().replace(/:/g, '')

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    // Measure before first paint so paths never animate from a placeholder width.
    if (el.clientWidth > 0) setWidth(el.clientWidth)
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width
      if (w > 0) setWidth(Math.round(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const visible = series.filter((s) => !s.hidden)
  const maxMonth = xs[xs.length - 1] ?? 1

  const { yTicks, yLo, yHi, labelW } = useMemo(() => {
    let lo = 0
    let hi = 0
    for (const s of visible) {
      for (const v of s.values) if (Number.isFinite(v)) hi = Math.max(hi, v)
      for (const v of s.values) if (Number.isFinite(v)) lo = Math.min(lo, v)
      if (s.lower) for (const v of s.lower) if (Number.isFinite(v)) lo = Math.min(lo, v)
    }
    if (goal && Number.isFinite(goal.value)) hi = Math.max(hi, goal.value * 1.04)
    const t = niceTicks(lo, hi * 1.02, height < 260 ? 4 : 5)
    const longest = Math.max(...t.ticks.map((v) => yFormat(v).length))
    return { yTicks: t.ticks, yLo: t.lo, yHi: t.hi, labelW: Math.max(34, longest * 7 + 10) }
  }, [visible, goal, height, yFormat])

  const left = PAD.left + labelW
  const plotW = Math.max(40, width - left - PAD.right)
  const plotH = height - PAD.top - PAD.bottom
  const sx = (m: number) => left + (maxMonth > 0 ? (m / maxMonth) * plotW : 0)
  const sy = (v: number) => PAD.top + plotH - ((v - yLo) / (yHi - yLo || 1)) * plotH
  const px = useMemo(() => xs.map(sx), [xs, width, labelW, maxMonth]) // eslint-disable-line react-hooks/exhaustive-deps

  const paths = visible.map((s) => {
    const top = s.values.map((v) => (Number.isFinite(v) ? sy(v) : null))
    const line = buildPath(px, top)
    let area = ''
    if (s.kind === 'area' || s.kind === 'band') {
      const bottom = s.kind === 'band' && s.lower ? s.lower.map((v) => sy(v)) : px.map(() => sy(Math.max(yLo, 0)))
      const idx = top.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0)
      if (idx.length > 1) {
        area =
          `M${px[idx[0]].toFixed(1)} ${bottom[idx[0]].toFixed(1)}` +
          idx.map((i) => `L${px[i].toFixed(1)} ${top[i]!.toFixed(1)}`).join('') +
          idx
            .slice()
            .reverse()
            .map((i) => `L${px[i].toFixed(1)} ${bottom[i].toFixed(1)}`)
            .join('') +
          'Z'
      }
    }
    return { s, line, area }
  })

  const years = maxMonth / 12
  const step = yearStep(years, Math.max(3, Math.floor(plotW / 64)))
  const xTicks: number[] = []
  for (let y = 0; y <= years + 1e-9; y += step) xTicks.push(y)

  const indexFromClientX = (clientX: number) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    const x = clientX - rect.left
    const m = ((x - left) / plotW) * maxMonth
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < xs.length; i++) {
      const d = Math.abs(xs[i] - m)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return best
  }

  const onPointer = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' || e.buttons > 0 || e.type === 'pointerdown') setHover(indexFromClientX(e.clientX))
  }

  const tooltipRows = (i: number) => {
    const rows = visible
      .filter((s) => !s.quiet && Number.isFinite(s.values[i]))
      .map((s) => ({ label: s.label, value: (s.format ?? tooltipFormat)(s.values[i]), color: s.color }))
    return [...rows, ...(extraRows ? extraRows(i) : [])]
  }

  const onKey = (e: KeyboardEvent) => {
    const stepIdx = (() => {
      // Convert month step to index step using sample spacing.
      const spacing = xs.length > 1 ? xs[1] - xs[0] : 1
      return Math.max(1, Math.round((e.shiftKey ? 1 : keyStepMonths) / spacing))
    })()
    let next: number
    if (e.key === 'ArrowRight') next = Math.min(xs.length - 1, (hover ?? -1) + stepIdx)
    else if (e.key === 'ArrowLeft') next = Math.max(0, (hover ?? xs.length) - stepIdx)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = xs.length - 1
    else if (e.key === 'Escape') {
      setHover(null)
      return
    } else return
    e.preventDefault()
    setHover(next)
    setAnnounce(`${tooltipTitle(xs[next])}: ${tooltipRows(next).map((r) => `${r.label} ${r.value}`).join(', ')}`)
  }

  const hx = hover != null ? px[hover] : 0
  const flip = hover != null && hx > left + plotW * 0.6

  return (
    <div className="xy" style={{ height }}>
      <div
        ref={wrapRef}
        className="xy-plot"
        tabIndex={0}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        <svg width={width} height={height} className="xy-svg" aria-hidden="true">
          <defs>
            {visible
              .filter((s) => s.kind === 'area' && s.fill !== 'flat')
              .map((s) => (
                <linearGradient key={s.id} id={`${gid}-${s.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={s.fillColor ?? s.color} stopOpacity="0.34" />
                  <stop offset="1" stopColor={s.fillColor ?? s.color} stopOpacity="0.02" />
                </linearGradient>
              ))}
          </defs>
          {regions.map((r) => {
            const x1 = sx(Math.max(0, r.start))
            const x2 = sx(Math.min(maxMonth, r.end))
            if (!(x2 > x1)) return null
            return (
              <g key={`${r.start}-${r.label}`} className="xy-region">
                <rect x={x1} y={PAD.top} width={x2 - x1} height={plotH} />
                <line x1={x1} x2={x1} y1={PAD.top} y2={PAD.top + plotH} />
                <text x={x1 + 8} y={PAD.top + 14}>
                  {r.label}
                </text>
              </g>
            )
          })}
          <g className="xy-grid">
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={left} x2={left + plotW} y1={sy(v)} y2={sy(v)} className={v === 0 ? 'xy-zero' : undefined} />
                <text x={left - 8} y={sy(v)} dy="0.32em" textAnchor="end" className="xy-tick">
                  {yFormat(v)}
                </text>
              </g>
            ))}
            {xTicks.map((y) => (
              <text key={y} x={sx(y * 12)} y={height - 8} textAnchor={y === 0 ? 'start' : 'middle'} className="xy-tick">
                {xTickLabel(y)}
              </text>
            ))}
          </g>
          {paths.map(({ s, area }) =>
            area ? (
              <path
                key={`a-${s.id}`}
                d={area}
                className="xy-area"
                fill={s.kind === 'band' || s.fill === 'flat' ? s.fillColor ?? s.color : `url(#${gid}-${s.id})`}
                fillOpacity={s.kind === 'band' || s.fill === 'flat' ? 1 : undefined}
              />
            ) : null,
          )}
          {paths.map(({ s, line }) =>
            s.kind === 'band' ? null : (
              <path
                key={`l-${s.id}`}
                d={line}
                className="xy-line"
                stroke={s.color}
                strokeWidth={s.width ?? 2}
                strokeDasharray={s.dashed ? '5 5' : undefined}
                fill="none"
              />
            ),
          )}
          {goal && Number.isFinite(goal.value) && goal.value <= yHi && (
            <g className="xy-goal">
              <line x1={left} x2={left + plotW} y1={sy(goal.value)} y2={sy(goal.value)} />
              <text x={left + plotW - 4} y={sy(goal.value) - 6} textAnchor="end">
                {goal.label}
              </text>
            </g>
          )}
          {markers.map((m, i) => {
            const x = sx(m.month)
            const idx = xs.findIndex((v) => v >= m.month)
            const base = visible.find((s) => s.kind !== 'band')
            const y = base && idx >= 0 ? sy(base.values[idx]) : PAD.top
            return (
              <g key={`${m.month}-${i}`} className={`xy-marker xy-marker--${m.tone ?? 'default'}`}>
                <line x1={x} x2={x} y1={PAD.top} y2={PAD.top + plotH} />
                <circle cx={x} cy={Number.isFinite(y) ? y : PAD.top} r={4} />
                <title>{m.label}</title>
              </g>
            )
          })}
          {hover != null && (
            <g className="xy-hover">
              <line x1={hx} x2={hx} y1={PAD.top} y2={PAD.top + plotH} />
              {visible
                .filter((s) => s.kind !== 'band' && Number.isFinite(s.values[hover]))
                .map((s) => (
                  <circle key={s.id} cx={hx} cy={sy(s.values[hover])} r={4.5} fill={s.color} />
                ))}
            </g>
          )}
        </svg>
        {hover != null && (
          <div
            className={`xy-tip${flip ? ' xy-tip--left' : ''}`}
            style={{ transform: `translate(${flip ? hx - 12 : hx + 12}px, ${PAD.top}px) translateX(${flip ? '-100%' : '0'})` }}
          >
            <div className="xy-tip-title">{tooltipTitle(xs[hover])}</div>
            {tooltipRows(hover).map((r) => (
              <div key={r.label} className="xy-tip-row">
                {r.color && <span className="xy-swatch" style={{ background: r.color }} />}
                <span className="xy-tip-label">{r.label}</span>
                <span className="xy-tip-value">{r.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {footer}
    </div>
  )
}
