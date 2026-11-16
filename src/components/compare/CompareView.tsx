import { useMemo, useState } from 'react'
import { useI18n } from '../../i18n'
import { computeSummary } from '../../model/compute'
import { incomeTarget, monthlyToPayment, inflationRate, scaledAmount, totalMonths, uid, type Scenario } from '../../model/scenario'
import { compareStrategies, incomeStats } from '../../model/retirement'
import { applyVariant, contributionStep, type VariantId } from '../../model/variants'
import { evaluateIncome } from '../../engine/income'
import { MAX_SCENARIOS } from '../../state/store'
import { useApp } from '../../state/context'
import { XYChart, type Series } from '../chart/XYChart'
import { axisUnit, chartTitle } from '../chart/time'
import { Icon } from '../ui/Icon'
import { Menu, Segmented } from '../ui/controls'
import { HelpTip } from '../ui/HelpTip'

const COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)']

export default function CompareView({ onOpen }: { onOpen: () => void }) {
  const i18n = useI18n()
  const { t, f, fill, duration } = i18n
  const { store, toast } = useApp()
  const [real, setReal] = useState(false)
  const [showAll, setShowAll] = useState(false)
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

  /** The scenario of a preset (shared pure model code) and its label. Used for previews and for adding. */
  const build = (id: VariantId, base: Scenario): { sc: Scenario; label: string } => {
    const sc = applyVariant(id, base)
    const delta = contributionStep(base.currency)
    switch (id) {
      case 'plusContribution':
        return {
          sc,
          label: fill(t.compare.variants.plusContribution, {
            amount: f.money(base.contribMode === 'constant' ? monthlyToPayment(delta, base.constant.frequency) : delta, base.currency),
            per: base.contribMode === 'constant' ? t.per[base.constant.frequency] : t.per.monthly,
          }),
        }
      case 'returnDown':
        return { sc, label: t.compare.variants.returnDown }
      case 'returnUp':
        return { sc, label: t.compare.variants.returnUp }
      case 'longer':
        return { sc, label: t.compare.variants.longer }
      case 'fees':
        return { sc, label: t.compare.variants.fees }
    }
  }

  const variant = (id: VariantId) => {
    const { sc, label } = build(id, active)
    add({ ...sc, name: `${name(active, scenarios.indexOf(active))} · ${label}`.slice(0, 60) })
  }

  /** One plain sentence on what a preset really changes (it is the same change `build` applies). */
  const hintFor = (id: VariantId, b: Scenario): string => {
    const h = t.compare.hints
    switch (id) {
      case 'plusContribution':
        return b.contribMode === 'constant'
          ? fill(h.plusConstant, { amount: f.money(monthlyToPayment(contributionStep(b.currency), b.constant.frequency), b.currency), per: t.per[b.constant.frequency] })
          : fill(h.plusSchedule, { amount: f.money(contributionStep(b.currency), b.currency) })
      case 'returnUp':
      case 'returnDown':
        return h.returnPp
      case 'fees':
        return h.fees
      case 'longer':
        if (!b.withdrawal.enabled) return h.longerPlain
        return b.withdrawal.endYear == null ? h.longerWithdrawals : h.longerWithdrawalsEnd
    }
  }

  // What each quick preset would do to the final value (single-scenario start screen only).
  const presets = useMemo(() => {
    if (scenarios.length !== 1) return []
    const base = summaries[0]?.result.totals.final
    return (['plusContribution', 'returnUp', 'returnDown', 'longer', 'fees'] as VariantId[]).map((id) => {
      const { sc, label } = build(id, scenarios[0])
      const fin = computeSummary(sc)?.result.totals.final
      return { id, label, hint: hintFor(id, scenarios[0]), delta: base != null && fin != null ? fin - base : null }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarios, summaries, t, f])

  // Same plan and the same starting retirement income; only the withdrawal rule differs (see compareStrategies).
  const strategyVariants = () => {
    const room = MAX_SCENARIOS - scenarios.length
    if (room <= 0) {
      toast(fill(t.compare.max, { max: MAX_SCENARIOS }))
      return
    }
    const cmp = compareStrategies(active)
    if (!cmp || cmp.status !== 'ok') {
      toast(cmp?.status === 'noPortfolio' ? t.retire.noPortfolio : t.retire.noIncome)
      return
    }
    const nm = name(active, scenarios.indexOf(active))
    const add = cmp.rows
      .filter((r) => r.result && r.strategy !== active.withdrawal.strategy)
      .slice(0, room)
      .map((r) => ({ ...r.variant, id: uid('sc'), name: `${nm} · ${t.retire.strategies[r.strategy]}`.slice(0, 60) }))
    store.setDoc((d) => ({ ...d, scenarios: [...d.scenarios, ...add] }))
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
  const currency = active.currency
  const mixedCurrency = scenarios.some((s) => s.currency !== currency)
  // Without real FX conversion, only scenarios in the active scenario's currency share the chart.
  const series: Series[] = scenarios.flatMap((s, i) => {
    if (s.currency !== currency) return []
    const sum = summaries[i]
    const values = xs.map((m) => {
      if (!sum || m > sum.result.points.length - 1) return NaN
      const p = sum.result.points[m]
      return real && s.inflationEnabled ? p.real : p.balance
    })
    return [
      {
        id: s.id,
        label: name(s, i),
        color: COLORS[i % COLORS.length],
        kind: 'line' as const,
        values,
        width: s.id === active.id ? 2.25 : 1.75,
        format: (v: number) => f.money(v, s.currency),
      },
    ]
  })
  const anyWithdrawal = scenarios.some((s) => s.withdrawal.enabled)
  const stats = summaries.map((sum, i) => (sum && scenarios[i].withdrawal.enabled ? incomeStats(sum.result, inflationRate(scenarios[i])) : null))
  const metrics: {
    key: string
    label: string
    get: (i: number) => number | null
    money?: boolean
    goal?: boolean
    lowerIsBetter?: boolean
    text?: (i: number) => { value: string; tone?: 'pos' | 'neg' | 'warn' }
  }[] = [
    { key: 'final', label: t.compare.final, get: (i) => summaries[i]?.result.totals.final ?? null, money: true },
    ...(anyInflation ? [{ key: 'real', label: t.compare.finalReal, get: (i: number) => summaries[i]?.result.totals.finalReal ?? null, money: true }] : []),
    { key: 'contrib', label: t.compare.contributed, get: (i) => summaries[i]?.result.totals.contributed ?? null, money: true },
    { key: 'gain', label: t.compare.gain, get: (i) => summaries[i]?.result.totals.netGain ?? null, money: true },
    ...(scenarios.some((s) => s.feesEnabled) ? [{ key: 'fees', label: t.compare.fees, get: (i: number) => summaries[i]?.result.totals.fees ?? null, money: true, lowerIsBetter: true }] : []),
    ...(scenarios.some((s) => s.goal.enabled) ? [{ key: 'goal', label: t.compare.goal, get: (i: number) => summaries[i]?.timeToGoal ?? null, goal: true }] : []),
    ...(anyWithdrawal
      ? [
          { key: 'strategy', label: t.retire.strategy, get: () => null, text: (i: number) => ({ value: scenarios[i].withdrawal.enabled ? t.retire.strategies[scenarios[i].withdrawal.strategy] : '—' }) },
          { key: 'inc0', label: `${t.retire.initialIncome} (${t.results.real})`, get: (i: number) => stats[i]?.initialReal ?? null, money: true },
          { key: 'incMin', label: `${t.retire.lowestIncome} (${t.results.real})`, get: (i: number) => stats[i]?.minReal ?? null, money: true },
          { key: 'incEnd', label: `${t.retire.finalIncome} (${t.results.real})`, get: (i: number) => stats[i]?.finalReal ?? null, money: true },
          { key: 'wd', label: t.results.withdrawn, get: (i: number) => stats[i]?.totalWithdrawn ?? null, money: true },
          {
            key: 'dep',
            label: t.retire.depletion,
            get: () => null,
            text: (i: number) => {
              const st = stats[i]
              if (!st) return { value: '—' }
              return st.depletedAtMonth != null ? { value: String(Math.ceil(st.depletedAtMonth / 12)), tone: 'neg' as const } : { value: t.retire.never, tone: 'pos' as const }
            },
          },
          {
            key: 'funds',
            label: t.retire.fundsIncome,
            get: () => null,
            text: (i: number) => {
              const sum = summaries[i]
              const sc = scenarios[i]
              if (!sum || !sc.withdrawal.enabled) return { value: '—' }
              const goal = incomeTarget(sc)
              if (!goal) return { value: '—' }
              const ev = evaluateIncome(sum.result.withdrawalYears, inflationRate(sc), goal.monthly, goal.real)
              return ev.funded ? { value: t.retire.yes, tone: 'pos' as const } : { value: t.retire.no, tone: 'warn' as const }
            },
          },
        ]
      : []),
  ]

  const params = (s: Scenario) => {
    const rate = f.pct(s.annualReturn, 2)
    const years = duration(totalMonths(s))
    const initial = f.money(s.initial, s.currency, { compact: true })
    return s.contribMode === 'constant'
      ? fill(t.compare.params, { initial, contribution: `${f.money(s.constant.amount, s.currency, { compact: true })} ${t.per[s.constant.frequency]}`, rate, years })
      : fill(t.compare.scheduleParams, { initial, rate, years })
  }

  /** What a scenario changes compared with the first one: short chips, so the cards show differences, not repeats. */
  const changes = (s: Scenario, base: Scenario): string[] => {
    const out: string[] = []
    if (s.annualReturn !== base.annualReturn) out.push(fill(t.compare.chReturn, { value: f.pct(s.annualReturn, 2) }))
    if (totalMonths(s) !== totalMonths(base)) out.push(fill(t.compare.chYears, { value: duration(totalMonths(s)) }))
    if (s.contribMode === 'constant' && base.contribMode === 'constant' && (s.constant.amount !== base.constant.amount || s.constant.frequency !== base.constant.frequency))
      out.push(fill(t.compare.chContribution, { value: `${f.money(s.constant.amount, s.currency, { compact: true })} ${t.per[s.constant.frequency]}` }))
    const fee = (x: Scenario) => (x.feesEnabled ? x.fees.annual : 0)
    if (fee(s) !== fee(base)) out.push(fill(t.compare.chFees, { value: f.pct(fee(s), 2) }))
    if (s.withdrawal.enabled && base.withdrawal.enabled && s.withdrawal.strategy !== base.withdrawal.strategy) out.push(t.retire.strategies[s.withdrawal.strategy])
    return out
  }

  const finalOf = (i: number) => {
    const sum = summaries[i]
    if (!sum) return null
    return real && scenarios[i].inflationEnabled ? sum.result.totals.finalReal : sum.result.totals.final
  }
  const base = scenarios[0]
  const single = scenarios.length === 1

  // The headline: which scenario has the highest FINAL VALUE (same currency only: amounts are never converted).
  // This is a statement about one figure, not a verdict: plans may differ in length, withdrawals, risk or goals.
  let bestLine: string | null = null
  let bestCaveat: string | null = null
  if (!single && !mixedCurrency) {
    let bi = 0
    scenarios.forEach((_, i) => {
      if ((finalOf(i) ?? -Infinity) > (finalOf(bi) ?? -Infinity)) bi = i
    })
    const v = finalOf(bi)
    const b0 = finalOf(0)
    const basis = real && anyInflation ? t.compare.inTodays : ''
    if (v != null && b0 != null)
      bestLine =
        bi === 0
          ? fill(t.compare.best, { name: name(scenarios[0], 0), value: f.money(v, currency), basis })
          : fill(t.compare.bestDelta, { name: name(scenarios[bi], bi), value: f.money(v, currency), delta: f.money(v - b0, currency), base: name(scenarios[0], 0), basis })
    const diffs: string[] = []
    if (new Set(scenarios.map((s) => totalMonths(s))).size > 1) diffs.push(t.compare.diffLength)
    const wd = (s: Scenario) => {
      const w = s.withdrawal
      return w.enabled ? [w.strategy, w.amount, w.amountReal, w.rate, w.startYear, w.endYear, w.frequency, w.indexed, w.maxIncrease, w.maxDecrease, w.floor].join('|') : 'off'
    }
    if (scenarios.some((s) => wd(s) !== wd(base)))
      diffs.push(t.compare.diffWithdrawals)
    if (diffs.length) bestCaveat = fill(t.compare.caveat, { what: diffs.join(` ${t.compare.and} `) })
  }

  // Rows where every scenario gives the same answer say nothing: hidden unless asked for.
  const rowDiffers = (m: (typeof metrics)[number]) => {
    const key = (i: number) => (m.text ? m.text(i).value : m.get(i) == null ? '—' : Math.round((m.get(i) as number) * 2) / 2)
    return scenarios.some((_, i) => key(i) !== key(0))
  }
  const visibleMetrics = showAll ? metrics : metrics.filter(rowDiffers)
  const hiddenCount = metrics.length - metrics.filter(rowDiffers).length

  return (
    <div className="compare">
      <header className="view-head">
        <div>
          <div className="title-row">
            <h1 className="view-title">{t.compare.title}</h1>
            <HelpTip topic="compare" label={t.compare.title} />
          </div>
          <p className="view-sub">{fill(t.compare.subtitle, { max: MAX_SCENARIOS })}</p>
        </div>
        {!single && (
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
              items={(['plusContribution', 'returnDown', 'returnUp', 'longer', 'fees'] as VariantId[])
                .map((id) => ({
                  label:
                    id === 'plusContribution'
                      ? fill(t.compare.variants.plusContribution, {
                          amount: f.money(scaledAmount(1000, active.currency), active.currency),
                          per: active.contribMode === 'constant' ? t.per[active.constant.frequency] : t.per.monthly,
                        })
                      : t.compare.variants[id],
                  disabled: full,
                  onSelect: () => variant(id),
                }))
                .concat(active.withdrawal.enabled ? [{ label: t.compare.variants.strategies, disabled: full, onSelect: () => strategyVariants() }] : [])}
            />
            <button type="button" className="btn btn--ghost btn--sm" onClick={resetCompare}>
              {t.compare.single}
            </button>
          </div>
        )}
      </header>
      {full && <p className="note">{fill(t.compare.max, { max: MAX_SCENARIOS })}</p>}
      {mixedCurrency && (
        <p className="inline-warn" role="status">
          <Icon name="warning" size={15} />
          <span>
            {fill(t.compare.mixedCurrency, {
              currencies: Array.from(new Set(scenarios.map((s) => s.currency))).join(', '),
              currency,
            })}
          </span>
        </p>
      )}

      {single ? (
        <section className="card start" aria-labelledby="cmp-start-h">
          <div className="start-plan">
            <span className="start-k">{t.compare.startPlan}</span>
            <label className="sr-only" htmlFor={`name-${base.id}`}>
              {t.scenario.rename}
            </label>
            <input
              id={`name-${base.id}`}
              className="scen-name start-name"
              value={base.name}
              placeholder={`${t.scenario.untitled} 1`}
              maxLength={60}
              onChange={(e) => store.setDoc((d) => ({ ...d, scenarios: d.scenarios.map((x) => (x.id === base.id ? { ...x, name: e.target.value } : x)) }), `name-${base.id}`)}
            />
            <p className="start-final">{summaries[0] ? f.money(summaries[0].result.totals.final, base.currency) : '—'}</p>
            <p className="scen-params">{params(base)}</p>
          </div>
          <div className="start-main">
            <h2 id="cmp-start-h" className="section-title">
              {t.compare.startTitle}
            </h2>
            <p className="start-text">{t.compare.startText}</p>
            <ul className="presets">
              {presets.map((p) => (
                <li key={p.id}>
                  <button type="button" className="preset" onClick={() => variant(p.id)}>
                    <span className="preset-label">{p.label}</span>
                    <span className="preset-hint">{p.hint}</span>
                    {p.delta != null && Math.abs(p.delta) >= 0.5 && (
                      <span className="preset-effect">
                        {fill(t.compare.presetEffect, { delta: f.money(p.delta, base.currency, { signed: true, compact: true }) })}
                      </span>
                    )}
                  </button>
                </li>
              ))}
              {base.withdrawal.enabled && (
                <li>
                  <button type="button" className="preset" onClick={strategyVariants}>
                    <span className="preset-label">{t.compare.variants.strategies}</span>
                  </button>
                </li>
              )}
            </ul>
            <p className="note preset-basis">{t.compare.presetBasis}</p>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => add({ ...base, id: uid('sc'), name: `${name(base, 0)} (${t.compare.copySuffix})`.slice(0, 60) })}>
              <Icon name="copy" size={15} />
              {t.compare.duplicateCurrent}
            </button>
          </div>
        </section>
      ) : (
        <>
          {bestLine && (
            <div className="cmp-best-wrap">
              <p className="cmp-best" role="status">
                {bestLine}
              </p>
              {bestCaveat && <p className="note cmp-caveat">{bestCaveat}</p>}
            </div>
          )}
          <div className="compare-grid">
            {scenarios.map((s, i) => {
              const v = finalOf(i)
              const b0 = finalOf(0)
              const delta = i > 0 && !mixedCurrency && v != null && b0 != null ? v - b0 : null
              const ch = i > 0 ? changes(s, base) : []
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
                  <p className="scen-final">{v != null ? f.money(v, s.currency) : '—'}</p>
                  {delta != null && Math.abs(delta) >= 0.5 && (
                    <p className="scen-delta">
                      {f.money(delta, s.currency, { signed: true })} <span>{fill(t.compare.diff, { name: name(base, 0) })}</span>
                    </p>
                  )}
                  {ch.length > 0 ? (
                    <ul className="scen-changes">
                      {ch.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="scen-params">{params(s)}</p>
                  )}
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
              endFormat={(v) => f.money(v, currency, { compact: true })}
              tooltipFormat={(v) => f.money(v, currency)}
              xTickLabel={(y) => String(y)}
              xUnit={axisUnit(i18n, null)}
              tooltipTitle={chartTitle(i18n, null)}
            />
          </section>

          <section className="card" aria-labelledby="cmp-table-h">
            <header className="card-head">
              <div className="title-row">
                <h2 id="cmp-table-h" className="section-title">
                  {t.compare.metricsTitle}
                </h2>
                <HelpTip topic="compareDiff" label={t.compare.metricsTitle} />
              </div>
              {(hiddenCount > 0 || showAll) && (
                <button type="button" className="btn btn--ghost btn--sm" aria-pressed={showAll} onClick={() => setShowAll(!showAll)}>
                  {showAll ? t.compare.onlyDiff : t.compare.showAll}
                </button>
              )}
            </header>
            {visibleMetrics.length === 0 ? (
              <p className="note">{t.compare.sameFigures}</p>
            ) : (
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
                    {visibleMetrics.map((m) => (
                      <tr key={m.key}>
                        <th scope="row">{m.label}</th>
                        {scenarios.map((s, i) => {
                          const v = m.get(i)
                          const b0 = m.get(0)
                          if (m.text) {
                            const tx = m.text(i)
                            return (
                              <td key={s.id}>
                                <span className={`ct-val${tx.tone ? ` is-${tx.tone}` : ''}`}>{tx.value}</span>
                              </td>
                            )
                          }
                          if (m.goal) {
                            return <td key={s.id}>{s.goal.enabled && v != null ? fill(t.goal.timeTo, { year: Math.max(1, Math.ceil(v / 12)) }) : t.compare.goalNone}</td>
                          }
                          const diff = i > 0 && v != null && b0 != null && !mixedCurrency ? v - b0 : null
                          return (
                            <td key={s.id}>
                              <span className="ct-val">{v != null ? f.money(v, s.currency) : '—'}</span>
                              {diff != null && Math.abs(diff) >= 0.5 && (
                                <span className="ct-diff">
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
            )}
            <p className="note">{t.compare.keep}</p>
          </section>
        </>
      )}
    </div>
  )
}
