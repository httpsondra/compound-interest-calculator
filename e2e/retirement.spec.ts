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
  const preview = page.locator('.income-preview')
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
  await expect(page.locator('.income-preview')).toBeVisible()
})
