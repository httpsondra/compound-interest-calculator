import {
  FREQUENCY_MONTHS,
  PER_YEAR,
  type WithdrawalYear,
  type Frequency,
  type PeriodRow,
  type PlanInput,
  type SimPoint,
  type SimResult,
  type Timing,
} from './types'

/*
 * Canonical calculation pipeline — every number shown anywhere in the app
 * (cards, chart, table, goal solvers, comparisons, fee impact, Monte Carlo)
 * comes from `simulate()`.
 *
 * CONVENTIONS
 * ───────────
 * • Return input R is an EFFECTIVE annual rate. Growth over Δ months is
 *   (1 + R)^(Δ/12), so one month is r_m = (1 + R)^(1/12) − 1. It is never R/12.
 * • Time runs in months. Cashflows are placed at exact fractional times, so
 *   weekly (every 12/52 months), monthly, quarterly, semi-annual and annual
 *   cashflows are all modelled exactly on the same clock.
 * • Timing "start": the first cashflow happens at the start of a stream;
 *   timing "end": one interval later (ordinary annuity).
 * • Within an instant: deposits first, then withdrawals.
 * • Between cashflows the balance first grows by the market factor and then
 *   the management fee is deducted: B → B·(1+R)^(Δ/12) → ·(1−f)^(Δ/12).
 *   f is an effective annual fee on the balance.
 * • Deposit fees (percentage + fixed) are deducted from each deposit,
 *   including the initial investment, and never exceed the deposit.
 * • Indexation (contribution growth, inflation-linked withdrawals) steps up at
 *   every plan-year anniversary: amount × (1 + g)^(plan year − 1).
 * • Withdrawals are capped at the available balance. The first month in which
 *   a withdrawal could not be paid in full is reported as depletion.
 * • Real value at month t = nominal / (1 + π)^(t/12).
 * • Full float64 precision internally; rounding happens only for display.
 */

const EPS = 1e-9
export const MAX_HORIZON_MONTHS = 1200

interface CashEvent {
  month: number
  /** Position inside the month, 0 … 1. */
  tau: number
  /** 0 = deposit, 1 = withdrawal (processing order at equal times). */
  kind: 0 | 1
  amount: number
  /** Withdrawal year index (withdrawals only). */
  wYear?: number
  /** Amount decided at run time by the withdrawal policy. */
  dynamic?: boolean
}

/** Generate the event times of a recurring stream on [start, end) with the given timing. */
export function streamEventTimes(
  start: number,
  end: number,
  frequency: Frequency,
  timing: Timing,
  horizon: number,
): number[] {
  const step = FREQUENCY_MONTHS[frequency]
  const out: number[] = []
  const stop = Math.min(end, horizon)
  if (!(stop > start)) return out
  const offset = timing === 'start' ? 0 : 1
  for (let k = 0; ; k++) {
    const t = start + (k + offset) * step
    if (timing === 'start' ? t >= stop - EPS : t > stop + EPS) break
    out.push(t)
  }
  return out
}

function locate(t: number, timing: Timing): { month: number; tau: number } {
  // A time sitting exactly on a month boundary belongs to the START of that
  // month for "start" cashflows and to the END of the previous month for
  // "end" cashflows. Both are economically the same instant.
  const rounded = Math.round(t)
  const onBoundary = Math.abs(t - rounded) < EPS
  if (onBoundary) {
    if (timing === 'end' && rounded > 0) return { month: rounded - 1, tau: 1 }
    return { month: rounded, tau: 0 }
  }
  const month = Math.floor(t)
  return { month, tau: t - month }
}

function indexFactor(rate: number, month: number): number {
  if (rate === 0) return 1
  return Math.pow(1 + rate, Math.floor(month / 12))
}

