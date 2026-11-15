import { useI18n } from '../../i18n'
import type { Frequency } from '../../engine/types'
import { CURRENCIES, FREQUENCIES, scaledAmount, type Currency, type Issue } from '../../model/scenario'
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
    <div className="currency" title={t.inputs.currencyHint}>
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
    </div>
  )
}

export function Controls() {
  const { t, f, lang } = useI18n()
  const { scenario: s, update, computed } = useApp()
  const issue = useIssue(computed.issues)
  const affix = f.currencyAffix(s.currency)
  const freqOptions = FREQUENCIES.map((v) => ({ value: v, label: t.freq[v] }))

  return (
    <section className="config-body" aria-labelledby="assumptions-h">
      <h2 id="assumptions-h" className="sr-only">
        {t.inputs.heading}
      </h2>

      <CurrencyPicker />

      {/* Level 1: the four numbers most plans need. Everything else lives under Advanced settings. */}
      <div className="primary-fields">
        <NumberField
          id="f-initial"
          size="md"
          label={t.inputs.initial}
          value={s.initial}
          min={0}
          max={1e13}
          step={scaledAmount(10_000, s.currency)}
          {...affix}
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
                size="md"
                hideLabel
                label={t.inputs.amount}
                ariaLabel={`${t.inputs.contribution} – ${t.inputs.amount}`}
                value={s.constant.amount}
                min={0}
                max={1e12}
                step={scaledAmount(500, s.currency)}
                {...affix}
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
        </div>

        <div className="pair-fields">
          <NumberField
            id="f-years"
            size="md"
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
            id="f-return"
            size="md"
            label={t.inputs.returnShort}
            help="return"
            value={s.annualReturn}
            min={-99}
            max={100}
            step={0.1}
            decimals={2}
            suffix="%"
            slider={{ min: -5, max: 15, step: 0.1 }}
            error={issue('annualReturn', 'error')}
            warning={issue('annualReturn', 'warning')}
            onChange={(v) => update((x) => ({ ...x, annualReturn: v }), 'annualReturn')}
          />
        </div>
      </div>

      <AdvancedSections />
    </section>
  )
}
