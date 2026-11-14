import { simulate } from './simulate'
import { evaluateIncome } from './income'
import type { PlanInput } from './types'

/*
 * Monte Carlo simulation — a deliberately simple, explicitly stated model:
 *
 * • Monthly log returns are independent and normally distributed
 *   (geometric Brownian motion in discrete monthly steps).
 * • The return input R is interpreted as the GEOMETRIC (median) annual
 *   return: ln(1 + R) is the expected annual log return. The median path
 *   therefore grows like the deterministic projection, and the arithmetic
 *   mean annual return is (1 + R)·e^(σ²/2) − 1.
 * • σ is the annual volatility of log returns; monthly σ = σ/√12.
 * • Contributions, fees, withdrawals and inflation are identical to the
 *   deterministic plan and run through the same `simulate()` pipeline.
 * • No fat tails, autocorrelation, regime changes or sequence-specific
 *   market history. Probabilities describe this model, not real markets.
 * • A seeded PRNG (mulberry32 + Box–Muller) makes runs reproducible.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function normalSampler(rand: () => number): () => number {
  let spare: number | null = null
  return () => {
    if (spare !== null) {
      const s = spare
      spare = null
      return s
    }
    let u = 0
    while (u <= Number.EPSILON) u = rand()
    const v = rand()
    const mag = Math.sqrt(-2 * Math.log(u))
    spare = mag * Math.sin(2 * Math.PI * v)
    return mag * Math.cos(2 * Math.PI * v)
  }
}

export interface MonteCarloInput {
  plan: PlanInput
  volatility: number
  simulations: number
  seed: number
  goal?: { target: number; month: number; real: boolean } | null
  /**
   * Spending sustainability: a path "funds the income" only if the income actually paid in
   * EVERY full withdrawal year is at least `monthly` (monthly equivalent; deflated to today's
   * money at the start of each withdrawal year when `real`). A positive balance alone is not success.
   */
  income?: { monthly: number; real: boolean } | null
}

export interface MonteCarloResult {
  /** Month indices sampled for the band chart (every 12 months + the last). */
  months: number[]
  /** Percentile paths (nominal), keyed by percentile. */
  bands: Record<'p10' | 'p25' | 'p50' | 'p75' | 'p90', number[]>
  finals: Float64Array
  finalPercentiles: Record<'p5' | 'p10' | 'p25' | 'p50' | 'p75' | 'p90' | 'p95', number>
  goalProbability: number | null
  depletionProbability: number | null
  /** Share of paths whose income never fell below the desired level. */
  incomeProbability: number | null
  /** Distribution across paths of the lowest monthly income in any full withdrawal year. */
  lowestIncome: Record<'p10' | 'p50' | 'p90', number> | null
  /** Distribution across paths of the first-year monthly income. */
  firstIncome: Record<'p10' | 'p50' | 'p90', number> | null
  simulations: number
}

export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length
  if (n === 0) return NaN
  const pos = (n - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function pct3(a: Float64Array) {
  const s = Float64Array.from(a).sort()
  return { p10: quantileSorted(s, 0.1), p50: quantileSorted(s, 0.5), p90: quantileSorted(s, 0.9) }
}

export function runMonteCarlo(input: MonteCarloInput): MonteCarloResult {
  const { plan, volatility, simulations, seed, goal } = input
  const N = plan.horizonMonths
  const rand = mulberry32(seed)
  const normal = normalSampler(rand)
  const mu = Math.log(1 + plan.annualReturn) / 12
  const sd = volatility / Math.sqrt(12)

  const months: number[] = []
  for (let m = 12; m < N; m += 12) months.push(m)
  months.unshift(0)
  months.push(N)

  const samples = months.map(() => new Float64Array(simulations))
  const finals = new Float64Array(simulations)
  const factors = new Float64Array(N)
  let goalHits = 0
  let depleted = 0
  let incomeHits = 0
  const hasIncome = !!plan.withdrawal
  const lowest = new Float64Array(hasIncome ? simulations : 0)
  const first = new Float64Array(hasIncome ? simulations : 0)
  const incReal = input.income?.real ?? true
  const goalMonth = goal ? Math.min(N, Math.max(0, Math.round(goal.month))) : 0
  const goalDeflator = goal && goal.real ? Math.pow(1 + plan.inflation, goalMonth / 12) : 1

  for (let s = 0; s < simulations; s++) {
    for (let m = 0; m < N; m++) factors[m] = Math.exp(mu + sd * normal())
    const res = simulate(plan, { monthFactors: factors, lean: true })
    const b = res.balances
    for (let i = 0; i < months.length; i++) samples[i][s] = b[months[i]]
    finals[s] = b[N]
    if (goal && b[goalMonth] / goalDeflator >= goal.target) goalHits++
    if (res.totals.depletedAtMonth !== null) depleted++
    if (hasIncome) {
      const ev = evaluateIncome(res.withdrawalYears, plan.inflation, input.income?.monthly ?? 0, incReal)
      lowest[s] = ev.lowest
      first[s] = ev.first
      if (input.income && ev.funded) incomeHits++
    }
  }

  const bands = { p10: [] as number[], p25: [] as number[], p50: [] as number[], p75: [] as number[], p90: [] as number[] }
  for (const col of samples) {
    col.sort()
    bands.p10.push(quantileSorted(col, 0.1))
    bands.p25.push(quantileSorted(col, 0.25))
    bands.p50.push(quantileSorted(col, 0.5))
    bands.p75.push(quantileSorted(col, 0.75))
    bands.p90.push(quantileSorted(col, 0.9))
  }
  const sortedFinals = Float64Array.from(finals).sort()
  return {
    months,
    bands,
    finals: sortedFinals,
    finalPercentiles: {
      p5: quantileSorted(sortedFinals, 0.05),
      p10: quantileSorted(sortedFinals, 0.1),
      p25: quantileSorted(sortedFinals, 0.25),
      p50: quantileSorted(sortedFinals, 0.5),
      p75: quantileSorted(sortedFinals, 0.75),
      p90: quantileSorted(sortedFinals, 0.9),
      p95: quantileSorted(sortedFinals, 0.95),
    },
    goalProbability: goal ? goalHits / simulations : null,
    depletionProbability: plan.withdrawal ? depleted / simulations : null,
    incomeProbability: hasIncome && input.income ? incomeHits / simulations : null,
    lowestIncome: hasIncome ? pct3(lowest) : null,
    firstIncome: hasIncome ? pct3(first) : null,
    simulations,
  }
}
