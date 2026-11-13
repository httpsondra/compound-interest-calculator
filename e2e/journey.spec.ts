import { expect, test, type Page } from '@playwright/test'

const heroValue = async (page: Page) =>
  ((await page.locator('.hero-value').textContent()) ?? '').replace(/^.*?:\s*/, '').trim()

async function typeInto(page: Page, label: string | RegExp, value: string) {
  const input = page.getByRole('textbox', { name: label, exact: typeof label === 'string' })
  await input.click()
  await input.press('ControlOrMeta+a')
  await input.pressSequentially(value)
  await input.press('Enter')
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?lang=en')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/?lang=en')
})

test('reference case B: 100 000 at 10 % for one year is exactly 110 000', async ({ page }) => {
  await typeInto(page, 'Initial investment', '100000')
  await typeInto(page, 'Regular contribution – Amount', '0')
  await typeInto(page, 'Investment horizon – Years', '1')
  await typeInto(page, 'Expected annual return', '10')
  await expect.poll(() => heroValue(page)).toBe('€110,000')
})

test('full planning journey stays consistent across chart, cards, table, language and reload', async ({ page, isMobile }) => {
  await typeInto(page, 'Initial investment', '10000')
  await typeInto(page, 'Regular contribution – Amount', '300')
  await typeInto(page, 'Investment horizon – Years', '25')

  // Timeline with changing contributions
  await page.getByRole('radio', { name: 'Changes over time' }).click()
  await page.getByRole('button', { name: /^Edit period 1:/ }).click()
  await typeInto(page, 'Period 1 – Until year', '5')
  await expect(page.getByText('Years 6–20')).toBeVisible()
  await page.getByRole('button', { name: 'Add period' }).click()
  await expect(page.getByText(/no contributions are planned/i)).toHaveCount(0)

  // Goal
  await page.getByRole('button', { name: /Financial goal/ }).click()
  await page.getByRole('switch', { name: 'Set a target value' }).click()
  await typeInto(page, 'Target value', '500k')
  await typeInto(page, 'Reach it by year', '25')
  await expect(page.getByRole('heading', { name: /Goal/ })).toBeVisible()

  const value = await heroValue(page)
  expect(value).toMatch(/^€[\d,]+$/)

  // Table last row equals the hero value
  await page.getByRole('button', { name: 'Show yearly breakdown' }).click()
  const lastEnd = page.locator('.ytable tbody tr').last().locator('td.col-end')
  await expect(lastEnd).toHaveText(value)

  // Chart summary equals the hero value
  await expect(page.getByRole('img', { name: new RegExp(`Final value ${value.replace(/[$€,]/g, '.')}`) })).toBeVisible()

  // Keyboard inspection of the chart
  if (!isMobile) {
    const chart = page.locator('.plan-chart .xy-plot')
    await chart.focus()
    await chart.press('End')
    await expect(page.locator('.plan-chart .xy-tip')).toContainText('Year 25')
    await expect(page.locator('.plan-chart .xy-tip')).toContainText(value)
  }

  // Language switch keeps the same number, formatted for Czech
  await page.getByRole('button', { name: /Čeština/ }).click()
  const digits = value.replace(/\D/g, '')
  await expect.poll(async () => (await heroValue(page)).replace(/\D/g, '')).toBe(digits)
  await expect(page.getByRole('heading', { name: 'Předpoklady' })).toBeVisible()

  // Reload restores the configuration from local storage
  await page.reload()
  await expect.poll(async () => (await heroValue(page)).replace(/\D/g, '')).toBe(digits)
})