export interface SimulateOptions {
  /**
   * Optional per-month gross market growth factors (length ≥ horizon).
   * Used by the Monte Carlo module; when omitted the deterministic
   * (1 + R)^(1/12) factor is used for every month.
   */
  monthFactors?: ArrayLike<number>
  /** Skip building per-month points and yearly rows (Monte Carlo speed path). */
  lean?: boolean
  /**
   * Instantaneous portfolio shocks (stress tests): at the start of `month`, after the annual
   * withdrawal review and before that month's cashflows, the balance is multiplied by `factor`.
   * Counted as (negative) market growth. Distinct from a low period return via `monthFactors`.
   */
  shocks?: { month: number; factor: number }[]
}

export function validatePlan(plan: PlanInput): string | null {
  if (!Number.isFinite(plan.horizonMonths) || plan.horizonMonths < 1) return 'horizon'
  if (plan.horizonMonths > MAX_HORIZON_MONTHS) return 'horizon'
  if (!Number.isFinite(plan.annualReturn) || plan.annualReturn <= -1) return 'return'
  if (!Number.isFinite(plan.inflation) || plan.inflation <= -1) return 'inflation'
  if (!Number.isFinite(plan.initial) || plan.initial < 0) return 'initial'
  if (!Number.isFinite(plan.contributionGrowth) || plan.contributionGrowth <= -1) return 'growth'
  const f = plan.fees
  if (!(f.annualRate >= 0 && f.annualRate < 1)) return 'fees'
  if (!(f.entryRate >= 0 && f.entryRate <= 1)) return 'fees'
  if (!(f.fixedPerDeposit >= 0)) return 'fees'
  for (const s of plan.streams) {
    if (!(s.amount >= 0) || !Number.isFinite(s.startMonth) || !(s.endMonth > s.startMonth)) return 'streams'
  }
  for (const l of plan.lumpSums) if (!(l.amount >= 0) || !(l.month >= 0)) return 'lumps'
  if (plan.withdrawal && !(plan.withdrawal.amount >= 0)) return 'withdrawal'
  if (plan.withdrawal && !(plan.withdrawal.indexRate > -1 && (plan.withdrawal.preIndexRate ?? 0) > -1)) return 'withdrawal'
  const pol = plan.withdrawal?.policy
  if (pol && pol.kind !== 'fixed') {
    if (!(pol.rate >= 0 && pol.rate <= 1)) return 'withdrawal'
    if (pol.kind === 'guardrails' && !(pol.maxIncrease >= 0 && pol.maxDecrease >= 0 && pol.maxDecrease <= 1 && pol.floorAnnual >= 0))
      return 'withdrawal'
  }
  return null
}

export function buildEvents(plan: PlanInput): CashEvent[][] {
  const N = plan.horizonMonths
  const byMonth: CashEvent[][] = Array.from({ length: N }, () => [])
  const w = plan.withdrawal
  const contribCutoff = w && w.stopContributions ? w.startMonth : Infinity

  for (const s of plan.streams) {
    if (s.amount <= 0) continue
    for (const t of streamEventTimes(s.startMonth, s.endMonth, s.frequency, plan.timing, N)) {
      const { month, tau } = locate(t, plan.timing)
      if (month >= N || month >= contribCutoff) continue
      const amount = s.amount * indexFactor(plan.contributionGrowth, month)
      byMonth[month].push({ month, tau, kind: 0, amount })
    }
  }
  for (const l of plan.lumpSums) {
    if (l.amount <= 0 || l.month >= N || l.month < 0) continue
    const month = Math.floor(l.month)
    byMonth[month].push({ month, tau: 0, kind: 0, amount: l.amount })
  }
  const dynamic = !!w && !!w.policy && w.policy.kind !== 'fixed'
  const preYears = w ? Math.floor(w.startMonth / 12) : 0
  const samePre = !w || w.preIndexRate == null || w.preIndexRate === w.indexRate
  const preFactor = w ? Math.pow(1 + (w.preIndexRate ?? w.indexRate), preYears) : 1
  if (w && (w.amount > 0 || dynamic)) {
    for (const t of streamEventTimes(w.startMonth, w.endMonth, w.frequency, w.timing, N)) {
      const { month, tau } = locate(t, w.timing)
      if (month >= N) continue
      // Withdrawal year: a payment exactly at the end of a year belongs to that year.
      const rel = (t - w.startMonth) / 12
      const wYear = w.timing === 'start' ? Math.floor(rel + EPS) : Math.max(0, Math.ceil(rel - EPS) - 1)
      // Fixed amounts: grown to the first withdrawal year by `preIndexRate` (before retirement),
      // then by `indexRate` once per withdrawal year (during retirement). Never both for the same year.
      // One power when both rates agree, so V4 plans (pre = during) stay bit-identical.
      const amount = dynamic
        ? 0
        : samePre
          ? w.amount * Math.pow(1 + w.indexRate, preYears + wYear)
          : w.amount * preFactor * Math.pow(1 + w.indexRate, wYear)
      byMonth[month].push({ month, tau, kind: 1, amount, wYear, dynamic })
    }
  }
  for (const list of byMonth) {
    if (list.length > 1) list.sort((a, b) => a.tau - b.tau || a.kind - b.kind)
  }
  return byMonth
}

