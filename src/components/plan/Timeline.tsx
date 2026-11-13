import { useState } from 'react'
import { useI18n } from '../../i18n'
import { PER_YEAR, type Frequency } from '../../engine/types'
import { FREQUENCIES, PER_YEAR_SCALE, horizonYearsCeil, periodRanges, scaledAmount } from '../../model/scenario'
import { addPeriod, extendTo, movePeriod, removePeriod, setEndYear, splitPeriod, trimTo } from '../../model/timeline'
import { useApp } from '../../state/context'
import { Icon } from '../ui/Icon'
import { NumberField } from '../ui/NumberField'
import { Menu, Select } from '../ui/controls'

export function Timeline() {
  const { t, f, fill, lang } = useI18n()
  const { scenario: s, update, toast, store } = useApp()
  const [selected, setSelected] = useState<string | null>(null)
  const ranges = periodRanges(s.periods)
  const H = horizonYearsCeil(s)
  const covered = ranges.length ? ranges[ranges.length - 1].endYear : 0
  const span = Math.max(H, covered)
  const monthlyEq = (amount: number, freq: Frequency) => (amount * PER_YEAR[freq]) / 12
  const maxEq = Math.max(1, ...s.periods.map((p) => (p.paused ? 0 : monthlyEq(p.amount, p.frequency))))
  const affix = f.currencyAffix(s.currency)
  const age = s.startAge
  const setPeriods = (fn: (p: typeof s.periods) => typeof s.periods, key?: string) =>
    update((x) => ({ ...x, periods: fn(x.periods) }), key)

  const rangeLabel = (a: number, b: number) =>
    a === b ? fill(t.timeline.year, { from: a }) : fill(t.timeline.years, { from: a, to: b })
  const ageLabel = (a: number, b: number) => (age != null ? fill(t.timeline.ages, { from: age + a - 1, to: age + b }) : null)

  const summary = ranges
    .map((r) => `${rangeLabel(r.startYear, r.endYear)}: ${r.period.paused ? t.timeline.paused : f.money(r.period.amount, s.currency)} ${t.per[r.period.frequency]}`)
    .join('; ')

  const focusRow = (id: string) => {
    setSelected(id)
    requestAnimationFrame(() => document.getElementById(`amt-${id}`)?.focus())
  }

  return (
    <div className="timeline">
      <div className="timeline-head">
        <p className="timeline-hint">{t.timeline.hint}</p>
      </div>

      <div className="ribbon" role="group" aria-label={fill(t.timeline.ribbonLabel, { summary })}>
        <div className="ribbon-track">
          {ranges.map((r) => {
            const eq = r.period.paused ? 0 : monthlyEq(r.period.amount, r.period.frequency)
            const beyond = r.startYear > H
            return (
              <button
                key={r.period.id}
                type="button"
                className={`ribbon-seg${r.period.paused ? ' is-paused' : ''}${beyond ? ' is-beyond' : ''}${selected === r.period.id ? ' is-selected' : ''}`}
                style={{ flexGrow: r.period.years }}
                onClick={() => focusRow(r.period.id)}
                aria-label={`${rangeLabel(r.startYear, r.endYear)} – ${r.period.paused ? t.timeline.paused : `${f.money(r.period.amount, s.currency)} ${t.per[r.period.frequency]}`}`}
              >
                <span className="ribbon-bar" style={{ height: `${eq > 0 ? 22 + 78 * (eq / maxEq) : 0}%` }} />
                <span className="ribbon-val">{r.period.paused ? t.timeline.paused : f.money(r.period.amount, s.currency, { compact: true })}</span>
              </button>
            )
          })}
          {covered < H && <span className="ribbon-gap" style={{ flexGrow: H - covered }} aria-hidden="true" />}
          {covered > H && <span className="ribbon-horizon" style={{ left: `${(H / span) * 100}%` }} aria-hidden="true" />}
        </div>
        <div className="ribbon-axis" aria-hidden="true">
          <span>{age != null ? age : 1}</span>
          <span>{age != null ? age + span : span}</span>
        </div>
      </div>

      <ol className="periods">
        {ranges.map((r, i) => {
          const p = r.period
          const ageText = ageLabel(r.startYear, r.endYear)
          return (
            <li key={p.id} className={`period${p.paused ? ' is-paused' : ''}${selected === p.id ? ' is-selected' : ''}`} onFocus={() => setSelected(p.id)}>
              <div className="period-head">
                <span className="period-index" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="period-range">
                  <strong>{rangeLabel(r.startYear, r.endYear)}</strong>
                  {ageText && <span className="period-age">{ageText}</span>}
                </div>
                <Menu
                  label={fill(t.timeline.actions, { n: i + 1 })}
                  trigger={<Icon name="more" size={18} />}
                  className="period-menu"
                  items={[
                    { label: t.timeline.duplicate, onSelect: () => setPeriods((ps) => splitPeriod(ps, i)) },
                    { label: p.paused ? t.timeline.resume : t.timeline.pause, onSelect: () => setPeriods((ps) => ps.map((x) => (x.id === p.id ? { ...x, paused: !x.paused } : x))) },
                    { label: t.timeline.moveEarlier, disabled: i === 0, onSelect: () => setPeriods((ps) => movePeriod(ps, i, -1)) },
                    { label: t.timeline.moveLater, disabled: i === ranges.length - 1, onSelect: () => setPeriods((ps) => movePeriod(ps, i, 1)) },
                    {
                      label: t.timeline.remove,
                      danger: true,
                      disabled: ranges.length <= 1,
                      onSelect: () => {
                        setPeriods((ps) => removePeriod(ps, i))
                        toast(t.timeline.removed, { label: t.app.undo, run: store.undo })
                      },
                    },
                  ]}
                />
              </div>
              <div className="period-fields">
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
                  slider={{ min: 0, max: scaledAmount(100_000, s.currency) * PER_YEAR_SCALE[p.frequency], scale: 'pow' }}
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
                  className="period-until"
                  label={t.timeline.until}
                  ariaLabel={`${fill(t.timeline.period, { n: i + 1 })} – ${t.timeline.until}`}
                  value={r.endYear}
                  min={r.startYear}
                  max={i < ranges.length - 1 ? ranges[i + 1].endYear - 1 : 100}
                  step={1}
                  onChange={(v) => setPeriods((ps) => setEndYear(ps, i, v), `end-${p.id}`)}
                />
              </div>
              {p.paused && <p className="period-paused-note">{t.timeline.paused}</p>}
            </li>
          )
        })}
      </ol>

      {covered < H && (
        <div className="inline-warn" role="status">
          <Icon name="warning" size={16} />
          <span>{fill(t.validation.scheduleShort, { year: covered + 1 })}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPeriods((ps) => extendTo(ps, H))}>
            {fill(t.timeline.extendFix, { year: H })}
          </button>
        </div>
      )}
      {covered > H && (
        <div className="inline-warn" role="status">
          <Icon name="warning" size={16} />
          <span>{fill(t.validation.scheduleLong, { year: H })}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPeriods((ps) => trimTo(ps, H))}>
            {fill(t.timeline.trimFix, { year: H })}
          </button>
        </div>
      )}

      <button type="button" className="btn btn--soft btn--block" onClick={() => setPeriods((ps) => addPeriod(ps, H))} lang={lang}>
        <Icon name="plus" size={16} />
        {t.timeline.add}
      </button>
    </div>
  )
}
