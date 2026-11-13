import type { Ref } from 'react'
import { useI18n } from '../../i18n'
import { toReal } from '../../engine/simulate'
import { withdrawalSummary } from '../../model/compute'
import { incomeCheck } from '../../model/retirement'
import { inflationRate, totalMonths } from '../../model/scenario'
import { useApp } from '../../state/context'
import { HelpTip } from '../ui/HelpTip'

/**
 * The projection headline. In accumulation plans the headline is the final
 * value; in plans with withdrawals it is the value when withdrawals begin,
 * with the outcome of the withdrawal phase stated right below — so a
 * correctly depleted €0 ending value never dominates without context.
 */
export function ResultsHero({ heroRef }: { heroRef?: Ref<HTMLElement> }) {
  const { t, f, fill, duration } = useI18n()
  const { scenario: s, computed, stale } = useApp()
  const res = computed.result
  const H = totalMonths(s)

  if (!res) {
    return (
      <section className="hero hero--invalid" ref={heroRef} aria-labelledby="hero-h">
        <h2 id="hero-h" className="hero-label">
          {t.results.projected}
        </h2>
        <p className="hero-invalid" role="alert">
          {t.results.invalid}
        </p>
      </section>
    )
  }

  const tot = res.totals
  const money = (v: number) => f.money(v, s.currency)
  const ws = withdrawalSummary(s, res)
  const yearAge = (month: number) => {
    const year = Math.floor(month / 12) + 1
    return s.startAge != null ? fill(t.results.inYearAge, { year, age: s.startAge + year - 1 }) : fill(t.results.inYear, { year })
  }

  if (ws) {
    const dep = tot.depletedAtMonth
    const depYear = dep != null ? Math.ceil(dep / 12) : null
    const showPeak = ws.peak > ws.startValue * 1.005
    // Percentage-of-portfolio policies rarely hit zero even when income collapses:
    // judge them by the income they pay, not by whether the balance stays positive.
    const incomeBased = s.withdrawal.strategy === 'currentPct' || s.withdrawal.strategy === 'guardrails'
    const check = incomeBased ? incomeCheck(s, res) : null
    return (
      <section className={`hero${stale ? ' is-stale' : ''}`} ref={heroRef} aria-labelledby="hero-h">
        <div className="hero-meta">
          <div className="hero-title">
            <h2 id="hero-h" className="hero-label">
              {t.results.atWithdrawalStart} <span className="hero-when">{yearAge(ws.startMonth)}</span>
            </h2>
            <HelpTip topic="withdrawalStartValue" label={t.results.atWithdrawalStart} />
          </div>
          <span className="tag">
            {t.results.hypothetical}
            <HelpTip topic="assumptions" label={t.results.hypothetical} />
          </span>
        </div>
        <p className="hero-value" aria-live="polite" aria-atomic="true">
          <span className="sr-only">{t.results.atWithdrawalStart}: </span>
          {money(ws.startValue)}
        </p>
        {s.inflationEnabled && (
          <p className="hero-real">
            {fill(t.results.todayMoney, { value: money(toReal(ws.startValue, ws.startMonth, inflationRate(s))) })}
            <HelpTip topic="todayMoney" label={t.results.real} />
          </p>
        )}
        {incomeBased && check ? (
          <p className={`status-line ${check.funded ? 'is-pos' : 'is-warn'}`} role="status">
            <span className="status-dot" aria-hidden="true" />
            {check.funded
              ? fill(t.results.incomeOk, { income: money(s.retirement.income) })
              : fill(t.results.incomeLow, { income: money(s.retirement.income), year: check.firstShortYear ?? '', lowest: money(check.lowest) })}
            <span className="status-sub">{s.retirement.real ? t.results.real : t.results.nominal}</span>
            <HelpTip topic="incomeFunding" />
          </p>
        ) : (
          <p className={`status-line ${dep != null ? 'is-neg' : 'is-pos'}`} role="status">
            <span className="status-dot" aria-hidden="true" />
            {depYear != null
              ? s.startAge != null
                ? fill(t.results.runsOutAge, { year: depYear, age: s.startAge + depYear - 1 })
                : fill(t.results.runsOut, { year: depYear })
              : t.results.lastsAll}
            {dep == null && tot.final > 0 && <span className="status-sub">{fill(t.results.endLeft, { value: money(tot.final) })}</span>}
            <HelpTip topic="depletion" />
          </p>
        )}
        <dl className="hero-stats">
          <div className="stat">
            <dt>
              {t.results.withdrawn}
              <HelpTip topic="withdrawn" label={t.results.withdrawn} />
            </dt>
            <dd>{money(tot.withdrawn)}</dd>
          </div>
          <div className="stat">
            <dt>
              {t.results.endValue}
              <HelpTip topic="endValue" label={t.results.endValue} />
            </dt>
            <dd className={dep != null ? 'is-neg' : undefined}>{money(tot.final)}</dd>
          </div>
          <div className="stat">
            <dt>
              <span className="dot dot--contrib" aria-hidden="true" />
              {t.results.contributed}
              <HelpTip topic="contributed" label={t.results.contributed} />
            </dt>
            <dd>{money(tot.contributed)}</dd>
          </div>
          {showPeak && (
            <div className="stat">
              <dt>
                {t.results.peak}
                <HelpTip topic="peak" label={t.results.peak} />
              </dt>
              <dd>
                {money(ws.peak)} <span className="stat-sub">{yearAge(Math.max(0, ws.peakMonth - 1))}</span>
              </dd>
            </div>
          )}
        </dl>
      </section>
    )
  }

  const when =
    s.startAge != null ? fill(t.results.atAge, { age: f.num(s.startAge + H / 12, 1) }) : fill(t.results.afterYears, { years: duration(H) })
  const gainPositive = tot.netGain >= 0
  const showComposition = tot.final > 0
  const contribShare = showComposition ? Math.min(1, Math.max(0, tot.contributed / Math.max(tot.final, tot.contributed))) : 0
  const gainShare = tot.final > 0 ? tot.netGain / tot.final : 0

  return (
    <section className={`hero${stale ? ' is-stale' : ''}`} ref={heroRef} aria-labelledby="hero-h">
      <div className="hero-meta">
        <div className="hero-title">
          <h2 id="hero-h" className="hero-label">
            {t.results.projected} <span className="hero-when">{when}</span>
          </h2>
          <HelpTip topic="projected" label={t.results.projected} />
        </div>
        <span className="tag">
          {t.results.hypothetical}
          <HelpTip topic="assumptions" label={t.results.hypothetical} />
        </span>
      </div>
      <p className="hero-value" aria-live="polite" aria-atomic="true">
        <span className="sr-only">{t.results.projected}: </span>
        {money(tot.final)}
      </p>
      {s.inflationEnabled && (
        <p className="hero-real">
          {fill(t.results.todayMoney, { value: money(tot.finalReal) })}
          <HelpTip topic="todayMoney" label={t.results.real} />
        </p>
      )}

      {showComposition && (
        <div
          className="comp"
          role="img"
          aria-label={`${t.results.composition}: ${t.results.yourMoney} ${money(tot.contributed)}, ${gainPositive ? t.results.growthPart : t.results.lossPart} ${money(tot.netGain)}`}
        >
          <span className="comp-contrib" style={{ flexGrow: contribShare }} />
          {gainPositive ? (
            <span className="comp-gain" style={{ flexGrow: 1 - contribShare }} />
          ) : (
            <span className="comp-loss" style={{ flexGrow: 1 - tot.final / tot.contributed }} />
          )}
        </div>
      )}

      <dl className="hero-stats">
        <div className="stat">
          <dt>
            <span className="dot dot--contrib" aria-hidden="true" />
            {t.results.contributed}
            <HelpTip topic="contributed" label={t.results.contributed} />
          </dt>
          <dd>{money(tot.contributed)}</dd>
        </div>
        <div className="stat">
          <dt>
            <span className="dot dot--value" aria-hidden="true" />
            {s.feesEnabled ? t.results.gainAfterFees : t.results.gain}
            <HelpTip topic="gain" label={t.results.gain} />
          </dt>
          <dd className={gainPositive ? 'is-pos' : 'is-neg'}>{f.money(tot.netGain, s.currency, { signed: true })}</dd>
        </div>
        <div className="stat">
          <dt>
            {t.results.gainShare}
            <HelpTip topic="gainShare" label={t.results.gainShare} />
          </dt>
          <dd>{tot.final > 0 ? f.pct(gainShare * 100, 0) : '—'}</dd>
        </div>
      </dl>
    </section>
  )
}
