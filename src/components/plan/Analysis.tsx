import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useI18n } from '../../i18n'
import { incomeCheck, incomeStats } from '../../model/retirement'
import { incomeTarget, inflationRate } from '../../model/scenario'
import { useApp } from '../../state/context'
import { Icon } from '../ui/Icon'
import { FeeCard, GoalCard, Insights, Sensitivity, WithdrawalCard, YearTable } from './Details'
import { MilestoneList } from './milestones'

/**
 * Essential, plan-specific takeaways shown directly under the chart. Only what applies to the active
 * scenario appears here; a plain accumulation plan shows nothing, because the hero already says it.
 */
export function PlanHighlights({ onRetirement }: { onRetirement: () => void }) {
  const { t, f, fill } = useI18n()
  const { scenario: s, computed } = useApp()
  const res = computed.result
  if (!res) return null
  const money = (v: number) => f.money(v, s.currency)
  const rows: ReactNode[] = []

  // Retirement income: spending quality, not just whether the portfolio survives.
  if (s.withdrawal.enabled) {
    const infl = inflationRate(s)
    const st = incomeStats(res, infl)
    if (st) {
      // Both figures on ONE price basis: today's money when inflation is on, never nominal at two dates.
      const real = s.inflationEnabled && infl !== 0
      const start = real ? st.initialReal : st.initial
      const low = real ? st.minReal : st.min
      const change = start > 0 ? (low / start - 1) * 100 : 0
      const drops = change <= -10
      const goal = incomeTarget(s)
      // The hero already reports the goal check for income-based strategies; do not say it twice.
      const heroShowsCheck = s.withdrawal.strategy === 'currentPct' || s.withdrawal.strategy === 'guardrails'
      const check = goal && !heroShowsCheck ? incomeCheck(s, res) : null
      rows.push(
        <div key="income" className={`hl-row${drops ? ' is-warn' : ''}`}>
          <div className="hl-head">
            <h3 className="hl-title">
              {t.hl.retirement} <span className="hl-basis">· {real ? t.results.real : t.results.nominal}</span>
            </h3>
            <button type="button" className="link-btn" onClick={onRetirement}>
              {t.retire.openPlanner}
              <Icon name="chevronRight" size={14} />
            </button>
          </div>
          <dl className="hl-figures">
            <div>
              <dt>{t.hl.startsAt}</dt>
              <dd>
                {money(start)} <span>{t.per.monthly}</span>
              </dd>
            </div>
            <div>
              <dt>{t.hl.lowest}</dt>
              <dd>
                {money(low)} <span>{t.per.monthly}</span>
              </dd>
              {Math.abs(change) >= 0.5 && <dd className="hl-change">{fill(t.hl.change, { pct: f.pct(Math.abs(change), 0), dir: change < 0 ? t.hl.below : t.hl.above })}</dd>}
            </div>
          </dl>
          {goal && check && (
            <p className="hl-note">
              {check.funded
                ? fill(t.results.incomeOk, { income: money(goal.monthly) })
                : fill(t.results.incomeLow, { income: money(goal.monthly), year: check.firstShortYear ?? '', lowest: money(check.lowest) })}
            </p>
          )}
        </div>,
      )
    }
  }

  const g = computed.goal
  if (s.goal.enabled && g) {
    rows.push(
      <div key="goal" className={`hl-row${g.reached ? ' is-pos' : ' is-warn'}`}>
        <h3 className="hl-title">{t.goal.cardTitle}</h3>
        <p className="hl-line">
          {g.reached
            ? fill(t.goal.reached, { target: money(s.goal.target), year: s.goal.year })
            : fill(t.goal.notReached, { gap: money(Math.abs(g.gap)), year: s.goal.year })}
        </p>
      </div>,
    )
  }

  if (s.feesEnabled && computed.noFee) {
    const diff = computed.noFee.final - res.totals.final
    const pct = computed.noFee.final > 0 ? (diff / computed.noFee.final) * 100 : 0
    rows.push(
      <div key="fees" className="hl-row">
        <h3 className="hl-title">{t.fees.cardTitle}</h3>
        <p className="hl-line">{fill(t.insights.fees, { amount: money(diff), pct: f.pct(pct, 1) })}</p>
      </div>,
    )
  }

  if (!rows.length) return null
  return (
    <section className="highlights" aria-label={t.hl.title}>
      {rows}
    </section>
  )
}

type TabId = 'goal' | 'withdrawal' | 'fees' | 'insights' | 'sensitivity' | 'table'

/**
 * Detailed analysis: everything beyond the essentials, behind one calm row of tabs. Collapsed by
 * default; only analyses that apply to the current plan are offered.
 */
export function DetailedAnalysis() {
  const { t } = useI18n()
  const { scenario: s, computed } = useApp()
  const [open, setOpen] = useState<TabId | null>(null)
  const base = useId()
  if (!computed.result) return null

  const tabs: { id: TabId; label: string; panel: ReactNode }[] = []
  if (s.goal.enabled && computed.goal) tabs.push({ id: 'goal', label: t.goal.cardTitle, panel: <GoalCard /> })
  if (s.withdrawal.enabled) tabs.push({ id: 'withdrawal', label: t.withdrawal.cardTitle, panel: <WithdrawalCard /> })
  if (s.feesEnabled && computed.noFee) tabs.push({ id: 'fees', label: t.fees.cardTitle, panel: <FeeCard /> })
  tabs.push({
    id: 'insights',
    label: t.insights.title,
    panel: (
      <div className="analysis-stack">
        <Insights />
        <MilestoneList />
      </div>
    ),
  })
  tabs.push({ id: 'sensitivity', label: t.sensitivity.title, panel: <Sensitivity /> })
  tabs.push({ id: 'table', label: t.table.title, panel: <YearTable /> })

  const current = tabs.find((x) => x.id === open) ?? null
  const move = (e: KeyboardEvent, i: number) => {
    let n = -1
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') n = 0
    else if (e.key === 'End') n = tabs.length - 1
    if (n < 0) return
    e.preventDefault()
    setOpen(tabs[n].id)
    document.getElementById(`${base}-tab-${tabs[n].id}`)?.focus()
  }

  return (
    <section className="analysis" aria-labelledby={`${base}-h`}>
      <div className="analysis-head">
        <h2 id={`${base}-h`} className="analysis-title">
          {t.analysis.title}
        </h2>
        <span className="analysis-hint">{t.analysis.hint}</span>
      </div>
      <div className="tabs" role="tablist" aria-label={t.analysis.title}>
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            id={`${base}-tab-${tab.id}`}
            type="button"
            role="tab"
            className="tab"
            aria-selected={open === tab.id}
            aria-controls={`${base}-panel`}
            tabIndex={open === tab.id || (open === null && i === 0) ? 0 : -1}
            onClick={() => setOpen(open === tab.id ? null : tab.id)}
            onKeyDown={(e) => move(e, i)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {current && (
        <div className="tabpanel" role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${current.id}`}>
          {current.panel}
        </div>
      )}
    </section>
  )
}
