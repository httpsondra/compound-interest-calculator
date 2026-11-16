import { monthlyToPayment, scaledAmount, uid, type Scenario } from './scenario'

export type VariantId = 'plusContribution' | 'returnDown' | 'returnUp' | 'longer' | 'fees'

/** Monthly contribution step of the "more per month" preset, in the scenario's currency. */
export const contributionStep = (currency: Scenario['currency']) => scaledAmount(1000, currency)

/**
 * A copy of `base` with one quick change applied. Pure and shared by the Compare previews and by the
 * scenarios they create, so a preview always equals what the created scenario shows.
 * • plusContribution — constant mode: the regular amount; timeline mode: EVERY active period gets the same
 *   monthly step (converted to its own payment frequency). Paused periods stay paused and unchanged.
 * • longer — five more plan years. Withdrawals without an end year run to the end of the plan, so they extend too.
 */
export function applyVariant(id: VariantId, base: Scenario): Scenario {
  const sc: Scenario = { ...base, id: uid('sc') }
  const step = contributionStep(base.currency)
  switch (id) {
    case 'plusContribution':
      return base.contribMode === 'constant'
        ? { ...sc, constant: { ...sc.constant, amount: sc.constant.amount + monthlyToPayment(step, sc.constant.frequency) } }
        : { ...sc, periods: sc.periods.map((p) => ({ ...p, id: uid('p'), amount: p.paused ? p.amount : p.amount + monthlyToPayment(step, p.frequency) })) }
    case 'returnDown':
      return { ...sc, annualReturn: base.annualReturn - 1 }
    case 'returnUp':
      return { ...sc, annualReturn: base.annualReturn + 1 }
    case 'longer':
      return { ...sc, horizonYears: Math.min(100, base.horizonYears + 5) }
    case 'fees':
      return { ...sc, feesEnabled: true, fees: { ...sc.fees, annual: (base.feesEnabled ? base.fees.annual : 0) + 1 } }
  }
}
