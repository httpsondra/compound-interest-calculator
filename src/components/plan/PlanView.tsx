import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { PRESET_IDS, buildPreset } from '../../model/presets'
import { withdrawalSummary } from '../../model/compute'
import { useApp } from '../../state/context'
import { Icon } from '../ui/Icon'
import { Menu, Select } from '../ui/controls'
import { Controls } from './Controls'
import { ResultsHero } from './ResultsHero'
import { GrowthChart } from './GrowthChart'
import { RetirementSummary } from '../retirement/RetirementSummary'
import { Conventions, FeeCard, GoalCard, Insights, Sensitivity, WithdrawalCard, YearTable } from './Details'

export function PlanView({ onReset, onRetirement }: { onReset: () => void; onRetirement: () => void }) {
  const { t, f } = useI18n()
  const { scenario: s, store, toast, computed } = useApp()
  const heroRef = useRef<HTMLElement>(null)
  const [heroVisible, setHeroVisible] = useState(true)

  useEffect(() => {
    const el = heroRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setHeroVisible(e.isIntersecting), { rootMargin: '-40px 0px 0px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const scenarios = store.doc.scenarios
  const res = computed.result
  const ws = res ? withdrawalSummary(s, res) : null

  return (
    <div className="plan">
      <div className="plan-hero">
        <ResultsHero heroRef={heroRef} />
      </div>

      <aside className="plan-config" aria-label={t.inputs.heading}>
        <div className="config">
          <div className="config-top">
            {scenarios.length > 1 ? (
              <Select
                label={t.scenario.label}
                hideLabel
                className="scenario-select"
                value={store.doc.activeId}
                options={scenarios.map((x, i) => ({ value: x.id, label: x.name || `${t.scenario.untitled} ${i + 1}` }))}
                onChange={(id) => store.setDoc((d) => ({ ...d, activeId: id }))}
              />
            ) : (
              <span className="config-title">{s.name || t.scenario.untitled}</span>
            )}
            <div className="config-actions">
              <Menu
                label={`${t.app.examples} – ${t.app.examplesHint}`}
                trigger={
                  <span className="quiet-btn as-span">
                    {t.app.examples}
                    <Icon name="chevron" size={14} />
                  </span>
                }
                items={PRESET_IDS.map((id) => ({
                  label: t.presets[id],
                  onSelect: () => {
                    store.update((x) => ({ ...buildPreset(id, x.currency), id: x.id, name: x.name }))
                    toast(t.presets[id], { label: t.app.undo, run: store.undo })
                  },
                }))}
              />
              <button type="button" className="icon-btn icon-btn--sm" onClick={store.undo} disabled={!store.canUndo} aria-label={t.app.undo} title={t.app.undo}>
                <Icon name="undo" size={16} />
              </button>
              <button type="button" className="icon-btn icon-btn--sm" onClick={onReset} aria-label={t.app.reset} title={t.app.reset}>
                <Icon name="reset" size={16} />
              </button>
            </div>
          </div>
          <Controls />
        </div>
      </aside>

      <div className="plan-chart">
        <GrowthChart />
      </div>

      <div className="plan-more">
        <RetirementSummary onOpen={onRetirement} />
        <GoalCard />
        <div className="more-grid">
          <WithdrawalCard />
          <FeeCard />
          <Insights />
          <Sensitivity />
        </div>
        <YearTable />
        <Conventions />
      </div>

      {res && (
        <div className={`sticky-result${heroVisible ? '' : ' is-visible'}`} aria-hidden={heroVisible}>
          <span className="sticky-label">{ws ? t.results.atWithdrawalStart : t.results.sticky}</span>
          <span className="sticky-value">{f.money(ws ? ws.startValue : res.totals.final, s.currency)}</span>
        </div>
      )}
    </div>
  )
}
