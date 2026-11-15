import { useI18n } from '../../i18n'
import { useApp } from '../../state/context'
import type { Marker } from '../chart/XYChart'
import { HelpTip } from '../ui/HelpTip'

/** All milestone markers for the current plan (labels are localised). */
export function useMilestoneMarkers(): Marker[] {
  const { t, f, fill } = useI18n()
  const { scenario: s, computed } = useApp()
  return computed.milestones.map((m) => {
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
}

/** The full milestone list, shown in the detailed analysis instead of crowding the chart. */
export function MilestoneList() {
  const { t } = useI18n()
  const markers = useMilestoneMarkers()
  if (!markers.length) return null
  return (
    <section className="block milestones" aria-labelledby="milestones-h">
      <div className="title-row">
        <h3 id="milestones-h" className="section-title section-title--sm">
          {t.milestones.title}
        </h3>
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
    </section>
  )
}
