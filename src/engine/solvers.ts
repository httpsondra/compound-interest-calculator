import { MAX_HORIZON_MONTHS, simulate } from './simulate'
import type { PlanInput, SimResult } from './types'

/*
 * Inverse solvers. They never use separate formulas: every candidate is
 * evaluated with the same `simulate()` pipeline, so a solved value always
 * reproduces the target when fed back into the calculator.
 *
 * Final value is affine in a contribution amount or in the initial
 * investment as long as no withdrawal is capped, so we first try an exact
 * two-point affine solve and verify it; if the verification fails (e.g.
 * capped withdrawals make the function non-linear) we fall back to a bounded
 * bisection on the monotone function. Tolerance: 0.01 currency units or
 * 1e-9 relative, maximum 200 iterations.
 */

export type SolveResult =
  | { status: 'ok'; value: number }
  /** The target is met even with the variable at its lower bound (0). */
  | { status: 'not-needed' }
  /** The variable has no effect, or the target cannot be reached within bounds. */
  | { status: 'unreachable' }

const MAX_ITER = 200

export function valueAt(res: SimResult, month: number, real: boolean, inflation: number): number {
  const m = Math.max(0, Math.min(res.balances.length - 1, Math.round(month)))
  const nominal = res.balances[m]
  return real ? nominal / Math.pow(1 + inflation, m / 12) : nominal
}

/**
 * Solve f(x) = target for x ≥ 0 where f is non-decreasing in x.
 */
export function solveMonotone(f: (x: number) => number, target: number, upperLimit = 1e12): SolveResult {
  const tol = Math.max(0.01, Math.abs(target) * 1e-9)
  const f0 = f(0)
  if (f0 >= target - tol) return { status: 'not-needed' }
  const probe = 1000
  const f1 = f(probe)
  const slope = (f1 - f0) / probe
  if (!(slope > 1e-12)) return { status: 'unreachable' }
  const guess = (target - f0) / slope
  if (guess >= 0 && guess <= upperLimit && Math.abs(f(guess) - target) <= tol) {
    return { status: 'ok', value: guess }
  }
  // Bisection fallback.
  let lo = 0
  let hi = Math.max(probe, Number.isFinite(guess) && guess > 0 ? guess : probe)
  let iter = 0
  while (f(hi) < target && iter < 80) {
    hi *= 2
    iter++
    if (hi > upperLimit) return { status: 'unreachable' }
  }
  for (let i = 0; i < MAX_ITER; i++) {
    const mid = (lo + hi) / 2
    if (f(mid) >= target) hi = mid
    else lo = mid
    if (hi - lo < 0.005) break
  }
  return { status: 'ok', value: hi }
}

/** Open-ended copy of a plan, used to look beyond the horizon (time-to-goal). */
export function extendPlan(plan: PlanInput, months = MAX_HORIZON_MONTHS): PlanInput {
  const H = plan.horizonMonths
  return {
    ...plan,
    horizonMonths: months,
    streams: plan.streams.map((s) => (s.endMonth >= H ? { ...s, endMonth: Infinity } : s)),
    withdrawal: plan.withdrawal
      ? {
          ...plan.withdrawal,
          endMonth: plan.withdrawal.endMonth >= H ? Infinity : plan.withdrawal.endMonth,
        }
      : null,
  }
}

/** First month whose (nominal or real) end balance is ≥ target, or null. */
export function firstCrossing(res: SimResult, target: number, real: boolean, inflation: number): number | null {
  const b = res.balances
  const k = Math.pow(1 + inflation, 1 / 12)
  for (let m = 0; m < b.length; m++) {
    const v = real ? b[m] / Math.pow(k, m) : b[m]
    if (v >= target) return m
  }
  return null
}

export interface GoalInput {
  target: number
  /** Month at which the target should be met. */
  month: number
  /** Compare against today's purchasing power instead of nominal values. */
  real: boolean
}

export interface GoalAnalysis {
  projected: number
  gap: number
  reached: boolean
  /** Month at which the current plan (continued past the horizon) first reaches the target. */
  timeToGoal: number | null
  /** Solve for the variable contribution amount. */
  contribution: SolveResult
  /** Solve for an extra one-time investment made today. */
  extraInitial: SolveResult
}

export function analyzeGoal(
  plan: PlanInput,
  goal: GoalInput,
  /** Builds a plan with the contribution variable set to x (≥ 0). */
  withContribution: (x: number) => PlanInput,
): GoalAnalysis {
  const atMonth = Math.min(Math.max(1, Math.round(goal.month)), MAX_HORIZON_MONTHS)
  // A goal after the horizon is evaluated on the plan continued past its end
  // (open-ended contributions keep running), matching time-to-goal.
  const evalAt = (p: PlanInput) => {
    const q = atMonth > p.horizonMonths ? extendPlan(p, atMonth) : { ...p, horizonMonths: atMonth }
    return valueAt(simulate(q, { lean: true }), atMonth, goal.real, p.inflation)
  }

  const projected = evalAt(plan)
  const extended = simulate(extendPlan(plan), { lean: true })
  const timeToGoal = firstCrossing(extended, goal.target, goal.real, plan.inflation)

  const contribution = solveMonotone((x) => evalAt(withContribution(x)), goal.target)
  const extraInitial = solveMonotone((x) => evalAt({ ...plan, initial: plan.initial + x }), goal.target)

  return {
    projected,
    gap: goal.target - projected,
    reached: projected >= goal.target,
    timeToGoal,
    contribution,
    extraInitial,
  }
}

/**
 * Largest withdrawal amount (per occurrence, in plan-year-1 terms) that the
 * portfolio can pay in full until the end of the horizon under the
 * deterministic assumptions.
 */
export function sustainableWithdrawal(plan: PlanInput): number | null {
  if (!plan.withdrawal) return null
  const w = plan.withdrawal
  const survives = (amount: number) =>
    simulate({ ...plan, withdrawal: { ...w, amount } }, { lean: true }).totals.depletedAtMonth === null
  let lo = 0
  let hi = 1000
  let guard = 0
  while (survives(hi) && guard < 60) {
    lo = hi
    hi *= 2
    guard++
  }
  if (guard >= 60) return Infinity
  for (let i = 0; i < MAX_ITER; i++) {
    const mid = (lo + hi) / 2
    if (survives(mid)) lo = mid
    else hi = mid
    if (hi - lo < 0.005) break
  }
  return lo
}
