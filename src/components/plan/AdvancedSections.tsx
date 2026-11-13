import { useI18n } from '../../i18n'
import type { Frequency } from '../../engine/types'
import { WITHDRAWAL_FREQUENCIES, scaledAmount, uid } from '../../model/scenario'
import { useApp } from '../../state/context'
import { Icon } from '../ui/Icon'
import { NumberField } from '../ui/NumberField'
import { Disclosure, Segmented, Select, Switch } from '../ui/controls'
import { useIssue } from './Controls'
import { HelpTip } from '../ui/HelpTip'

export function AdvancedSections() {
  const { t, f, lang } = useI18n()
  const { scenario: s, update, computed } = useApp()
  const issue = useIssue(computed.issues)
  const affix = f.currencyAffix(s.currency)
  const yrs = lang === 'cs' ? 'let' : 'yrs'
  const w = s.withdrawal

  return (
    <div className="disc-stack">
      <h3 className="disc-label">{t.inputs.more}</h3>
      <Disclosure
        id="sec-goal"
        title={t.goal.title}
        icon={<Icon name="target" size={17} />}
        active={s.goal.enabled}
        summary={s.goal.enabled ? f.money(s.goal.target, s.currency, { compact: true }) : t.goal.summaryOff}
      >
        <Switch label={t.goal.enable} help="goal" checked={s.goal.enabled} onChange={(v) => update((x) => ({ ...x, goal: { ...x.goal, enabled: v } }))} />
        {s.goal.enabled && (
          <>
            <NumberField
              id="f-goal-target"
              help="goalTarget"
              label={t.goal.target}
              value={s.goal.target}
              min={0}
              max={1e13}
              step={scaledAmount(100_000, s.currency)}
              {...affix}
              slider={{ min: 0, max: scaledAmount(50_000_000, s.currency), scale: 'pow' }}
              onChange={(v) => update((x) => ({ ...x, goal: { ...x.goal, target: v } }), 'goal.target')}
            />
            <NumberField
              id="f-goal-year"
              help="goalYear"
              label={t.goal.year}
              value={s.goal.year}
              min={1}
              max={100}
              step={1}
              slider={{ min: 1, max: 60, step: 1 }}
              error={issue('goal.year')}
              onChange={(v) => update((x) => ({ ...x, goal: { ...x.goal, year: Math.round(v) } }), 'goal.year')}
            />
            {s.inflationEnabled && (
              <Switch
                label={t.goal.real}
                help="goalReal"
                checked={s.goal.real}
                onChange={(v) => update((x) => ({ ...x, goal: { ...x.goal, real: v } }))}
              />
            )}
          </>
        )}
      </Disclosure>

      <Disclosure
        id="sec-inflation"
        title={t.inflation.title}
        icon={<Icon name="layers" size={17} />}
        active={s.inflationEnabled}
        summary={s.inflationEnabled ? f.pct(s.inflation, 2) : t.inflation.summaryOff}
      >
        <Switch
          label={t.inflation.enable}
          help="inflation"
          checked={s.inflationEnabled}
          onChange={(v) =>
            update((x) => ({
              ...x,
              inflationEnabled: v,
              growthMode: !v && x.growthMode === 'inflation' ? 'none' : x.growthMode,
              goal: { ...x.goal, real: v ? x.goal.real : false },
            }))
          }
        />
        {s.inflationEnabled && (
          <NumberField
            id="f-inflation"
            help="inflationRate"
            label={t.inflation.rate}
            value={s.inflation}
            min={-50}
            max={50}
            step={0.1}
            decimals={2}
            suffix="%"
            slider={{ min: 0, max: 10, step: 0.1 }}
            error={issue('inflation')}
            onChange={(v) => update((x) => ({ ...x, inflation: v }), 'inflation')}
          />
        )}
      </Disclosure>

      <Disclosure
        id="sec-fees"
        title={t.fees.title}
        icon={<Icon name="minus" size={17} />}
        active={s.feesEnabled}
        summary={s.feesEnabled ? `${f.pct(s.fees.annual, 2)} ${lang === 'cs' ? 'p. a.' : 'p.a.'}` : t.fees.summaryOff}
      >
        <Switch label={t.fees.enable} help="fees" checked={s.feesEnabled} onChange={(v) => update((x) => ({ ...x, feesEnabled: v }))} />
        {s.feesEnabled && (
          <>
            <NumberField
              id="f-fee-annual"
              label={t.fees.annual}
              help="feeAnnual"
              value={s.fees.annual}
              min={0}
              max={99}
              step={0.05}
              decimals={2}
              suffix="%"
              slider={{ min: 0, max: 3, step: 0.05 }}
              error={issue('fees.annual')}
              onChange={(v) => update((x) => ({ ...x, fees: { ...x.fees, annual: v } }), 'fees.annual')}
            />
            <NumberField
              id="f-fee-entry"
              label={t.fees.entry}
              help="feeEntry"
              value={s.fees.entry}
              min={0}
              max={100}
              step={0.1}
              decimals={2}
              suffix="%"
              error={issue('fees.entry')}
              onChange={(v) => update((x) => ({ ...x, fees: { ...x.fees, entry: v } }), 'fees.entry')}
            />
            <NumberField
              id="f-fee-fixed"
              help="feeFixed"
              label={t.fees.fixed}
              value={s.fees.fixed}
              min={0}
              max={1e9}
              step={scaledAmount(10, s.currency)}
              decimals={2}
              {...affix}
              onChange={(v) => update((x) => ({ ...x, fees: { ...x.fees, fixed: v } }), 'fees.fixed')}
            />
          </>
        )}
      </Disclosure>

      <Disclosure
        id="sec-withdrawal"
        title={t.withdrawal.title}
        icon={<Icon name="arrowDown" size={17} />}
        active={w.enabled}
        summary={w.enabled ? `${f.money(w.amount, s.currency, { compact: true })} ${t.per[w.frequency]}` : t.withdrawal.summaryOff}
      >
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
        {w.enabled && (
          <>
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
                onChange={(v) => update((x) => ({ ...x, withdrawal: { ...x.withdrawal, amount: v } }), 'w.amount')}
              />
              <Select<Frequency>
                label={t.inputs.frequency}
                className="freq-select"
                value={w.frequency}
                options={WITHDRAWAL_FREQUENCIES.map((v) => ({ value: v, label: t.freq[v] }))}
                onChange={(v) => update((x) => ({ ...x, withdrawal: { ...x.withdrawal, frequency: v } }))}
              />
            </div>
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
                onChange={(v) => update((x) => ({ ...x, withdrawal: { ...x.withdrawal, startYear: Math.round(v) } }), 'w.start')}
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
                  onChange={(v) => update((x) => ({ ...x, withdrawal: { ...x.withdrawal, endYear: Math.round(v) } }), 'w.end')}
                />
              )}
            </div>
            <Switch
              label={t.withdrawal.untilEnd}
              help="withdrawalEnd"
              checked={w.endYear == null}
              onChange={(v) =>
                update((x) => ({
                  ...x,
                  withdrawal: { ...x.withdrawal, endYear: v ? null : Math.max(x.withdrawal.startYear, x.horizonYears) },
                }))
              }
            />
            {s.inflationEnabled && (
              <Switch
                label={t.withdrawal.indexed}
                help="withdrawalIndexed"
                checked={w.indexed}
                onChange={(v) => update((x) => ({ ...x, withdrawal: { ...x.withdrawal, indexed: v } }))}
              />
            )}
            <Switch
              label={t.withdrawal.stop}
              help="withdrawalStop"
              checked={w.stopContributions}
              onChange={(v) => update((x) => ({ ...x, withdrawal: { ...x.withdrawal, stopContributions: v } }))}
            />
          </>
        )}
      </Disclosure>

      <Disclosure
        id="sec-lumps"
        title={t.lumps.title}
        icon={<Icon name="plus" size={17} />}
        active={s.lumpSums.length > 0}
        summary={s.lumpSums.length ? f.money(s.lumpSums.reduce((a, l) => a + l.amount, 0), s.currency, { compact: true }) : t.lumps.summaryNone}
      >
        {s.lumpSums.map((l, i) => (
          <div className="lump-row" key={l.id}>
            <NumberField
              id={`lump-y-${l.id}`}
              size="sm"
              label={t.lumps.year}
              value={l.year}
              min={1}
              max={100}
              step={1}
              onChange={(v) => update((x) => ({ ...x, lumpSums: x.lumpSums.map((y) => (y.id === l.id ? { ...y, year: Math.round(v) } : y)) }), `lump-y-${l.id}`)}
            />
            <NumberField
              id={`lump-a-${l.id}`}
              size="sm"
              label={t.lumps.amount}
              value={l.amount}
              min={0}
              max={1e13}
              step={scaledAmount(10_000, s.currency)}
              {...affix}
              onChange={(v) => update((x) => ({ ...x, lumpSums: x.lumpSums.map((y) => (y.id === l.id ? { ...y, amount: v } : y)) }), `lump-a-${l.id}`)}
            />
            <button
              type="button"
              className="icon-btn"
              aria-label={`${t.lumps.remove} ${i + 1}`}
              onClick={() => update((x) => ({ ...x, lumpSums: x.lumpSums.filter((y) => y.id !== l.id) }))}
            >
              <Icon name="trash" size={17} />
            </button>
          </div>
        ))}
        {issue('lumpSums') && <p className="nf-msg nf-msg--warn">{issue('lumpSums')}</p>}
        <div className="row-with-help">
        <button
          type="button"
          className="btn btn--soft btn--block"
          onClick={() =>
            update((x) => ({
              ...x,
              lumpSums: [...x.lumpSums, { id: uid('l'), year: Math.min(5, Math.max(1, x.horizonYears)), amount: scaledAmount(50_000, x.currency) }],
            }))
          }
        >
          <Icon name="plus" size={16} />
          {t.lumps.add}
        </button>
        <HelpTip topic="lumps" label={t.lumps.title} />
        </div>
      </Disclosure>

      <Disclosure
        id="sec-timing"
        title={t.advanced.title}
        icon={<Icon name="sparkle" size={17} />}
        summary={`${s.startAge != null ? `${s.startAge} ${yrs} · ` : ''}${s.timing === 'start' ? t.advanced.timingStart : t.advanced.timingEnd}`}
      >
        <Switch
          label={t.advanced.startAge}
          help="startAge"
          checked={s.startAge != null}
          onChange={(v) => update((x) => ({ ...x, startAge: v ? 30 : null }))}
        />
        {s.startAge != null && (
          <NumberField
            id="f-age"
            label={t.advanced.startAge}
            value={s.startAge}
            min={0}
            max={120}
            step={1}
            suffix={yrs}
            error={issue('startAge')}
            onChange={(v) => update((x) => ({ ...x, startAge: Math.round(v) }), 'startAge')}
          />
        )}
        <Segmented
          label={t.advanced.timing}
          help="timing"
          value={s.timing}
          options={[
            { value: 'start', label: t.advanced.timingStart },
            { value: 'end', label: t.advanced.timingEnd },
          ]}
          onChange={(v) => update((x) => ({ ...x, timing: v }))}
        />
      </Disclosure>
    </div>
  )
}
