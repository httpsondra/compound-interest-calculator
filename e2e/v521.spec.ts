import { expect, test, type Page } from '@playwright/test'

/* V5.2.1: financial comparison accuracy. */

async function fresh(page: Page, hash = '', lang = 'en') {
  await page.goto(`/?lang=${lang}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/?lang=${lang}${hash}`)
}
async function enableWithdrawals(page: Page) {
  await fresh(page, '#/retirement')
  await page.getByRole('button', { name: 'Plan withdrawals' }).click()
  await expect(page.locator('.hero-value')).toBeVisible()
}
const openStrategies = async (page: Page) => {
  const h = page.getByRole('button', { name: /^Withdrawal strategies compared/ })
  if ((await h.getAttribute('aria-expanded')) !== 'true') await h.click()
}
const num = (s: string) => Number(s.replace(/[^\d.]/g, ''))

test.describe('Strategy comparison starts every rule from the same income', () => {
  test('all four columns show one starting income, the rate derived from it, and an explanation of what happens after year one', async ({ page }) => {
    await enableWithdrawals(page)
    await openStrategies(page)
    const table = page.locator('#sec-strategies-panel table')
    await expect(table.locator('thead th')).toHaveCount(5)
    await expect(page.locator('#sec-strategies-panel .strat-intro')).toContainText(/Same starting income for every rule/)
    const first = await table.locator('tbody tr').first().locator('td .ct-val').allTextContents()
    expect(first).toHaveLength(4)
    expect(new Set(first).size).toBe(1) // identical starting income in every column
    await expect(table.locator('thead .ct-sub')).toHaveCount(3) // three percentage rules show their derived rate
    await expect(page.locator('.strat-after li')).toHaveCount(5) // four rules + the fixed = initial % note
    await expect(page.locator('.strat-after')).toContainText('Current portfolio %.')
    await expect(page.locator('.strat-after')).toContainText('follow the same path')
    // Neutral wording: no strategy is declared best.
    await expect(page.locator('#sec-strategies-panel')).not.toContainText(/\bbest strategy\b/i)
    await expect(page.locator('#sec-strategies-panel .note').last()).toContainText('No rule is best for everyone')
  })

  test('a zero income baseline invents nothing: an explanation replaces the table', async ({ page }) => {
    await enableWithdrawals(page)
    await page.getByRole('radio', { name: 'Fixed amount' }).click()
    const amount = page.locator('#f-w-income')
    await amount.click()
    await amount.press('ControlOrMeta+a')
    await amount.pressSequentially('0')
    await amount.press('Enter')
    await openStrategies(page)
    await expect(page.locator('#sec-strategies-panel')).toContainText(/plans no income/)
    await expect(page.locator('#sec-strategies-panel table')).toHaveCount(0)
  })

  test('the user’s withdrawal settings are not changed by looking at the comparison', async ({ page }) => {
    await enableWithdrawals(page)
    await page.getByRole('radio', { name: 'Initial portfolio %' }).click()
    const rate = page.locator('#f-w-rate')
    const before = await rate.inputValue()
    await openStrategies(page)
    await expect(page.locator('#sec-strategies-panel table')).toBeVisible()
    await expect(rate).toHaveValue(before)
    await expect(page.getByRole('radio', { name: 'Initial portfolio %' })).toHaveAttribute('aria-checked', 'true')
  })

  test('mobile: the table is a labelled, keyboard-reachable scroll region and every strategy can be reached', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phone layout')
    await enableWithdrawals(page)
    await openStrategies(page)
    await expect(page.locator('.scroll-hint')).toBeVisible()
    const region = page.locator('#sec-strategies-panel [role="region"][tabindex="0"]')
    await expect(region).toHaveAttribute('aria-label', 'Withdrawal strategies compared')
    const box = await region.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
    expect(box.sw).toBeGreaterThan(box.cw) // scrolls, with the hint above it
    await region.evaluate((el) => (el.scrollLeft = el.scrollWidth))
    const lastHead = page.locator('#sec-strategies-panel thead th').last()
    await expect(lastHead).toBeInViewport()
    // Row headers stay associated with their values.
    await expect(page.locator('#sec-strategies-panel tbody th[scope="row"]').first()).toBeVisible()
  })
})

