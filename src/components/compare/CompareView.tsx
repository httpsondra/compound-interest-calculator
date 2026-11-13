import { useMemo, useState } from 'react'
import { useI18n } from '../../i18n'
import { computeSummary } from '../../model/compute'
import { scaledAmount, totalMonths, uid, type Scenario } from '../../model/scenario'
import { MAX_SCENARIOS } from '../../state/store'
import { useApp } from '../../state/context'
import { XYChart, type Series } from '../chart/XYChart'
import { Icon } from '../ui/Icon'
import { Menu, Segmented } from '../ui/controls'

const COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)']
type VariantId = 'plusContribution' | 'returnDown' | 'returnUp' | 'longer' | 'fees'

export default function CompareView({ onOpen }: { onOpen: () => void }) {
  const { t, f, fill, duration } = useI18n()
  const { store, toast } = useApp()
  const [real, setReal] = useState(false)
  const scenarios = store.doc.scenarios
  const summaries = useMemo(() => scenarios.map((s) => computeSummary(s)), [scenarios])
  const full = scenarios.length >= MAX_SCENARIOS
  const active = store.active
  const anyInflation = scenarios.some((s) => s.inflationEnabled)
  const name = (s: Scenario, i: number) => s.name || `${t.scenario.untitled} ${i + 1}`

  const add = (sc: Scenario) => {
    if (full) {
      toast(fill(t.compare.max, { max: MAX_SCENARIOS }))
      return
    }
    store.setDoc((d) => ({ ...d, scenarios: [...d.scenarios, sc] }))
  }

  const variant = (id: VariantId) => {
    const base = active
    const delta = scaledAmount(1000, base.currency)
    let s: Scenario = { ...base, id: uid('sc') }
    let label = ''
    switch (id) {
      case 'plusContribution':
        s =
          base.contribMode === 'constant'
            ? { ...s, constant: { ...s.constant, amount: s.constant.amount + delta } }
            : { ...s, periods: s.periods.map((p) => ({ ...p, id: uid('p'), amount: p.paused ? p.amount : p.amount + delta })) }
        label = fill(t.compare.variants.plusContribution, {
          amount: f.money(delta, base.currency),
          per: base.contribMode === 'constant' ? t.per[base.constant.frequency] : t.per.monthly,
        })
        break
      case 'returnDown':
        s = { ...s, annualReturn: base.annualReturn - 1 }
        label = t.compare.variants.returnDown
        break
      case 'returnUp':
        s = { ...s, annualReturn: base.annualReturn + 1 }
        label = t.compare.variants.returnUp
        break
      case 'longer':
        s = { ...s, horizonYears: Math.min(100, base.horizonYears + 5) }
        label = t.compare.variants.longer
        break
      case 'fees':
        s = { ...s, feesEnabled: true, fees: { ...s.fees, annual: (base.feesEnabled ? base.fees.annual : 0) + 1 } }
        label = t.compare.variants.fees
        break
    }
    add({ ...s, name: `${name(base, scenarios.indexOf(base))} · ${label}`.slice(0, 60) })
  }

  const remove = (s: Scenario, i: number) => {
    if (scenarios.length <= 1) return
    store.setDoc((d) => {
      const rest = d.scenarios.filter((x) => x.id !== s.id)
      return { scenarios: rest, activeId: d.activeId === s.id ? rest[0].id : d.activeId }
    })
    toast(fill(t.compare.deleted, { name: name(s, i) }), { label: t.app.undo, run: store.undo })
  }

  const resetCompare = () => {
    store.setDoc((d) => ({ scenarios: d.scenarios.filter((x) => x.id === d.activeId), activeId: d.activeId }))
    toast(t.compare.reset, { label: t.app.undo, run: store.undo })
  }

  const maxH = Math.max(...summaries.map((x) => x?.months ?? 0), 12)
  const xs = Array.from({ length: maxH + 1 }, (_, m) => m)
  const series: Series[] = scenarios.map((s, i) => {
    const sum = summaries[i]
    const values = xs.map((m) => {
      if (!sum || m > sum.result.points.length - 1) return NaN
      const p = sum.result.points[m]
      return real && s.inflationEnabled ? p.real : p.balance
    })
    return { id: s.id, label: name(s, i), color: COLORS[i % COLORS.length], kind: 'line', values, width: s.id === active.id ? 2.5 : 2 }
  })
  const currency = active.currency
  const mixedCurrency = scenarios.some((s) => s.currency !== currency)

  const metrics: { key: string; label: string; get: (i: number) => number | null; money?: boolean; goal?: boolean; lowerIsBetter?: boolean }[] = [
    { key: 'final', label: t.compare.final, get: (i) => summaries[i]?.result.totals.final ?? null, money: true },
    ...(anyInflation ? [{ key: 'real', label: t.compare.finalReal, get: (i: number) => summaries[i]?.result.totals.finalReal ?? null, money: true }] : []),
    { key: 'contrib', label: t.compare.contributed, get: (i) => summaries[i]?.result.totals.contributed ?? null, money: true },
    { key: 'gain', label: t.compare.gain, get: (i) => summaries[i]?.result.totals.netGain ?? null, money: true },
    ...(scenarios.some((s) => s.feesEnabled) ? [{ key: 'fees', label: t.compare.fees, get: (i: number) => summaries[i]?.result.totals.fees ?? null, money: true, lowerIsBetter: true }] : []),
    ...(scenarios.some((s) => s.goal.enabled) ? [{ key: 'goal', label: t.compare.goal, get: (i: number) => summaries[i]?.timeToGoal ?? null, goal: true }] : []),
  ]

  const params = (s: Scenario) => {
    const rate = f.pct(s.annualReturn, 2)
    const years = duration(totalMonths(s))
    const initial = f.money(s.initial, s.currency, { compact: true })
    return s.contribMode === 'constant'
      ? fill(t.compare.params, { initial, contribution: `${f.money(s.constant.amount, s.currency, { compact: true })} ${t.per[s.constant.frequency]}`, rate, years })
      : fill(t.compare.scheduleParams, { initial, rate, years })
  }

  return (
    <div className="compare">
      <header className="view-head">
        <div>
          <h1 className="view-title">{t.compare.title}</h1>
          <p className="view-sub">{fill(t.compare.subtitle, { max: MAX_SCENARIOS })}</p>
        </div>
        <div className="view-actions">
          <Menu
            label={t.compare.variantMenu}
            align="end"
            trigger={
              <span className={`btn btn--primary btn--sm as-span${full ? ' is-disabled' : ''}`}>
                <Icon name="plus" size={16} />
                {t.compare.add}
              </span>
            }
            items={(['plusContribution', 'returnDown', 'returnUp', 'longer', 'fees'] as VariantId[]).map((id) => ({
              label:
                id === 'plusContribution'
                  ? fill(t.compare.variants.plusContribution, {
                      amount: f.money(scaledAmount(1000, active.currency), active.currency),
                      per: active.contribMode === 'constant' ? t.per[active.constant.frequency] : t.per.monthly,
                    })
                  : t.compare.variants[id],
              disabled: full,
              onSelect: () => variant(id),
            }))}
          />
          {scenarios.length > 1 && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={resetCompare}>
              {t.compare.single}
            </button>
          )}
        </div>
      </header>
      {full && <p className="note">{fill(t.compare.max, { max: MAX_SCENARIOS })}</p>}

      <div className="compare-grid">
        {scenarios.map((s, i) => {
          const sum = summaries[i]
          return (
            <article key={s.id} className={`card scen${s.id === active.id ? ' is-active' : ''}`} style={{ ['--sc' as string]: COLORS[i % COLORS.length] }}>
              <div className="scen-top">
                <span className="scen-swatch" aria-hidden="true" />
                <label className="sr-only" htmlFor={`name-${s.id}`}>
                  {t.scenario.rename}
                </label>
                <input
                  id={`name-${s.id}`}
                  className="scen-name"
                  value={s.name}
                  placeholder={`${t.scenario.untitled} ${i + 1}`}
                  maxLength={60}
                  onChange={(e) =>
                    store.setDoc((d) => ({ ...d, scenarios: d.scenarios.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)) }), `name-${s.id}`)
                  }
                />
                <Menu
                  label={fill(t.compare.actions, { name: name(s, i) })}
                  trigger={<Icon name="more" size={18} />}
                  items={[
                    { label: t.compare.duplicate, disabled: full, onSelect: () => add({ ...s, id: uid('sc'), name: `${name(s, i)} (${t.compare.copySuffix})`.slice(0, 60) }) },
                    { label: t.compare.remove, danger: true, disabled: scenarios.length <= 1, onSelect: () => remove(s, i) },
                  ]}
                />
              </div>
              <p className="scen-params">{params(s)}</p>
              <p className="scen-final">{sum ? f.money(real && s.inflationEnabled ? sum.result.totals.finalReal : sum.result.totals.final, s.currency) : '—'}</p>
              {s.id === active.id ? (
                <span className="chip">{t.compare.active}</span>
              ) : (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    store.setDoc((d) => ({ ...d, activeId: s.id }))
                    onOpen()
                  }}
                >
                  <Icon name="open" size={15} />
                  {t.compare.open}
                </button>
              )}
            </article>
          )
        })}
      </div>

      <section className="card chart-card" aria-labelledby="cmp-chart-h">
        <header className="card-head">
          <h2 id="cmp-chart-h" className="section-title">
            {t.compare.chartTitle}
          </h2>
          {anyInflation && (
            <Segmented
              size="sm"
              hideLabel
              label={t.results.valueMode}
              value={real ? 'real' : 'nominal'}
              options={[
                { value: 'nominal', label: t.results.nominal },
                { value: 'real', label: t.results.real },
              ]}
              onChange={(v) => setReal(v === 'real')}
            />
          )}
        </header>
        <ul className="legend">
          {series.map((se) => (
            <li key={se.id}>
              <span className="legend-item">
                <span className="legend-swatch" style={{ ['--sw' as string]: se.color }} />
                {se.label}
              </span>
            </li>
          ))}
        </ul>
        <XYChart
          xs={xs}
          series={series}
          height={320}
          ariaLabel={t.compare.chartTitle}
          yFormat={(v) => f.compact(v)}
          tooltipFormat={(v) => f.money(v, currency)}
          xTickLabel={(y) => String(y)}
          tooltipTitle={(m) => (m === 0 ? t.chart.start : fill(t.chart.year, { year: f.num(m / 12, m % 12 ? 1 : 0) }))}
        />
      </section>

      <section className="card" aria-labelledby="cmp-table-h">
        <h2 id="cmp-table-h" className="section-title">
          {t.compare.metricsTitle}
        </h2>
        <div className="table-scroll">
          <table className="ctable">
            <thead>
              <tr>
                <th scope="col">{t.compare.metric}</th>
                {scenarios.map((s, i) => (
                  <th key={s.id} scope="col">
                    <span className="legend-swatch" style={{ ['--sw' as string]: COLORS[i % COLORS.length] }} aria-hidden="true" /> {name(s, i)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.key}>
                  <th scope="row">{m.label}</th>
                  {scenarios.map((s, i) => {
                    const v = m.get(i)
                    const base = m.get(0)
                    if (m.goal) {
                      return <td key={s.id}>{s.goal.enabled && v != null ? fill(t.goal.timeTo, { year: Math.max(1, Math.ceil(v / 12)) }) : t.compare.goalNone}</td>
                    }
                    const diff = i > 0 && v != null && base != null && !mixedCurrency ? v - base : null
                    return (
                      <td key={s.id}>
                        <span className="ct-val">{v != null ? f.money(v, s.currency) : '—'}</span>
                        {diff != null && Math.abs(diff) >= 0.5 && (
                          <span className={`ct-diff ${(diff > 0) !== !!m.lowerIsBetter ? 'is-pos' : 'is-neg'}`}>
                            {f.money(diff, s.currency, { signed: true, compact: true })} {fill(t.compare.diff, { name: name(scenarios[0], 0) })}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">{t.compare.keep}</p>
      </section>
    </div>
  )
}
