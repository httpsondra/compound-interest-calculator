import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../../i18n'
import { runMonteCarlo, type MonteCarloInput, type MonteCarloResult } from '../../engine/montecarlo'
import { incomeTarget, inflationRate, totalMonths } from '../../model/scenario'
import { incomeStats } from '../../model/retirement'
import { axisUnit, chartTitle } from '../chart/time'
import { McRunner, type WorkerLike } from './mcRunner'
import { useApp } from '../../state/context'
import { XYChart, type Series } from '../chart/XYChart'
import { Icon } from '../ui/Icon'
import { NumberField } from '../ui/NumberField'
import { Segmented } from '../ui/controls'
import { HelpTip } from '../ui/HelpTip'

const SIM_OPTIONS = ['500', '1000', '2500', '5000'] as const

/**
 * One runner for the whole page: a worker that hung is not trusted again when the user leaves and
 * returns to this view. Unmounting only cancels pending work and terminates the current worker.
 */
let runnerInstance: McRunner | null = null
function sharedRunner(): McRunner {
  if (!runnerInstance) {
    runnerInstance = new McRunner(
      typeof Worker === 'undefined' ? null : () => new Worker(new URL('./mc.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
      runMonteCarlo,
    )
  }
  return runnerInstance
}

export default function RiskView() {
  const i18n = useI18n()
  const { t, f, fill, duration } = i18n
  const { scenario: s, computed, update } = useApp()
  const [vol, setVol] = useState(15)
  const [sims, setSims] = useState<(typeof SIM_OPTIONS)[number]>('1000')
  const [seed, setSeed] = useState(20261113)
  const [result, setResult] = useState<MonteCarloResult | null>(null)
  const [running, setRunning] = useState(false)
  const reqId = useRef(0)
  const runner = useRef<McRunner | null>(null)
  if (runner.current === null) runner.current = sharedRunner()
  const plan = computed.plan

  useEffect(() => () => runner.current?.dispose(), [])

  const H = totalMonths(s)
  const target = incomeTarget(s)
  const incomeMonthly = target?.monthly ?? 0
  // Without a goal Monte Carlo reports income in today's money (its default), so label it that way.
  const incomeReal = target ? target.real : inflationRate(s) !== 0
  const goal = s.goal.enabled && s.goal.year * 12 <= H ? { target: s.goal.target, month: s.goal.year * 12, real: s.goal.real } : null

  useEffect(() => {
    if (!plan) return
    const input: MonteCarloInput = {
      plan,
      volatility: vol / 100,
      simulations: Number(sims),
      seed,
      goal,
      income: plan.withdrawal && target ? { monthly: incomeMonthly, real: incomeReal } : null,
    }
    setRunning(true)
    // The ID advances the moment the inputs change, so a result for the previous inputs can never be
    // shown as current, even if it arrives during the debounce window.
    const id = ++reqId.current
    const timer = window.setTimeout(() => {
      runner.current?.request(input, (r) => {
        if (id === reqId.current) {
          setResult(r)
          setRunning(false)
        }
      })
    }, 220)
    return () => window.clearTimeout(timer)
  }, [plan, vol, sims, seed, goal?.target, goal?.month, goal?.real, target != null, incomeMonthly, incomeReal]) // eslint-disable-line react-hooks/exhaustive-deps

  const money = (v: number) => f.money(v, s.currency)
  const compact = (v: number) => f.money(v, s.currency, { compact: true })
  const extra = {
    vol,
    median: result?.finalPercentiles.p50,
    p10: result?.finalPercentiles.p10,
    p90: result?.finalPercentiles.p90,
    goalProb: result?.goalProbability,
  }
  const det = computed.result
  const arith = ((1 + s.annualReturn / 100) * Math.exp(Math.pow(vol / 100, 2) / 2) - 1) * 100
  const startIncome = useMemo(() => {
    const st = det && plan?.withdrawal ? incomeStats(det, inflationRate(s)) : null
    return st ? (incomeReal ? st.initialReal : st.initial) : null
  }, [det, plan, s, incomeReal])
  const pctStrategy = s.withdrawal.enabled && s.withdrawal.strategy !== 'fixed'

  let series: Series[] = []
  if (result && det) {
    series = [
      { id: 'b80', label: t.risk.band80, color: 'var(--c-value)', kind: 'band', values: result.bands.p90, lower: result.bands.p10, fillColor: 'var(--accent-soft)', quiet: true },
      { id: 'b50', label: t.risk.band50, color: 'var(--c-value)', kind: 'band', values: result.bands.p75, lower: result.bands.p25, fillColor: 'var(--accent-soft-2)', quiet: true },
      { id: 'p90', label: t.risk.lineUp, color: 'var(--c-value)', kind: 'line', values: result.bands.p90, width: 1, dashed: false },
      { id: 'p50', label: t.risk.lineMid, color: 'var(--c-value)', kind: 'line', values: result.bands.p50, width: 2.5 },
      { id: 'p10', label: t.risk.lineDown, color: 'var(--c-value)', kind: 'line', values: result.bands.p10, width: 1 },
      { id: 'det', label: t.risk.deterministic, color: 'var(--c-contrib)', kind: 'line', values: result.months.map((m) => det.balances[m]), dashed: true, width: 1.75, noEndLabel: true },
    ]
  }

  // Set an income target without leaving the page: switches the goal on (its last value is kept) and goes to the field.
  const goSetTarget = () => {
    update((x) => ({ ...x, retirement: { ...x.retirement, enabled: true } }))
    window.location.hash = '#/retirement'
    // The planner loads lazily: wait for its goal field, then focus it so the user confirms or types the value.
    let tries = 0
    const timer = window.setInterval(() => {
      const el = document.getElementById('f-goal') as HTMLInputElement | null
      if (el || ++tries > 30) {
        window.clearInterval(timer)
        el?.scrollIntoView({ block: 'center' })
        el?.focus()
      }
    }, 100)
  }

  return (
    <div className="risk">
      <header className="view-head">
        <div>
          <div className="title-row">
            <h1 className="view-title">{t.risk.title}</h1>
            <HelpTip topic="monteCarlo" label={t.risk.title} />
          </div>
          <p className="view-sub">{t.risk.subtitle}</p>
        </div>
      </header>

      {!plan ? (
        <section className="card">
          <p>{t.results.invalid}</p>
        </section>
      ) : (
        <div className="risk-grid">
          <section className="card risk-controls" aria-label={t.inputs.heading}>
            <NumberField
              id="f-vol"
              label={t.risk.volatility}
              help="volatility"
              helpExtra={{ vol }}
              value={vol}
              min={0}
              max={80}
              step={1}
              decimals={1}
              suffix="%"
              slider={{ min: 0, max: 40, step: 1 }}
              onChange={setVol}
            />
            <div className="risk-return">
              <span className="nf-label">{t.risk.expectedReturn}</span>
              <span className="risk-return-val">{f.pct(s.annualReturn, 2)}</span>
              <HelpTip topic="riskReturn" label={t.risk.expectedReturn} />
            </div>
            <details className="model-note">
              <summary>{t.risk.settings}</summary>
              <div className="risk-settings">
                <Segmented
                  label={t.risk.simulations}
                  help="simulations"
                  size="sm"
                  value={sims}
                  options={SIM_OPTIONS.map((v) => ({ value: v, label: f.num(Number(v)) }))}
                  onChange={setSims}
                />
                <div className="seed-row">
                  <span className="note">{fill(t.risk.seed, { seed })}</span>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSeed(Math.floor(Math.random() * 2 ** 31))}>
                    <Icon name="reset" size={15} />
                    {t.risk.rerun}
                  </button>
                </div>
              </div>
            </details>
            <details className="model-note">
              <summary>{t.risk.model}</summary>
              <p>{fill(t.risk.modelText, { arith: f.pct(arith, 2) })}</p>
            </details>
          </section>

          <div className={`risk-results${running ? ' is-stale' : ''}`} aria-busy={running}>
            <h2 className="sr-only">{t.risk.title}</h2>
            {!result ? (
              <section className="card">
                <p className="note">{t.risk.running}</p>
              </section>
            ) : (
              <>
                {running && (
                  <p className="risk-running" role="status">
                    {t.risk.running}
                  </p>
                )}
                {result.lowestIncome && (
                  <section className="card" aria-labelledby="risk-income-h">
                    <div className="title-row">
                      <h2 id="risk-income-h" className="section-title">
                        {t.risk.incomeTitle}
                      </h2>
                      <span className="tag">{incomeReal ? t.results.real : t.results.nominal}</span>
                    </div>
                    {result.incomeProbability != null ? (
                      <div className="lead-q">
                        <p className="lead-q-text">
                          {fill(t.risk.incomeChance, { income: money(incomeMonthly) })}
                          <HelpTip topic="incomeProbability" label={t.risk.incomeProbLabel} />
                        </p>
                        <p className={`lead-q-val ${result.incomeProbability < 0.75 ? 'is-warn' : 'is-pos'}`}>{f.pct(result.incomeProbability * 100, 0)}</p>
                        <div className="meter" aria-hidden="true">
                          <span className={result.incomeProbability < 0.75 ? 'is-warn' : 'is-pos'} style={{ width: `${Math.round(result.incomeProbability * 100)}%` }} />
                        </div>
                      </div>
                    ) : (
                      <p className="lead-q-none">
                        {t.risk.incomeNoTarget}{' '}
                        <button type="button" className="link-btn" onClick={goSetTarget}>
                          {t.risk.setTarget}
                        </button>
                      </p>
                    )}
                    {startIncome === 0 ? (
                      <p className="note">{t.retire.noIncome}</p>
                    ) : (
                      <>
                    <div className="trio-head">
                      <h3 className="mini-title">{t.risk.lowestTitle} · {incomeReal ? t.results.real : t.results.nominal}</h3>
                      <HelpTip topic="lowestIncome" label={t.risk.lowestIncome} />
                    </div>
                    <Trio
                      items={[
                        { label: t.risk.downside, sub: t.risk.downsideSub, value: money(result.lowestIncome.p10) },
                        { label: t.risk.typical, sub: t.risk.typicalSub, value: money(result.lowestIncome.p50), lead: true },
                        { label: t.risk.upside, sub: t.risk.upsideSub, value: money(result.lowestIncome.p90) },
                      ]}
                      unit={t.per.monthly}
                    />
                      </>
                    )}
                    {startIncome != null && startIncome > 0 && (
                      <p className="note">
                        {fill(t.risk.startsAt, { value: money(startIncome) })}
                        {startIncome > 0 && result.lowestIncome.p10 < startIncome * 0.7 && (
                          <>
                            {' · '}
                            <span className="is-warn">{fill(t.risk.incomeDrop, { pct: f.pct((1 - result.lowestIncome.p10 / startIncome) * 100, 0) })}</span>
                          </>
                        )}
                      </p>
                    )}
                    {result.depletionProbability != null && (
                      <div className="depl">
                        <div className="depl-row">
                          <span className="depl-k">
                            {t.risk.depletionProb}
                            <HelpTip topic="depletionProbability" label={t.risk.depletionProb} />
                          </span>
                          <span className={`depl-v${result.depletionProbability > 0.1 ? ' is-neg' : ''}`}>{result.depletionProbability === 0 ? fill(t.risk.noneIn, { n: f.num(result.simulations) }) : result.depletionProbability < 0.005 ? '<1 %' : f.pct(result.depletionProbability * 100, 0)}</span>
                        </div>
                        {pctStrategy && <p className="note depl-caution">{t.risk.depletionCaution}</p>}
                      </div>
                    )}
                  </section>
                )}

                <section className="card chart-card" aria-labelledby="risk-h">
                  <div className="title-row">
                    <h2 id="risk-h" className="section-title">
                      {t.risk.outcomesTitle}
                    </h2>
                    <HelpTip topic="percentiles" label={t.risk.percentiles} extra={extra} />
                  </div>
                  <Trio
                    items={[
                      { label: t.risk.downside, sub: t.risk.downsideSub, value: money(result.finalPercentiles.p10) },
                      { label: t.risk.typical, sub: t.risk.typicalSub, value: money(result.finalPercentiles.p50), lead: true, help: <HelpTip topic="median" label={t.risk.median} extra={extra} /> },
                      { label: t.risk.upside, sub: t.risk.upsideSub, value: money(result.finalPercentiles.p90) },
                    ]}
                  />
                  {result.goalProbability != null && goal && (
                    <p className="goal-line">
                      <span>{fill(t.risk.goalProb, { year: s.goal.year })}</span>
                      <HelpTip topic="goalProbability" label={t.risk.goalProbLabel} extra={extra} />
                      <strong>{f.pct(result.goalProbability * 100, 0)}</strong>
                    </p>
                  )}
                  <ul className="legend">
                    <li>
                      <span className="legend-item">
                        <span className="legend-swatch" style={{ ['--sw' as string]: 'var(--c-value)' }} />
                        {t.risk.lineMid}
                      </span>
                    </li>
                    <li>
                      <span className="legend-item">
                        <span className="legend-swatch legend-swatch--band" />
                        {t.risk.band50} / {t.risk.band80}
                      </span>
                    </li>
                    <li>
                      <span className="legend-item">
                        <span className="legend-swatch legend-swatch--dashed" style={{ ['--sw' as string]: 'var(--c-contrib)' }} />
                        {t.risk.deterministic}
                      </span>
                    </li>
                  </ul>
                  <XYChart
                    xs={result.months}
                    series={series}
                    height={320}
                    ariaLabel={`${t.risk.chartLabel} ${t.risk.median}: ${money(result.finalPercentiles.p50)}.`}
                    yFormat={(v) => f.compact(v)}
                    endFormat={compact}
                    tooltipFormat={money}
                    xTickLabel={(y) => (s.startAge != null ? String(s.startAge + y) : String(y))}
                    xUnit={axisUnit(i18n, s.startAge)}
                    tooltipTitle={chartTitle(i18n, s.startAge)}
                    keyStepMonths={12}
                  />
                  <details className="model-note">
                    <summary>{t.risk.allPercentiles}</summary>
                    <table className="ctable ctable--compact">
                      <tbody>
                        {(['p5', 'p10', 'p25', 'p50', 'p75', 'p90', 'p95'] as const).map((k) => (
                          <tr key={k}>
                            <th scope="row">{fill(t.risk.pct, { p: k.slice(1) })}</th>
                            <td>{money(result.finalPercentiles[k])}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                  <p className="note">
                    {f.num(result.simulations)} × {duration(H)} · {t.results.hypothetical}
                  </p>
                </section>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Downside / typical / upside, as one calm row: the typical outcome leads, the others frame it. */
function Trio({ items, unit }: { items: { label: string; sub: string; value: string; lead?: boolean; help?: ReactNode }[]; unit?: string }) {
  return (
    <dl className="trio">
      {items.map((it) => (
        <div key={it.label} className={`trio-i${it.lead ? ' is-lead' : ''}`}>
          <dt>
            {it.label}
            {it.help}
          </dt>
          <dd>
            {it.value}
            {unit && <span className="tile-unit"> {unit}</span>}
          </dd>
          <dd className="trio-sub">{it.sub}</dd>
        </div>
      ))}
    </dl>
  )
}
