import { expect, test, type Page } from '@playwright/test'

/*
 * V5.1 regression: nested Advanced-settings sections must open and close independently.
 * Root cause was CSS: `.disc.is-open .disc-panel` (descendant selector) matched the panels of every
 * nested section while the outer "Advanced settings" section was open, so the inner sections always
 * rendered open (and with a rotated chevron) no matter what their own aria-expanded said.
 * "Collapsed" is therefore asserted on what the user sees (rendered height), not only on attributes.
 */

const SECTIONS = ['growth', 'goal', 'inflation', 'fees', 'withdrawal', 'lumps', 'timing'] as const
type Sec = (typeof SECTIONS)[number]

const header = (page: Page, id: Sec | 'advanced') => page.locator(`#sec-${id} > .disc-h > .disc-btn`)
const panelHeight = (page: Page, id: Sec | 'advanced') =>
  page.locator(`#sec-${id}-panel`).evaluate((el) => (el.firstElementChild as HTMLElement).getBoundingClientRect().height)

async function expectOpen(page: Page, id: Sec) {
  await expect(header(page, id)).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator(`#sec-${id}-panel`)).not.toHaveAttribute('inert', '')
  await expect.poll(() => panelHeight(page, id)).toBeGreaterThan(20)
}
async function expectClosed(page: Page, id: Sec) {
  await expect(header(page, id)).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator(`#sec-${id}-panel`)).toHaveAttribute('inert', '')
  await expect.poll(() => panelHeight(page, id)).toBeLessThan(2)
}
const chevron = (page: Page, id: Sec) => header(page, id).locator('.disc-chevron').evaluate((el) => getComputedStyle(el).transform)

test.beforeEach(async ({ page }) => {
  await page.goto('/?lang=en')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/?lang=en')
  await header(page, 'advanced').click()
})

test('opening Advanced settings leaves every section collapsed, chevrons included', async ({ page }) => {
  await expect(header(page, 'advanced')).toHaveAttribute('aria-expanded', 'true')
  for (const id of SECTIONS) {
    await expectClosed(page, id)
    await expect.poll(() => chevron(page, id)).toBe('none')
  }
})

test('inflation: open, close, reopen — setting and value are unchanged', async ({ page }) => {
  await header(page, 'inflation').click()
  await expectOpen(page, 'inflation')
  await expect.poll(() => chevron(page, 'inflation')).not.toBe('none')
  const rate = page.locator('#f-inflation')
  await rate.click()
  await rate.press('ControlOrMeta+a')
  await rate.pressSequentially('4')
  await rate.press('Enter')
  await expect(rate).toHaveValue(/4/)
  await expect(header(page, 'inflation')).toContainText(/4\s?% annually/)

  await header(page, 'inflation').click()
  await expectClosed(page, 'inflation')
  await expect.poll(() => chevron(page, 'inflation')).toBe('none')
  await expect(header(page, 'inflation')).toContainText(/4\s?% annually/) // still active while closed

  await header(page, 'inflation').click()
  await expectOpen(page, 'inflation')
  await expect(page.locator('#f-inflation')).toHaveValue(/4/)
  await expect(page.getByRole('switch', { name: 'Account for inflation' })).toHaveAttribute('aria-checked', 'true')
})

test('fees and withdrawals open together; closing fees leaves withdrawals open and live', async ({ page }) => {
  await header(page, 'fees').click()
  await header(page, 'withdrawal').click()
  await expectOpen(page, 'fees')
  await expectOpen(page, 'withdrawal')
  await expectClosed(page, 'inflation') // untouched siblings stay closed

  await page.getByRole('switch', { name: 'Include fees' }).click()
  await expect(page.locator('#f-fee-annual')).toBeVisible()
  await page.getByRole('switch', { name: 'Withdraw from the portfolio' }).click()
  await expect(page.locator('#f-w-income')).toBeVisible()

  await header(page, 'fees').click()
  await expectClosed(page, 'fees')
  await expectOpen(page, 'withdrawal')
  await expect(page.locator('#f-w-income')).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Withdraw from the portfolio' })).toHaveAttribute('aria-checked', 'true')

  // Editing a value does not close (or reopen) anything.
  const income = page.locator('#f-w-income')
  await income.click()
  await income.press('ControlOrMeta+a')
  await income.pressSequentially('45000')
  await income.press('Enter')
  await expectOpen(page, 'withdrawal')
  await expectClosed(page, 'fees')
  await expect(header(page, 'withdrawal')).toContainText(/45,000/)
})

test('turning a feature on or off never changes whether its section is open', async ({ page }) => {
  await header(page, 'inflation').click()
  const sw = page.getByRole('switch', { name: 'Account for inflation' })
  await sw.click()
  await expect(sw).toHaveAttribute('aria-checked', 'false')
  await expectOpen(page, 'inflation')
  await expect(header(page, 'inflation')).toContainText('Off')
  await sw.click()
  await expect(sw).toHaveAttribute('aria-checked', 'true')
  await expectOpen(page, 'inflation')
  // The switch of a closed section is not reachable, and enabling a feature elsewhere does not open it.
  await header(page, 'inflation').click()
  await expectClosed(page, 'inflation')
  await header(page, 'goal').click()
  await page.getByRole('switch', { name: 'Set a target value' }).click()
  await expectOpen(page, 'goal')
  await expectClosed(page, 'inflation')
})

