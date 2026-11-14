import { expect, test, type Page } from '@playwright/test'

async function typeInto(page: Page, label: string, value: string) {
  const input = page.getByRole('textbox', { name: label, exact: true })
  await input.click()
  await input.press('ControlOrMeta+a')
  await input.pressSequentially(value)
  await input.press('Enter')
}

async function loadFiPreset(page: Page) {
  await page.getByRole('button', { name: /^Examples/ }).click()
  await page.getByRole('menuitem', { name: 'Financial independence (4 % rule)' }).click()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?lang=en')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/?lang=en')
})

test('Test A in the UI: 6 000 000 CZK at 4 % → 20 000 / month, 240 000 / year', async ({ page }) => {
  await page.getByRole('radio', { name: /CZK/ }).click()
  await typeInto(page, 'Initial investment', '6000000')
  await typeInto(page, 'Regular contribution – Amount', '0')
  await page.getByRole('button', { name: /^Withdrawals/ }).click()
  await page.getByRole('switch', { name: 'Withdraw from the portfolio' }).click()
  await typeInto(page, 'Start in year', '1')
  await page.getByRole('radio', { name: /Initial portfolio %/ }).click()
  await page.getByRole('button', { name: '4%', exact: true }).click()
  const preview = page.locator('.breakdown')
  await expect(preview).toContainText(/CZK\s20,000/)
  await expect(preview).toContainText(/CZK\s240,000/)
  await expect(preview).toContainText(/CZK\s6,000,000/)
})

test('retirement planner: FI capital, strategy switching and income-based status', async ({ page }) => {
  await loadFiPreset(page)
  await page.getByRole('link', { name: 'Retirement', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Retirement & financial independence' })).toBeVisible()
  await expect(page.locator('.fi-card')).toContainText('Capital needed in year 26')
  await expect(page.locator('.fi-card')).toContainText('income ÷ 4%')
  await expect(page.locator('.hero-value').first()).toContainText('/ month')

  await page.getByRole('radio', { name: /Current portfolio %/ }).click()
  await expect(page.locator('.retire .status-line').first()).toContainText(/desired/)
  await page.getByRole('radio', { name: /Fixed amount/ }).click()
  await expect(page.locator('.fi-card')).toContainText('solved so withdrawals last')
})

test('stress test changes outcomes; charts share one crosshair', async ({ page, isMobile }) => {
  await loadFiPreset(page)
  await page.getByRole('link', { name: 'Retirement', exact: true }).click()
  const stress = page.getByRole('radio', { name: '−40 % crash' })
  await stress.click()
  await expect(page.getByText('An instant 40 % fall')).toBeVisible()
  const remaining = page.locator('.ctable').first().locator('tr', { hasText: 'Ending value' })
  const [base, stressed] = await remaining.locator('td').allTextContents()
  expect(base).not.toBe(stressed)

  if (!isMobile) {
    const charts = page.locator('.paired').first().locator('.xy-plot')
    await charts.first().scrollIntoViewIfNeeded()
    const box = await charts.first().boundingBox()
    await page.mouse.move(box!.x + box!.width * 0.7, box!.y + box!.height / 2)
    await expect(page.locator('.paired').first().locator('.xy-tip')).toHaveCount(2)
  }
})

test('strategies open side by side in Compare with retirement metrics', async ({ page }) => {
  await loadFiPreset(page)
  await page.getByRole('link', { name: 'Retirement', exact: true }).click()
  await page.getByRole('button', { name: 'Open in Compare' }).click()
  await expect(page.locator('.scen')).toHaveCount(4)
  await expect(page.locator('.ctable')).toContainText('Funds desired income')
  await expect(page.locator('.ctable')).toContainText('Lowest monthly income')
})

test('Risk view reports the chance of funding the desired income', async ({ page }) => {
  await loadFiPreset(page)
  await page.getByRole('link', { name: 'Risk', exact: true }).click()
  await expect(page.getByText(/Funds €[\d,]+ \/ month every year/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Lowest monthly income (median path)')).toBeVisible()
})

test('legacy fixed withdrawals still work and empty state offers to start', async ({ page }) => {
  await page.getByRole('link', { name: 'Retirement', exact: true }).click()
  await page.getByRole('button', { name: 'Plan withdrawals' }).click()
  await expect(page.locator('.breakdown')).toBeVisible()
})

/** A plan saved by V4 (fixed amount + one `indexed` switch) — the brief's example. */
const LEGACY_V4 = {
  id: 'sc-legacy', currency: 'CZK', initial: 3_000_000, horizonYears: 100, horizonMonths: 0, annualReturn: 7, startAge: 30,
  contribMode: 'constant', constant: { amount: 20_000, frequency: 'monthly' }, inflationEnabled: true, inflation: 2.5,
  retirement: { income: 50_000, real: true },
  withdrawal: { enabled: true, startYear: 33, endYear: null, strategy: 'fixed', amount: 40_000, frequency: 'monthly', indexed: true, stopContributions: true, rate: 4, maxIncrease: 5, maxDecrease: 2.5, floor: 0 },
}

/** Seed storage in the next document, after the current page has flushed its own state on pagehide. */
const seed = (page: Page, s: object) =>
  page.addInitScript((s) => localStorage.setItem('investcalc.v2.scenarios', JSON.stringify({ scenarios: [s], activeId: (s as { id: string }).id })), s)

test('V4.1: a saved V4 plan migrates, and the two inflation questions are separate', async ({ page }) => {
  await seed(page, LEGACY_V4)
  await page.goto('/?lang=en&seeded=1#/retirement')
  const b = page.locator('.breakdown')
  // Case A: 40 000 in today's money → ≈ 88 150 in year 33, and 2.5 % more in year 34.
  await expect(b.locator('.breakdown-v')).toContainText(/CZK\s88,150/)
  await expect(b).toContainText(/Desired income in today’s money\s*CZK\s40,000 \/ month/)
  await expect(b).toContainText(/year 34 plans CZK\s90,354/)
  await expect(page.getByRole('textbox', { name: 'Desired monthly income', exact: true })).toHaveValue(/40,000/)

  // Case B/C: the same number at retirement is used as entered, then raised each year.
  await page.getByRole('radio', { name: 'At retirement', exact: true }).click()
  await expect(b.locator('.breakdown-v')).toContainText(/CZK\s40,000/)
  await expect(b).toContainText(/year 34 plans CZK\s41,000/)

  // Case D: no raise during retirement → constant nominal income.
  await page.getByRole('switch', { name: 'Increase income with inflation every year' }).click()
  await expect(b).toContainText(/stays at CZK\s40,000 a month/)
})

test('V4.1: percentage strategies show the 4 % budget without a pre-retirement inflation step', async ({ page }) => {
  await seed(page, {
    ...LEGACY_V4,
    initial: 10_000_000,
    annualReturn: 0,
    constant: { amount: 0, frequency: 'monthly' },
    withdrawal: { ...LEGACY_V4.withdrawal, strategy: 'initialPct', startYear: 11 },
  })
  await page.goto('/?lang=en&seeded=1#/retirement')
  const b = page.locator('.breakdown')
  await expect(b).toContainText(/CZK\s10,000,000/)
  await expect(b).toContainText(/CZK\s400,000 \/ year/)
  await expect(b.locator('.breakdown-v')).toContainText(/CZK\s33,333/)
  await expect(b).not.toContainText('Inflation until withdrawals')
})
