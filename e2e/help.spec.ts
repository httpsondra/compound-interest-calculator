import { expect, test, type Page } from '@playwright/test'

const pop = (page: Page) => page.locator('.help-pop')

async function expectInViewport(page: Page) {
  const box = await pop(page).boundingBox()
  const vp = page.viewportSize()!
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width)
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?lang=en')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/?lang=en')
})

test.describe('desktop pointer and keyboard', () => {
  test.skip(({ isMobile }) => isMobile, 'pointer hover is desktop-only')

  test('hover opens, leaving closes; click pins until Escape', async ({ page }) => {
    const btn = page.getByRole('button', { name: 'About “Expected annual return”' })
    await btn.hover()
    await expect(pop(page)).toBeVisible()
    await expect(pop(page)).toContainText('Expected annual return')
    await page.mouse.move(5, 5)
    await expect(pop(page)).toHaveCount(0)

    await btn.click()
    await expect(pop(page)).toBeVisible()
    await page.mouse.move(5, 5)
    await page.waitForTimeout(400)
    await expect(pop(page)).toBeVisible() // pinned
    await page.keyboard.press('Escape')
    await expect(pop(page)).toHaveCount(0)
  })

  test('keyboard: Enter opens and focuses the explanation, Escape returns focus', async ({ page }) => {
    const btn = page.getByRole('button', { name: 'About “Initial investment”' })
    await btn.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Initial investment' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toBeFocused()
    await expect(btn).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(btn).toBeFocused()
  })

  test('only one explanation is open at a time; Learn more expands', async ({ page }) => {
    await page.getByRole('button', { name: 'About “Expected annual return”' }).click()
    await expect(pop(page)).toHaveCount(1)
    await page.getByRole('button', { name: 'About “Initial investment”' }).click()
    await expect(pop(page)).toHaveCount(1)
    await expect(pop(page)).toContainText('Initial investment')
    await page.getByRole('button', { name: 'About “Expected annual return”' }).click()
    const more = pop(page).getByRole('button', { name: 'Learn more' })
    await more.click()
    await expect(pop(page)).toContainText('(1 + R)^(1/12)')
    await expect(pop(page).getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
  })

  test('popovers inside the sticky sidebar are not clipped', async ({ page }) => {
    // Open "More options" → Fees and its annual fee help, deep inside the scrolling sidebar.
    await page.getByRole('button', { name: /^Fees/ }).click()
    await page.getByRole('switch', { name: 'Include fees' }).click()
    await page.getByRole('button', { name: 'About “Annual fee (on balance)”' }).click()
    await expect(pop(page)).toBeVisible()
    await expectInViewport(page)
    // The popover is on top: the element at its centre belongs to it.
    const inside = await page.evaluate(() => {
      const el = document.querySelector('.help-pop')!
      const r = el.getBoundingClientRect()
      return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
    })
    expect(inside).toBe(true)
  })
})

test('touch / tap: opens, stays within the viewport, closes on outside tap and close button', async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 740 })
    // The "Hypothetical projection" tag sits at the right edge on wider screens; use a stat at the right column too.
    const btn = page.getByRole('button', { name: 'About “Investment gain”' })
    await btn.click()
    await expect(pop(page)).toBeVisible()
    await expectInViewport(page)
    await page.mouse.click(10, 700)
    await expect(pop(page)).toHaveCount(0)
    await btn.click()
    await pop(page).getByRole('button', { name: 'Close' }).click()
    await expect(pop(page)).toHaveCount(0)
  }
})

test('content follows language and currency', async ({ page }) => {
  await page.getByRole('radio', { name: /USD/ }).click()
  await page.getByRole('button', { name: 'About “Expected annual return”' }).click()
  await expect(pop(page)).toContainText(/\$4,000 would grow to \$4,280/)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /Čeština/ }).click()
  await page.getByRole('button', { name: 'Vysvětlení: Očekávané roční zhodnocení' }).click()
  await expect(pop(page)).toContainText('Očekávané roční zhodnocení')
  await expect(pop(page)).toContainText(/4\s000\s\$/)
})

test('help is available across Plan, Compare and Risk', async ({ page }) => {
  for (const name of ['Projected value', 'Contributed', 'Growth over time', 'Return sensitivity', 'Yearly breakdown']) {
    await expect(page.getByRole('button', { name: `About “${name}”` })).toHaveCount(1)
  }
  await page.getByRole('link', { name: 'Compare' }).click()
  await expect(page.getByRole('button', { name: 'About “Compare scenarios”' })).toBeVisible()
  await page.getByRole('link', { name: 'Risk' }).click()
  await page.getByRole('button', { name: 'About “Median outcome”' }).click()
  await expect(pop(page)).toContainText(/Here: €[\d,]+/)
  await expect(page.getByRole('button', { name: 'About “Annual volatility”' })).toBeVisible()
})
