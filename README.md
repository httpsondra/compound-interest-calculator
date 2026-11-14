# InvestCalc

Compound-interest and investment-planning calculator for [investcalc.dev](https://investcalc.dev).
Czech and English, light and dark themes. Everything runs locally in the browser: no accounts, no tracking, no external APIs.

## Stack

Vite + React 19 + TypeScript, deployed as a static site on Vercel. The charts are hand-written SVG; there is no chart library.
Runtime dependencies are React and the self-hosted Geist fonts, nothing else. Unit tests use Vitest and fast-check; E2E tests use Playwright (desktop Chromium and mobile WebKit).

```
npm run dev        # local dev server
npm test           # unit + property tests (engine, model, parsing, CSV, share links)
npm run e2e        # builds, serves and runs Playwright journeys
npm run lint && npm run typecheck && npm run build
```

## Architecture

| Layer | Path | Responsibility |
|---|---|---|
| Engine | `src/engine/` | Pure, deterministic financial maths: `simulate()` (the single canonical pipeline), inverse solvers, Monte Carlo |
| Model | `src/model/` | UI scenario ⇄ engine plan mapping, validation, timeline operations, presets, safe share-link (de)serialisation, derived results |
| State | `src/state/` | Scenario store with undo history and local persistence |
| UI | `src/components/` | Plan / Compare / Risk views, controls, results, charts |
| i18n & formatting | `src/i18n/`, `src/lib/format.ts` | Typed cs/en dictionaries, plural rules, locale-aware money formatting and tolerant number parsing |

Every number on screen comes from `simulate()`: the cards, chart, yearly table, goal solvers, fee impact, comparison and Monte Carlo paths. Solved values (for example the required contribution) are evaluated through the same pipeline, so feeding them back into the calculator reproduces the target.

## Calculation conventions

- **Return** is an *effective annual* rate R. Growth over m months is (1 + R)^(m/12), so the monthly rate is (1 + R)^(1/12) − 1, never R/12.
- **Clock.** Time runs in months. Cash flows sit at their exact fractional times, so weekly (12/52 months), monthly, quarterly, semi-annual and annual flows are modelled exactly.
- **Deposit timing.** "Start" deposits are made at the beginning of each interval (annuity due). "End" deposits are made at the end (ordinary annuity).
- **Order of events.** At the same instant, deposits come before withdrawals. Between cash flows the balance grows first, and then the management fee is deducted: B·(1+R)^Δ·(1−f)^Δ.
- **Fees.**
  - The annual fee f is an effective annual rate on the balance.
  - Entry (%) and fixed fees are deducted from every deposit, including the initial investment, and never exceed the deposit.
  - Fee impact compares the plan with an otherwise identical fee-free run. Lost growth is the difference in final value minus the fees actually paid.
- **Contribution timeline.**
  - Periods are contiguous segments, so overlaps are impossible by construction and a pause is an explicit segment.
  - A gap at the end, or periods beyond the horizon, raise a warning that offers a one-click fix.
  - Amounts are per occurrence at the chosen frequency.
- **Indexation.** Contribution growth steps up at every plan anniversary: amount × (1 + g)^(plan year − 1). "With inflation" uses g = π. Withdrawals are indexed per withdrawal year, see below.
- **Inflation.** Real value = nominal ÷ (1 + π)^(months/12). Inflation is never applied twice: real values only deflate the nominal results.
- **Withdrawals.** A withdrawal is paid only up to the available balance. The first month that cannot be paid in full is reported as depletion, and any shortfall is tracked. The sustainable withdrawal is found by bisection: the largest amount that never depletes before the horizon.
- **Goals.**
  - Time to goal is the first month the trajectory, continued up to 100 years, crosses the target.
  - The required contribution and the extra lump sum come from an exact two-point affine solve, verified against the engine. Non-linear cases fall back to bounded bisection: tolerance 0.01, at most 200 iterations.
  - Explicit `not-needed` and `unreachable` states are returned instead of NaN.
- **Monte Carlo.**
  - Model: independent log-normal monthly returns.
  - The return input is treated as the *geometric/median* annual return, ln(1+R). The arithmetic mean is (1+R)·e^(σ²/2) − 1.
  - The seeded mulberry32 PRNG makes runs reproducible.
  - It runs in a Web Worker so input stays responsive.
- **Precision.** Full float64 precision is kept internally, and values are rounded only for display. A float64 has about 15–16 significant digits, far beyond the money values involved (amounts are capped at 10¹³).
- **Currency.** Switching the currency changes the unit label only. Nothing is converted at an exchange rate.

## Retirement & withdrawal conventions (V4.1)

All four strategies run inside the same `simulate()` engine (`WithdrawalPolicy` in `src/engine/types.ts`):

| Strategy | Yearly budget |
|---|---|
| Fixed amount | the planned monthly withdrawal W (`withdrawal.amount`); first-year budget 12 · W · (1 + π)^(years before withdrawals) when entered in today's money, 12 · W when entered at retirement; × (1 + π) each later withdrawal year when “increase with inflation” is on |
| Initial portfolio % ("4 % rule") | year 1 = rate × portfolio at the first review; later years = previous budget × (1 + inflation) — later portfolio values are ignored |
| Current portfolio % | rate × portfolio at each annual review |
| Dynamic (guardrails) | target = rate × portfolio; limited to `[prev × (1+π) × (1 − maxDecrease), prev × (1+π) × (1 + maxIncrease)]`, i.e. the limits apply **after** the inflation adjustment of last year's spending; an optional minimum income (in today's money unless migrated from a V4 plan without indexing) is applied last and wins over the ceiling |

