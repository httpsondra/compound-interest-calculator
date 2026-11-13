import { useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { totalMonths } from '../../model/scenario'
import { useApp } from '../../state/context'
import { downloadCsv } from '../../lib/csv'
import { Icon } from '../ui/Icon'
import { HelpTip } from '../ui/HelpTip'
import type { SolveResult } from '../../engine/solvers'

export function Insights() {
  const { t, f, fill, years } = useI18n()
  const { scenario: s, computed } = useApp()
  const res = computed.result
  if (!res) return null
  const tot = res.totals
  const money = (v: number) => f.money(v, s.currency)
  const items: string[] = []
  if (!s.withdrawal.enabled && tot.final > 0) {
    if (tot.netGain >= 0) items.push(fill(t.insights.share, { pct: f.pct((tot.netGain / tot.final) * 100, 0) }))
    else items.push(fill(t.insights.shareNeg, { amount: money(-tot.netGain) }))
  }
  if (computed.moreDelta) {
    const diff = computed.moreDelta.final - tot.final
    const per = s.contribMode === 'constant' ? t.per[s.constant.frequency] : t.per.monthly
    if (diff > 0) items.push(fill(t.insights.more, { delta: money(computed.moreDelta.delta), per, amount: money(diff) }))
  }
  if (computed.later != null && tot.final - computed.later > 0) items.push(fill(t.insights.earlier, { amount: money(tot.final - computed.later) }))
  if (s.inflationEnabled && s.inflation !== 0) items.push(fill(t.insights.inflation, { rate: f.pct(s.inflation, 2), amount: money(tot.finalReal) }))
  if (computed.noFee && computed.noFee.final > 0) {
    const d = computed.noFee.final - tot.final
    if (d > 0) items.push(fill(t.insights.fees, { amount: money(d), pct: f.pct((d / computed.noFee.final) * 100, 1) }))
  }
  if (s.annualReturn > 0.5) {
    const yrs = Math.log(2) / Math.log(1 + s.annualReturn / 100)
    items.push(fill(t.insights.doubling, { rate: f.pct(s.annualReturn, 2), years: years(Math.round(yrs * 10) / 10) }))
  }
  if (!items.length) return null
  return (
    <section className="block insights" aria-labelledby="insights-h">
      <div className="title-row">
        <h2 id="insights-h" className="section-title">
          {t.insights.title}
        </h2>
        <HelpTip topic="insights" label={t.insights.title} />
      </div>
      <ul className="insight-list">
        {items.map((it) => (
          <li key={it}>{it}</li>
        ))}
      </ul>
    </section>
  )
}

function solveText(r: SolveResult, fmt: (v: number) => string, t: ReturnType<typeof useI18n>['t']) {
  if (r.status === 'ok') return fmt(r.value)
  return r.status === 'not-needed' ? t.goal.notNeeded : t.goal.unreachable
}

export function GoalCard() {
  const { t, f, fill } = useI18n()
  const { scenario: s, computed } = useApp()
  const g = computed.goal
  if (!s.goal.enabled || !g) return null
  const money = (v: number) => f.money(v, s.currency)
  const goalYear = s.goal.year
  const H = totalMonths(s)
  const ttg = g.timeToGoal
  const ttgYear = ttg != null ? Math.max(1, Math.ceil(ttg / 12)) : null
  const pct = Math.min(1, Math.max(0, g.projected / Math.max(1, s.goal.target)))
  const constant = s.contribMode === 'constant'
  return (
    <section className={`card goal-card${g.reached ? ' is-reached' : ''}`} aria-labelledby="goal-h">
      <header className="card-head">
        <div className="title-row">
          <h2 id="goal-h" className="section-title">
            <Icon name="target" size={18} /> {t.goal.cardTitle}
          </h2>
          <HelpTip topic="goal" label={t.goal.cardTitle} />
        </div>
        <span className="chip">{money(s.goal.target)}{s.goal.real ? ` · ${t.results.real}` : ''}</span>
      </header>
      <p className="goal-status" role="status">
        {g.reached
          ? fill(t.goal.reached, { target: money(s.goal.target), year: goalYear })
          : fill(t.goal.notReached, { gap: money(g.gap), year: goalYear })}
      </p>
      <div className="goal-progress" aria-hidden="true">
        <span style={{ width: `${pct * 100}%` }} />
      </div>
      {goalYear * 12 > H && <p className="note">{t.goal.beyondHorizon}</p>}
      <dl className="tiles">
        <div className="tile">
          <dt>{fill(t.goal.projectedAt, { year: goalYear })}</dt>
          <dd>{money(g.projected)}</dd>
        </div>
        <div className="tile">
          <dt>{g.reached ? t.goal.surplus : t.goal.gap}</dt>
          <dd className={g.reached ? 'is-pos' : 'is-warn'}>{money(Math.abs(g.gap))}</dd>
        </div>
        <div className="tile">
          <dt>{t.goal.timeLabel}
            <HelpTip topic="timeToGoal" label={t.goal.timeLabel} />
          </dt>
          <dd className="tile-text">
            {ttgYear != null
              ? s.startAge != null
                ? fill(t.goal.timeToAge, { year: ttgYear, age: s.startAge + ttgYear - 1 })
                : fill(t.goal.timeTo, { year: ttgYear })
              : t.goal.never}
          </dd>
        </div>
        <div className="tile">
          <dt>{constant ? t.goal.requiredConstant : t.goal.requiredExtra}
            <HelpTip topic="requiredContribution" label={t.goal.requiredConstant} />
          </dt>
          <dd>
            {solveText(g.contribution, (v) => `${money(v)} ${constant ? t.per[s.constant.frequency] : t.per.monthly}`, t)}
            {constant && <span className="tile-sub">{fill(t.goal.current, { amount: `${money(s.constant.amount)} ${t.per[s.constant.frequency]}` })}</span>}
          </dd>
        </div>
        <div className="tile">
          <dt>{t.goal.requiredLump}
            <HelpTip topic="extraLump" label={t.goal.requiredLump} />
          </dt>
          <dd>{solveText(g.extraInitial, money, t)}</dd>
        </div>
      </dl>
    </section>
  )
}

export function FeeCard() {
  const { t, f } = useI18n()
  const { scenario: s, computed } = useApp()
  const res = computed.result
  if (!s.feesEnabled || !res || !computed.noFee) return null
  const money = (v: number) => f.money(v, s.currency)
  const diff = computed.noFee.final - res.totals.final
  const paid = res.totals.fees
  const foregone = diff - paid
  return (
    <section className="block" aria-labelledby="fees-h">
      <header className="card-head">
        <div className="title-row">
          <h2 id="fees-h" className="section-title">
            {t.fees.cardTitle}
          </h2>
          <HelpTip topic="feeImpact" label={t.fees.cardTitle} />
        </div>
      </header>
      <div className="fee-compare">
        <div>
          <span className="fee-label">{t.fees.withoutFees}</span>
          <span className="fee-val">{money(computed.noFee.final)}</span>
          <span className="fee-bar" style={{ width: '100%' }} />
        </div>
        <div>
          <span className="fee-label">{t.fees.withFees}</span>
          <span className="fee-val">{money(res.totals.final)}</span>
          <span className="fee-bar fee-bar--with" style={{ width: `${computed.noFee.final > 0 ? (res.totals.final / computed.noFee.final) * 100 : 0}%` }} />
        </div>
      </div>
      <dl className="tiles tiles--3">
        <div className="tile">
          <dt>{t.fees.difference}</dt>
          <dd className="is-neg">{money(diff)}</dd>
        </div>
        <div className="tile">
          <dt>{t.fees.paid}</dt>
          <dd>{money(paid)}</dd>
        </div>
        <div className="tile">
          <dt>{t.fees.foregone}</dt>
          <dd>{money(Math.max(0, foregone))}</dd>
        </div>
      </dl>
      <p className="note">{t.fees.explain}</p>
    </section>
  )
}

export function WithdrawalCard() {
  const { t, f, fill } = useI18n()
  const { scenario: s, computed } = useApp()
  const res = computed.result
  if (!s.withdrawal.enabled || !res) return null
  const money = (v: number) => f.money(v, s.currency)
  const dep = res.totals.depletedAtMonth
  const depYear = dep != null ? Math.ceil(dep / 12) : null
  return (
    <section className={`block${dep != null ? ' is-alert' : ''}`} aria-labelledby="wd-h">
      <header className="card-head">
        <div className="title-row">
          <h2 id="wd-h" className="section-title">
            {t.withdrawal.cardTitle}
          </h2>
          <HelpTip topic="withdrawals" label={t.withdrawal.cardTitle} />
        </div>
      </header>
      <p className={`goal-status${dep != null ? ' is-neg' : ''}`} role="status">
        {depYear != null
          ? s.startAge != null
            ? fill(t.withdrawal.depletedAge, { year: depYear, age: s.startAge + depYear - 1 })
            : fill(t.withdrawal.depleted, { year: depYear })
          : t.withdrawal.lasts}
      </p>
      <dl className="tiles">
        <div className="tile">
          <dt>{t.withdrawal.total}
            <HelpTip topic="withdrawn" label={t.withdrawal.total} />
          </dt>
          <dd>{money(res.totals.withdrawn)}</dd>
        </div>
        <div className="tile">
          <dt>{t.withdrawal.remaining}</dt>
          <dd>{money(res.totals.final)}</dd>
        </div>
        {computed.sustainable && (
          <div className="tile">
            <dt>
              {computed.sustainable.kind === 'rate' ? t.withdrawal.sustainableRate : t.withdrawal.sustainable}
              <HelpTip topic="sustainable" label={t.withdrawal.sustainable} />
            </dt>
            <dd>
              {computed.sustainable.kind === 'rate'
                ? f.pct(computed.sustainable.value * 100, 2)
                : Number.isFinite(computed.sustainable.value)
                  ? `${money(computed.sustainable.value)} ${t.per[s.withdrawal.frequency]}`
                  : '—'}
              {computed.sustainable.kind === 'amount' && s.withdrawal.indexed && s.inflationEnabled && <span className="tile-sub">{t.results.real}</span>}
              {computed.sustainable.kind === 'rate' && res.withdrawalYears[0] && (
                <span className="tile-sub">
                  ≈ {money((computed.sustainable.value * res.withdrawalYears[0].reviewBalance) / 12)} {t.per.monthly}
                </span>
              )}
            </dd>
          </div>
        )}
        {res.totals.shortfall > 0 && (
          <div className="tile">
            <dt>{t.withdrawal.shortfall}
            <HelpTip topic="shortfall" label={t.withdrawal.shortfall} />
          </dt>
            <dd className="is-neg">{money(res.totals.shortfall)}</dd>
          </div>
        )}
      </dl>
    </section>
  )
}

export function Sensitivity() {
  const { t, f } = useI18n()
  const { scenario: s, computed } = useApp()
  const sens = computed.sensitivity
  if (!sens) return null
  const max = Math.max(...sens.map((x) => (Number.isFinite(x.final) ? x.final : 0)), 1)
  const labels = [t.sensitivity.lower, t.sensitivity.base, t.sensitivity.higher]
  return (
    <section className="block" aria-labelledby="sens-h">
      <header className="card-head">
        <div className="title-row">
          <h2 id="sens-h" className="section-title">
            {t.sensitivity.title}
          </h2>
          <HelpTip topic="sensitivity" label={t.sensitivity.title} />
        </div>
      </header>
      <ul className="sens">
        {sens.map((x, i) => (
          <li key={i} className={i === 1 ? 'is-base' : undefined}>
            <span className="sens-label">
              {labels[i]} <span className="sens-rate">{f.pct(x.rate, 2)}</span>
            </span>
            <span className="sens-track">
              <span className="sens-bar" style={{ width: `${Number.isFinite(x.final) ? (Math.max(0, x.final) / max) * 100 : 0}%` }} />
            </span>
            <span className="sens-val">{f.money(x.final, s.currency)}</span>
          </li>
        ))}
      </ul>
      <p className="note">{t.sensitivity.hint}</p>
    </section>
  )
}

export function YearTable() {
  const { t, f, fill, lang, duration } = useI18n()
  const { scenario: s, computed } = useApp()
  const [open, setOpen] = useState(false)
  const res = computed.result
  if (!res) return null
  const money = (v: number) => f.money(v, s.currency)
  const hasW = res.totals.withdrawn > 0 || s.withdrawal.enabled
  const hasF = res.totals.fees > 0
  const hasR = s.inflationEnabled
  const age = s.startAge
  const cols = [
    { key: 'year', label: t.table.year },
    ...(age != null ? [{ key: 'age', label: t.table.age }] : []),
    { key: 'start', label: t.table.start },
    { key: 'contributions', label: t.table.contributions },
    ...(hasW ? [{ key: 'withdrawals', label: t.table.withdrawals }] : []),
    { key: 'growth', label: t.table.growth },
    ...(hasF ? [{ key: 'fees', label: t.table.fees }] : []),
    { key: 'end', label: t.table.end },
    ...(hasR ? [{ key: 'real', label: t.table.real }] : []),
  ]
  const cell = (key: string, y: (typeof res.years)[number]) => {
    switch (key) {
      case 'year':
        return y.months < 12 ? `${y.year} (${fill(t.table.partial, { months: y.months })})` : String(y.year)
      case 'age':
        return String((age ?? 0) + y.year)
      case 'start':
        return money(y.startBalance)
      case 'contributions':
        return money(y.contributions)
      case 'withdrawals':
        return y.withdrawals ? `−${money(y.withdrawals)}` : money(0)
      case 'growth':
        return f.money(y.growth, s.currency, { signed: true })
      case 'fees':
        return y.fees ? `−${money(y.fees)}` : money(0)
      case 'end':
        return money(y.endBalance)
      case 'real':
        return money(y.endReal)
    }
    return ''
  }
  const exportCsv = () => {
    downloadCsv({
      lang,
      filename: `investcalc-${(s.name || 'plan').replace(/[^\w-]+/g, '-').toLowerCase()}.csv`,
      meta: [
        [t.results.hypothetical, ''],
        [t.inputs.currency, s.currency],
        [t.inputs.initial, s.initial],
        [t.inputs.annualReturn, `${s.annualReturn} %`],
        [t.inputs.horizon, duration(totalMonths(s))],
        ...(s.inflationEnabled ? [[t.inflation.rate, `${s.inflation} %`] as [string, string]] : []),
        ...(s.feesEnabled ? [[t.fees.annual, `${s.fees.annual} %`] as [string, string]] : []),
      ],
      header: cols.map((c) => (c.key === 'year' || c.key === 'age' ? c.label : `${c.label} (${s.currency})`)),
      rows: res.years.map((y) =>
        cols.map((c) => {
          switch (c.key) {
            case 'year':
              return y.year
            case 'age':
              return (age ?? 0) + y.year
            case 'start':
              return y.startBalance
            case 'contributions':
              return y.contributions
            case 'withdrawals':
              return y.withdrawals
            case 'growth':
              return y.growth
            case 'fees':
              return y.fees
            case 'end':
              return y.endBalance
            case 'real':
              return y.endReal
          }
          return ''
        }),
      ),
    })
  }
  return (
    <section className="card table-card" aria-labelledby="table-h">
      <header className="card-head">
        <div className="title-row">
          <h2 id="table-h" className="section-title">
            {t.table.title}
          </h2>
          <HelpTip topic="yearTable" label={t.table.title} />
        </div>
        <div className="card-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={exportCsv}>
            <Icon name="download" size={16} />
            {t.table.csv}
          </button>
          <button type="button" className="btn btn--ghost btn--sm print-hide" onClick={() => window.print()}>
            <Icon name="print" size={16} />
            {t.table.print}
          </button>
        </div>
      </header>
      <button type="button" className="btn btn--soft btn--block table-toggle" aria-expanded={open} aria-controls="year-table" onClick={() => setOpen(!open)}>
        {open ? t.table.hide : t.table.show}
        <Icon name="chevron" size={16} className={open ? 'rot-180' : undefined} />
      </button>
      <div id="year-table" className={`table-wrap${open ? '' : ' is-collapsed'}`}>
        <table className="ytable">
          <caption className="sr-only">{t.table.caption}</caption>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} scope="col" className={c.key === 'year' || c.key === 'age' ? 'is-key' : undefined}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {res.years.map((y) => (
              <tr key={y.year}>
                {cols.map((c) =>
                  c.key === 'year' ? (
                    <th key={c.key} scope="row" data-label={c.label} className="is-key">
                      {cell(c.key, y)}
                    </th>
                  ) : (
                    <td key={c.key} data-label={c.label} className={`col-${c.key}`}>
                      {cell(c.key, y)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note">{t.table.reconcile}</p>
      </div>
    </section>
  )
}

export function Conventions() {
  const { t } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const items = (
    <ol className="conv-list">
      {t.conventions.items.map((it) => (
        <li key={it}>{it}</li>
      ))}
    </ol>
  )
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="method-link"
        aria-haspopup="dialog"
        onClick={() => ref.current?.showModal()}
      >
        <Icon name="info" size={15} />
        {t.conventions.title}
      </button>
      <dialog
        ref={ref}
        className="dialog"
        aria-labelledby="conv-h"
        onClose={() => trigger.current?.focus()}
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close()
        }}
      >
        <div className="dialog-inner">
          <header className="dialog-head">
            <h2 id="conv-h" className="section-title">
              {t.conventions.title}
            </h2>
            <button type="button" className="icon-btn" aria-label={t.common.close} onClick={() => ref.current?.close()}>
              <Icon name="close" size={17} />
            </button>
          </header>
          {items}
        </div>
      </dialog>
      <section className="print-only" aria-hidden="true">
        <h2>{t.conventions.title}</h2>
        {items}
      </section>
    </>
  )
}
