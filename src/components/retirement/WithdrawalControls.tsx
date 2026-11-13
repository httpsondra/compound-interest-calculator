import { useRef, type KeyboardEvent } from 'react'
import { useI18n } from '../../i18n'
import type { Frequency } from '../../engine/types'
import { WITHDRAWAL_FREQUENCIES, WITHDRAWAL_STRATEGIES, scaledAmount, type WithdrawalStrategy } from '../../model/scenario'
import { firstYearBudget } from '../../model/retirement'
import { useApp } from '../../state/context'
import { useIssue } from '../plan/Controls'
import { HelpTip } from '../ui/HelpTip'
import { NumberField } from '../ui/NumberField'
import { Select, Switch } from '../ui/controls'
import type { HelpId } from '../../help'

const RATE_PRESETS = [3, 3.5, 4, 4.5, 5]
const STRATEGY_HELP: Record<WithdrawalStrategy, HelpId> = {
  fixed: 'withdrawalAmount',
  initialPct: 'rule4',
  currentPct: 'currentPct',
  guardrails: 'guardrails',
}

function StrategyPicker() {
  const { t } = useI18n()
  const { scenario: s, update } = useApp()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const idx = WITHDRAWAL_STRATEGIES.indexOf(s.withdrawal.strategy)
  const set = (v: WithdrawalStrategy) => update((x) => ({ ...x, withdrawal: { ...x.withdrawal, strategy: v } }))
  const onKey = (e: KeyboardEvent) => {
    const n = WITHDRAWAL_STRATEGIES.length
    let next: number
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % n
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + n) % n
    else return
    e.preventDefault()
    set(WITHDRAWAL_STRATEGIES[next])
    refs.current[next]?.focus()
  }
  return (
    <div className="strategy">
      <div className="field-head">
        <span className="nf-label" id="strategy-label">
          {t.retire.strategy}
        </span>
        <HelpTip topic="withdrawalStrategy" label={t.retire.strategy} />
      </div>
      <div className="strategy-grid" role="radiogroup" aria-labelledby="strategy-label" onKeyDown={onKey}>
        {WITHDRAWAL_STRATEGIES.map((v, i) => (
          <button
            key={v}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={v === s.withdrawal.strategy}
            tabIndex={v === s.withdrawal.strategy ? 0 : -1}
            className="strategy-card"
            onClick={() => set(v)}
          >
            <span className="strategy-name">{t.retire.strategies[v]}</span>
            <span className="strategy-desc">{t.retire.strategyDesc[v]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Live first-year income from the same simulation as the results. */
function IncomePreview() {
  const { t, f, fill } = useI18n()
  const { scenario: s, computed } = useApp()
  const b = firstYearBudget(computed.result)
  if (!b) return null
  const money = (v: number) => f.money(v, s.currency)
  const year = Math.floor(b.startMonth / 12) + 1
  return (
    <div className="income-preview" aria-live="polite">
      <span className="income-preview-k">
        {s.withdrawal.strategy === 'fixed' ? t.retire.previewFixed : fill(t.retire.previewPct, { rate: f.pct(s.withdrawal.rate, 2) })}
        <HelpTip topic={STRATEGY_HELP[s.withdrawal.strategy]} label={t.retire.strategies[s.withdrawal.strategy]} />
      </span>
      <span className="income-preview-v">
        {money(b.monthly)} <span>{t.per.monthly}</span>
      </span>
      <span className="income-preview-s">
        {money(b.annual)} {t.per.annual} · {fill(t.retire.previewBase, { value: money(b.portfolio), year })}
      </span>
    </div>
  )
}

export function WithdrawalControls({ showEnable = true }: { showEnable?: boolean }) {
  const { t, f, lang } = useI18n()
  const { scenario: s, update, computed } = useApp()
  const issue = useIssue(computed.issues)
  const affix = f.currencyAffix(s.currency)
  const w = s.withdrawal
  const setW = (patch: Partial<typeof w>, key?: string) => update((x) => ({ ...x, withdrawal: { ...x.withdrawal, ...patch } }), key)
  const pct = w.strategy !== 'fixed'

  return (
    <div className="wd-controls">
      {showEnable && (
        <Switch
          label={t.withdrawal.enable}
          help="withdrawals"
          checked={w.enabled}
          onChange={(v) =>
            update((x) => ({
              ...x,
              withdrawal: {
                ...x.withdrawal,
                enabled: v,
                startYear: v && x.withdrawal.startYear > x.horizonYears ? Math.max(1, x.horizonYears - 9) : x.withdrawal.startYear,
              },
            }))
          }
        />
      )}
      {w.enabled && (
        <>
          <div className="pair-row">
            <NumberField
              id="f-w-start"
              help="withdrawalStart"
              label={t.withdrawal.start}
              value={w.startYear}
              min={1}
              max={100}
              step={1}
              warning={issue('withdrawal.startYear', 'warning')}
              onChange={(v) => setW({ startYear: Math.round(v) }, 'w.start')}
            />
            {w.endYear != null && (
              <NumberField
                id="f-w-end"
                label={t.withdrawal.end}
                value={w.endYear}
                min={1}
                max={100}
                step={1}
                error={issue('withdrawal.endYear')}
                onChange={(v) => setW({ endYear: Math.round(v) }, 'w.end')}
              />
            )}
          </div>

          <StrategyPicker />

          {w.strategy === 'fixed' ? (
            <div className="contrib-row">
              <NumberField
                id="f-w-amount"
                help="withdrawalAmount"
                label={t.withdrawal.amount}
                value={w.amount}
                min={0}
                max={1e12}
                step={scaledAmount(1000, s.currency)}
                {...affix}
                slider={{ min: 0, max: scaledAmount(200_000, s.currency), scale: 'pow' }}
                onChange={(v) => setW({ amount: v }, 'w.amount')}
              />
              <Select<Frequency>
                label={t.inputs.frequency}
                className="freq-select"
                value={w.frequency}
                options={WITHDRAWAL_FREQUENCIES.map((v) => ({ value: v, label: t.freq[v] }))}
                onChange={(v) => setW({ frequency: v })}
              />
            </div>
          ) : (
            <>
              <div className="contrib-row">
                <NumberField
                  id="f-w-rate"
                  help="withdrawalRate"
                  label={t.retire.rate}
                  value={w.rate}
                  min={0}
                  max={20}
                  step={0.1}
                  decimals={2}
                  suffix={lang === 'cs' ? '% p. a.' : '% p.a.'}
                  slider={{ min: 1, max: 8, step: 0.1 }}
                  error={issue('withdrawal.rate')}
                  onChange={(v) => setW({ rate: v }, 'w.rate')}
                />
                <Select<Frequency>
                  label={t.retire.payout}
                  className="freq-select"
                  value={w.frequency}
                  options={WITHDRAWAL_FREQUENCIES.map((v) => ({ value: v, label: t.freq[v] }))}
                  onChange={(v) => setW({ frequency: v })}
                />
              </div>
              <div className="rate-presets" role="group" aria-label={t.retire.presets}>
                {RATE_PRESETS.map((r) => (
                  <button key={r} type="button" className="chip-btn" aria-pressed={w.rate === r} onClick={() => setW({ rate: r })}>
                    {f.pct(r, 1)}
                  </button>
                ))}
                <span className="rate-presets-note">{t.retire.presetsNote}</span>
              </div>
            </>
          )}

          {w.strategy === 'guardrails' && (
            <div className="guard-box">
              <div className="pair-row">
                <NumberField
                  id="f-w-inc"
                  size="sm"
                  help="guardLimits"
                  label={t.retire.maxIncrease}
                  value={w.maxIncrease}
                  min={0}
                  max={100}
                  step={0.5}
                  decimals={2}
                  suffix="%"
                  error={issue('withdrawal.guard')}
                  onChange={(v) => setW({ maxIncrease: v }, 'w.inc')}
                />
                <NumberField
                  id="f-w-dec"
                  size="sm"
                  label={t.retire.maxDecrease}
                  value={w.maxDecrease}
                  min={0}
                  max={100}
                  step={0.5}
                  decimals={2}
                  suffix="%"
                  onChange={(v) => setW({ maxDecrease: v }, 'w.dec')}
                />
              </div>
              <NumberField
                id="f-w-floor"
                size="sm"
                help="incomeFloor"
                label={t.retire.floor}
                value={w.floor}
                min={0}
                max={1e12}
                step={scaledAmount(1000, s.currency)}
                {...affix}
                onChange={(v) => setW({ floor: v }, 'w.floor')}
              />
            </div>
          )}

          <IncomePreview />

          <Switch label={t.withdrawal.untilEnd} help="withdrawalEnd" checked={w.endYear == null} onChange={(v) => setW({ endYear: v ? null : Math.max(w.startYear, s.horizonYears) })} />
          {s.inflationEnabled && w.strategy !== 'currentPct' && (
            <Switch
              label={pct ? t.retire.indexedPct : t.withdrawal.indexed}
              help="withdrawalIndexed"
              checked={w.indexed}
              onChange={(v) => setW({ indexed: v })}
            />
          )}
          <Switch label={t.withdrawal.stop} help="withdrawalStop" checked={w.stopContributions} onChange={(v) => setW({ stopContributions: v })} />
        </>
      )}
    </div>
  )
}

/** Desired retirement income (used by the FI calculator and the income checks). */
export function DesiredIncome() {
  const { t, f } = useI18n()
  const { scenario: s, update } = useApp()
  return (
    <div className="desired">
      <NumberField
        id="f-desired"
        help="desiredIncome"
        label={t.retire.desired}
        value={s.retirement.income}
        min={0}
        max={1e12}
        step={scaledAmount(1000, s.currency)}
        {...f.currencyAffix(s.currency)}
        slider={{ min: 0, max: scaledAmount(200_000, s.currency), scale: 'pow' }}
        onChange={(v) => update((x) => ({ ...x, retirement: { ...x.retirement, income: v } }), 'ret.income')}
      />
      {s.inflationEnabled && (
        <Switch
          label={t.retire.desiredReal}
          help="realIncome"
          checked={s.retirement.real}
          onChange={(v) => update((x) => ({ ...x, retirement: { ...x.retirement, real: v } }))}
        />
      )}
    </div>
  )
}