- **Planned withdrawal vs. income goal.** Two separate inputs that are never synchronised automatically:
  - The **planned withdrawal** (fixed monthly amount, or the rate of a percentage strategy) is the only thing that moves money: it drives the projection, charts and totals.
  - The **income goal** (`retirement: { enabled, income, real }`) is optional and off for new plans. It never changes cashflows. When set, it drives the financial-independence capital, the "funds your income" checks, Monte Carlo income probability, the strategy table and Compare's "Funds desired income" row. Without a goal those metrics are hidden and the plan is judged by whether every planned withdrawal is paid.
  - The goal comparison uses matching units: the planned income in the **first withdrawal year**, **monthly**, against the goal — both in today's money when the goal is, otherwise both nominal. The whole-retirement verdict uses the same rule as Monte Carlo.
  - "Use planned income as goal" and "Use goal as withdrawal" copy one value into the other on request.
- **Two separate inflation questions (V4.1).**
  - *How is the withdrawal entered?* “In today's money” raises it by inflation **before** withdrawals start (once per full plan year, `preIndexRate`); “At retirement” uses the number as entered.
  - *Does it rise during retirement?* The switch raises it once per withdrawal year (`indexRate`). Both factors multiply, so inflation is never applied twice: 40 000 in today's money at 2.5 % starting in year 33 plans 40 000 · 1.025³² ≈ 88 150 a month, then 90 354 in year 34.
  - Percentage strategies never get the pre-retirement factor: their budget comes from the projected portfolio. “Current portfolio %” has no inflation switch.
  - The guardrails minimum income is in today's money by default (`floorReal`).
- **Monthly income.** The income field is always a monthly amount. Quarterly or annual payouts pay 3× or 12× that amount per payment.
- **Migration (scenario `v`).**
  - **V4 and older (no `v`, or < 3):** V4 had one `indexed` switch for both inflation questions, stored the fixed amount per payment, and stored the desired income separately. **Both values are preserved:** the withdrawal keeps its amount (as a monthly equivalent: quarterly ÷ 3, annual ÷ 12), fixed + indexed → today's money + raised during retirement, fixed + not indexed → at retirement + constant; the desired income becomes the goal and is switched on (V4 always checked against it); a guardrails minimum stays indexed only if it was before. Trajectories, withdrawals and totals are identical to V4 (bit-for-bit, or within 1e-12 relative for quarterly/annual fixed amounts), and so are the FI analysis, funding verdicts and Monte Carlo income metrics. `tests/v41.test.ts` checks this against frozen V4 code in `tests/fixtures/v4`. One deliberate difference: a withdrawal phase shorter than a year with quarterly/annual payouts (or whose only payment falls after the horizon) is now rated at its full-year rate, where V4 divided lumpy payments by the months.
  - **v3 (an earlier V4.1 preview that merged the two values):** a fixed plan keeps that value as its withdrawal, with no goal; a percentage plan keeps it as its goal.
  - Share links keep the same envelope (`sv=2`); the scenario inside carries its own `v`.
- **Annual review.** Reviews happen at the start of every withdrawal year (`start + 12k`), before that month's cashflows. The budget is set once and split evenly over the year's payments, so 4 % is never taken every month.
- **Requested vs. paid.** Payments are capped at the balance. The engine records requested and paid amounts per withdrawal year, plus any shortfall.
- **Income.** Monthly income = paid ÷ 12 per withdrawal year. Today's-money income deflates at the start of each withdrawal year.
- **"Funds the desired income"** (only with a goal). Every full withdrawal year must pay at least the goal; a goal in today's money must keep its purchasing power every year. A withdrawal phase shorter than a year is rated at its full-year planned rate × the share actually paid. Deterministic results and Monte Carlo share this rule (`src/engine/income.ts`). A positive balance alone never counts as success.
- **Required capital** (only with a goal). For percentage strategies it is the planning identity *annual income ÷ rate*. For a fixed amount it is solved by simulation so withdrawals of the goal amount last until the plan ends. A goal in today's money is inflated to the retirement year.
- **Financial independence year.** The first month the savings (contributions stop at retirement when that switch is on) reach the capital need, which grows with inflation for today's-money income.
- **Stress tests.**
  - A crash is a single instantaneous loss at the start of the first withdrawal year, after that year's review and before the first payment. It is not also a negative period return.
  - "Flat", "poor first years" and custom sequences replace the period return for the first withdrawal years.
- **Sustainable withdrawal.**
  - Fixed strategy: the largest amount that never depletes.
  - Initial % and guardrails: the largest starting rate that never depletes.
  - Current %: not shown, because it cannot deplete.
- **Monte Carlo.** Every path runs the selected policy, with the same returns, fees and inflation as the deterministic plan.

Sources for context, not as hard-coded safe rates:
- Bengen's 4 % rule: https://www.bengenfs.com/the-4-percent-rule/
- Vanguard's dynamic spending research: https://corporate.vanguard.com/content/corporatesite/us/en/corp/articles/making-your-wealth-last-longer-retirement.html
- Morningstar's withdrawal-rate research: https://www.morningstar.com/retirement/whats-safe-retirement-withdrawal-rate-2026

The app labels every rate as a hypothetical assumption.

## Fixed in the redesign (bugs in the previous version)

- The monthly rate was R/12 instead of (1+R)^(1/12) − 1, so "10 % per year" produced 110 471 rather than 110 000.
- Fractional horizons were rounded to whole months without telling the user.
- Overlapping special periods silently let the last one win.
- Half-filled periods were silently ignored.
- Validation consisted of a blocking `alert()`.

## Deployment

`vercel.json` sets long-lived caching for hashed assets and security headers (CSP, nosniff, frame options).
Deep links are hash-based (`#/compare`, `#/risk`), and shared calculations use `?s=<base64url JSON, schema v2>`. Neither needs a server rewrite.
