/**
 * Financial engine types.
 *
 * All rates are decimals (0.07 = 7 %). All time values are in MONTHS from the
 * start of the plan (t = 0). Money values are plain float64 numbers in the
 * scenario's currency unit; nothing is rounded inside the engine.
 */

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual'
export type Timing = 'start' | 'end'

/** Interval between two cashflows of a given frequency, in months. */
export const FREQUENCY_MONTHS: Record<Frequency, number> = {
  weekly: 12 / 52,
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
}

/** Number of cashflows per year for a given frequency. */
export const PER_YEAR: Record<Frequency, number> = {
  weekly: 52,
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
}

/** A recurring contribution stream active on the half-open interval [startMonth, endMonth). */
export interface ContributionStream {
  startMonth: number
  /** Exclusive. `Infinity` means "until the plan ends" (also used when the horizon is extended). */
  endMonth: number
  /** Amount per occurrence, in plan-year-1 terms (before indexation). */
  amount: number
  frequency: Frequency
}

export interface LumpSum {
  /** Deposited at the very start of this month. */
  month: number
  amount: number
}

export interface FeeSettings {
  /** Annual percentage charged on the portfolio balance, as an effective annual rate. */
  annualRate: number
  /** Percentage deducted from every deposit (including the initial investment). */
  entryRate: number
  /** Fixed amount deducted from every deposit (capped at the deposit). */
  fixedPerDeposit: number
}

export interface WithdrawalPlan {
  startMonth: number
  /** Exclusive end. Infinity = until the plan ends. */
  endMonth: number
  /** Amount per occurrence, in plan-year-1 terms (before indexation). */
  amount: number
  frequency: Frequency
  /** When true, contributions stop from `startMonth` onward. */
  stopContributions: boolean
  /** Annual increase applied at each plan-year anniversary (e.g. inflation). */
  indexRate: number
  timing: Timing
}

export interface PlanInput {
  horizonMonths: number
  initial: number
  /** Effective annual return R (> -1). */
  annualReturn: number
  timing: Timing
  streams: ContributionStream[]
  lumpSums: LumpSum[]
  /** Contribution growth applied at each plan-year anniversary, e.g. 0.03. */
  contributionGrowth: number
  /** Annual inflation π, used only for real (today's-money) values. */
  inflation: number
  fees: FeeSettings
  withdrawal: WithdrawalPlan | null
}

export interface SimPoint {
  /** Month index (0 … horizon). Values are at the END of month t (t = 0 → right after the initial deposit). */
  month: number
  balance: number
  /** Balance deflated to today's purchasing power. */
  real: number
  /** Cumulative gross deposits (initial + contributions + lump sums). */
  contributed: number
  /** Cumulative withdrawals actually paid out. */
  withdrawn: number
  /** Cumulative market growth (before management fees). */
  growth: number
  /** Cumulative fees of every kind. */
  fees: number
}

export interface PeriodRow {
  /** 1-based plan year. */
  year: number
  /** Months covered in this row (12, except possibly the last row). */
  months: number
  startBalance: number
  contributions: number
  withdrawals: number
  growth: number
  fees: number
  endBalance: number
  endReal: number
}

export interface SimTotals {
  final: number
  finalReal: number
  contributed: number
  withdrawn: number
  /** Market growth before fees. */
  growth: number
  managementFees: number
  depositFees: number
  fees: number
  /** final + withdrawn − contributed: what the investments added after all fees. */
  netGain: number
  /** First month (1-based end-of-month index) in which the portfolio could not pay a full withdrawal. */
  depletedAtMonth: number | null
  /** Total withdrawal amount that could not be paid. */
  shortfall: number
}

export interface SimResult {
  /** Balance at the end of each month, index 0 = right after the initial deposit. */
  balances: Float64Array
  points: SimPoint[]
  years: PeriodRow[]
  totals: SimTotals
}