test('share link reproduces the calculation in a fresh browser', async ({ page, browser }) => {
  // Capture what the app writes to the clipboard (reading it back is not allowed in every engine).
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => void ((window as unknown as { __copied: string }).__copied = text) },
      configurable: true,
    })
  })
  await page.reload()
  await typeInto(page, 'Initial investment', '25000')
  await typeInto(page, 'Expected annual return', '5.5')
  const value = await heroValue(page)
  await page.getByRole('button', { name: 'Share' }).click()
  await expect(page.getByText(/Link copied/)).toBeVisible()
  const link = await page.evaluate(() => (window as unknown as { __copied: string }).__copied)
  expect(link).toContain('?s=')
  const fresh = await browser.newContext()
  const p2 = await fresh.newPage()
  await p2.goto(link)
  await expect.poll(() => heroValue(p2)).toBe(value)
  await expect(p2.getByText(/Loaded a shared calculation/)).toBeVisible()
  await fresh.close()
})

test('undo restores a removed timeline period', async ({ page }) => {
  await page.getByRole('radio', { name: 'Changes over time' }).click()
  await expect(page.locator('.tl-item')).toHaveCount(3)
  await page.getByRole('button', { name: /^Edit period 2:/ }).click()
  await page.getByRole('group', { name: 'Actions for period 2' }).getByRole('button', { name: 'Remove' }).click()
  await expect(page.locator('.tl-item')).toHaveCount(2)
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('.tl-item')).toHaveCount(3)
})

test('compare and risk views work', async ({ page }) => {
  await page.getByRole('link', { name: 'Compare' }).click()
  await page.getByRole('button', { name: 'Create a variant' }).click()
  await page.getByRole('menuitem', { name: 'Return +1 pp' }).click()
  await expect(page.locator('.scen')).toHaveCount(2)
  await expect(page.locator('.ctable thead th')).toHaveCount(3)
  await page.getByRole('link', { name: 'Risk' }).click()
  await expect(page.getByText('Median outcome').first()).toBeVisible()
  await expect(page.locator('.tile--lead dd')).toHaveText(/€[\d,]+/, { timeout: 15_000 })
})

test('invalid input shows an accessible error instead of NaN', async ({ page }) => {
  const input = page.getByRole('textbox', { name: 'Expected annual return', exact: true })
  await input.click()
  await input.press('ControlOrMeta+a')
  await input.pressSequentially('abc')
  await expect(page.getByRole('alert')).toHaveText('Enter a number.')
  await expect(page.locator('body')).not.toContainText('NaN')
})

test('no horizontal overflow on narrow screens, all views, both themes', async ({ page }) => {
  for (const scheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    for (const width of [320, 375, 390, 768]) {
      await page.setViewportSize({ width, height: 800 })
      for (const hash of ['', '#/compare', '#/risk']) {
        await page.goto(`/?lang=cs${hash}`)
        await page.waitForLoadState('networkidle')
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        expect(overflow, `overflow at ${width}px ${scheme} ${hash || 'plan'}`).toBeLessThanOrEqual(0)
      }
    }
  }
})

test('opening a share link with a full scenario list is undoable', async ({ page }) => {
  await page.getByRole('link', { name: 'Compare' }).click()
  for (const v of ['Return +1 pp', 'Return −1 pp', '+5 years']) {
    await page.getByRole('button', { name: 'Create a variant' }).click()
    await page.getByRole('menuitem', { name: v }).click()
  }
  await expect(page.locator('.scen')).toHaveCount(4)
  const names = await page.locator('.scen-name').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value || (e as HTMLInputElement).placeholder))
  // Build a share link through the app itself (clipboard captured).
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => void ((window as unknown as { __copied: string }).__copied = text) },
      configurable: true,
    })
  })
  await page.reload()
  await page.getByRole('button', { name: 'Share' }).click()
  const shared = await page.evaluate(() => (window as unknown as { __copied: string }).__copied)
  await page.goto(shared.replace('#/compare', '') + '#/compare')
  await expect(page.getByText(/Loaded a shared calculation/)).toBeVisible()
  await expect(page.locator('.scen')).toHaveCount(4)
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() =>
    page.locator('.scen-name').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value || (e as HTMLInputElement).placeholder)),
  ).toEqual(names)
})

