import { useState } from 'react'
import { useI18n } from '../../i18n'
import { PER_YEAR, type Frequency } from '../../engine/types'
import { FREQUENCIES, horizonYearsCeil, periodRanges, scaledAmount } from '../../model/scenario'
import { addPeriod, extendTo, movePeriod, removePeriod, setEndYear, splitPeriod, trimTo } from '../../model/timeline'
import { useApp } from '../../state/context'
import { Icon } from '../ui/Icon'
import { NumberField } from '../ui/NumberField'
import { Select } from '../ui/controls'

/**
 * Contribution timeline: a step visualisation of the whole schedule plus
 * compact rows. Only the expanded row shows its editing controls.
 */
export function Timeline() {
  const { t, f, fill } = useI18n()
  const { scenario: s, update, toast, store } = useApp()
  const [open, setOpen] = useState<string | null>(null)
  const ranges = periodRanges(s.periods)
  const H = horizonYearsCeil(s)
  const covered = ranges.length ? ranges[ranges.length - 1].endYear : 0
  const span = Math.max(H, covered, 1)
  const monthlyEq = (amount: number, freq: Frequency) => (amount * PER_YEAR[freq]) / 12
  const maxEq = Math.max(1, ...s.periods.map((p) => (p.paused ? 0 : monthlyEq(p.amount, p.frequency))))
  const affix = f.currencyAffix(s.currency)
  const age = s.startAge
  const setPeriods = (fn: (p: typeof s.periods) => typeof s.periods, key?: string) => update((x) => ({ ...x, periods: fn(x.periods) }), key)

  const rangeLabel = (a: number, b: number) => (a === b ? fill(t.timeline.year, { from: a }) : fill(t.timeline.years, { from: a, to: b }))
  const ageLabel = (a: number, b: number) => (age != null ? fill(t.timeline.ages, { from: age + a - 1, to: age + b }) : null)
  const amountText = (amount: number, freq: Frequency) => `${f.money(amount, s.currency)} ${t.per[freq]}`
  const summary = ranges
    .map((r) => `${rangeLabel(r.startYear, r.endYear)}: ${r.period.paused ? t.timeline.paused : amountText(r.period.amount, r.period.frequency)}`)
    .join('; ')

  const expand = (id: string, focus = false) => {
    setOpen((cur) => (cur === id && !focus ? null : id))
    if (focus) requestAnimationFrame(() => document.getElementById(`amt-${id}`)?.focus())
  }

  // Boundary labels on the axis (start of each period + end), skipping ones that would collide.
  const ticks: { pos: number; label: string }[] = []
  for (const r of [...ranges.map((r) => r.startYear - 1), covered]) {
    const pos = (r / span) * 100
    if (ticks.length && pos - ticks[ticks.length - 1].pos < 7) continue
    ticks.push({ pos, label: String(age != null ? age + r : r) })
  }

  return (
    <div className="tl">
      <div className="tl-chart" role="group" aria-label={fill(t.timeline.ribbonLabel, { summary })}>
        <div className="tl-plot">
          {ranges.map((r, i) => {
            const eq = r.period.paused ? 0 : monthlyEq(r.period.amount, r.period.frequency)
            const h = eq > 0 ? 18 + 82 * (eq / maxEq) : 0
            const beyond = r.startYear > H
            return (
              <button
                key={r.period.id}
                type="button"
                className={`tl-seg${r.period.paused ? ' is-paused' : ''}${beyond ? ' is-beyond' : ''}${open === r.period.id ? ' is-selected' : ''}`}
                style={{ flexGrow: r.period.years, ['--h' as string]: `${h}%` }}
                onClick={() => expand(r.period.id, true)}
                aria-label={`${fill(t.timeline.period, { n: i + 1 })}: ${rangeLabel(r.startYear, r.endYear)} – ${r.period.paused ? t.timeline.paused : amountText(r.period.amount, r.period.frequency)}`}
              >
                <span className="tl-bar" />
                <span className="tl-val">{r.period.paused ? t.timeline.paused : f.money(r.period.amount, s.currency, { compact: true })}</span>
              </button>
            )
          })}
          {covered < H && <span className="tl-gap" style={{ flexGrow: H - covered }} aria-hidden="true" />}
          {covered > H && <span className="tl-horizon" style={{ left: `${(H / span) * 100}%` }} aria-hidden="true" />}
        </div>
        <div className="tl-axis" aria-hidden="true">
          {ticks.map((tk) => (
            <span key={tk.pos} style={{ left: `${tk.pos}%` }}>
              {tk.label}
            </span>
          ))}
        </div>
      </div>

      <ol className="tl-list">
        {ranges.map((r, i) => {
          const p = r.period
          const isOpen = open === p.id
          const ageText = ageLabel(r.startYear, r.endYear)
          return (
            <li key={p.id} className={`tl-item${isOpen ? ' is-open' : ''}${p.paused ? ' is-paused' : ''}`}>
              <button
                type="button"
                className="tl-row"
                aria-expanded={isOpen}
                aria-controls={`tl-edit-${p.id}`}
                aria-label={`${fill(t.timeline.edit, { n: i + 1 })}: ${rangeLabel(r.startYear, r.endYear)}, ${p.paused ? t.timeline.paused : amountText(p.amount, p.frequency)}`}
                onClick={() => expand(p.id)}
              >
                <span className="tl-dot" aria-hidden="true" style={{ ['--lvl' as string]: p.paused ? 0 : monthlyEq(p.amount, p.frequency) / maxEq }} />
                <span className="tl-range">
                  <span className="tl-years">{rangeLabel(r.startYear, r.endYear)}</span>
                  {ageText && <span className="tl-age">{ageText}</span>}
                </span>
                <span className="tl-amount">{p.paused ? t.timeline.paused : amountText(p.amount, p.frequency)}</span>
                <Icon name="chevron" size={15} className="tl-chev" />
              </button>
              {isOpen && (
                <div className="tl-edit" id={`tl-edit-${p.id}`}>
                  <div className="tl-fields">
                    <NumberField
                      id={`amt-${p.id}`}
                      size="sm"
                      label={t.inputs.amount}
                      ariaLabel={`${fill(t.timeline.period, { n: i + 1 })} – ${t.inputs.amount}`}
                      value={p.amount}
                      min={0}
                      max={1e12}
                      step={scaledAmount(500, s.currency)}
                      disabled={p.paused}
                      {...affix}
                      onChange={(v) => setPeriods((ps) => ps.map((x) => (x.id === p.id ? { ...x, amount: v } : x)), `amt-${p.id}`)}
                    />
                    <Select<Frequency>
                      label={t.inputs.frequency}
                      className="freq-select"
                      value={p.frequency}
                      options={FREQUENCIES.map((v) => ({ value: v, label: t.freq[v] }))}
                      onChange={(v) => setPeriods((ps) => ps.map((x) => (x.id === p.id ? { ...x, frequency: v } : x)))}
                    />
                    <NumberField
                      id={`end-${p.id}`}
                      size="sm"
                      label={t.timeline.until}
                      ariaLabel={`${fill(t.timeline.period, { n: i + 1 })} – ${t.timeline.until}`}
                      value={r.endYear}
                      min={r.startYear}
                      max={i < ranges.length - 1 ? ranges[i + 1].endYear - 1 : 100}
                      step={1}
                      onChange={(v) => setPeriods((ps) => setEndYear(ps, i, v), `end-${p.id}`)}
                    />
                  </div>
                  <div className="tl-actions" role="group" aria-label={fill(t.timeline.actions, { n: i + 1 })}>
                    <button type="button" className="chip-btn" onClick={() => setPeriods((ps) => ps.map((x) => (x.id === p.id ? { ...x, paused: !x.paused } : x)))}>
                      <Icon name={p.paused ? 'play' : 'pause'} size={14} />
                      {p.paused ? t.timeline.resume : t.timeline.pause}
                    </button>
                    <button type="button" className="chip-btn" onClick={() => setPeriods((ps) => splitPeriod(ps, i))}>
                      <Icon name="copy" size={14} />
                      {t.timeline.duplicate}
                    </button>
                    <button type="button" className="chip-btn chip-btn--icon" disabled={i === 0} aria-label={t.timeline.moveEarlier} title={t.timeline.moveEarlier} onClick={() => setPeriods((ps) => movePeriod(ps, i, -1))}>
                      <Icon name="chevronLeft" size={15} />
                    </button>
                    <button
                      type="button"
                      className="chip-btn chip-btn--icon"
                      disabled={i === ranges.length - 1}
                      aria-label={t.timeline.moveLater}
                      title={t.timeline.moveLater}
                      onClick={() => setPeriods((ps) => movePeriod(ps, i, 1))}
                    >
                      <Icon name="chevronRight" size={15} />
                    </button>
                    <button
                      type="button"
                      className="chip-btn chip-btn--danger"
                      disabled={ranges.length <= 1}
                      onClick={() => {
                        setPeriods((ps) => removePeriod(ps, i))
                        setOpen(null)
                        toast(t.timeline.removed, { label: t.app.undo, run: store.undo })
                      }}
                    >
                      <Icon name="trash" size={14} />
                      {t.timeline.remove}
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {covered < H && (
        <div className="inline-warn" role="status">
          <Icon name="warning" size={15} />
          <span>{fill(t.validation.scheduleShort, { year: covered + 1 })}</span>
          <button type="button" className="link-btn" onClick={() => setPeriods((ps) => extendTo(ps, H))}>
            {fill(t.timeline.extendFix, { year: H })}
          </button>
        </div>
      )}
      {covered > H && (
        <div className="inline-warn" role="status">
          <Icon name="warning" size={15} />
          <span>{fill(t.validation.scheduleLong, { year: H })}</span>
          <button type="button" className="link-btn" onClick={() => setPeriods((ps) => trimTo(ps, H))}>
            {fill(t.timeline.trimFix, { year: H })}
          </button>
        </div>
      )}

      <button type="button" className="tl-add" onClick={() => setPeriods((ps) => addPeriod(ps, H))}>
        <Icon name="plus" size={15} />
        {t.timeline.add}
      </button>
    </div>
  )
}
