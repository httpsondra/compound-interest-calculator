import { useDeferredValue, useMemo, useState } from 'react'
import { useI18n } from '../../i18n'
import { evaluateIncome } from '../../engine/income'
import { parseNumber } from '../../lib/format'
import {
  STRESS_KINDS,
  compareStrategies,
  fiAnalysis,
  incomeSeries,
  incomeStats,
  stressTest,
  type IncomeStats,
  type StressKind,
} from '../../model/retirement'
import { inflationRate, totalMonths, uid, type Scenario, type WithdrawalStrategy } from '../../model/scenario'
import { MAX_SCENARIOS } from '../../state/store'
import { useApp } from '../../state/context'
import { XYChart, type Series } from '../chart/XYChart'
import { HelpTip } from '../ui/HelpTip'
import { Icon } from '../ui/Icon'
import { Segmented } from '../ui/controls'
import { DesiredIncome, WithdrawalControls } from './WithdrawalControls'
import type { SimResult } from '../../engine/types'

type Basis = 'nominal' | 'real'

export default function RetirementView({ onCompare }: { onCompare: () => void }) {
  const { t, fill } = useI18n()
  const { scenario, computed, update, store, toast } = useApp()
  const s = useDeferredValue(scenario)
  const [basis, setBasis] = useState<Basis>('real')
  const [hover, setHover] = useState<number | null>(null)
  const res = computed.result
  const infl = inflationRate(s)
  const real = basis === 'real' && s.inflationEnabled

  const fi = useMemo(() => (res ? fiAnalysis(s, res) : null), [s, res])
  const stats = useMemo(() => (res ? incomeStats(res, infl) : null), [res, infl])

  if (!s.withdrawal.enabled) {
    return (
      <div className="retire">
        <RetireHead />
        <section className="card retire-empty">
          <Icon name="target" size={22} />
          <h2 className="section-title">{t.retire.emptyTitle}</h2>
          <p>{t.retire.emptyText}</p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() =>
              update((x) => ({
                ...x,
                withdrawal: {
                  ...x.withdrawal,
                  enabled: true,
                  strategy: 'initialPct',
                  startYear: x.withdrawal.startYear > x.horizonYears ? Math.max(1, x.horizonYears - 9) : x.withdrawal.startYear,
                },
              }))
            }
          >
            {t.retire.emptyCta}
          </button>
        </section>
      </div>
    )
  }

  return (
    <div className="retire">
      <RetireHead />
      <div className="retire-grid">
        {res && stats && (
          <div className="retire-hero">
            <IncomeHero stats={stats} real={real} />
          </div>
        )}
        <aside className="retire-config" aria-label={t.retire.settings}>
          <div className="config">
            <div className="config-body">
              <DesiredIncome />
              <WithdrawalControls showEnable={false} />
            </div>
          </div>
        </aside>
        <div className="retire-main">
          {!res || !stats ? (
            <section className="card">
              <p>{computed.ok ? t.retire.noWithdrawals : t.results.invalid}</p>
            </section>
          ) : (
            <>
              {fi && <FiCard fi={fi} />}
              <section className="card chart-card" aria-labelledby="ret-chart-h">
                <header className="card-head">
                  <div className="title-row">
                    <h2 id="ret-chart-h" className="section-title">
                      {t.retire.chartsTitle}
                    </h2>
                    <HelpTip topic="retirementIncome" label={t.retire.chartsTitle} />
                  </div>
                  {s.inflationEnabled && (
                    <div className="chart-tools">
                      <Segmented
                        size="sm"
                        hideLabel
                        label={t.results.valueMode}
                        value={basis}
                        options={[
                          { value: 'nominal', label: t.results.nominal },
                          { value: 'real', label: t.results.real },
                        ]}
                        onChange={setBasis}
                      />
                      <HelpTip topic="realIncome" label={t.results.valueMode} />
                    </div>
                  )}
                </header>
                <PairedCharts results={[{ res, label: t.retire.base, color: 'var(--c-value)' }]} real={real} hover={hover} onHover={setHover} />
              </section>
              {stats.adjusted.length > 0 && (
                <section className="block" aria-label={t.retire.adjustTitle}>
                  <h2 className="section-title">{t.retire.adjustTitle}</h2>
                  <ul className="insight-list">
                    {stats.adjusted.slice(0, 6).map((a) => (
                      <li key={a.year}>{fill(t.retire.adjust[a.limit], { year: s.withdrawal.startYear + a.year - 1 })}</li>
                    ))}
                    {stats.adjusted.length > 6 && <li>{fill(t.retire.adjustMore, { n: stats.adjusted.length - 6 })}</li>}
                  </ul>
                </section>
              )}
              <StressSection real={real} />
              <StrategyTable
                real={real}
                onCreate={(strategies) => {
                  const room = MAX_SCENARIOS - store.doc.scenarios.length
                  if (room <= 0) {
                    toast(fill(t.compare.max, { max: MAX_SCENARIOS }))
                    return
                  }
                  const base = scenario
                  const add: Scenario[] = strategies
                    .filter((st) => st !== base.withdrawal.strategy)
                    .slice(0, room)
                    .map((st) => ({
                      ...base,
                      id: uid('sc'),
                      name: `${base.name || t.scenario.untitled} · ${t.retire.strategies[st]}`.slice(0, 60),
                      withdrawal: { ...base.withdrawal, strategy: st },
                    }))
                  store.setDoc((d) => ({ ...d, scenarios: [...d.scenarios, ...add] }))
                  onCompare()
                }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function RetireHead() {
  const { t } = useI18n()
  return (
    <header className="view-head">
      <div>
        <div className="title-row">
          <h1 className="view-title">{t.retire.title}</h1>
          <HelpTip topic="financialIndependence" label={t.retire.title} />
        </div>
        <p className="view-sub">{t.retire.subtitle}</p>
      </div>
    </header>
  )
}

function IncomeHero({ stats, real }: { stats: IncomeStats; real: boolean }) {
  const { t, f, fill } = useI18n()
  const { scenario: s, computed } = useApp()
  const money = (v: number) => f.money(v, s.currency)
  const year = s.withdrawal.startYear
  const ev = computed.result ? evaluateIncome(computed.result.withdrawalYears, inflationRate(s), s.retirement.income, s.retirement.real) : null
  const dep = stats.depletedAtMonth
  const pick = (n: number, r: number) => (real ? r : n)
  return (
    <section className="hero" aria-labelledby="ret-hero-h">
      <div className="hero-meta">
        <div className="hero-title">
          <h2 id="ret-hero-h" className="hero-label">
            {t.retire.initialIncome}{' '}
            <span className="hero-when">
              {s.startAge != null ? fill(t.results.inYearAge, { year, age: s.startAge + year - 1 }) : fill(t.results.inYear, { year })}
            </span>
          </h2>
          <HelpTip topic="retirementIncome" label={t.retire.initialIncome} />
        </div>
        <span className="tag">{real ? t.results.real : t.results.nominal}</span>
      </div>
      <p className="hero-value" aria-live="polite" aria-atomic="true">
        {money(pick(stats.initial, stats.initialReal))}
        <span className="hero-unit"> {t.per.monthly}</span>
      </p>
      {ev && (
        <p className={`status-line ${ev.funded ? 'is-pos' : 'is-warn'}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          {ev.funded
            ? fill(t.results.incomeOk, { income: money(s.retirement.income) })
            : fill(t.results.incomeLow, {
                income: money(s.retirement.income),
                year: ev.firstShortIndex != null ? s.withdrawal.startYear + ev.firstShortIndex : '',
                lowest: money(ev.lowest),
              })}
          <span className="status-sub">{s.retirement.real ? t.results.real : t.results.nominal}</span>
          <HelpTip topic="incomeFunding" />
        </p>
      )}
      <dl className="hero-stats">
        <div className="stat">
          <dt>{t.retire.finalIncome}</dt>
          <dd>{money(pick(stats.final, stats.finalReal))}</dd>
        </div>
        <div className="stat">
          <dt>
            {t.retire.lowestIncome}
            <HelpTip topic="lowestIncome" label={t.retire.lowestIncome} />
          </dt>
          <dd>{money(pick(stats.min, stats.minReal))}</dd>
        </div>
        <div className="stat">
          <dt>{t.retire.peakIncome}</dt>
          <dd>{money(pick(stats.max, stats.maxReal))}</dd>
        </div>
        <div className="stat">
          <dt>
            {t.results.withdrawn}
            <HelpTip topic="withdrawn" label={t.results.withdrawn} />
          </dt>
          <dd>{money(stats.totalWithdrawn)}</dd>
        </div>
        <div className="stat">
          <dt>{t.results.endValue}</dt>
          <dd className={dep != null ? 'is-neg' : undefined}>{money(stats.remaining)}</dd>
        </div>
        <div className="stat">
          <dt>
            {dep != null ? t.retire.depletion : t.retire.realChange}
            <HelpTip topic={dep != null ? 'depletion' : 'realIncome'} />
          </dt>
          <dd className={dep != null ? 'is-neg' : stats.realChange < -0.5 ? 'is-warn' : undefined}>
            {dep != null ? fill(t.results.inYear, { year: Math.ceil(dep / 12) }) : f.pct(stats.realChange, 1, true)}
          </dd>
        </div>
      </dl>
    </section>
  )
}

function FiCard({ fi }: { fi: NonNullable<ReturnType<typeof fiAnalysis>> }) {
  const { t, f, fill } = useI18n()
  const { scenario: s } = useApp()
  const money = (v: number) => f.money(v, s.currency)
  const yearAge = (month: number) => {
    const year = Math.max(1, Math.ceil(month / 12))
    return s.startAge != null ? fill(t.results.inYearAge, { year, age: s.startAge + year - 1 }) : fill(t.results.inYear, { year })
  }
  const constant = s.contribMode === 'constant'
  const c = fi.goal.contribution
  return (
    <section className="card fi-card" aria-labelledby="fi-h">
      <header className="card-head">
        <div className="title-row">
          <h2 id="fi-h" className="section-title">
            {t.retire.fiTitle}
          </h2>
          <HelpTip topic="financialIndependence" label={t.retire.fiTitle} />
        </div>
        <span className="chip">
          {money(s.retirement.income)} {t.per.monthly}
          {s.retirement.real ? ` · ${t.results.real}` : ''}
        </span>
      </header>
      <div className="fi-lead">
        <div>
          <span className="fi-k">
            {fill(t.retire.capitalAt, { year: s.withdrawal.startYear })}
            <HelpTip topic="requiredCapital" label={t.retire.capital} />
          </span>
          <span className="fi-v">{money(fi.capital)}</span>
          <span className="fi-s">
            {s.inflationEnabled && `≈ ${money(fi.capitalReal)} ${t.retire.todayShort} · `}
            {fi.method === 'identity' ? fill(t.retire.methodIdentity, { rate: f.pct(s.withdrawal.rate, 2) }) : fill(t.retire.methodSim, { rate: f.pct(fi.impliedRate, 2) })}
          </span>
        </div>
        <div>
          <span className="fi-k">{t.retire.projectedAt}</span>
          <span className="fi-v">{money(fi.projectedAtStart)}</span>
          <span className={`fi-s ${fi.gap > 0 ? 'is-warn' : 'is-pos'}`}>
            {fi.gap > 0 ? fill(t.retire.short, { value: money(fi.gap) }) : fill(t.retire.ahead, { value: money(-fi.gap) })}
          </span>
        </div>
      </div>
      <dl className="tiles">
        <div className="tile">
          <dt>
            {t.retire.fiYear}
            <HelpTip topic="financialIndependence" label={t.retire.fiYear} />
          </dt>
          <dd className="tile-text">
            {fi.fiMonth != null ? yearAge(fi.fiMonth) : t.goal.never}
            {fi.fiMonthWithMore && fi.fiMonthWithMore.month != null && fi.fiMonth != null && fi.fiMonthWithMore.month < fi.fiMonth && (
              <span className="tile-sub">
                {fill(t.retire.withMore, { delta: money(fi.fiMonthWithMore.delta), when: yearAge(fi.fiMonthWithMore.month) })}
              </span>
            )}
          </dd>
        </div>
        <div className="tile">
          <dt>{constant ? t.goal.requiredConstant : t.goal.requiredExtra}</dt>
          <dd className="tile-text">
            {c.status === 'ok'
              ? `${money(c.value)} ${constant ? t.per[s.constant.frequency] : t.per.monthly}`
              : c.status === 'not-needed'
                ? t.goal.notNeeded
                : t.goal.unreachable}
            <span className="tile-sub">{fill(t.retire.toReach, { year: s.withdrawal.startYear })}</span>
          </dd>
        </div>
        <div className="tile">
          <dt>
            {t.retire.sustainTitle}
            <HelpTip topic="incomeFunding" label={t.retire.sustainTitle} />
          </dt>
          <dd className={`tile-text ${fi.sustain.meets ? 'is-pos' : 'is-warn'}`}>
            {fi.sustain.meets ? t.retire.sustainYes : fill(t.retire.sustainNo, { year: fi.sustain.firstShortYear ?? '' })}
          </dd>
        </div>
      </dl>
      <p className="note">{t.retire.fiNote}</p>
    </section>
  )
}

function PairedCharts({
  results,
  real,
  hover,
  onHover,
}: {
  results: { res: SimResult; label: string; color: string; dashed?: boolean }[]
  real: boolean
  hover: number | null
  onHover: (i: number | null) => void
}) {
  const { t, f, fill } = useI18n()
  const { scenario: s } = useApp()
  const H = totalMonths(s)
  const infl = inflationRate(s)
  const xs = useMemo(() => Array.from({ length: H + 1 }, (_, m) => m), [H])
  const start = (s.withdrawal.startYear - 1) * 12
  const end = s.withdrawal.endYear != null ? Math.min(H, s.withdrawal.endYear * 12) : H
  const money = (v: number) => f.money(v, s.currency)
  const title = (m: number) => {
    if (m === 0) return t.chart.start
    const year = f.num(m / 12, m % 12 ? 1 : 0)
    return s.startAge != null ? fill(t.chart.yearAge, { year, age: f.num(s.startAge + m / 12, m % 12 ? 1 : 0) }) : fill(t.chart.year, { year })
  }
  const tick = (y: number) => (s.startAge != null ? String(s.startAge + y) : String(y))
  const deflate = (v: number, m: number) => (real ? v / Math.pow(1 + infl, m / 12) : v)

  const portfolio: Series[] = results.map((r, i) => ({
    id: `p${i}`,
    label: r.label,
    color: r.color,
    kind: i === 0 ? 'area' : 'line',
    dashed: r.dashed,
    values: Array.from(r.res.balances, (b, m) => deflate(b, m)),
    width: 2,
  }))
  const income: Series[] = results.flatMap((r, i) => {
    const paid = incomeSeries(r.res, H, infl, real)
    const req = incomeSeries(r.res, H, infl, real, true)
    const short = req.some((v, m) => Number.isFinite(v) && v > paid[m] + 0.5)
    const out: Series[] = [{ id: `i${i}`, label: results.length > 1 ? r.label : t.retire.incomePaid, color: r.color, kind: i === 0 ? 'area' : 'line', dashed: r.dashed, values: paid, width: 2 }]
    if (short && i === 0)
      out.push({ id: `r${i}`, label: t.retire.incomeRequested, color: 'var(--c-warn)', kind: 'line', dashed: true, values: req, width: 1.5 })
    return out
  })
  const region = [{ start, end, label: t.withdrawal.title }]
  const desired = s.retirement.real === real || !s.inflationEnabled ? { value: s.retirement.income, label: `${t.retire.desiredShort} ${f.money(s.retirement.income, s.currency, { compact: true })}` } : null
  const dep = results[0].res.totals.depletedAtMonth
  return (
    <div className="paired">
      <p className="mini-title">{real ? t.chart.valueReal : t.chart.value}</p>
      <XYChart
        xs={xs}
        series={portfolio}
        height={250}
        regions={region}
        markers={dep != null ? [{ month: dep, label: t.retire.depletion, tone: 'neg' }] : []}
        ariaLabel={`${t.chart.value}: ${results.map((r) => `${r.label} ${money(r.res.totals.final)}`).join(', ')}`}
        yFormat={(v) => f.compact(v)}
        tooltipFormat={money}
        xTickLabel={tick}
        tooltipTitle={title}
        hoverIndex={hover}
        onHover={onHover}
      />
      <p className="mini-title">
        {t.retire.incomeChart} · {real ? t.results.real : t.results.nominal}
      </p>
      <XYChart
        xs={xs}
        series={income}
        height={200}
        regions={region}
        goal={desired}
        ariaLabel={`${t.retire.incomeChart}. ${results.map((r) => r.label).join(', ')}`}
        yFormat={(v) => f.compact(v)}
        tooltipFormat={(v) => `${money(v)} ${t.per.monthly}`}
        xTickLabel={tick}
        tooltipTitle={title}
        hoverIndex={hover}
        onHover={onHover}
      />
    </div>
  )
}

function StressSection({ real }: { real: boolean }) {
  const { t, f, lang } = useI18n()
  const { scenario } = useApp()
  const s = useDeferredValue(scenario)
  const [kind, setKind] = useState<StressKind>('crash30')
  const [customText, setCustomText] = useState('-20; -10; 0; 5')
  const [hover, setHover] = useState<number | null>(null)
  const custom = useMemo(
    () =>
      customText
        .split(/[;\s]+/)
        .map((x) => parseNumber(x, lang))
        .filter((x): x is number => x !== null && x > -100 && x < 1000)
        .slice(0, 30),
    [customText, lang],
  )
  const st = useMemo(() => stressTest(s, kind, custom), [s, kind, custom])
  if (!st || !st.baseStats || !st.stressStats) return null
  const money = (v: number) => f.money(v, s.currency)
  const b = st.baseStats
  const x = st.stressStats
  const pick = (a: IncomeStats, key: 'initial' | 'min' | 'final') => (real ? a[`${key}Real` as const] : a[key])
  const rows: { label: string; base: string; stress: string; worse?: boolean }[] = [
    { label: t.retire.initialIncome, base: money(pick(b, 'initial')), stress: money(pick(x, 'initial')), worse: pick(x, 'initial') < pick(b, 'initial') - 0.5 },
    { label: t.retire.lowestIncome, base: money(pick(b, 'min')), stress: money(pick(x, 'min')), worse: pick(x, 'min') < pick(b, 'min') - 0.5 },
    { label: t.retire.finalIncome, base: money(pick(b, 'final')), stress: money(pick(x, 'final')), worse: pick(x, 'final') < pick(b, 'final') - 0.5 },
    { label: t.results.withdrawn, base: money(b.totalWithdrawn), stress: money(x.totalWithdrawn), worse: x.totalWithdrawn < b.totalWithdrawn - 0.5 },
    { label: t.results.endValue, base: money(b.remaining), stress: money(x.remaining), worse: x.remaining < b.remaining - 0.5 },
    {
      label: t.retire.depletion,
      base: b.depletedAtMonth != null ? String(Math.ceil(b.depletedAtMonth / 12)) : t.retire.never,
      stress: x.depletedAtMonth != null ? String(Math.ceil(x.depletedAtMonth / 12)) : t.retire.never,
      worse: x.depletedAtMonth != null && (b.depletedAtMonth == null || x.depletedAtMonth < b.depletedAtMonth),
    },
  ]
  return (
    <section className="card" aria-labelledby="stress-h">
      <header className="card-head">
        <div className="title-row">
          <h2 id="stress-h" className="section-title">
            {t.retire.stressTitle}
          </h2>
          <HelpTip topic="stressTest" label={t.retire.stressTitle} />
          <HelpTip topic="sequenceRisk" label={t.retire.sequence} />
        </div>
        <span className="tag">{t.retire.hypothetical}</span>
      </header>
      <div className="stress-kinds" role="radiogroup" aria-label={t.retire.stressTitle}>
        {STRESS_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className="chip-btn" onClick={() => setKind(k)}>
            {t.retire.stress[k]}
          </button>
        ))}
      </div>
      {kind === 'custom' && (
        <label className="stress-custom">
          <span className="nf-label">{t.retire.customLabel}</span>
          <input className="stress-input" value={customText} onChange={(e) => setCustomText(e.target.value)} inputMode="text" spellCheck={false} />
          <span className="note">{t.retire.customHint}</span>
        </label>
      )}
      <p className="stress-desc">{t.retire.stressDesc[kind]}</p>
      <div className="table-scroll">
        <table className="ctable">
          <thead>
            <tr>
              <th scope="col">{t.compare.metric}</th>
              <th scope="col">{t.retire.base}</th>
              <th scope="col">{t.retire.stressed}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>
                  <span className="ct-val">{r.base}</span>
                </td>
                <td>
                  <span className={`ct-val${r.worse ? ' is-neg' : ''}`}>{r.stress}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PairedCharts
        results={[
          { res: st.base, label: t.retire.base, color: 'var(--c-value)' },
          { res: st.stress, label: t.retire.stressed, color: 'var(--c-neg)', dashed: true },
        ]}
        real={real}
        hover={hover}
        onHover={setHover}
      />
    </section>
  )
}

function StrategyTable({ real, onCreate }: { real: boolean; onCreate: (s: WithdrawalStrategy[]) => void }) {
  const { t, f } = useI18n()
  const { scenario } = useApp()
  const s = useDeferredValue(scenario)
  const rows = useMemo(() => compareStrategies(s), [s])
  if (!rows.length) return null
  const infl = inflationRate(s)
  const money = (v: number) => f.money(v, s.currency)
  return (
    <section className="card" aria-labelledby="strat-h">
      <header className="card-head">
        <div className="title-row">
          <h2 id="strat-h" className="section-title">
            {t.retire.strategyTitle}
          </h2>
          <HelpTip topic="strategyCompare" label={t.retire.strategyTitle} />
        </div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => onCreate(rows.map((r) => r.strategy))}>
          <Icon name="layers" size={15} />
          {t.retire.openCompare}
        </button>
      </header>
      <div className="table-scroll">
        <table className="ctable">
          <thead>
            <tr>
              <th scope="col">{t.compare.metric}</th>
              {rows.map((r) => (
                <th key={r.strategy} scope="col" className={r.strategy === s.withdrawal.strategy ? 'is-current' : undefined}>
                  {t.retire.strategies[r.strategy]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(
              [
                [t.retire.initialIncome, (st: IncomeStats) => money(real ? st.initialReal : st.initial)],
                [t.retire.lowestIncome, (st: IncomeStats) => money(real ? st.minReal : st.min)],
                [t.retire.finalIncome, (st: IncomeStats) => money(real ? st.finalReal : st.final)],
                [t.results.withdrawn, (st: IncomeStats) => money(st.totalWithdrawn)],
                [t.results.endValue, (st: IncomeStats) => money(st.remaining)],
                [t.retire.depletion, (st: IncomeStats) => (st.depletedAtMonth != null ? String(Math.ceil(st.depletedAtMonth / 12)) : t.retire.never)],
              ] as [string, (st: IncomeStats) => string][]
            ).map(([label, fn]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                {rows.map((r) => (
                  <td key={r.strategy}>
                    <span className="ct-val">{r.stats ? fn(r.stats) : '—'}</span>
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row">{t.retire.fundsIncome}</th>
              {rows.map((r) => {
                const ev = evaluateIncome(r.result.withdrawalYears, infl, s.retirement.income, s.retirement.real)
                return (
                  <td key={r.strategy}>
                    <span className={`ct-val ${ev.funded ? 'is-pos' : 'is-warn'}`}>{ev.funded ? t.retire.yes : t.retire.no}</span>
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="note">{t.retire.strategyNote}</p>
    </section>
  )
}
