import type { WithdrawalYear } from './types'

/*
 * One definition of "the plan funds the desired income", shared by the
 * deterministic analysis and Monte Carlo:
 *
 * • Income of a withdrawal year = paid ÷ 12 (monthly equivalent).
 * • In today's money it is deflated by (1 + π)^(year start / 12).
 * • Every FULL 12-month withdrawal year must reach the desired monthly income.
 *   If the withdrawal phase inside the horizon is shorter than a year, that
 *   partial year is evaluated instead (pro-rated: paid ÷ months).
 * • No withdrawal year at all → not funded (nothing was paid).
 */
export function yearMonthlyIncome(y: WithdrawalYear, inflation: number, real: boolean, prorate = false): number {
  const m = y.paid / (prorate ? Math.max(1, y.months) : 12)
  return real ? m / Math.pow(1 + inflation, y.startMonth / 12) : m
}

export function evaluateIncome(years: WithdrawalYear[], inflation: number, desiredMonthly: number, real: boolean) {
  const full = years.filter((y) => y.months === 12)
  const prorate = full.length === 0
  const ranked = prorate ? years : full
  let firstShortIndex: number | null = null
  let lowest = Infinity
  for (const y of ranked) {
    const v = yearMonthlyIncome(y, inflation, real, prorate)
    if (v < lowest) lowest = v
    if (firstShortIndex === null && v < desiredMonthly * (1 - 1e-9)) firstShortIndex = y.index
  }
  return {
    funded: ranked.length > 0 && firstShortIndex === null,
    firstShortIndex,
    lowest: ranked.length ? lowest : 0,
    first: years.length ? yearMonthlyIncome(years[0], inflation, real, years[0].months !== 12) : 0,
    evaluatedYears: ranked.length,
  }
}
