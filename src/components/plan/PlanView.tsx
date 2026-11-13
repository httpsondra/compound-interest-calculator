import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { PRESET_IDS, buildPreset } from '../../model/presets'
import { useApp } from '../../state/context'
import { Icon } from '../ui/Icon'
import { Menu, Select } from '../ui/controls'
import { Controls } from './Controls'
import { ResultsHero } from './ResultsHero'
import { GrowthChart } from './GrowthChart'
import { Conventions, FeeCard, GoalCard, Insights, Sensitivity, WithdrawalCard, YearTable } from './Details'

export function PlanView({ onReset }: { onReset: () => void }) {
  const { t, f } = useI18n()
  const { scenario: s, store, toast, computed } = useApp()
  const heroRef = useRef<HTMLElement>(null)
  const [heroVisible, setHeroVisible] = useState(true)

  useEffect(() => {
    const el = heroRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setHeroVisible(e.isIntersecting), { rootMargin: '-60px 0px 0px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const scenarios = store.doc.scenarios

  return (
    <div className="plan">
      <div className="plan-toolbar">
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
          <span className="toolbar-title">{s.name || t.scenario.untitled}</span>
        )}
        <div className="toolbar-actions">
          <Menu
            label={`${t.app.examples} – ${t.app.examplesHint}`}
            trigger={
              <span className="btn btn--ghost btn--sm as-span">
                {t.app.examples}
                <Icon name="chevron" size={15} />
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
          <button type="button" className="icon-btn" onClick={store.undo} disabled={!store.canUndo} aria-label={t.app.undo} title={t.app.undo}>
            <Icon name="undo" size={17} />
          </button>
          <button type="button" className="icon-btn" onClick={onReset} aria-label={t.app.reset} title={t.app.reset}>
            <Icon name="reset" size={17} />
          </button>
        </div>
      </div>

      <div className="plan-hero">
        <ResultsHero heroRef={heroRef} />
      </div>
      <div className="plan-controls">
        <Controls />
      </div>
      <div className="plan-chart">
        <GrowthChart />
      </div>
      <div className="plan-details">
        <GoalCard />
        <WithdrawalCard />
        <FeeCard />
        <Insights />
        <Sensitivity />
        <YearTable />
        <Conventions />
      </div>

      {computed.result && (
        <div className={`sticky-result${heroVisible ? '' : ' is-visible'}`} aria-hidden={heroVisible}>
          <span className="sticky-label">{t.results.sticky}</span>
          <span className="sticky-value">{f.money(computed.result.totals.final, s.currency)}</span>
          {s.inflationEnabled && <span className="sticky-real">{f.money(computed.result.totals.finalReal, s.currency, { compact: true })} · {t.results.real}</span>}
        </div>
      )}
    </div>
  )
}
