import { expect, test, type Page } from '@playwright/test'

/* V5.2: Retirement, Compare and Risk refinements. */

async function fresh(page: Page, hash = '') {
  await page.goto('/?lang=en')
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/?lang=en${hash}`)
}

async function enableWithdrawals(page: Page) {
  await fresh(page, '#/retirement')
  await page.getByRole('button', { name: 'Plan withdrawals' }).click()
  await expect(page.locator('.hero-value')).toBeVisible()
}

test.describe('Retirement', () => {
  test('monthly income leads, three figures show, the rest sits behind More figures', async ({ page }) => {
    await enableWithdrawals(page)
    await expect(page.locator('.hero-value')).toContainText(/€[\d,]+/)
    await expect(page.locator('.hero-stats .stat')).toHaveCount(3)
    await expect(page.locator('.hero-stats')).toContainText('Purchasing power change')
    const more = page.locator('.more')
    await expect(more.locator('.more-grid')).toBeHidden()
    await more.locator('summary').click()
    await expect(more.locator('.more-grid')).toContainText('Ending value')
  })

  test('the income chart comes first and the stress test and strategies are collapsed by default', async ({ page }) => {
    await enableWithdrawals(page)
    const titles = await page.locator('.paired .mini-title').allTextContents()
    expect(titles[0]).toMatch(/Monthly income/)
    expect(titles[1]).toMatch(/Portfolio/)
    await expect(page.getByRole('button', { name: /^Market stress test/ })).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('button', { name: /^Withdrawal strategies compared/ })).toHaveAttribute('aria-expanded', 'false')
    await page.getByRole('button', { name: /^Market stress test/ }).click()
    await expect(page.getByRole('radio', { name: '−30 % crash' })).toBeVisible()
    // Opening one does not open the other.
    await expect(page.getByRole('button', { name: /^Withdrawal strategies compared/ })).toHaveAttribute('aria-expanded', 'false')
  })

  test('a tooltip before the first withdrawal explains itself instead of being empty', async ({ page, isMobile }) => {
    test.skip(isMobile, 'mouse hover')
    await enableWithdrawals(page)
    const chart = page.locator('.paired .xy-plot').first()
    await chart.scrollIntoViewIfNeeded()
    const box = (await chart.boundingBox())!
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2)
    const tip = page.locator('.paired .xy-tip').first()
    await expect(tip).toContainText(/Withdrawals start in year/)
    await expect(tip.locator('.xy-tip-row')).toHaveCount(0)
  })

  test('tooltip titles use years and months, not decimals; lines carry value labels and the axis a unit', async ({ page, isMobile }) => {
    test.skip(isMobile, 'mouse hover')
    await enableWithdrawals(page)
    const chart = page.locator('.paired .xy-plot').nth(1)
    await chart.scrollIntoViewIfNeeded()
    await expect(chart.locator('.xy-end').first()).toContainText(/€/)
    await expect(chart.locator('.xy-unit')).toHaveText('Year')
    const box = (await chart.boundingBox())!
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2)
    const title = await page.locator('.paired .xy-tip-title').first().textContent()
    expect(title).not.toMatch(/\d\.\d/)
  })

  test('a large purchasing-power loss is flagged even though every withdrawal is paid', async ({ page }) => {
    await enableWithdrawals(page)
    await page.getByRole('radio', { name: 'Fixed amount' }).click()
    // Fixed amount without inflation indexing erodes buying power.
    const idx = page.getByRole('switch', { name: /Increase income with inflation/ })
    if ((await idx.getAttribute('aria-checked')) === 'true') await idx.click()
    const status = page.locator('.hero .status-line')
    await expect(status).toBeVisible()
    await expect(status).toContainText(/buying power falls|Paid in full|Every planned withdrawal|can’t be fully paid/)
  })
})

test.describe('Compare', () => {
  test('a single scenario starts with presets, not an empty chart and table', async ({ page }) => {
    await fresh(page, '#/compare')
    await expect(page.getByRole('heading', { name: 'Start a comparison' })).toBeVisible()
    await expect(page.locator('.preset').first()).toContainText(/final value/)
    await expect(page.locator('.xy-plot')).toHaveCount(0)
    await expect(page.locator('.ctable')).toHaveCount(0)
  })

  test('a preset adds a variant, shows the difference and brings in the chart', async ({ page }) => {
    await fresh(page, '#/compare')
    await page.getByRole('button', { name: /Return \+1 pp/ }).click()
    await expect(page.locator('.scen')).toHaveCount(2)
    await expect(page.locator('.cmp-best')).toContainText(/Highest final portfolio value/)
    await expect(page.locator('.scen-delta').first()).toContainText(/\+€/)
    await expect(page.locator('.scen-changes').first()).toContainText('Return 8%')
    await expect(page.locator('.xy-end')).toHaveCount(2)
  })

  test('the table shows only differing rows until asked for all', async ({ page }) => {
    await fresh(page, '#/compare')
    await page.getByRole('button', { name: /Return \+1 pp/ }).click()
    const rows = page.locator('.ctable tbody tr')
    const few = await rows.count()
    await expect(page.locator('.ctable')).not.toContainText('Contributed') // identical in both scenarios
    await page.getByRole('button', { name: 'Show all figures' }).click()
    await expect(page.locator('.ctable')).toContainText('Contributed')
    expect(await rows.count()).toBeGreaterThan(few)
    await page.getByRole('button', { name: 'Only differences' }).or(page.getByRole('button', { name: 'Show only differences' })).first().click()
    await expect(page.locator('.ctable')).not.toContainText('Contributed')
  })

  test('the single scenario can still be renamed, duplicated and shared state is kept', async ({ page }) => {
    await fresh(page, '#/compare')
    const name = page.locator('.start-name')
    await name.fill('Base case')
    await page.getByRole('button', { name: 'Duplicate and edit' }).click()
    await expect(page.locator('.scen')).toHaveCount(2)
    await expect(page.locator('.scen-name').first()).toHaveValue('Base case')
  })
})

test.describe('Risk', () => {
  test('outcomes are explained as downside, typical and upside', async ({ page }) => {
    await fresh(page, '#/risk')
    const trio = page.locator('.trio').last()
    await expect(trio).toBeVisible({ timeout: 20_000 })
    await expect(trio).toContainText('Poor markets')
    await expect(trio).toContainText('Typical')
    await expect(trio).toContainText('Strong markets')
    await expect(page.locator('.xy-end')).toHaveCount(3)
    await expect(page.getByText('5th percentile', { exact: true })).toBeHidden() // behind "All percentiles"
    await page.getByText('All percentiles').click()
    await expect(page.getByText('5th percentile', { exact: true })).toBeVisible()
  })

  test('a percentage withdrawal strategy gets the depletion caution and the income range', async ({ page }) => {
    await fresh(page, '#/retirement')
    await page.getByRole('button', { name: 'Plan withdrawals' }).click()
    await page.getByRole('link', { name: 'Risk', exact: true }).click()
    await expect(page.locator('.depl-caution')).toContainText(/never reaches zero/, { timeout: 20_000 })
    await expect(page.getByText('Lowest monthly income during retirement')).toBeVisible()
    await expect(page.getByText(/No income target is set/)).toBeVisible()
  })

  test('with an income target set, the chance of meeting it leads', async ({ page }) => {
    await fresh(page, '#/retirement')
    await page.getByRole('button', { name: 'Plan withdrawals' }).click()
    await page.getByRole('button', { name: 'Set an income goal' }).click()
    await expect(page.locator('#f-goal')).toBeFocused()
    await page.getByRole('link', { name: 'Risk', exact: true }).click()
    await expect(page.locator('.lead-q-val')).toContainText(/\d+\s?%/, { timeout: 20_000 })
    await expect(page.getByText(/chance of at least/)).toBeVisible()
  })

  test('Set an income target leads to the Retirement goal field', async ({ page }) => {
    await fresh(page, '#/retirement')
    await page.getByRole('button', { name: 'Plan withdrawals' }).click()
    await page.getByRole('link', { name: 'Risk', exact: true }).click()
    await page.getByRole('button', { name: 'Set an income target' }).click()
    await expect(page).toHaveURL(/#\/retirement/)
    await expect(page.locator('#f-goal')).toBeFocused({ timeout: 8000 })
  })
})

test('Czech: new Retirement, Compare and Risk copy is translated', async ({ page }) => {
  await page.goto('/?lang=cs')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/?lang=cs#/compare')
  await expect(page.getByRole('heading', { name: 'Začněte srovnání' })).toBeVisible()
  await page.goto('/?lang=cs#/risk')
  await expect(page.locator('.trio').last()).toContainText('Slabé trhy', { timeout: 20_000 })
})
