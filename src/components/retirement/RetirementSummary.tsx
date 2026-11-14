import { useMemo } from 'react'
import { useI18n } from '../../i18n'
import { evaluateIncome } from '../../engine/income'
import { incomeStats } from '../../model/retirement'
import { incomeTarget, inflationRate } from '../../model/scenario'
import { useApp } from '../../state/context'
import { HelpTip } from '../ui/HelpTip'
import { Icon } from '../ui/Icon'

/** Compact retirement-income summary on the Plan page; the full planner lives in the Retirement view. */
export function RetirementSummary({ onOpen }: { onOpen: () => void }) {
  const { t, f, fill } = useI18n()
  const { scenario: s, computed } = useApp()
  const res = computed.result
  const infl = inflationRate(s)
  const stats = useMemo(() => (res && s.withdrawal.enabled ? incomeStats(res, infl) : null), [res, infl, s.withdrawal.enabled])
  if (!stats || !res) return null
  const real = s.retirement.real && s.inflationEnabled
  const money = (v: number) => f.money(v, s.currency)
  const goal = incomeTarget(s)
  const ev = evaluateIncome(res.withdrawalYears, infl, goal.monthly, goal.real)
  return (
    <section className="card ret-summary" aria-labelledby="ret-sum-h">
      <header className="card-head">
        <div className="title-row">
          <h2 id="ret-sum-h" className="section-title">
            {t.retire.incomeChart}
          </h2>
          <HelpTip topic="retirementIncome" label={t.retire.incomeChart} />
        </div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onOpen}>
          {t.retire.openPlanner}
          <Icon name="chevronRight" size={15} />
        </button>
      </header>
      <dl className="tiles">
        <div className="tile">
          <dt>{t.retire.initialIncome}</dt>
          <dd>
            {money(real ? stats.initialReal : stats.initial)} <span className="tile-unit">{t.per.monthly}</span>
            {real && stats.initial !== stats.initialReal && (
              <span className="tile-sub">{fill(t.wd.tileNominal, { value: money(stats.initial), year: s.withdrawal.startYear })}</span>
            )}
          </dd>
        </div>
        <div className="tile">
          <dt>
            {t.retire.lowestIncome}
            <HelpTip topic="lowestIncome" label={t.retire.lowestIncome} />
          </dt>
          <dd>{money(real ? stats.minReal : stats.min)}</dd>
        </div>
        <div className="tile">
          <dt>
            {t.retire.sustainTitle}
            <HelpTip topic="incomeFunding" label={t.retire.sustainTitle} />
          </dt>
          <dd className={`tile-text ${ev.funded ? 'is-pos' : 'is-warn'}`}>
            {ev.funded ? t.retire.sustainYes : fill(t.retire.sustainNo, { year: ev.firstShortIndex != null ? s.withdrawal.startYear + ev.firstShortIndex : '' })}
          </dd>
        </div>
      </dl>
      <p className="note">
        {t.retire.strategies[s.withdrawal.strategy]} · {real ? t.results.real : t.results.nominal}
      </p>
    </section>
  )
}