export function simulate(plan: PlanInput, options: SimulateOptions = {}): SimResult {
  const invalid = validatePlan(plan)
  if (invalid) throw new RangeError(`Invalid plan input: ${invalid}`)

  const N = Math.round(plan.horizonMonths)
  const events = buildEvents({ ...plan, horizonMonths: N })
  const lean = options.lean === true
  const detGrowth = Math.pow(1 + plan.annualReturn, 1 / 12)
  const feeKeep = Math.pow(1 - plan.fees.annualRate, 1 / 12)
  const inflM = Math.pow(1 + plan.inflation, 1 / 12)
  const entryRate = plan.fees.entryRate
  const fixedFee = plan.fees.fixedPerDeposit

  let B = 0
  let contributed = 0
  let withdrawn = 0
  let growth = 0
  let mgmtFees = 0
  let depositFees = 0
  let shortfall = 0
  let depletedAtMonth: number | null = null

  // Per-year accumulators
  let yContrib = 0
  let yWithdraw = 0
  let yGrowth = 0
  let yFees = 0
  let yStart = 0

  const deposit = (amount: number) => {
    const fee = Math.min(amount, amount * entryRate + (amount > 0 ? fixedFee : 0))
    B += amount - fee
    contributed += amount
    depositFees += fee
    yContrib += amount
    yFees += fee
  }

  // Initial investment at t = 0.
  if (plan.initial > 0) deposit(plan.initial)

  const balances = new Float64Array(N + 1)
  balances[0] = B
  const points: SimPoint[] = []
  const years: PeriodRow[] = []
  if (!lean) {
    points.push({
      month: 0,
      balance: B,
      real: B,
      contributed,
      withdrawn: 0,
      growth: 0,
      fees: depositFees,
    })
  }

  // ── Withdrawal policy state ──
  const w = plan.withdrawal
  const policy = w?.policy ?? { kind: 'fixed' as const }
  const perYear = w ? PER_YEAR[w.frequency] : 12
  const wYears: WithdrawalYear[] = []
  let budget = 0
  const shockAt = new Map<number, number>()
  for (const sh of options.shocks ?? []) shockAt.set(sh.month, (shockAt.get(sh.month) ?? 1) * sh.factor)

  const review = (m: number) => {
    if (!w) return
    const k = Math.round((m - w.startMonth) / 12)
    const prev = wYears[k - 1]
    let target = budget
    let limit: WithdrawalYear['limit'] = null
    switch (policy.kind) {
      case 'fixed':
        target = budget = 0 // fixed amounts live on the events; `requested` is summed below
        break
      case 'initialPct':
        budget = k === 0 ? policy.rate * B : budget * (1 + w.indexRate)
        target = budget
        break
      case 'currentPct':
        budget = target = policy.rate * B
        break
      case 'guardrails': {
        target = policy.rate * B
        if (k === 0 || !prev) budget = target
        else {
          const base = budget * (1 + w.indexRate)
          const hi = base * (1 + policy.maxIncrease)
          const lo = base * (1 - policy.maxDecrease)
          budget = Math.min(hi, Math.max(lo, target))
          if (target > hi + 1e-9) limit = 'increase'
          else if (target < lo - 1e-9) limit = 'decrease'
        }
        const floor = policy.floorAnnual * indexFactor(policy.floorIndexRate ?? w.indexRate, m)
        if (floor > budget + 1e-9) {
          budget = floor
          limit = 'floor'
        }
        break
      }
    }
    wYears[k] = {
      index: k,
      startMonth: m,
      months: Math.min(12, N - m),
      reviewBalance: B,
      requested: 0,
      paid: 0,
      target,
      limit,
    }
  }

  let monthGrowth = detGrowth
  const advance = (dTau: number) => {
    if (dTau <= 0 || B <= 0) return
    const g = dTau === 1 ? monthGrowth : Math.pow(monthGrowth, dTau)
    const grown = B * g
    const gain = grown - B
    const keep = dTau === 1 ? feeKeep : Math.pow(feeKeep, dTau)
    const fee = grown * (1 - keep)
    B = grown - fee
    growth += gain
    mgmtFees += fee
    yGrowth += gain
    yFees += fee
  }

  const wEnd = w ? Math.min(w.endMonth, N) : 0
  for (let m = 0; m < N; m++) {
    monthGrowth = options.monthFactors ? options.monthFactors[m] : detGrowth
    if (w && m >= w.startMonth && m < wEnd && (m - w.startMonth) % 12 === 0) review(m)
    const shock = shockAt.get(m)
    if (shock !== undefined && B > 0) {
      const loss = B * (shock - 1)
      B += loss
      growth += loss
      yGrowth += loss
    }
    let pos = 0
    for (const ev of events[m]) {
      advance(ev.tau - pos)
      pos = Math.max(pos, ev.tau)
      if (ev.kind === 0) {
        deposit(ev.amount)
      } else {
        const wy = wYears[ev.wYear ?? 0]
        const amount = ev.dynamic ? budget / perYear : ev.amount
        const paid = Math.min(amount, Math.max(B, 0))
        const miss = amount - paid
        B -= paid
        if (B < 1e-9) B = 0
        withdrawn += paid
        yWithdraw += paid
        if (wy) {
          wy.requested += amount
          wy.paid += paid
        }
        if (miss > 1e-6) {
          shortfall += miss
          if (depletedAtMonth === null) depletedAtMonth = m + 1
        }
      }
    }
    advance(1 - pos)
    balances[m + 1] = B

    if (!lean) {
      const t = m + 1
      const real = B / Math.pow(inflM, t)
      points.push({
        month: t,
        balance: B,
        real,
        contributed,
        withdrawn,
        growth,
        fees: mgmtFees + depositFees,
      })
      if (t % 12 === 0 || t === N) {
        years.push({
          year: Math.ceil(t / 12),
          months: t % 12 === 0 ? 12 : t % 12,
          startBalance: yStart,
          contributions: yContrib,
          withdrawals: yWithdraw,
          growth: yGrowth,
          fees: yFees,
          endBalance: B,
          endReal: real,
        })
        yStart = B
        yContrib = yWithdraw = yGrowth = yFees = 0
      }
    }
  }

  const final = B
  const finalReal = final / Math.pow(1 + plan.inflation, N / 12)
  return {
    withdrawalYears: wYears.filter(Boolean),
    balances,
    points,
    years,
    totals: {
      final,
      finalReal,
      contributed,
      withdrawn,
      growth,
      managementFees: mgmtFees,
      depositFees,
      fees: mgmtFees + depositFees,
      netGain: final + withdrawn - contributed,
      depletedAtMonth,
      shortfall,
    },
  }
}

/** Deflate a nominal value at month t to today's money. */
export function toReal(nominal: number, month: number, inflation: number): number {
  return nominal / Math.pow(1 + inflation, month / 12)
}
