import { useI18n } from '../../i18n'
import { totalMonths } from '../../model/scenario'
import { useApp } from '../../state/context'

export function ResultsHero({ heroRef }: { heroRef?: React.Ref<HTMLElement> }) {
  const { t, f, fill, duration } = useI18n()
  const { scenario: s, computed, stale } = useApp()
  const res = computed.result
  const H = totalMonths(s)

  if (!res) {
    return (
      <section className="card hero hero--invalid" ref={heroRef} aria-labelledby="hero-h">
        <h2 id="hero-h" className="hero-label">
          {t.results.projected}
        </h2>
        <p className="hero-invalid">{t.results.invalid}</p>
      </section>
    )
  }

  const tot = res.totals
  const money = (v: number) => f.money(v, s.currency)
  const when =
    s.startAge != null ? fill(t.results.atAge, { age: f.num(s.startAge + H / 12, 1) }) : fill(t.results.afterYears, { years: duration(H) })
  const showComposition = !s.withdrawal.enabled && tot.final > 0
  const gainPositive = tot.netGain >= 0
  const contribShare = showComposition ? Math.min(1, Math.max(0, tot.contributed / Math.max(tot.final, tot.contributed))) : 0
  const gainShare = tot.final > 0 ? tot.netGain / tot.final : 0

  return (
    <section className={`card hero${stale ? ' is-stale' : ''}`} ref={heroRef} aria-labelledby="hero-h">
      <div className="hero-aurora" aria-hidden="true" />
      <div className="hero-top">
        <h2 id="hero-h" className="hero-label">
          {t.results.projected} <span className="hero-when">{when}</span>
        </h2>
        <span className="chip chip--quiet">{t.results.hypothetical}</span>
      </div>
      <p className="hero-value" aria-live="polite" aria-atomic="true">
        <span className="sr-only">{t.results.projected}: </span>
        {money(tot.final)}
      </p>
      {s.inflationEnabled && (
        <p className="hero-real">{fill(t.results.todayMoney, { value: money(tot.finalReal) })}</p>
      )}

      {showComposition && (
        <div className="comp" role="img" aria-label={`${t.results.composition}: ${t.results.yourMoney} ${money(tot.contributed)}, ${gainPositive ? t.results.growthPart : t.results.lossPart} ${money(tot.netGain)}`}>
          <div className="comp-bar">
            <span className="comp-contrib" style={{ width: `${contribShare * 100}%` }} />
            {gainPositive && <span className="comp-gain" style={{ width: `${(1 - contribShare) * 100}%` }} />}
            {!gainPositive && <span className="comp-loss" style={{ width: `${(1 - tot.final / tot.contributed) * 100}%` }} />}
          </div>
        </div>
      )}

      <dl className="hero-stats">
        <div className="stat">
          <dt>
            <span className="dot dot--contrib" aria-hidden="true" />
            {t.results.contributed}
          </dt>
          <dd>{money(tot.contributed)}</dd>
        </div>
        <div className="stat">
          <dt>
            <span className="dot dot--value" aria-hidden="true" />
            {s.feesEnabled ? t.results.gainAfterFees : t.results.gain}
          </dt>
          <dd className={gainPositive ? 'is-pos' : 'is-neg'}>{f.money(tot.netGain, s.currency, { signed: true })}</dd>
        </div>
        {s.withdrawal.enabled ? (
          <div className="stat">
            <dt>{t.results.withdrawn}</dt>
            <dd>{money(tot.withdrawn)}</dd>
          </div>
        ) : (
          <div className="stat">
            <dt>{t.results.gainShare}</dt>
            <dd>{tot.final > 0 ? f.pct(gainShare * 100, 0) : '—'}</dd>
          </div>
        )}
      </dl>
    </section>
  )
}
