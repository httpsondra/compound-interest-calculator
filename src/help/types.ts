import type { Computed } from '../model/compute'
import type { Scenario } from '../model/scenario'
import type { Formatter } from '../lib/format'

export const HELP_IDS = [
  // Main calculator
  'currency',
  'initial',
  'contribution',
  'frequency',
  'timeline',
  'growth',
  'horizon',
  'return',
  'timing',
  // Timeline
  'periodFrequency',
  'boundaries',
  'paused',
  'gaps',
  // Goals
  'goal',
  'goalTarget',
  'goalYear',
  'goalReal',
  'requiredContribution',
  'timeToGoal',
  'extraLump',
  // Inflation
  'inflation',
  'inflationRate',
  'nominalReal',
  // Fees
  'fees',
  'feeAnnual',
  'feeEntry',
  'feeFixed',
  'feeImpact',
  // Withdrawals
  'withdrawals',
  'withdrawalAmount',
  'withdrawalStart',
  'withdrawalEnd',
  'withdrawalIndexed',
  'withdrawalStop',
  'sustainable',
  'shortfall',
  // Retirement & financial independence
  'withdrawalStrategy',
  'rule4',
  'currentPct',
  'guardrails',
  'withdrawalRate',
  'guardLimits',
  'incomeFloor',
  'desiredIncome',
  'retirementIncome',
  'realIncome',
  'lowestIncome',
  'incomeFunding',
  'requiredCapital',
  'financialIndependence',
  'retirementHorizon',
  'sequenceRisk',
  'stressTest',
  'strategyCompare',
  'incomeProbability',
  // Other settings
  'lumps',
  'startAge',
  // Results
  'projected',
  'assumptions',
  'todayMoney',
  'contributed',
  'gain',
  'gainShare',
  'withdrawalStartValue',
  'depletion',
  'withdrawn',
  'endValue',
  'peak',
  'chart',
  'milestones',
  'insights',
  'sensitivity',
  'yearTable',
  // Compare
  'compare',
  'compareDiff',
  // Risk
  'monteCarlo',
  'riskReturn',
  'volatility',
  'simulations',
  'median',
  'percentiles',
  'goalProbability',
  'depletionProbability',
] as const

export type HelpId = (typeof HELP_IDS)[number]

export interface HelpBody {
  title: string
  /** What is it? One plain sentence. */
  what: string
  /** How does it work / what changes when you use it. */
  how?: string
  /** Short realistic example (often computed from the current settings). */
  example?: string
  /** Only when needed to avoid misleading anyone. */
  limit?: string
  /** Optional deeper explanation behind "Learn more". */
  more?: string
}

export interface HelpCtx {
  s: Scenario
  computed: Computed
  f: Formatter
  /** Money in the scenario's currency. */
  money: (v: number) => string
  pct: (v: number, decimals?: number) => string
  /** Optional view-specific values (e.g. Monte Carlo results). */
  extra?: Record<string, number | null | undefined>
}

export type HelpContent = Record<HelpId, (c: HelpCtx) => HelpBody>
