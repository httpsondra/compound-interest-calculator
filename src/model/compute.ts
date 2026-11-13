import { simulate } from '../engine/simulate'
import { analyzeGoal, extendPlan, firstCrossing, sustainableWithdrawal, type GoalAnalysis } from '../engine/solvers'
import type { PlanInput, SimResult, SimTotals } from '../engine/types'
import {
  contributionVariable,
  hasErrors,
  inflationRate,
  scaledAmount,
  toPlan,
  toPlanWithoutFees,
  totalMonths,
  validateScenario,
  type Issue,
  type Scenario,
} from './scenario'

export type MilestoneKind = 'million' | 'crossover' | 'goal' | 'withdraw' | 'depleted'
export interface Milestone {
  kind: MilestoneKind
  month: number
  amount?: number
}

export interface Computed {
  issues: Issue[]
  ok: boolean
  plan: PlanInput | null
  result: SimResult | null
  /** Same scenario without fees (only when fees are enabled). */
  noFee: SimTotals | null
  goal: (GoalAnalysis & { month: number }) | null
  /** Largest sustainable withdrawal (only when withdrawals are enabled). */
  sustainable: number | null
  sensitivity: { rate: number; final: number }[] | null
  /** Effect of a larger regular contribution. */
  moreDelta: { delta: number; final: number } | null
  /** Effect of a 5-year shorter investing period (starting later). */
  later: number | null
  milestones: Milestone[]
}

const EMPTY: Omit<Computed, 'issues'> = {
  ok: false,
  plan: null,
  result: null,
  noFee: null,
  goal: null,
  sustainable: null,
  sensitivity: null,
  moreDelta: null,
  later: null,
  milestones: [],
}

export function findMilestones(s: Scenario, res: SimResult, goalMonth: number | null): Milestone[] {
  const out: Milestone[] = []
  const pts = res.points
  for (const threshold of [1_000_000, 10_000_000, 100_000_000]) {
    const p = pts.find((pt) => pt.balance >= threshold)
    if (p && p.month > 0) out.push({ kind: 'million', month: p.month, amount: threshold })
  }
  // Keep only the largest two thresholds to stay subtle.
  const millions = out.filter((m) => m.kind === 'million').slice(-2)
  const result: Milestone[] = [...millions]
  const cross = pts.find((p) => p.month > 0 && p.balance + p.withdrawn - p.contributed > p.contributed && p.contributed > 0)
  if (cross) result.push({ kind: 'crossover', month: cross.month })
  if (goalMonth != null && goalMonth <= res.points.length - 1) result.push({ kind: 'goal', month: goalMonth })
  if (s.withdrawal.enabled) {
    const start = (s.withdrawal.startYear - 1) * 12
    if (start < res.points.length - 1) result.push({ kind: 'withdraw', month: start })
  }
  if (res.totals.depletedAtMonth != null) result.push({ kind: 'depleted', month: res.totals.depletedAtMonth })
  return result.sort((a, b) => a.month - b.month)
}

export function computeScenario(s: Scenario, opts: { full?: boolean } = { full: true }): Computed {
  const issues = validateScenario(s)
  if (hasErrors(issues)) return { ...EMPTY, issues }
  const plan = toPlan(s)
  const result = simulate(plan)
  const full = opts.full !== false
  const H = plan.horizonMonths

  const noFee = s.feesEnabled ? simulate(toPlanWithoutFees(s), { lean: true }).totals : null

  let goal: Computed['goal'] = null
  if (s.goal.enabled && s.goal.target > 0) {
    const month = s.goal.year * 12
    goal = {
      ...analyzeGoal(plan, { target: s.goal.target, month, real: s.goal.real }, contributionVariable(s)),
      month,
    }
  }

  if (!full) {
    return { ...EMPTY, issues, ok: true, plan, result, noFee, goal, milestones: [] }
  }

  const sustainable = s.withdrawal.enabled && plan.withdrawal ? sustainableWithdrawal(plan) : null

  const sensitivity = [-2, 0, 2].map((d) => {
    const rate = s.annualReturn + d
    if (rate <= -100) return { rate, final: NaN }
    return { rate, final: d === 0 ? result.totals.final : simulate({ ...plan, annualReturn: rate / 100 }, { lean: true }).totals.final }
  })

  // "+X per period" insight uses the same contribution variable as the goal solver.
  const delta = scaledAmount(1000, s.currency)
  let moreDelta: Computed['moreDelta'] = null
  if (H >= 12) {
    const variable = contributionVariable(s)
    const current = s.contribMode === 'constant' ? s.constant.amount : 0
    moreDelta = { delta, final: simulate(variable(current + delta), { lean: true }).totals.final }
  }

  // Starting 5 years later: same plan, horizon shortened by 5 years (contributions keep their calendar schedule).
  const later = H > 60 && !s.withdrawal.enabled ? simulate({ ...plan, horizonMonths: H - 60 }, { lean: true }).totals.final : null

  let goalMonth: number | null = null
  if (goal && s.goal.enabled) {
    const cross = firstCrossing(result, s.goal.target, s.goal.real, inflationRate(s))
    goalMonth = cross
  }
  const milestones = findMilestones(s, result, goalMonth)

  return { issues, ok: true, plan, result, noFee, goal, sustainable, sensitivity, moreDelta, later, milestones }
}

/** Light computation for the comparison view: main simulation, fees, and time to goal. */
export function computeSummary(s: Scenario) {
  const issues = validateScenario(s)
  if (hasErrors(issues)) return null
  const plan = toPlan(s)
  const result = simulate(plan)
  let timeToGoal: number | null = null
  if (s.goal.enabled && s.goal.target > 0) {
    timeToGoal = firstCrossing(simulate(extendPlan(plan), { lean: true }), s.goal.target, s.goal.real, plan.inflation)
  }
  return { plan, result, timeToGoal, months: totalMonths(s) }
}

export interface WithdrawalSummary {
  startMonth: number
  /** Balance at the start of the withdrawal phase (read from the simulation, before the first withdrawal). */
  startValue: number
  peak: number
  peakMonth: number
}

/**
 * Display helper for withdrawal plans. It only reads values that the single
 * simulation already produced — the same numbers the chart plots — and adds
 * no calculation of its own.
 */
export function withdrawalSummary(s: Scenario, res: SimResult): WithdrawalSummary | null {
  if (!s.withdrawal.enabled) return null
  const startMonth = (s.withdrawal.startYear - 1) * 12
  if (startMonth >= res.balances.length - 1) return null
  let peak = -Infinity
  let peakMonth = 0
  res.balances.forEach((b, m) => {
    if (b > peak) {
      peak = b
      peakMonth = m
    }
  })
  return { startMonth, startValue: res.balances[startMonth], peak, peakMonth }
}
