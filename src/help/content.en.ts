import { totalMonths } from '../model/scenario'
import { baseAmount, depositFee, feeDrag, grow, nextYearContribution, perYear, realOf, timingDifference } from './examples'
import type { HelpContent, HelpCtx } from './types'
import { plannedIncome } from '../model/retirement'

const PER: Record<string, string> = { weekly: 'week', monthly: 'month', quarterly: 'quarter', semiannual: 'half-year', annual: 'year' }
const rate = (c: HelpCtx) => (c.s.annualReturn > 0 ? c.s.annualReturn : 7)
const infl = (c: HelpCtx) => (c.s.inflationEnabled && c.s.inflation > 0 ? c.s.inflation : 2.5)
const monthly = (c: HelpCtx) => (c.s.contribMode === 'constant' && c.s.constant.amount > 0 ? c.s.constant.amount : baseAmount(c.s.currency, 5000))
const yearsText = (n: number) => `${n} ${n === 1 ? 'year' : 'years'}`

export const helpEn: HelpContent = {
  /* ───────── Main calculator ───────── */
  currency: (c) => ({
    title: 'Currency',
    what: 'The currency your whole plan is expressed in — CZK, EUR or USD.',
    how: 'Switching only changes the unit. Every amount stays exactly as you typed it; nothing is converted at an exchange rate.',
    example: `${c.money(baseAmount(c.s.currency))} stays the same number when you switch to another currency.`,
    limit: 'If you want to compare plans in different currencies, enter the amounts in one currency yourself.',
  }),
  initial: (c) => ({
    title: 'Initial investment',
    what: 'Money you invest once, right at the start.',
    how: 'It grows for the whole investment period, so it benefits most from compounding.',
    example: `${c.money(baseAmount(c.s.currency))} at ${c.pct(rate(c))} a year becomes about ${c.money(grow(baseAmount(c.s.currency), rate(c), 120))} after 10 years, with no further deposits or fees.`,
  }),
  contribution: (c) => {
    const s = c.s
    const ex =
      s.contribMode === 'constant' && s.constant.amount > 0
        ? `You currently invest ${c.money(s.constant.amount)} every ${PER[s.constant.frequency]} — ${c.money(perYear(s.constant.amount, s.constant.frequency))} a year before any increases.`
        : `For example, ${c.money(monthly(c))} a month adds up to ${c.money(perYear(monthly(c), 'monthly'))} a year.`
    return {
      title: 'Regular contribution',
      what: 'An amount you add to the investment repeatedly, for example every month.',
      how: 'The frequency next to the amount sets how often you invest: weekly is 52 deposits a year, monthly 12, quarterly 4. Choose “Changes over time” to plan different amounts for different life stages.',
      example: ex,
    }
  },
  frequency: (c) => ({
    title: 'Contribution frequency',
    what: 'How often the regular amount is invested.',
    how: 'Weekly means 52 deposits a year, monthly 12, quarterly 4, semi-annually 2 and annually 1. Each deposit is placed on its exact date.',
    example: `${c.money(baseAmount(c.s.currency, 1000))} weekly is ${c.money(perYear(baseAmount(c.s.currency, 1000), 'weekly'))} a year; the same amount monthly is ${c.money(perYear(baseAmount(c.s.currency, 1000), 'monthly'))}.`,
  }),
  timeline: (c) => ({
    title: 'Contributions that change over time',
    what: 'A schedule of consecutive periods, each with its own amount and frequency.',
    how: 'Periods follow each other without gaps or overlaps. Click a period to edit its amount, frequency or end year, pause it, duplicate it or remove it.',
    example: `Years 1–5: ${c.money(baseAmount(c.s.currency, 2000))} a month, years 6–15: ${c.money(baseAmount(c.s.currency, 5000))}, years 16–30: ${c.money(baseAmount(c.s.currency, 12000))}.`,
    more: 'Real life rarely means investing the same amount for decades. Contributions usually grow with income and may pause during parental leave or a mortgage. Modelling stages gives a much more realistic projection than one constant amount.',
  }),
  growth: (c) => {
    const g = c.s.growthMode === 'custom' ? c.s.growthRate : c.s.growthMode === 'inflation' ? infl(c) : 5
    const a = monthly(c)
    return {
      title: 'Annual increase',
      what: 'Raises all regular contributions automatically once a year.',
      how: '“With inflation” raises them by the inflation rate, so they stay constant in today’s money. “None” keeps the same nominal amount, which slowly loses purchasing power.',
      example: `${c.money(a)} a month with a ${c.pct(g)} increase becomes ${c.money(nextYearContribution(a, g))} a month in the second year.`,
    }
  },
  horizon: (c) => ({
    title: 'Investment horizon',
    what: 'How long the money stays invested — in years and optional extra months.',
    how: 'Longer horizons give compounding more time to work; the effect grows strongly in later years.',
    example: `Your plan currently runs for ${yearsText(c.s.horizonYears)}${c.s.horizonMonths ? ` and ${c.s.horizonMonths} months` : ''} (${totalMonths(c.s)} months).`,
  }),
  return: (c) => ({
    title: 'Expected annual return',
    what: 'The average yearly growth you assume for the investment.',
    how: 'It is applied as an effective annual rate: a full year of growth equals exactly this percentage, spread evenly across the months.',
    example: `With ${c.pct(rate(c))}, ${c.money(baseAmount(c.s.currency))} would grow to ${c.money(grow(baseAmount(c.s.currency), rate(c)))} after one year, with no deposits or fees.`,
    limit: 'Real markets go up and down from year to year. Returns are not guaranteed — see the Risk view for a range of outcomes.',
    more: 'The monthly rate is derived as (1 + R)^(1/12) − 1 rather than R ÷ 12, so 12 months of growth add up to exactly R. Long-run assumptions are often in the 4–8 % range for diversified stock portfolios; lower for bonds or savings.',
  }),
  timing: (c) => {
    const d = timingDifference(monthly(c), rate(c))
    return {
      title: 'Deposit timing',
      what: 'Whether each deposit is made at the beginning or at the end of its period.',
      how: 'Deposits at the start grow during that period; deposits at the end are added after the period’s growth.',
      example: `${c.money(monthly(c))} a month for one year at ${c.pct(rate(c))}: start of month gives ${c.money(d.start)}, end of month ${c.money(d.end)}.`,
    }
  },

  /* ───────── Timeline ───────── */
  periodFrequency: () => ({
    title: 'Frequency in this period',
    what: 'How often the amount of this period is invested.',
    how: 'Each period can have its own frequency — for example monthly at first, later one larger annual deposit.',
  }),
  boundaries: () => ({
    title: 'Period boundaries',
    what: 'The last year of this period. The next period starts the year after.',
    how: 'Changing it moves the boundary between this period and the next one, so the schedule never has overlaps.',
    example: 'Moving the end of “Years 1–10” to year 5 makes the next period start in year 6.',
  }),
  paused: () => ({
    title: 'Paused contributions',
    what: 'A period with no deposits — for example parental leave or a sabbatical.',
    how: 'The money already invested keeps growing; only new deposits stop. Resume restores the original amount.',
  }),
  gaps: () => ({
    title: 'Uncovered years',
    what: 'Years of your horizon that no period covers.',
    how: 'No contributions are made in those years. Extend the last period to cover them, or keep the gap if it is intentional.',
  }),

  /* ───────── Goals ───────── */
  goal: () => ({
    title: 'Financial goal',
    what: 'A target value you want your portfolio to reach by a certain year.',
    how: 'The calculator shows whether your plan gets there, when it would, and what you could change to reach it.',
  }),
  goalTarget: (c) => ({
    title: 'Target value',
    what: 'The amount you want to have.',
    example: `For example ${c.money(baseAmount(c.s.currency, 5_000_000))} for financial independence or ${c.money(baseAmount(c.s.currency, 1_000_000))} for a home deposit.`,
  }),
  goalYear: () => ({
    title: 'Target year',
    what: 'The plan year by which the target should be reached.',
    how: 'It can be later than your investment horizon — the plan is then continued to evaluate the goal.',
  }),
  goalReal: (c) => ({
    title: 'Target in today’s money',
    what: 'Compares your target with inflation-adjusted values instead of nominal ones.',
    example: `At ${c.pct(infl(c))} inflation, reaching “${c.money(baseAmount(c.s.currency, 1_000_000))} in today’s money” in 20 years needs about ${c.money(baseAmount(c.s.currency, 1_000_000) / realOf(1, 20, infl(c)))} in nominal terms.`,
    more: 'Prices rise over time, so a target set in today’s money is the more honest way to describe what you will actually be able to buy.',
  }),
  requiredContribution: (c) => {
    const g = c.computed.goal
    const ok = g && g.contribution.status === 'ok'
    return {
      title: 'Required contribution',
      what:
        c.s.contribMode === 'constant'
          ? 'The regular amount that would reach your target exactly by the target year.'
          : 'The extra amount per month, on top of your timeline, that would reach your target by the target year.',
      how: 'It is solved with the same calculation as your results, so entering it reproduces the target.',
      example: ok && g.contribution.status === 'ok' ? `Currently: ${c.money(g.contribution.value)}.` : undefined,
    }
  },
  timeToGoal: (c) => {
    const m = c.computed.goal?.timeToGoal
    return {
      title: 'Time to reach the goal',
      what: 'When your current plan first reaches the target, if you keep it going.',
      example: m != null ? `Your plan reaches it in year ${Math.max(1, Math.ceil(m / 12))}.` : 'With the current plan the target is not reached within 100 years.',
    }
  },
  extraLump: () => ({
    title: 'One extra investment today',
    what: 'A single additional amount invested now that would close the gap to your target on its own.',
    how: 'Useful if you expect a bonus or inheritance — it shows its effect on the goal.',
  }),

  /* ───────── Inflation ───────── */
  inflation: (c) => ({
    title: 'Inflation',
    what: 'The general rise in prices, which reduces what money can buy over time.',
    how: 'When enabled, results also show values in today’s money, and contributions or withdrawals can rise with inflation.',
    example: `At ${c.pct(infl(c))} a year, ${c.money(baseAmount(c.s.currency))} in 20 years buys about as much as ${c.money(realOf(baseAmount(c.s.currency), 20, infl(c)))} today.`,
  }),
  inflationRate: (c) => {
    const tot = c.computed.result?.totals
    return {
      title: 'Annual inflation',
      what: 'The assumed average price increase per year.',
      example:
        tot && c.s.inflationEnabled
          ? `With ${c.pct(c.s.inflation)}, your final ${c.money(tot.final)} would be worth about ${c.money(tot.finalReal)} in today’s money.`
          : undefined,
      limit: 'Inflation varies from year to year; the calculator uses one average rate.',
    }
  },
  nominalReal: () => ({
    title: 'Nominal vs. today’s money',
    what: 'Nominal values are the actual future amounts; values in today’s money show what they would buy at current prices.',
    how: 'Switch between the two to see how much of the growth is “real” and how much only offsets rising prices.',
  }),

  /* ───────── Fees ───────── */
  fees: () => ({
    title: 'Investment fees',
    what: 'Costs charged by funds, platforms or advisers. They are deducted from your money and reduce long-term growth.',
    how: 'Three types are supported: a yearly fee on the balance, an entry fee in % of each deposit, and a fixed fee per deposit. Results include them automatically.',
    more: 'Fees compound too: money taken as a fee can no longer grow. Over decades, even 1 % a year can cost far more than the fees you see on statements. The “Fee impact” section shows both the fees paid and the growth lost.',
  }),
  feeAnnual: (c) => {
    const fee = c.s.fees.annual > 0 ? c.s.fees.annual : 1
    const d = feeDrag(baseAmount(c.s.currency), rate(c), fee, 30)
    return {
      title: 'Annual fee',
      what: 'A yearly percentage of your portfolio value, such as a fund’s total expense ratio or a management fee.',
      how: 'It is deducted gradually each month after growth.',
      example: `${c.money(baseAmount(c.s.currency))} over 30 years at ${c.pct(rate(c))}: ${c.money(d.without)} without fees, ${c.money(d.withFee)} with a ${c.pct(fee, 2)} annual fee.`,
    }
  },
  feeEntry: (c) => {
    const e = c.s.fees.entry > 0 ? c.s.fees.entry : 2
    const a = monthly(c)
    return {
      title: 'Entry fee',
      what: 'A percentage taken from every deposit before it is invested, including the initial investment.',
      example: `A ${c.pct(e, 2)} entry fee on a ${c.money(a)} deposit costs ${c.money(depositFee(a, e, 0))} — only the rest is invested.`,
    }
  },
  feeFixed: (c) => {
    const fx = c.s.fees.fixed > 0 ? c.s.fees.fixed : baseAmount(c.s.currency, 50)
    return {
      title: 'Fixed fee per deposit',
      what: 'A flat amount charged for each deposit, such as a transaction fee.',
      how: 'It matters most for small or frequent deposits. It never exceeds the deposit itself.',
      example: `${c.money(fx)} on 12 monthly deposits is ${c.money(perYear(fx, 'monthly'))} a year.`,
    }
  },
  feeImpact: (c) => {
    const nf = c.computed.noFee
    const tot = c.computed.result?.totals
    return {
      title: 'Fee impact',
      what: 'How much lower your final value is because of fees.',
      how: 'It compares your plan with an identical plan without fees. The difference consists of the fees paid plus the growth those fees would have earned.',
      example: nf && tot ? `Here: ${c.money(nf.final - tot.final)} less in total, of which ${c.money(tot.fees)} are fees actually paid.` : undefined,
    }
  },

  /* ───────── Withdrawals ───────── */
  withdrawals: () => ({
    title: 'Withdrawals',
    what: 'Taking money out of the portfolio regularly, for example in retirement.',
    how: 'Withdrawals reduce the balance while the rest keeps growing. If they are larger than the growth, the portfolio can run out.',
    limit: 'This uses a constant return. Real markets with bad years early in retirement can deplete a portfolio sooner — see the Risk view.',
  }),
  withdrawalAmount: (c) => ({
    title: 'Withdrawal frequency',
    what: 'How often money is paid out: monthly, quarterly or once a year.',
    how: 'Amounts are always shown as a monthly equivalent (yearly total ÷ 12), so plans with different frequencies compare fairly.',
    example: `${c.money(c.s.retirement.income)} a month paid quarterly means ${c.money(perYear(c.s.retirement.income, 'monthly') / 4)} per payment.`,
  }),
  withdrawalStart: (c) => ({
    title: 'Withdrawals start',
    what: 'The plan year in which the first withdrawal is made.',
    example:
      c.s.startAge != null
        ? `Year ${c.s.withdrawal.startYear} starts at age ${c.s.startAge + c.s.withdrawal.startYear - 1}.`
        : `Year ${c.s.withdrawal.startYear} begins after ${yearsText(c.s.withdrawal.startYear - 1)} of investing.`,
  }),
  withdrawalEnd: () => ({
    title: 'Withdrawal period',
    what: 'Whether withdrawals continue until the end of the plan or stop after a chosen year.',
  }),
  withdrawalIndexed: (c) => ({
    title: 'Increase income with inflation every year',
    what: 'Raises your retirement income once a year by the inflation rate, so it keeps its purchasing power during retirement.',
    how: 'This only affects the years after withdrawals start. How the amount grows before retirement is decided by “In today’s money / At retirement”.',
    example: `${c.money(baseAmount(c.s.currency, 40_000))} a month with ${c.pct(infl(c))} inflation becomes ${c.money(nextYearContribution(baseAmount(c.s.currency, 40_000), infl(c)))} in the second year.`,
  }),
  withdrawalStop: () => ({
    title: 'Stop contributions',
    what: 'When on, regular contributions end in the year withdrawals begin.',
    how: 'Turn it off if you plan to keep investing while also taking money out.',
  }),
  sustainable: (c) => {
    const v = c.computed.sustainable
    return {
      title: 'Sustainable withdrawal',
      what: 'The largest withdrawal — an amount for fixed withdrawals, a starting rate for the 4 % rule and dynamic spending — that lets the simulated portfolio pay every planned withdrawal until the end of your plan.',
      how: 'It is solved with the same simulation as your results and the same assumptions, including inflation increases if enabled. It is not shown for “% of current portfolio”, which by design never runs out.',
      example: v ? (v.kind === 'rate' ? `For your plan: a starting rate of about ${c.pct(v.value * 100)}.` : Number.isFinite(v.value) ? `For your plan: about ${c.money(v.value)} per ${PER[c.s.withdrawal.frequency]}.` : undefined) : undefined,
      limit: 'It is not a guaranteed safe amount. Real returns vary, and a few bad years at the wrong time can change the outcome.',
    }
  },
  shortfall: () => ({
    title: 'Unpaid withdrawals',
    what: 'The total of withdrawals that could not be paid because the portfolio was already empty.',
  }),

  /* ───────── Retirement & financial independence ───────── */
  fixedWithdrawal: (c) => {
    const p = plannedIncome(c.s, c.computed.result)
    return {
      title: 'Fixed amount',
      what: 'You choose how much you want to receive each month. The plan withdraws that amount for as long as the portfolio can pay it.',
      how: 'Two separate choices shape it: whether the amount is in today’s money or at retirement, and whether it rises with inflation during retirement.',
      example: p ? `Your plan: ${c.money(p.firstMonthly)} a month in the first year of withdrawals (year ${p.startYear}).` : undefined,
      limit: 'The amount is a plan. If the portfolio runs out, only what is left can be paid.',
    }
  },
  amountBasis: (c) => {
    const years = Math.max(0, c.s.withdrawal.startYear - 1)
    const a = c.s.retirement.income
    const grown = a / realOf(1, years, infl(c))
    return {
      title: 'In today’s money or at retirement?',
      what: 'Tells the calculator what the amount you typed means.',
      how: '“In today’s money”: the purchasing power you want — it is raised with inflation until withdrawals start. “At retirement”: the actual amount you will withdraw in the first year, used as it is.',
      example: years > 0 ? `${c.money(a)} in today’s money becomes about ${c.money(grown)} after ${years} years of ${c.pct(infl(c))} inflation. Entered “at retirement”, it stays ${c.money(a)} — worth about ${c.money(realOf(a, years, infl(c)))} today.` : undefined,
      more: 'Neither choice changes how income develops after retirement starts — that is the separate switch “Increase income with inflation every year”. Inflation is never applied twice.',
    }
  },
  inflationBefore: (c) => ({
    title: 'Inflation before retirement',
    what: 'Prices rise between today and the start of withdrawals.',
    how: 'Only an amount entered in today’s money is raised for it. Percentage strategies don’t need it: their amount already comes from the projected future portfolio.',
    example: `At ${c.pct(infl(c))} a year, ${c.money(baseAmount(c.s.currency, 40_000))} today ≈ ${c.money(baseAmount(c.s.currency, 40_000) / realOf(1, 32, infl(c)))} in 32 years.`,
  }),
  inflationDuring: (c) => ({
    title: 'Inflation during retirement',
    what: 'Whether your income rises each year after withdrawals have started.',
    how: 'On: income keeps its purchasing power. Off: the amount stays the same and buys a little less every year. “% of current portfolio” has no such switch — it follows the portfolio.',
    example: `${c.money(baseAmount(c.s.currency, 40_000))} → year 2: ${c.money(nextYearContribution(baseAmount(c.s.currency, 40_000), infl(c)))} → year 3: ${c.money(nextYearContribution(nextYearContribution(baseAmount(c.s.currency, 40_000), infl(c)), infl(c)))} a month.`,
  }),
  desiredVsActual: (c) => {
    const t = c.computed.result?.totals
    return {
      title: 'Planned vs. actually paid',
      what: 'The planned withdrawal is what the strategy asks for; the paid amount is what the portfolio could actually pay.',
      how: 'They are the same until the portfolio runs out. After that the difference is shown as unfunded.',
      example: t && t.shortfall > 0 ? `In your plan ${c.money(t.shortfall)} of planned withdrawals could not be paid in total.` : 'In your plan every planned withdrawal is paid.',
    }
  },
  withdrawalStrategy: () => ({
    title: 'Withdrawal strategy',
    what: 'The rule that decides how much you take out each year.',
    how: 'Fixed amount: you choose the sum. 4 % rule: a percentage of the starting portfolio, then raised with inflation. % of current portfolio: recalculated from the portfolio every year. Dynamic: follows the portfolio, but within limits on yearly changes.',
    limit: 'No strategy is universally best: stable income usually means more risk of running out; adaptive income means less risk but a less predictable budget.',
  }),
  rule4: (c) => ({
    title: 'Initial-portfolio percentage (“4 % rule”)',
    what: 'The first year’s budget is a percentage of the portfolio when withdrawals start. After that it only rises with inflation — later market moves do not change it.',
    example: `${c.money(baseAmount(c.s.currency, 6_000_000))} × 4 % = ${c.money(baseAmount(c.s.currency, 6_000_000) * 0.04)} a year, i.e. ${c.money((baseAmount(c.s.currency, 6_000_000) * 0.04) / 12)} a month in year 1.`,
    limit: '4 % is a historical rule of thumb from US research, not a guaranteed safe rate. Results depend on returns, inflation, fees and how long retirement lasts.',
    more: 'The idea comes from studies of historical US markets in the 1990s. Because spending does not react to markets, a crash early in retirement can deplete the portfolio — use the stress test to see how.',
  }),
  currentPct: (c) => ({
    title: '% of current portfolio',
    what: 'Every year you take the chosen percentage of the portfolio’s value at that moment.',
    how: 'When the portfolio falls, your income falls too; when it grows, income grows. The yearly budget is set once at the annual review and split into the payments.',
    example: `4 % of ${c.money(baseAmount(c.s.currency, 6_000_000))} is ${c.money(baseAmount(c.s.currency, 6_000_000) * 0.04)}; if the portfolio drops to ${c.money(baseAmount(c.s.currency, 4_000_000))}, next year’s budget is ${c.money(baseAmount(c.s.currency, 4_000_000) * 0.04)} (${c.money((baseAmount(c.s.currency, 4_000_000) * 0.04) / 12)} a month).`,
    limit: 'It practically never runs out of money, but it does not guarantee a stable income — check the desired-income result, not just the balance.',
  }),
  guardrails: () => ({
    title: 'Dynamic spending with limits',
    what: 'Each year the target is a percentage of the current portfolio, but spending may only change by a limited amount compared with last year.',
    how: 'Last year’s spending is first adjusted for inflation; the new target is then capped at, say, +5 % above and −2.5 % below that. An optional minimum income is applied last.',
    limit: 'This is a simple floor-and-ceiling rule, not the more complex Guyton-Klinger guardrails. It is a hypothetical rule, not a proven safe strategy.',
    more: 'Limiting cuts keeps your lifestyle steadier in bad years; limiting increases keeps something in reserve after good ones. Research such as Vanguard’s dynamic spending studies uses a similar idea.',
  }),
  withdrawalRate: (c) => ({
    title: 'Withdrawal rate',
    what: 'The yearly withdrawal as a percentage of the portfolio.',
    example: `At 4 %, every ${c.money(baseAmount(c.s.currency, 1_000_000))} of portfolio supports ${c.money(baseAmount(c.s.currency, 1_000_000) * 0.04 / 12)} a month.`,
    limit: 'The presets (3–5 %) are illustrative assumptions, not recommendations or guaranteed safe rates.',
  }),
  guardLimits: () => ({
    title: 'Maximum increase and decrease',
    what: 'How much the yearly budget may rise or fall compared with last year’s inflation-adjusted spending.',
    example: 'With last year’s 240 000, 2 % inflation and limits of +5 % / −2.5 %, this year’s budget stays between about 238 680 and 257 040, whatever the portfolio does.',
  }),
  incomeFloor: (c) => ({
    title: 'Minimum income',
    what: 'A monthly amount that dynamic spending never goes below.',
    how: c.s.withdrawal.floorReal ? 'It is in today’s money and rises with inflation. It overrides the decrease limit.' : 'It is a fixed nominal amount (kept from an older saved plan). It overrides the decrease limit.',
    limit: 'A minimum does not mean the portfolio can afford it — in long bad markets it can empty the portfolio.',
  }),
  desiredIncome: (c) => {
    const p = plannedIncome(c.s, c.computed.result)
    return {
      title: 'Desired monthly income',
      what: c.s.withdrawal.strategy === 'fixed' ? 'The monthly income you want to withdraw in retirement.' : 'The income you would like — the results show whether your percentage strategy actually reaches it.',
      how: c.s.retirement.real ? 'Entered in today’s money: it is raised with inflation until withdrawals start, so it keeps the same purchasing power.' : 'Entered as the actual amount at the start of withdrawals: used as it is.',
      example: p && c.s.withdrawal.strategy === 'fixed' ? `You entered ${c.money(c.s.retirement.income)}; in year ${p.startYear} the plan withdraws ${c.money(p.firstMonthly)} a month.` : undefined,
    }
  },
  retirementIncome: () => ({
    title: 'Retirement income',
    what: 'The money your withdrawals actually pay, shown as a monthly amount for each retirement year.',
    how: 'If the portfolio cannot pay a planned withdrawal, only what was really paid counts.',
  }),
  realIncome: () => ({
    title: 'Income in today’s money',
    what: 'Retirement income converted to today’s purchasing power.',
    how: 'A fixed withdrawal raised with inflation stays flat here. A withdrawal that is not raised slowly falls.',
  }),
  lowestIncome: () => ({
    title: 'Lowest monthly income',
    what: 'The smallest monthly income in any full retirement year.',
    how: 'For adaptive strategies this matters more than the average: it is what you would have to live on in the worst modelled year.',
  }),
  incomeFunding: (c) => ({
    title: 'Does the plan fund your income?',
    what: `Checks whether every full retirement year pays at least your desired ${c.money(c.s.retirement.income)} a month${c.s.retirement.real ? ' in today’s money' : ''}.`,
    how: 'A positive balance alone does not count — a strategy that cuts income to almost nothing can “survive” while not supporting your life.',
  }),
  requiredCapital: (c) => ({
    title: 'Required capital',
    what: 'How much the portfolio should be worth when withdrawals start to fund your desired income.',
    how: 'For percentage strategies: yearly income ÷ withdrawal rate. For a fixed amount it is solved with the simulation so the withdrawals last until the end of the plan.',
    example: `${c.money(baseAmount(c.s.currency, 50_000))} a month = ${c.money(baseAmount(c.s.currency, 600_000))} a year; at 4 % that needs ${c.money(baseAmount(c.s.currency, 600_000) / 0.04)}.`,
    limit: 'The percentage formula is a planning rule of thumb, not proof that the income is sustainable. Taxes are not included.',
  }),
  financialIndependence: () => ({
    title: 'Financial independence',
    what: 'The first year in which your portfolio reaches the capital needed for your desired income, if you keep investing as planned.',
    how: 'The capital need grows with inflation when the income is set in today’s money.',
    limit: 'Reaching the capital is not the same as a guaranteed income — the sustainability check and the Risk view show whether the strategy holds up.',
  }),
  retirementHorizon: () => ({
    title: 'Retirement horizon',
    what: 'How long withdrawals are planned to last — from the start year until the end of the plan or the chosen last year.',
    how: 'Longer retirements need a lower withdrawal rate for the same safety.',
  }),
  sequenceRisk: () => ({
    title: 'Sequence-of-returns risk',
    what: 'The same average return can lead to very different results depending on when the bad years come.',
    how: 'Losses right after withdrawals start hurt most: you sell investments while they are cheap, and that money can no longer recover.',
  }),
  stressTest: () => ({
    title: 'Market stress test',
    what: 'Replays your plan with a hypothetical market shock at the start of retirement and compares it with the normal projection.',
    how: 'A crash is a one-time drop at the start of the first withdrawal year, after that year’s budget is set and before the first payment. Weak-year scenarios replace the return for the first retirement years.',
    limit: 'These are hypothetical scenarios, not predictions of a real crisis.',
  }),
  strategyCompare: () => ({
    title: 'Strategy comparison',
    what: 'The four withdrawal strategies applied to the same plan: same savings, returns, inflation, fees and retirement length.',
    limit: 'No strategy wins on everything: compare stable income against the risk of running out.',
  }),
  incomeProbability: (c) => ({
    title: 'Chance of funding your income',
    what: `The share of simulated paths in which every full retirement year paid at least ${c.money(c.s.retirement.income)} a month${c.s.retirement.real ? ' in today’s money' : ''}.`,
    how: 'This is stricter — and more honest — than “the portfolio did not run out”.',
    limit: 'It describes this simplified model, not real markets.',
  }),

  /* ───────── Other settings ───────── */
  lumps: (c) => ({
    title: 'One-time investments',
    what: 'Extra single deposits in a specific year — a bonus, an inheritance or the sale of something.',
    how: 'Each is invested at the start of the chosen year and grows from then on.',
    example: `${c.money(baseAmount(c.s.currency, 50_000))} invested in year 5 of a 30-year plan grows for 26 years.`,
  }),
  startAge: () => ({
    title: 'Age at start',
    what: 'Optional. Shows your age on the timeline, chart and results instead of only plan years.',
    how: 'Nothing about you is stored or sent anywhere; the age only changes labels.',
  }),

  /* ───────── Results ───────── */
  projected: (c) => ({
    title: 'Projected value',
    what: 'What the portfolio would be worth at the end of the plan under your assumptions.',
    example: c.computed.result ? `Your plan: ${c.money(c.computed.result.totals.final)}.` : undefined,
    limit: 'A projection, not a promise — it assumes the same return every year.',
  }),
  assumptions: () => ({
    title: 'Hypothetical projection',
    what: 'All results are calculations based on the assumptions you enter, not forecasts.',
    how: 'They assume a constant return, the fees you set and no taxes. Use the Risk view to see how uncertain real outcomes are.',
  }),
  todayMoney: (c) => ({
    title: 'In today’s money',
    what: 'The future amount converted to today’s purchasing power using your inflation rate.',
    example: c.computed.result ? `${c.money(c.computed.result.totals.final)} at the end buys roughly what ${c.money(c.computed.result.totals.finalReal)} buys today.` : undefined,
  }),
  contributed: (c) => ({
    title: 'Contributed',
    what: 'All the money you put in yourself: the initial investment, regular contributions and one-time investments.',
    example: c.computed.result ? `Your plan: ${c.money(c.computed.result.totals.contributed)}.` : undefined,
  }),
  gain: () => ({
    title: 'Investment gain',
    what: 'What your investments earned on top of the money you put in — after any fees.',
    how: 'Calculated as final value plus withdrawals minus contributions.',
  }),
  gainShare: (c) => {
    const tot = c.computed.result?.totals
    return {
      title: 'Growth vs. contributions',
      what: 'The share of the final value that comes from investment growth rather than your own deposits.',
      example: tot && tot.final > 0 ? `Of ${c.money(tot.final)}, ${c.money(tot.contributed)} are your deposits and ${c.money(tot.netGain)} is growth.` : undefined,
      more: 'In long plans, growth often becomes larger than everything you deposited — that is compounding: returns start earning returns of their own.',
    }
  },
  withdrawalStartValue: () => ({
    title: 'Value when withdrawals begin',
    what: 'How much the portfolio is worth at the moment the first withdrawal is made.',
    how: 'In plans with withdrawals this is the most useful headline: it is what you have built up for the withdrawal phase.',
  }),
  depletion: (c) => ({
    title: 'Portfolio depletion',
    what: 'The year in which the portfolio can no longer pay the full withdrawal.',
    how: 'Lower withdrawals, a later start, more contributions or a higher return assumption delay it.',
    example: c.computed.result?.totals.depletedAtMonth != null ? `In your plan the money runs out in year ${Math.ceil(c.computed.result.totals.depletedAtMonth / 12)}.` : 'In your plan the money lasts until the end.',
  }),
  withdrawn: (c) => ({
    title: 'Total withdrawn',
    what: 'The sum of all withdrawals actually paid out.',
    example: c.computed.result ? `Your plan: ${c.money(c.computed.result.totals.withdrawn)}.` : undefined,
  }),
  endValue: () => ({
    title: 'Ending value',
    what: 'What remains at the end of the plan after all withdrawals.',
  }),
  peak: () => ({
    title: 'Peak value',
    what: 'The highest value the portfolio reaches during the plan.',
  }),
  chart: () => ({
    title: 'Growth over time',
    what: 'The blue area is the portfolio value; the sand line is the money you contributed. The gap between them is your investment growth.',
    how: 'Hover, tap or use the arrow keys for exact values. “Today’s money” shows the inflation-adjusted value with the nominal value dashed.',
  }),
  milestones: () => ({
    title: 'Milestones',
    what: 'Notable moments found in your projection — for example when growth exceeds your deposits or when the goal is reached.',
  }),
  insights: () => ({
    title: 'Insights',
    what: 'Short observations calculated from your plan, such as the effect of investing a little more.',
    how: 'Each one is computed with the same engine as your results.',
  }),
  sensitivity: (c) => ({
    title: 'Return sensitivity',
    what: `Your plan recalculated with a return 2 percentage points lower and higher (${c.pct(c.s.annualReturn - 2)} and ${c.pct(c.s.annualReturn + 2)}).`,
    how: 'It shows how much the result depends on the return assumption.',
    limit: 'These are alternative assumptions, not probabilities or a confidence range.',
  }),
  yearTable: () => ({
    title: 'Yearly breakdown',
    what: 'The projection year by year: start value, contributions, withdrawals, growth, fees and end value.',
    how: 'Every row adds up exactly: start + contributions − withdrawals + growth − fees = end value.',
  }),

  /* ───────── Compare ───────── */
  compare: () => ({
    title: 'Scenario comparison',
    what: 'Up to four versions of your plan side by side, calculated the same way.',
    how: 'Create a variant (higher contribution, different return, longer horizon, extra fee) and compare the results. Scenarios are kept in this browser only.',
  }),
  compareDiff: () => ({
    title: 'Differences',
    what: 'How each scenario differs from the first one.',
    limit: 'Differences are hidden between scenarios in different currencies, because amounts are never converted.',
  }),

  /* ───────── Risk ───────── */
  monteCarlo: () => ({
    title: 'Monte Carlo simulation',
    what: 'Runs your plan many times with randomly varying yearly returns to show a range of possible outcomes.',
    how: 'Instead of one line, you get a fan: the middle is the typical outcome, the edges are luckier and unluckier paths.',
    limit: 'The probabilities describe this simplified model, not real markets. Crashes and long downturns can be more extreme than the model assumes.',
    more: 'Monthly returns are drawn independently from a log-normal distribution around your expected return. Contributions, fees, withdrawals and inflation are the same as in your plan.',
  }),
  riskReturn: (c) => ({
    title: 'Expected return in the simulation',
    what: `The simulation uses your plan’s ${c.pct(c.s.annualReturn)} as the typical (median) yearly return.`,
    how: 'Change it in the Plan view. Half of the simulated paths end above the median, half below.',
  }),
  volatility: (c) => ({
    title: 'Volatility',
    what: 'How much yearly returns swing around the expected return.',
    how: 'Higher volatility widens the range of outcomes.',
    example: `With ${c.pct(c.extra?.vol ?? 15)} volatility, roughly two years out of three land within about ±${c.pct(c.extra?.vol ?? 15)} of the expected return.`,
    more: 'Broad stock indices have historically shown around 15–20 % annual volatility, bonds much less. This is an input, not a prediction.',
  }),
  simulations: () => ({
    title: 'Number of simulations',
    what: 'How many random paths are calculated.',
    how: 'More simulations give smoother, more stable percentiles. The fixed random seed makes results reproducible; “Run again” uses a new one.',
  }),
  median: (c) => ({
    title: 'Median outcome',
    what: 'The middle result: half of the simulated paths end higher, half lower.',
    example: c.extra?.median != null ? `Here: ${c.money(c.extra.median)}.` : undefined,
  }),
  percentiles: (c) => ({
    title: 'Percentiles',
    what: 'Where outcomes fall within the range. The 10th percentile means 10 % of paths ended lower; the 90th means 90 % ended lower.',
    example: c.extra?.p10 != null && c.extra?.p90 != null ? `8 out of 10 simulated paths ended between ${c.money(c.extra.p10)} and ${c.money(c.extra.p90)}.` : undefined,
  }),
  goalProbability: (c) => ({
    title: 'Chance of reaching the goal',
    what: 'The share of simulated paths that reached your target by the target year.',
    example: c.extra?.goalProb != null ? `${c.pct(c.extra.goalProb * 100, 0)} of paths reached it.` : undefined,
    limit: 'It is a property of the model, not a real-world guarantee.',
  }),
  depletionProbability: () => ({
    title: 'Chance of running out',
    what: 'The share of simulated paths in which withdrawals emptied the portfolio before the plan ended.',
  }),
}
