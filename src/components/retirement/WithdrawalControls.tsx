import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { useI18n } from '../../i18n'
import type { Frequency } from '../../engine/types'
import { WITHDRAWAL_FREQUENCIES, WITHDRAWAL_STRATEGIES, scaledAmount, type WithdrawalStrategy } from '../../model/scenario'
import { plannedIncome } from '../../model/retirement'
import { useApp } from '../../state/context'
import { useIssue } from '../plan/Controls'
import { HelpTip } from '../ui/HelpTip'
import { Icon } from '../ui/Icon'
import { NumberField } from '../ui/NumberField'
import { Segmented, Select, Switch } from '../ui/controls'
import type { HelpId } from '../../help'

/*
 * Withdrawal configuration (V4.1).
 *
 * Two independent inflation questions are asked separately:
 *   1. How is the income entered?      → "Today's money" | "At retirement"   (retirement.real)
 *   2. Does it rise during retirement?  → switch                               (withdrawal.indexed)
 * Only controls that change the result of the selected strategy are shown, and the
 * live breakdown explains — with numbers from the engine — why the planned income in
 * the first withdrawal year differs from the number typed in.
 */

const RATE_PRESETS = [3, 3.5, 4, 4.5, 5]
const STRATEGY_HELP: Record<WithdrawalStrategy, HelpId> = {
  fixed: 'fixedWithdrawal',
  initialPct: 'rule4',
  currentPct: 'currentPct',
  guardrails: 'guardrails',
}

function Step({ n, title, help, children }: { n: number; title: string; help?: HelpId; children: ReactNode }) {
  const id = useId()
  return (
    <section className="wd-step" aria-labelledby={id}>
      <div className="wd-step-head">
        <span className="wd-step-n" aria-hidden="true">
          {n}
        </span>
        <h4 id={id} className="wd-step-title">
          {title}
        </h4>
        {help && <HelpTip topic={help} label={title} />}
      </div>
      <div className="wd-step-body">{children}</div>
    </section>
  )
}

function StrategyPicker({ labelledBy }: { labelledBy?: string }) {
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
    <div className="strategy-grid" role="radiogroup" aria-label={labelledBy ? undefined : t.retire.strategy} aria-labelledby={labelledBy} onKeyDown={onKey}>
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
  )
}

/** "Today's money | At retirement" — how the desired income is entered. */
function BasisToggle({ size = 'sm' }: { size?: 'xs' | 'sm' }) {
  const { t } = useI18n()
  const { scenario: s, update } = useApp()
  return (
    <Segmented
      size={size}
      label={t.wd.basisLabel}
      help="amountBasis"
      value={s.retirement.real ? 'today' : 'start'}
      options={[
        { value: 'today', label: t.wd.basisToday },
        { value: 'start', label: t.wd.basisStart },
      ]}
      onChange={(v) => update((x) => ({ ...x, retirement: { ...x.retirement, real: v === 'today' } }))}
    />
  )
}

