import { simulate, toReal } from '../engine/simulate'
import { PER_YEAR, type Frequency, type PlanInput } from '../engine/types'
import { scaledAmount, type Currency } from '../model/scenario'

/*
 * Numbers used inside help texts. Every value is produced by the same
 * engine as the results (simulate / toReal / PER_YEAR) — never by a
 * separate ad-hoc formula — so an example can never disagree with the app.
 */

const plan = (o: Partial<PlanInput>): PlanInput => ({
  horizonMonths: 12,
  initial: 0,
  annualReturn: 0,
  timing: 'end',
  streams: [],
  lumpSums: [],
  contributionGrowth: 0,
  inflation: 0,
  fees: { annualRate: 0, entryRate: 0, fixedPerDeposit: 0 },
  withdrawal: null,
  ...o,
})

/** A round example amount in the selected currency (100 000 Kč ≈ 4 000 € / $). */
export const baseAmount = (c: Currency, czk = 100_000) => scaledAmount(czk, c)

/** Value of a one-off amount after `months` at an effective annual return. */
export function grow(amount: number, ratePct: number, months = 12): number {
  return simulate(plan({ initial: amount, annualReturn: ratePct / 100, horizonMonths: months })).totals.final
}

/** Purchasing power today of a future nominal amount. */
export function realOf(amount: number, years: number, inflationPct: number): number {
  return toReal(amount, years * 12, inflationPct / 100)
}

/** Contribution per occurrence in plan year 2 after one annual increase (engine indexation). */
export function nextYearContribution(amount: number, growthPct: number): number {
  const r = simulate(
    plan({ horizonMonths: 24, streams: [{ startMonth: 0, endMonth: Infinity, amount, frequency: 'monthly' }], contributionGrowth: growthPct / 100 }),
  )
  return r.years[1].contributions / 12
}

/** Fees taken from one deposit (percentage + fixed), as the engine applies them. */
export function depositFee(amount: number, entryPct: number, fixed: number): number {
  const r = simulate(plan({ initial: amount, horizonMonths: 1, fees: { annualRate: 0, entryRate: entryPct / 100, fixedPerDeposit: fixed } }))
  return r.totals.depositFees
}

/** Final value of a lump sum with and without an annual fee. */
export function feeDrag(amount: number, ratePct: number, feePct: number, years: number) {
  const base = plan({ initial: amount, annualReturn: ratePct / 100, horizonMonths: years * 12 })
  const without = simulate(base).totals.final
  const withFee = simulate({ ...base, fees: { annualRate: feePct / 100, entryRate: 0, fixedPerDeposit: 0 } }).totals.final
  return { without, withFee }
}

/** Deposits per year for a frequency (52 weekly, 12 monthly, …). */
export const perYear = (amount: number, freq: Frequency) => amount * PER_YEAR[freq]

/** Same deposits at the start vs the end of each month for one year. */
export function timingDifference(amount: number, ratePct: number) {
  const mk = (timing: 'start' | 'end') =>
    simulate(plan({ annualReturn: ratePct / 100, timing, streams: [{ startMonth: 0, endMonth: Infinity, amount, frequency: 'monthly' }] })).totals.final
  return { start: mk('start'), end: mk('end') }
}