test('collapsed summaries come from real data, in both languages', async ({ page }) => {
  await expect(header(page, 'growth')).toContainText('Off')
  await expect(header(page, 'goal')).toContainText('Not set')
  await expect(header(page, 'lumps')).toContainText('None')
  await expect(header(page, 'timing')).toContainText('End of period')
  await header(page, 'fees').click()
  await page.getByRole('switch', { name: 'Include fees' }).click()
  await header(page, 'fees').click()
  await expectClosed(page, 'fees')
  await expect(header(page, 'fees')).toContainText(/0\.5\s?% annually/)

  await page.getByRole('button', { name: /Čeština/ }).click()
  await expect(header(page, 'fees')).toContainText(/0,5\s?% ročně/)
  await expect(header(page, 'goal')).toContainText('Nenastaven')
  await expect(header(page, 'growth')).toContainText('Vypnuto')
})

test('open sections stay as they are across language and currency changes and recalculation', async ({ page }) => {
  await header(page, 'fees').click()
  await header(page, 'timing').click()
  await page.getByRole('button', { name: /Čeština/ }).click()
  await expectOpen(page, 'fees')
  await expectOpen(page, 'timing')
  await expectClosed(page, 'inflation')
  await page.getByRole('radio', { name: /USD/ }).click()
  await expectOpen(page, 'fees')
  await expectClosed(page, 'withdrawal')
  await page.getByRole('button', { name: /English/ }).click()
  await expectOpen(page, 'timing')
  await expectClosed(page, 'goal')
  // A recalculation (changing a primary input) does not touch the accordion either.
  const years = page.locator('#f-years')
  await years.click()
  await years.press('ControlOrMeta+a')
  await years.pressSequentially('12')
  await years.press('Enter')
  await expectOpen(page, 'fees')
  await expectClosed(page, 'inflation')
})

test('a saved scenario reloads with its values and every section closed', async ({ page }) => {
  await header(page, 'inflation').click()
  const rate = page.locator('#f-inflation')
  await rate.click()
  await rate.press('ControlOrMeta+a')
  await rate.pressSequentially('3.5')
  await rate.press('Enter')
  await header(page, 'withdrawal').click()
  await page.getByRole('switch', { name: 'Withdraw from the portfolio' }).click()
  await expect(page.locator('#f-w-income')).toBeVisible()
  await page.waitForTimeout(400) // debounce before the save
  await page.reload()
  await header(page, 'advanced').click()
  for (const id of SECTIONS) await expectClosed(page, id)
  await expect(header(page, 'inflation')).toContainText(/3\.5\s?% annually/)
  await expect(header(page, 'withdrawal')).not.toContainText('Off')
  await header(page, 'inflation').click()
  await expect(page.locator('#f-inflation')).toHaveValue(/3\.5/)
})

test('keyboard: Enter/Space toggle, focus stays on the header when its section closes', async ({ page, browserName }) => {
  const h = header(page, 'fees')
  await h.focus()
  await page.keyboard.press('Enter')
  await expectOpen(page, 'fees')
  await page.keyboard.press('Space')
  await expectClosed(page, 'fees')
  await expect(h).toBeFocused()

  await page.keyboard.press('Space')
  await expectOpen(page, 'fees')
  const sw = page.getByRole('switch', { name: 'Include fees' })
  await sw.focus()
  await expect(sw).toBeFocused()
  // Closing with focus inside moves focus to the header instead of losing it.
  await h.click()
  await expectClosed(page, 'fees')
  // WebKit moves focus to <body> on a mouse press of a button before the click handler runs, so there is
  // nothing inside the panel to rescue there; elsewhere focus must land on the header, never get lost.
  if (browserName !== 'webkit') await expect(h).toBeFocused()
  // Closed content is not reachable by Tab.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('switch', { name: 'Include fees' })).not.toBeFocused()
})

test('touch: tapping a header toggles it, and a help icon inside never toggles the section', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch input only exists on the mobile project')
  const h = header(page, 'goal')
  await h.tap()
  await expectOpen(page, 'goal')
  await h.tap()
  await expectClosed(page, 'goal')
  await header(page, 'inflation').tap()
  await page.getByRole('button', { name: /^Help: Account for inflation|Account for inflation/ }).first().tap().catch(() => undefined)
  await expectOpen(page, 'inflation')
})

test('Plan withdrawals: the same state as the Retirement planner, linked, without a second copy', async ({ page }) => {
  await header(page, 'withdrawal').click()
  await page.getByRole('switch', { name: 'Withdraw from the portfolio' }).click()
  await page.getByRole('radio', { name: 'Initial portfolio %' }).click()
  const rate = page.locator('#f-w-rate')
  await rate.click()
  await rate.press('ControlOrMeta+a')
  await rate.pressSequentially('3.5')
  await rate.press('Enter')
  await expect(page.getByLabel('Paid out')).toBeVisible()
  await expect(page.locator('#sec-withdrawal-panel .wd-goal')).toHaveCount(0) // income goal lives in the planner
  await page.getByRole('link', { name: /Open the full planner|planner/i }).click()
  await expect(page).toHaveURL(/#\/retirement/)
  await expect(page.locator('#f-w-rate')).toHaveValue(/3\.5/)
  await expect(page.getByRole('radio', { name: 'Initial portfolio %' })).toHaveAttribute('aria-checked', 'true')
})