/** Live explanation of the planned first-year income (all numbers from the engine). */
export function IncomeBreakdown() {
  const { t, f, fill, years, lang } = useI18n()
  const { scenario: s, computed } = useApp()
  const p = plannedIncome(s, computed.result)
  const money = (v: number) => f.money(v, s.currency)
  const pct = (v: number) => f.pct(v, 2)
  const w = s.withdrawal
  if (!w.enabled) return null
  if (!p) {
    return (
      <div className="breakdown breakdown--muted" role="status">
        <p>{computed.ok ? t.wd.noYears : t.results.invalid}</p>
      </div>
    )
  }
  const where =
    p.age != null ? fill(t.wd.atStartAge, { year: p.startYear, age: p.age }) : fill(t.wd.atStart, { year: p.startYear })
  const inflOn = p.inflationPct !== 0
  /** Deflation (negative inflation) flips every "rises / higher" sentence. */
  const falling = p.inflationPct < 0
  const immediate = p.yearsBefore === 0
  const per = t.per.monthly
  // Czech needs the locative after "po": po 1 roce, po 32 letech.
  const yearsLoc = (n: number) => (lang === 'cs' ? `${f.num(n)} ${n === 1 ? 'roce' : 'letech'}` : years(n))

  const during = () => {
    if (w.strategy === 'currentPct') return t.wd.duringCurrent
    if (w.strategy === 'guardrails') return !inflOn ? t.wd.duringGuardNoInflation : w.indexed ? t.wd.duringGuardIndexed : t.wd.duringGuardFlat
    if (!inflOn) return t.wd.duringNoInflation
    if (!w.indexed) return fill(falling ? t.wd.duringFlatDown : t.wd.duringFlat, { value: money(p.firstMonthly) })
    if (p.secondMonthly == null) return fill(falling ? t.wd.duringIndexedShortDown : t.wd.duringIndexedShort, { rate: pct(p.inflationPct) })
    return fill(falling ? t.wd.duringIndexedDown : t.wd.duringIndexed, { rate: pct(p.inflationPct), year: p.startYear + 1, value: money(p.secondMonthly) })
  }

  let rows: { k: string; v: string }[]
  let lead: string
  let explain: string | null
  if (w.strategy === 'fixed') {
    if (s.retirement.real) {
      rows = [
        { k: t.wd.rowDesiredToday, v: `${money(s.retirement.income)} ${per}` },
        ...(inflOn && !immediate ? [{ k: t.wd.rowInflationBefore, v: fill(t.wd.rowInflationBeforeV, { rate: pct(p.inflationPct), years: years(p.yearsBefore) }) }] : []),
      ]
      lead = where
      explain = immediate
        ? t.wd.explainImmediate
        : inflOn
          ? fill(falling ? t.wd.explainTodayDown : t.wd.explainToday, { rate: pct(p.inflationPct), value: money(p.firstMonthly), year: p.startYear, today: money(s.retirement.income) })
          : t.wd.explainNoInflation
    } else {
      rows = [{ k: t.wd.rowEnteredStart, v: `${money(s.retirement.income)} ${per}` }]
      lead = where
      explain =
        inflOn && !immediate
          ? fill(t.wd.explainStart, { rate: pct(p.inflationPct), today: money(p.firstMonthlyReal), years: years(p.yearsBefore), yearsLoc: yearsLoc(p.yearsBefore) })
          : null
    }
  } else {
    rows = [
      { k: t.wd.rowRate, v: `${pct(w.rate)} ${t.per.annual}` },
      { k: fill(t.wd.rowPortfolio, { year: p.startYear }), v: money(p.portfolioAtStart) },
      { k: t.wd.rowBudget, v: `${money(p.firstAnnual)} ${t.per.annual}` },
    ]
    lead = where
    explain =
      w.strategy === 'initialPct'
        ? t.wd.explainInitial
        : w.strategy === 'currentPct'
          ? t.wd.explainCurrent
          : fill(t.wd.explainGuard, {
              rate: pct(w.rate),
              up: pct(w.maxIncrease),
              down: pct(w.maxDecrease),
              floor: w.floor > 0 ? fill(t.wd.explainGuardFloor, { value: money(w.floor) }) : '',
            })
  }

  return (
    <div className="breakdown" aria-live="polite">
      <p className="breakdown-k">
        <Icon name="sparkle" size={14} />
        {t.wd.breakdownTitle}
        <HelpTip topic={STRATEGY_HELP[w.strategy]} label={t.retire.strategies[w.strategy]} />
      </p>
      {rows.length > 0 && (
        <dl className="breakdown-rows">
          {rows.map((r) => (
            <div key={r.k}>
              <dt>{r.k}</dt>
              <dd>{r.v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="breakdown-result">
        <span className="breakdown-where">{lead}</span>
        <span className="breakdown-v">
          {money(p.firstMonthly)} <span>{per}</span>
        </span>
        {inflOn && !immediate && (w.strategy !== 'fixed' || !s.retirement.real) && (
          <span className="breakdown-sub">{fill(t.wd.inTodayMoney, { value: money(p.firstMonthlyReal) })}</span>
        )}
        {w.frequency !== 'monthly' && (
          <span className="breakdown-sub">{fill(t.wd.perPayment, { value: money(p.perPayment), freq: t.freq[w.frequency].toLowerCase() })}</span>
        )}
      </div>
      {explain && <p className="breakdown-explain">{explain}</p>}
      <p className="breakdown-explain breakdown-during">{during()}</p>
      {p.firstUnfundedMonthly > 0.5 && (
        <p className="breakdown-warn" role="status">
          <Icon name="warning" size={14} />
          {fill(t.wd.unfunded, { paid: money(p.firstPaidMonthly), gap: money(p.firstUnfundedMonthly) })}
        </p>
      )}
    </div>
  )
}

export function WithdrawalControls({ showEnable = true }: { showEnable?: boolean }) {
  const { t, f, fill, lang } = useI18n()
  const { scenario: s, update, computed } = useApp()
  const issue = useIssue(computed.issues)
  const affix = f.currencyAffix(s.currency)
  const w = s.withdrawal
  const setW = (patch: Partial<typeof w>, key?: string) => update((x) => ({ ...x, withdrawal: { ...x.withdrawal, ...patch } }), key)
  const setIncome = (v: number) => update((x) => ({ ...x, retirement: { ...x.retirement, income: v } }), 'ret.income')
  const fixed = w.strategy === 'fixed'
  const startAge = s.startAge != null ? s.startAge + w.startYear - 1 : null
  const strategyHead = useId()

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
          <section className="wd-step" aria-labelledby={strategyHead}>
            <div className="wd-step-head">
              <span className="wd-step-n" aria-hidden="true">
                1
              </span>
              <h4 id={strategyHead} className="wd-step-title">
                {t.retire.strategy}
              </h4>
              <HelpTip topic="withdrawalStrategy" label={t.retire.strategy} />
            </div>
            <div className="wd-step-body">
              <StrategyPicker labelledBy={strategyHead} />
            </div>
          </section>

          {fixed ? (
            <Step n={2} title={t.wd.stepIncome} help="desiredIncome">
              <div className="contrib-row">
                <NumberField
                  id="f-w-income"
                  size="lg"
                  hideLabel
                  label={t.wd.stepIncome}
                  value={s.retirement.income}
                  min={0}
                  max={1e12}
                  step={scaledAmount(1000, s.currency)}
                  {...affix}
                  suffix={affix.suffix ? `${affix.suffix} ${t.per.monthly}` : t.per.monthly}
                  slider={{ min: 0, max: scaledAmount(200_000, s.currency), scale: 'pow' }}
                  onChange={setIncome}
                />
                <Select<Frequency>
                  label={t.retire.payout}
                  hideLabel
                  className="freq-select"
                  value={w.frequency}
                  options={WITHDRAWAL_FREQUENCIES.map((v) => ({ value: v, label: t.freq[v] }))}
                  onChange={(v) => setW({ frequency: v })}
                />
              </div>
              <BasisToggle />
            </Step>
          ) : (
            <Step n={2} title={t.retire.rate} help="withdrawalRate">
              <div className="contrib-row">
                <NumberField
                  id="f-w-rate"
                  size="lg"
                  hideLabel
                  label={t.retire.rate}
                  value={w.rate}
                  min={0}
                  max={20}
                  step={0.1}
                  decimals={2}
                  suffix={lang === 'cs' ? '% ročně' : '% a year'}
                  slider={{ min: 1, max: 8, step: 0.1 }}
                  error={issue('withdrawal.rate')}
                  onChange={(v) => setW({ rate: v }, 'w.rate')}
                />
                <Select<Frequency>
                  label={t.retire.payout}
                  hideLabel
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
                    label={w.floorReal ? t.wd.floorToday : t.wd.floorNominal}
                    value={w.floor}
                    min={0}
                    max={1e12}
                    step={scaledAmount(1000, s.currency)}
                    {...affix}
                    onChange={(v) => setW({ floor: v }, 'w.floor')}
                  />
                </div>
              )}
              <div className="wd-target">
                <NumberField
                  id="f-w-target"
                  size="sm"
                  help="desiredIncome"
                  label={t.wd.targetLabel}
                  value={s.retirement.income}
                  min={0}
                  max={1e12}
                  step={scaledAmount(1000, s.currency)}
                  {...affix}
                  onChange={setIncome}
                />
                <BasisToggle size="xs" />
              </div>
            </Step>
          )}

          <Step n={3} title={t.wd.stepTiming} help="withdrawalStart">
            <div className="pair-row">
              <NumberField
                id="f-w-start"
                size="sm"
                label={t.withdrawal.start}
                value={w.startYear}
                min={1}
                max={100}
                step={1}
                suffix={startAge != null ? fill(t.wd.ageSuffix, { age: startAge }) : undefined}
                warning={issue('withdrawal.startYear', 'warning')}
                onChange={(v) => setW({ startYear: Math.round(v) }, 'w.start')}
              />
              {w.endYear != null && (
                <NumberField
                  id="f-w-end"
                  size="sm"
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
            <Switch label={t.withdrawal.untilEnd} help="retirementHorizon" checked={w.endYear == null} onChange={(v) => setW({ endYear: v ? null : Math.max(w.startYear, s.horizonYears) })} />
            <Switch label={t.withdrawal.stop} help="withdrawalStop" checked={w.stopContributions} onChange={(v) => setW({ stopContributions: v })} />
          </Step>

          <Step n={4} title={t.wd.stepInflation} help="inflationDuring">
            {w.strategy === 'currentPct' ? (
              <p className="wd-note">{t.wd.noAdjustCurrent}</p>
            ) : (
              <>
                <Switch
                  label={w.strategy === 'guardrails' ? t.wd.adjustGuard : t.wd.adjust}
                  description={s.inflationEnabled ? fill(t.wd.adjustRate, { rate: f.pct(s.inflation, 2) }) : t.wd.inflationOff}
                  checked={w.indexed}
                  onChange={(v) => setW({ indexed: v })}
                />
              </>
            )}
          </Step>

          <IncomeBreakdown />
        </>
      )}
    </div>
  )
}
