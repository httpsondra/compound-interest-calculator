import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { runMonteCarlo, type MonteCarloInput, type MonteCarloResult } from '../../engine/montecarlo'
import { totalMonths } from '../../model/scenario'
import { useApp } from '../../state/context'
import { XYChart, type Series } from '../chart/XYChart'
import { Icon } from '../ui/Icon'
import { NumberField } from '../ui/NumberField'
import { Segmented } from '../ui/controls'

const SIM_OPTIONS = ['500', '1000', '2500', '5000'] as const

export default function RiskView() {
  const { t, f, fill, duration } = useI18n()
  const { scenario: s, computed } = useApp()
  const [vol, setVol] = useState(15)
  const [sims, setSims] = useState<(typeof SIM_OPTIONS)[number]>('1000')
  const [seed, setSeed] = useState(20261113)
  const [result, setResult] = useState<MonteCarloResult | null>(null)
  const [running, setRunning] = useState(false)
  const workerRef = useRef<Worker | null>(null)
  const reqId = useRef(0)
  const plan = computed.plan

  useEffect(() => {
    try {
      workerRef.current = new Worker(new URL('./mc.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      workerRef.current = null
    }
    return () => workerRef.current?.terminate()
  }, [])

  const H = totalMonths(s)
  const goal = s.goal.enabled && s.goal.year * 12 <= H ? { target: s.goal.target, month: s.goal.year * 12, real: s.goal.real } : null

  useEffect(() => {
    if (!plan) return
    const id = ++reqId.current
    const input: MonteCarloInput = { plan, volatility: vol / 100, simulations: Number(sims), seed, goal }
    setRunning(true)
    const timer = window.setTimeout(() => {
      const w = workerRef.current
      const runHere = () => {
        // Fallback when the worker cannot load (old browser, blocked script): compute on the main thread.
        workerRef.current?.terminate()
        workerRef.current = null
        const r = runMonteCarlo(input)
        if (id === reqId.current) {
          setResult(r)
          setRunning(false)
        }
      }
      if (w) {
        w.onmessage = (e: MessageEvent<{ id: number; result: MonteCarloResult }>) => {
          if (e.data.id === reqId.current) {
            setResult(e.data.result)
            setRunning(false)
          }
        }
        w.onerror = (ev) => {
          ev.preventDefault()
          runHere()
        }
        w.onmessageerror = runHere
        w.postMessage({ id, input })
      } else {
        const r = runMonteCarlo(input)
        if (id === reqId.current) {
          setResult(r)
          setRunning(false)
        }
      }
    }, 220)
    return () => window.clearTimeout(timer)
  }, [plan, vol, sims, seed, goal?.target, goal?.month, goal?.real]) // eslint-disable-line react-hooks/exhaustive-deps

  const money = (v: number) => f.money(v, s.currency)
  const det = computed.result
  const arith = ((1 + s.annualReturn / 100) * Math.exp(Math.pow(vol / 100, 2) / 2) - 1) * 100

  let series: Series[] = []
  if (result && det) {
    series = [
      { id: 'b80', label: t.risk.band80, color: 'var(--c-value)', kind: 'band', values: result.bands.p90, lower: result.bands.p10, fillColor: 'var(--accent-soft)', quiet: true },
      { id: 'b50', label: t.risk.band50, color: 'var(--c-value)', kind: 'band', values: result.bands.p75, lower: result.bands.p25, fillColor: 'var(--accent-soft-2)', quiet: true },
      { id: 'p90', label: fill(t.risk.pct, { p: 90 }), color: 'var(--c-value)', kind: 'line', values: result.bands.p90, width: 1, dashed: false },
      { id: 'p50', label: t.risk.median, color: 'var(--c-value)', kind: 'line', values: result.bands.p50, width: 2.5 },
      { id: 'p10', label: fill(t.risk.pct, { p: 10 }), color: 'var(--c-value)', kind: 'line', values: result.bands.p10, width: 1 },
      { id: 'det', label: t.risk.deterministic, color: 'var(--c-contrib)', kind: 'line', values: result.months.map((m) => det.balances[m]), dashed: true, width: 1.75 },
    ]
  }

  return (
    <div className="risk">
      <header className="view-head">
        <div>
          <h1 className="view-title">{t.risk.title}</h1>
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
              help={t.risk.volatilityHelp}
              value={vol}
              min={0}
              max={80}
              step={1}
              decimals={1}
              suffix="%"
              slider={{ min: 0, max: 40, step: 1 }}
              onChange={setVol}
            />
            <Segmented
              label={t.risk.simulations}
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
            <details className="model-note">
              <summary>{t.risk.model}</summary>
              <p>{fill(t.risk.modelText, { arith: f.pct(arith, 2) })}</p>
            </details>
          </section>

          <section className={`card risk-results${running ? ' is-stale' : ''}`} aria-busy={running} aria-labelledby="risk-h">
            <h2 id="risk-h" className="sr-only">
              {t.risk.title}
            </h2>
            {result ? (
              <>
                <dl className="tiles tiles--risk">
                  <div className="tile tile--lead">
                    <dt>{t.risk.median}</dt>
                    <dd>{money(result.finalPercentiles.p50)}</dd>
                  </div>
                  <div className="tile">
                    <dt>{t.risk.range}</dt>
                    <dd className="tile-text">
                      {money(result.finalPercentiles.p10)} – {money(result.finalPercentiles.p90)}
                    </dd>
                  </div>
                  {result.goalProbability != null && goal && (
                    <div className="tile">
                      <dt>{fill(t.risk.goalProb, { year: s.goal.year })}</dt>
                      <dd>{f.pct(result.goalProbability * 100, 0)}</dd>
                    </div>
                  )}
                  {result.depletionProbability != null && (
                    <div className="tile">
                      <dt>{t.risk.depletionProb}</dt>
                      <dd className={result.depletionProbability > 0.1 ? 'is-neg' : undefined}>{f.pct(result.depletionProbability * 100, 0)}</dd>
                    </div>
                  )}
                </dl>
                <ul className="legend">
                  <li>
                    <span className="legend-item">
                      <span className="legend-swatch" style={{ ['--sw' as string]: 'var(--c-value)' }} />
                      {t.risk.median}
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
                  height={340}
                  ariaLabel={`${t.risk.chartLabel} ${t.risk.median}: ${money(result.finalPercentiles.p50)}.`}
                  yFormat={(v) => f.compact(v)}
                  tooltipFormat={money}
                  xTickLabel={(y) => (s.startAge != null ? String(s.startAge + y) : String(y))}
                  tooltipTitle={(m) => (m === 0 ? t.chart.start : fill(t.chart.year, { year: f.num(m / 12, m % 12 ? 1 : 0) }))}
                  keyStepMonths={12}
                />
                <h3 className="mini-title">{t.risk.percentiles}</h3>
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
                <p className="note">
                  {f.num(result.simulations)} × {duration(H)} · {t.results.hypothetical}
                </p>
              </>
            ) : (
              <p className="note">{t.risk.running}</p>
            )}
            {running && result && <p className="risk-running" role="status">{t.risk.running}</p>}
          </section>
        </div>
      )}
    </div>
  )
}
