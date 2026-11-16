import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?lang=en')
  await page.evaluate(() => localStorage.clear())
})

test('first visit is light; an explicit stored theme always wins', async ({ page }) => {
  await page.goto('/?lang=en')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.evaluate(() => localStorage.setItem('investcalc.theme', 'dark'))
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.evaluate(() => localStorage.setItem('investcalc.theme', 'system'))
  await page.reload()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/)
})

test('Advanced settings: collapsed by default, one entry point, and values survive collapsing', async ({ page }) => {
  await page.goto('/?lang=en')
  const adv = page.getByRole('button', { name: /Advanced settings/ })
  const panel = page.locator('#sec-advanced-panel')
  await expect(adv).toHaveAttribute('aria-expanded', 'false')
  await expect(panel).toHaveAttribute('inert', '')

  await adv.click()
  await expect(adv).toHaveAttribute('aria-expanded', 'true')
  await expect(panel).not.toHaveAttribute('inert', '')

  await page.locator('#sec-inflation .disc-btn').click()
  const rate = page.locator('#f-inflation')
  await rate.click()
  await rate.press('ControlOrMeta+a')
  await rate.pressSequentially('4')
  await rate.press('Enter')
  await expect(rate).toHaveValue(/4/)

  await adv.click() // collapse
  await expect(panel).toHaveAttribute('inert', '')
  await expect(adv).toContainText(/inflation/i)

  await adv.click() // expand again: nothing was reset
  await expect(page.locator('#f-inflation')).toHaveValue(/4/)
})

test('Detailed analysis: collapsed, keyboard-operable tabs, selected tab toggles closed', async ({ page }) => {
  await page.goto('/?lang=en')
  const tabs = page.getByRole('tablist', { name: 'Detailed analysis' })
  await expect(tabs).toBeVisible()
  await expect(page.getByRole('tabpanel')).toHaveCount(0)

  const first = tabs.getByRole('tab').first()
  await first.click()
  await expect(first).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel')).toHaveCount(1)

  await page.keyboard.press('ArrowRight')
  await expect(tabs.getByRole('tab').nth(1)).toBeFocused()
  await page.keyboard.press('End')
  await expect(tabs.getByRole('tab').last()).toBeFocused()
  await page.keyboard.press('Home')
  await expect(first).toBeFocused()

  await first.click() // re-selecting the open tab closes it
  await expect(page.getByRole('tabpanel')).toHaveCount(0)
})

test('a plain plan shows no retirement highlights and no gap warning', async ({ page }) => {
  await page.goto('/?lang=en')
  await expect(page.locator('.hl-row')).toHaveCount(0)
  await expect(page.getByText(/no contributions planned/i)).toHaveCount(0)
})