test.describe('currency', () => {
  test('switching currency keeps the entered amounts and reformats everything', async ({ page }) => {
    await typeInto(page, 'Initial investment', '100000')
    const before = (await heroValue(page)).replace(/\D/g, '')
    await page.getByRole('radio', { name: /USD/ }).click()
    await expect(page.getByText(/Now in USD\. Amounts were kept as entered/)).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Initial investment', exact: true })).toHaveValue('100,000')
    await expect.poll(() => heroValue(page)).toMatch(/^\$[\d,]+$/)
    expect((await heroValue(page)).replace(/\D/g, '')).toBe(before)
    await page.getByRole('radio', { name: /CZK/ }).click()
    await expect.poll(() => heroValue(page)).toMatch(/^CZK\s[\d,]+$/)
    // Czech formatting, and language switch keeps the currency
    await page.getByRole('button', { name: /Čeština/ }).click()
    await expect.poll(() => heroValue(page)).toMatch(/^[\d\s\u00a0]+\sKč$/)
    await page.getByRole('radio', { name: /EUR/ }).click()
    await expect.poll(() => heroValue(page)).toMatch(/^[\d\s\u00a0]+\s€$/)
    await page.reload()
    // ?lang=en in the URL wins over the stored language; the currency must persist.
    await expect.poll(() => heroValue(page)).toMatch(/^€[\d,]+$/)
    await expect(page.locator('body')).not.toContainText('US$')
  })

  test('CSV export carries the selected currency', async ({ page }) => {
    // Capture the generated file in the page (download handling differs per engine).
    await page.addInitScript(() => {
      const orig = URL.createObjectURL
      URL.createObjectURL = (b: Blob | MediaSource) => {
        if (b instanceof Blob) void b.text().then((t) => ((window as unknown as { __csv: string }).__csv = t))
        return orig.call(URL, b)
      }
    })
    await page.reload()
    await page.getByRole('radio', { name: /USD/ }).click()
    await page.getByRole('button', { name: 'Download CSV' }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __csv?: string }).__csv ?? '')).toContain('End value (USD)')
    const csv = await page.evaluate(() => (window as unknown as { __csv: string }).__csv)
    expect(csv).toMatch(/Currency,USD/)
  })

  test('comparison never mixes currencies', async ({ page }) => {
    await page.getByRole('link', { name: 'Compare' }).click()
    await page.getByRole('button', { name: 'Create a variant' }).click()
    await page.getByRole('menuitem', { name: 'Return +1 pp' }).click()
    await expect(page.locator('.ct-diff').first()).toBeVisible()
    // Switch the active scenario to another currency
    await page.getByRole('link', { name: 'Plan' }).click()
    const usd = page.getByRole('radio', { name: /USD/ })
    await usd.click()
    await page.getByRole('link', { name: 'Compare' }).click()
    await expect(page.getByText(/use different currencies/)).toBeVisible()
    await expect(page.locator('.ct-diff')).toHaveCount(0)
    await expect(page.locator('.scen-final').first()).toContainText('$')
    await expect(page.locator('.scen-final').nth(1)).toContainText('€')
  })

  test('share links keep the denomination', async ({ page, browser }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async (text: string) => void ((window as unknown as { __copied: string }).__copied = text) },
        configurable: true,
      })
    })
    await page.reload()
    await page.getByRole('radio', { name: /USD/ }).click()
    const value = await heroValue(page)
    await page.getByRole('button', { name: 'Share' }).click()
    const link = await page.evaluate(() => (window as unknown as { __copied: string }).__copied)
    const fresh = await browser.newContext()
    const p2 = await fresh.newPage()
    await p2.goto(link)
    await expect.poll(() => heroValue(p2)).toBe(value)
    expect(value.startsWith('$')).toBe(true)
    await fresh.close()
  })
})

test('withdrawal plan headline shows value at withdrawal start, not a bare €0', async ({ page }) => {
  await page.getByRole('button', { name: /Examples/ }).click()
  await page.getByRole('menuitem', { name: 'Invest, then withdraw' }).click()
  await expect(page.locator('.hero-label')).toContainText('Value when withdrawals begin')
  await expect(page.locator('.status-line')).toBeVisible()
  await expect(page.locator('.hero-stats')).toContainText('Ending value')
})
