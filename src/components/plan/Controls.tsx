import { useI18n } from '../../i18n'
import type { Frequency } from '../../engine/types'
import { CURRENCIES, FREQUENCIES, PER_YEAR_SCALE, scaledAmount, type Currency, type Issue } from '../../model/scenario'
import { useApp } from '../../state/context'
import { NumberField } from '../ui/NumberField'
import { Segmented, Select } from '../ui/controls'
import { HelpTip } from '../ui/HelpTip'
import { Timeline } from './Timeline'
import { AdvancedSections } from './AdvancedSections'

export function useIssue(issues: Issue[]) {
  const { t, fill } = useI18n()
  return (field: string, severity?: 'error' | 'warning') => {
    const i = issues.find((x) => x.field === field && (!severity || x.severity === severity))
    return i ? fill(t.validation[i.code], (i.params ?? {}) as Record<string, string | number>) : null
  }
}

export function CurrencyPicker() {
  const { t, f, fill } = useI18n()
  const { scenario: s, update, toast } = useApp()
  return (
    <div className="currency">
      <Segmented<Currency>
        size="sm"
        label={t.inputs.currency}
        help="currency"
        className="currency-seg"
        value={s.currency}
        options={CURRENCIES.map((c) => ({
          value: c,
          label: (
            <span className="cur-opt">
              {f.currencySymbol(c) !== c && (
                <span className="cur-sym" aria-hidden="true">
                  {f.currencySymbol(c)}
                </span>
              )}
              {c}
            </span>
          ),
        }))}
        onChange={(c) => {
          if (c === s.currency) return
          update((x) => ({ ...x, currency: c }), 'currency')
          toast(fill(t.inputs.currencyChanged, { currency: c }))
        }}
      />
      <p className="currency-hint">{t.inputs.currencyHint}</p>
    </div>
  )
}

export function Controls() {
  const { t, f, lang } = useI18n()
  const { scenario: s, update, computed } = useApp()
  const issue = useIssue(computed.issues)
  const affix = f.currencyAffix(s.currency)
  const amountMax = (freq: Frequency) => scaledAmount(100_000, s.currency) * PER_YEAR_SCALE[freq]
  const freqOptions = FREQUENCIES.map((v) => ({ value: v, label: t.freq[v] }))

  return (
    <section className="config-body" aria-labelledby="assumptions-h">
      <h2 id="assumptions-h" className="sr-only">
        {t.inputs.heading}
      </h2>

      <CurrencyPicker />

      <div className="field-stack">
        <NumberField
          id="f-initial"
          size="lg"
          help="initial"
          label={t.inputs.initial}
          value={s.initial}
          min={0}
          max={1e13}
          step={scaledAmount(10_000, s.currency)}
          {...affix}
          slider={{ min: 0, max: scaledAmount(10_000_000, s.currency), scale: 'pow' }}
          onChange={(v) => update((x) => ({ ...x, initial: v }), 'initial')}
        />

        <div className="field-group">
          <div className="field-group-head">
            <span className="field-head">
              <span className="nf-label" id="contrib-label">
                {t.inputs.contribution}
              </span>
              <HelpTip topic={s.contribMode === 'constant' ? 'contribution' : 'timeline'} label={t.inputs.contribution} />
            </span>
            <Segmented
              size="xs"
              hideLabel
              label={t.inputs.contribMode}
              value={s.contribMode}
              options={[
                { value: 'constant', label: t.inputs.constant },
                { value: 'schedule', label: t.inputs.schedule },
              ]}
              onChange={(v) => update((x) => ({ ...x, contribMode: v }))}
            />
          </div>
          {s.contribMode === 'constant' ? (
            <div className="contrib-row">
              <NumberField
                id="f-contribution"
                size="lg"
                hideLabel
                label={t.inputs.amount}
                ariaLabel={`${t.inputs.contribution} – ${t.inputs.amount}`}
                value={s.constant.amount}
                min={0}
                max={1e12}
                step={scaledAmount(500, s.currency)}
                {...affix}
                slider={{ min: 0, max: amountMax(s.constant.frequency), scale: 'pow' }}
                onChange={(v) => update((x) => ({ ...x, constant: { ...x.constant, amount: v } }), 'constant.amount')}
              />
              <Select<Frequency>
                label={t.inputs.frequency}
                hideLabel
                className="freq-select"
                value={s.constant.frequency}
                options={freqOptions}
                onChange={(v) => update((x) => ({ ...x, constant: { ...x.constant, frequency: v } }))}
              />
            </div>
          ) : (
            <Timeline />
          )}
          <div className="growth-row">
            <Segmented
              size="xs"
              label={t.inputs.growth}
              help="growth"
              value={s.growthMode}
              options={[
                { value: 'none', label: t.inputs.growthNone },
                { value: 'custom', label: t.inputs.growthCustom },
                { value: 'inflation', label: t.inputs.growthInflation },
              ]}
              onChange={(v) => update((x) => ({ ...x, growthMode: v, inflationEnabled: v === 'inflation' ? true : x.inflationEnabled }))}
            />
            {s.growthMode === 'custom' && (
              <NumberField
                id="f-growth"
                size="sm"
                label={t.inputs.growthRate}
                value={s.growthRate}
                min={-50}
                max={50}
                step={0.5}
                decimals={2}
                suffix="%"
                error={issue('growthRate')}
                onChange={(v) => update((x) => ({ ...x, growthRate: v }), 'growthRate')}
              />
            )}
          </div>
        </div>

        <div className="horizon-row">
          <NumberField
            id="f-years"
            size="lg"
            help="horizon"
            label={t.inputs.horizon}
            ariaLabel={`${t.inputs.horizon} – ${t.inputs.years}`}
            value={s.horizonYears}
            min={0}
            max={100}
            step={1}
            suffix={lang === 'cs' ? 'let' : 'yrs'}
            slider={{ min: 1, max: 60, step: 1 }}
            error={issue('horizon')}
            onChange={(v) => update((x) => ({ ...x, horizonYears: Math.round(v) }), 'horizonYears')}
          />
          <NumberField
            id="f-months"
            size="lg"
            label={t.inputs.months}
            value={s.horizonMonths}
            min={0}
            max={11}
            step={1}
            suffix={lang === 'cs' ? 'měs.' : 'mo'}
            onChange={(v) => update((x) => ({ ...x, horizonMonths: Math.round(v) }), 'horizonMonths')}
          />
        </div>

        <NumberField
          id="f-return"
          size="lg"
          label={t.inputs.annualReturn}
          help="return"
          value={s.annualReturn}
          min={-99}
          max={100}
          step={0.1}
          decimals={2}
          suffix={lang === 'cs' ? '% p. a.' : '% p.a.'}
          slider={{ min: -5, max: 15, step: 0.1 }}
          error={issue('annualReturn', 'error')}
          warning={issue('annualReturn', 'warning')}
          onChange={(v) => update((x) => ({ ...x, annualReturn: v }), 'annualReturn')}
        />
      </div>

      <AdvancedSections />
    </section>
  )
}
