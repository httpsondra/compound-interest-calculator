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
- **Indexation.** Contribution growth and inflation-linked withdrawals step up at every plan anniversary: amount × (1 + g)^(plan year − 1). "With inflation" uses g = π.
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

## Retirement & withdrawal conventions (V4)

All four strategies run inside the same `simulate()` engine (`WithdrawalPolicy` in `src/engine/types.ts`):

| Strategy | Yearly budget |
|---|---|
| Fixed amount | `amount` per payment, raised once per plan year by inflation when indexing is on (unchanged from V3) |
| Initial portfolio % ("4 % rule") | year 1 = rate × portfolio at the first review; later years = previous budget × (1 + inflation) — later portfolio values are ignored |
| Current portfolio % | rate × portfolio at each annual review |
| Dynamic (guardrails) | target = rate × portfolio; limited to `[prev × (1+π) × (1 − maxDecrease), prev × (1+π) × (1 + maxIncrease)]`, i.e. the limits apply **after** the inflation adjustment of last year's spending; an optional minimum income (year‑1 money, indexed only when indexing is on) is applied last and wins over the ceiling |

- **Annual review.** Reviews happen at the start of every withdrawal year (`start + 12k`), before that month's cashflows. The budget is set once and split evenly over the year's payments, so 4 % is never taken every month.
- **Requested vs. paid.** Payments are capped at the balance. The engine records requested and paid amounts per withdrawal year, plus any shortfall.
- **Income.** Monthly income = paid ÷ 12 per withdrawal year. Today's-money income deflates at the start of each withdrawal year.
- **"Funds the desired income".** Every full withdrawal year must pay at least the desired monthly income. A withdrawal phase shorter than a year is evaluated pro-rata. Deterministic results and Monte Carlo share this rule (`src/engine/income.ts`). A positive balance alone never counts as success.
- **Required capital.** For percentage strategies it is the planning identity *annual income ÷ rate*. For a fixed amount it is solved by simulation so the withdrawals last until the plan ends. Income set in today's money is inflated to the retirement year.
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
