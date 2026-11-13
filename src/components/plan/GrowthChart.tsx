import { useMemo, useState } from 'react'
import { useI18n } from '../../i18n'
import { totalMonths } from '../../model/scenario'
import { useApp } from '../../state/context'
import { XYChart, type Marker, type Series } from '../chart/XYChart'
import { Segmented } from '../ui/controls'
import { HelpTip } from '../ui/HelpTip'

export function GrowthChart() {
  const { t, f, fill, duration } = useI18n()
  const { scenario: s, computed, showReal, setShowReal } = useApp()
  const [hideContrib, setHideContrib] = useState(false)
  const res = computed.result
  const age = s.startAge

  const data = useMemo(() => {
    if (!res) return null
    const pts = res.points
    return {
      xs: pts.map((p) => p.month),
      balance: pts.map((p) => p.balance),
      real: pts.map((p) => p.real),
      contributed: pts.map((p) => p.contributed),
      withdrawn: pts.map((p) => p.withdrawn),
    }
  }, [res])

  if (!res || !data) return null
  const real = showReal && s.inflationEnabled
  const money = (v: number) => f.money(v, s.currency)
  const hasWithdrawals = s.withdrawal.enabled && res.totals.withdrawn > 0

  const series: Series[] = real
    ? [
        { id: 'real', label: t.chart.valueReal, color: 'var(--c-real)', kind: 'area', values: data.real, width: 2 },
        { id: 'nominal', label: t.chart.value, color: 'var(--c-value)', kind: 'line', values: data.balance, dashed: true, width: 1.5 },
      ]
    : [
        { id: 'value', label: t.chart.value, color: 'var(--c-value)', kind: 'area', values: data.balance, width: 2 },
        {
          id: 'contrib',
          label: t.chart.contributed,
          color: 'var(--c-contrib)',
          kind: 'area',
          fill: 'flat',
          fillColor: 'var(--c-contrib-fill)',
          values: data.contributed,
          hidden: hideContrib,
          width: 1.5,
        },
      ]

  const goal =
    s.goal.enabled && computed.goal && s.goal.real === real ? { value: s.goal.target, label: `${t.goal.marker} ${f.money(s.goal.target, s.currency, { compact: true })}` } : null

  const markers: Marker[] = computed.milestones.map((m) => {
    const year = Math.ceil(m.month / 12) || 1
    const label =
      m.kind === 'million'
        ? fill(t.milestones.million, { amount: f.money(m.amount!, s.currency, { compact: true }), year })
        : m.kind === 'crossover'
          ? fill(t.milestones.crossover, { year })
          : m.kind === 'goal'
            ? fill(t.milestones.goal, { year })
            : m.kind === 'withdraw'
              ? fill(t.milestones.withdraw, { year: Math.floor(m.month / 12) + 1 })
              : fill(t.milestones.depleted, { year })
    const tone = m.kind === 'goal' ? 'pos' : m.kind === 'depleted' ? 'neg' : m.kind === 'withdraw' ? 'warn' : 'default'
    return { month: m.month, label, tone } as Marker
  })

  const H = totalMonths(s)
  const title = (month: number) => {
    if (month === 0) return t.chart.start
    const year = f.num(month / 12, month % 12 ? 1 : 0)
    return age != null ? fill(t.chart.yearAge, { year, age: f.num(age + month / 12, month % 12 ? 1 : 0) }) : fill(t.chart.year, { year })
  }

  return (
    <section className="card chart-card" aria-labelledby="chart-h">
      <header className="card-head">
        <div className="title-row">
          <h2 id="chart-h" className="section-title">
            {t.chart.title}
          </h2>
          <HelpTip topic="chart" label={t.chart.title} />
        </div>
        <div className="chart-tools">
          {s.inflationEnabled && (
            <Segmented
              size="sm"
              hideLabel
              label={t.results.valueMode}
              value={real ? 'real' : 'nominal'}
              options={[
                { value: 'nominal', label: t.results.nominal },
                { value: 'real', label: t.results.real },
              ]}
              onChange={(v) => setShowReal(v === 'real')}
            />
          )}
          {s.inflationEnabled && <HelpTip topic="nominalReal" label={t.results.valueMode} />}
        </div>
      </header>
      <ul className="legend" aria-label={t.chart.title}>
        {series.map((se) => (
          <li key={se.id}>
            {se.id === 'contrib' ? (
              <button type="button" className="legend-item legend-btn" aria-pressed={!hideContrib} onClick={() => setHideContrib(!hideContrib)}>
                <span className="legend-swatch legend-swatch--area" style={{ ['--sw' as string]: se.color }} />
                {se.label}
              </button>
            ) : (
              <span className="legend-item">
                <span className={`legend-swatch${se.dashed ? ' legend-swatch--dashed' : ''}`} style={{ ['--sw' as string]: se.color }} />
                {se.label}
              </span>
            )}
          </li>
        ))}
        {goal && (
          <li>
            <span className="legend-item">
              <span className="legend-swatch legend-swatch--goal" />
              {t.goal.marker}
            </span>
          </li>
        )}
      </ul>
      <XYChart
        xs={data.xs}
        series={series}
        goal={goal}
        markers={real ? [] : markers.filter((m) => !(hasWithdrawals && m.tone === 'warn'))}
        regions={
          s.withdrawal.enabled && (s.withdrawal.startYear - 1) * 12 < H
            ? [{ start: (s.withdrawal.startYear - 1) * 12, end: s.withdrawal.endYear != null ? s.withdrawal.endYear * 12 : H, label: t.withdrawal.title }]
            : []
        }
        height={340}
        ariaLabel={fill(t.chart.label, { years: duration(H), value: money(res.totals.final) })}
        yFormat={(v) => f.compact(v)}
        tooltipFormat={money}
        xTickLabel={(y) => (age != null ? String(age + y) : y === 0 ? '0' : String(y))}
        tooltipTitle={title}
        extraRows={(i) => {
          const rows: { label: string; value: string; color?: string }[] = []
          if (!real) {
            const gain = data.balance[i] + data.withdrawn[i] - data.contributed[i]
            rows.push({ label: t.chart.gain, value: f.money(gain, s.currency, { signed: true }) })
          }
          if (hasWithdrawals && data.withdrawn[i] > 0) rows.push({ label: t.chart.withdrawn, value: money(data.withdrawn[i]) })
          return rows
        }}
      />
      <p className="chart-hint">{t.chart.hint}</p>
      {markers.length > 0 && !real && (
        <div className="milestones">
          <div className="title-row">
            <h3 className="mini-title">{t.milestones.title}</h3>
            <HelpTip topic="milestones" label={t.milestones.title} />
          </div>
          <ul>
            {markers.map((m, i) => (
              <li key={i} className={`milestone milestone--${m.tone}`}>
                <span className="milestone-dot" aria-hidden="true" />
                {m.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
