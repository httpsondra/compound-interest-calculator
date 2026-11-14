import type { WithdrawalYear } from './types'

/*
 * One definition of "the plan funds the desired income", shared by the
 * deterministic analysis and Monte Carlo:
 *
 * • Income of a withdrawal year = paid ÷ 12 (monthly equivalent).
 * • In today's money it is deflated by (1 + π)^(year start / 12).
 * • Every FULL 12-month withdrawal year must reach the desired monthly income.
 *   If the withdrawal phase inside the horizon is shorter than a year, that
 *   partial year is evaluated instead, at its full-year planned rate × the share actually paid.
 * • No withdrawal year at all → not funded (nothing was paid).
 */
export function yearMonthlyIncome(y: WithdrawalYear, inflation: number, real: boolean): number {
  // A full year: paid ÷ 12. A year cut short by the horizon: its full-year planned rate scaled by the
  // share actually paid — never paid ÷ months, which over- or under-states lumpy quarterly/annual payouts.
  const m = y.months >= 12 ? y.paid / 12 : (y.planned / 12) * (y.requested > 0 ? Math.min(1, y.paid / y.requested) : 0)
  return real ? m / Math.pow(1 + inflation, y.startMonth / 12) : m
}

/** Withdrawal years that count: a partial year only if a payment falls inside the horizon. */
export const countedYears = (years: WithdrawalYear[]) => years.filter((y) => y.months >= 12 || y.requested > 0)

export function evaluateIncome(years: WithdrawalYear[], inflation: number, desiredMonthly: number, real: boolean) {
  const counted = countedYears(years)
  const full = counted.filter((y) => y.months === 12)
  const ranked = full.length ? full : counted
  let firstShortIndex: number | null = null
  let lowest = Infinity
  for (const y of ranked) {
    const v = yearMonthlyIncome(y, inflation, real)
    if (v < lowest) lowest = v
    if (firstShortIndex === null && v < desiredMonthly * (1 - 1e-9)) firstShortIndex = y.index
  }
  return {
    funded: ranked.length > 0 && firstShortIndex === null,
    firstShortIndex,
    lowest: ranked.length ? lowest : 0,
    first: counted.length ? yearMonthlyIncome(counted[0], inflation, real) : 0,
    evaluatedYears: ranked.length,
  }
}