test.describe('Compare says what it measures', () => {
  test('presets explain themselves; +5 years mentions withdrawals when they are on', async ({ page }) => {
    await enableWithdrawals(page)
    await page.getByRole('link', { name: 'Compare', exact: true }).click()
    await expect(page.locator('.preset-hint').first()).toBeVisible()
    await expect(page.locator('.presets')).toContainText(/Extends the whole plan, including retirement withdrawals/)
    await expect(page.locator('.presets')).toContainText(/Raises the annual fee assumption by one percentage point/)
    await expect(page.locator('.preset-basis')).toContainText(/not automatically better or worse/)
  })

  test('a preview equals the created scenario, and the headline names a figure, not a "best" plan', async ({ page }) => {
    await fresh(page, '#/compare')
    const preset = page.locator('.preset', { hasText: '+5 years' })
    const preview = await preset.locator('.preset-effect').textContent()
    const compact = preview!.match(/([+−-])\D*([\d.,]+)\s?([kKmMbB])?/)!
    const unit = (compact[3] ?? '').toLowerCase()
    const mult = unit === 'k' ? 1e3 : unit === 'm' ? 1e6 : unit === 'b' ? 1e9 : 1
    const previewValue = (compact[1] === '+' ? 1 : -1) * num(compact[2]) * mult
    await preset.click()
    const delta = page.locator('.scen-delta').first()
    await expect(delta).toBeVisible()
    const created = (/^[−-]/.test((await delta.textContent())!.trim()) ? -1 : 1) * num((await delta.textContent())!.split(/vs\./)[0])
    expect(Math.abs(created - previewValue)).toBeLessThanOrEqual(Math.abs(created) * 0.02 + 1000)
    const best = page.locator('.cmp-best')
    await expect(best).toContainText(/^Highest final portfolio value/)
    await expect(best).not.toContainText(/best/i)
    await expect(page.locator('.cmp-caveat')).toContainText(/differ in plan length/)
  })
})

test.describe('Retirement goal chart', () => {
  async function withGoal(page: Page, value: string) {
    await enableWithdrawals(page)
    await page.getByRole('button', { name: 'Set an income goal' }).click()
    const goal = page.locator('#f-goal')
    await goal.press('ControlOrMeta+a')
    await goal.pressSequentially(value)
    await goal.press('Enter')
  }
  const topTick = (page: Page) =>
    page.locator('.paired .xy-svg').first().locator('.xy-tick').evaluateAll((els) =>
      Math.max(...els.map((e) => Number((e.textContent ?? '').replace(/[^\d.]/g, '')) * (/k/i.test(e.textContent ?? '') ? 1e3 : /M/.test(e.textContent ?? '') ? 1e6 : 1)).filter(Number.isFinite)),
    )

  test('a goal far above the income does not flatten the chart: it is announced as off the scale', async ({ page }) => {
    await withGoal(page, '900000')
    await expect(page.locator('.paired .xy-goal--off').first()).toContainText(/above this scale/)
    expect(await topTick(page)).toBeLessThan(900000)
    await expect(page.locator('.paired .xy-goal').first()).toBeVisible()
  })

  for (const value of ['100', '250']) {
    test(`a goal near or below the income (${value}) is drawn as a normal line`, async ({ page }) => {
      await withGoal(page, value)
      await expect(page.locator('.paired .xy-goal line').first()).toBeAttached()
      await expect(page.locator('.paired .xy-goal--off')).toHaveCount(0)
    })
  }
})

test('Risk percentile lines say which percentile they are', async ({ page }) => {
  await fresh(page, '#/risk')
  await expect(page.getByText('10th percentile: 1 in 10 simulations is lower, so worse is possible').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/Median: half of the simulations are lower, half higher/).first()).toBeVisible()
  await expect(page.locator('.view-sub')).toContainText(/not forecasts or guarantees/)
})

test('Czech: strategy comparison, Compare and Risk wording are translated', async ({ page }) => {
  await fresh(page, '#/retirement', 'cs')
  await page.getByRole('button', { name: 'Plánovat výběry' }).click()
  await page.getByRole('button', { name: /^Srovnání strategií výběrů/ }).click()
  await expect(page.locator('#sec-strategies-panel .strat-intro')).toContainText('Všechna pravidla startují ze stejného příjmu')
  await expect(page.locator('#sec-strategies-panel .note').last()).toContainText('Žádné pravidlo není nejlepší pro každého')
  await page.goto('/?lang=cs#/compare')
  await expect(page.locator('.preset-basis')).toContainText('automaticky lepší ani horší')
  await page.locator('.preset').first().click()
  await expect(page.locator('.cmp-best')).toContainText('Nejvyšší konečná hodnota portfolia')
  await page.goto('/?lang=cs#/risk')
  await expect(page.locator('.trio').last()).toContainText('10. percentil', { timeout: 20_000 })
})
