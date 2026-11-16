import { expect, test, type Page } from '@playwright/test'
import { seedLegacy } from './helpers'

/* V5.2.2: final polish. */

async function fresh(page: Page, hash = '', lang = 'en') {
  await page.goto(`/?lang=${lang}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/?lang=${lang}${hash}`)
}

async function setAmount(page: Page, v: string) {
  const a = page.locator('#f-w-income')
  await a.click()
  await a.press('ControlOrMeta+a')
  await a.pressSequentially(v)
  await a.press('Enter')
}

test('Plan: portfolio survival is not presented as a fully safe plan when income loses purchasing power', async ({ page }) => {
  await fresh(page, '#/retirement')
  await page.getByRole('button', { name: 'Plan withdrawals' }).click()
  await page.getByRole('radio', { name: 'Fixed amount' }).click()
  await setAmount(page, '150')
  const idx = page.getByRole('switch', { name: /Increase income with inflation/ })
  if ((await idx.getAttribute('aria-checked')) === 'true') await idx.click()
  await page.getByRole('link', { name: 'Plan', exact: true }).click()
  const status = page.locator('.hero .status-line')
  await expect(status).toContainText('Money lasts the whole plan')
  await expect(status).toContainText(/loses \d+ ?% of its purchasing power/)
  await expect(status).toHaveClass(/is-warn/)
  // Retirement says the same thing with the same number.
  const pct = (await status.textContent())!.match(/loses (\d+)/)![1]
  await page.getByRole('link', { name: 'Retirement', exact: true }).click()
  await expect(page.locator('.hero .status-line')).toContainText(new RegExp(`falls ${pct} ?%`))
})

test('Plan: an inflation-indexed fixed withdrawal keeps the plain green status', async ({ page }) => {
  await fresh(page, '#/retirement')
  await page.getByRole('button', { name: 'Plan withdrawals' }).click()
  await page.getByRole('radio', { name: 'Fixed amount' }).click()
  await setAmount(page, '150')
  const idx = page.getByRole('switch', { name: /Increase income with inflation/ })
  if ((await idx.getAttribute('aria-checked')) === 'false') await idx.click()
  await page.getByRole('link', { name: 'Plan', exact: true }).click()
  await expect(page.locator('.hero .status-line')).not.toContainText('purchasing power')
})

for (const lang of ['en', 'cs']) {
  test(`strategy table (${lang}): all four strategies fit a normal desktop column without scrolling`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop layout')
    await fresh(page, '#/retirement', lang)
    await page.locator('.retire-empty .btn--primary').click()
    await page.locator('#sec-strategies .disc-btn').click()
    const m = await page.locator('#sec-strategies .table-scroll').evaluate((e) => [e.scrollWidth, e.clientWidth])
    expect(m[0], 'no horizontal scrolling at 1440').toBeLessThanOrEqual(m[1])
    await expect(page.locator('#sec-strategies thead th').last()).toBeInViewport()
  })
}

const doc = (currency: string, periods: { years: number; amount: number; frequency?: string; paused?: boolean }[]) => ({
  activeId: 'a',
  scenarios: [
    {
      v: 4,
      id: 'a',
      name: 'P',
      currency,
      initial: 1000,
      horizonYears: 40,
      contribMode: 'schedule',
      periods: periods.map((p, i) => ({ id: `p${i}`, years: p.years, amount: p.amount, frequency: p.frequency ?? 'monthly', paused: !!p.paused })),
    },
  ],
})

test.describe('contribution timeline labels', () => {
  const cases: [string, number, { years: number; amount: number; frequency?: string; paused?: boolean }[]][] = [
    ['CZK', 1, [{ years: 5, amount: 2000 }, { years: 8, amount: 3000 }, { years: 7, amount: 5000 }, { years: 10, amount: 7000 }, { years: 10, amount: 12500 }]],
    ['EUR', 2, [{ years: 1, amount: 120 }, { years: 1, amount: 450 }, { years: 2, amount: 99 }, { years: 1, amount: 1500 }, { years: 3, amount: 80 }, { years: 5, amount: 2500, frequency: 'quarterly' }, { years: 10, amount: 777 }, { years: 17, amount: 25000, frequency: 'annual' }]],
    ['USD', 3, [{ years: 1, amount: 100 }, { years: 1, amount: 100, paused: true }, { years: 1, amount: 300 }, { years: 1, amount: 1200 }, { years: 1, amount: 50 }, { years: 1, amount: 75 }, { years: 1, amount: 99999 }, { years: 33, amount: 1250000 }]],
  ]
  for (const lang of ['en', 'cs']) {
    for (const [currency, , periods] of cases) {
      test(`${currency} ${lang}: labels never overlap or clip, and the currency is shown once`, async ({ page }) => {
        await page.goto(`/?lang=${lang}`)
        await seedLegacy(page, doc(currency, periods))
        await page.goto(`/?lang=${lang}`)
        await page.locator('.tl-plot').waitFor()
        await page.waitForTimeout(400)
        const boxes = await page.locator('.tl-val').evaluateAll((els) =>
          els
            .map((e) => ({ vis: getComputedStyle(e).display !== 'none', r: e.getBoundingClientRect(), clipped: e.scrollWidth > e.clientWidth + 1, text: e.textContent ?? '' }))
            .filter((b) => b.vis),
        )
        expect(boxes.length).toBeGreaterThan(0)
        for (let i = 0; i < boxes.length; i++) {
          expect(boxes[i].clipped, `label "${boxes[i].text}" clipped`).toBe(false)
          expect(boxes[i].text, 'no repeated currency above bars').not.toMatch(/CZK|EUR|USD|€|\$|Kč/)
          if (i > 0) expect(boxes[i].r.left, `labels ${i - 1}/${i} overlap`).toBeGreaterThanOrEqual(boxes[i - 1].r.right - 0.5)
        }
        await expect(page.locator('.tl-unit')).toContainText(currency)
        // The full value survives in the accessible name of every bar.
        await expect(page.locator('.tl-seg').first()).toHaveAttribute('aria-label', /\d/)
      })
    }
  }
})

test('Compare presets: equal card heights, the difference is the prominent number', async ({ page }) => {
  await fresh(page, '#/compare')
  await page.locator('.preset').first().waitFor()
  const rows = await page.locator('.preset').evaluateAll((els) => els.map((e) => ({ top: Math.round(e.getBoundingClientRect().top), h: Math.round(e.getBoundingClientRect().height) })))
  const byRow = new Map<number, Set<number>>()
  for (const r of rows) byRow.set(r.top, (byRow.get(r.top) ?? new Set()).add(r.h))
  for (const [top, hs] of byRow) expect(hs.size, `cards in the row at ${top} have different heights`).toBe(1)
  await expect(page.locator('.preset-effect strong').first()).toContainText(/[+−-]/)
})

test('Risk: zero depletions are reported as "none in N runs", not as proof of no risk', async ({ page }) => {
  await fresh(page, '#/retirement')
  await page.getByRole('button', { name: 'Plan withdrawals' }).click()
  await page.getByRole('link', { name: 'Risk', exact: true }).click()
  const depl = page.locator('.depl-v')
  await expect(depl).toBeVisible({ timeout: 20_000 })
  await expect(depl).toContainText(/\d+ ?%|none in [\d,]+ runs|<1/)
  await page.getByText('Model assumptions').click()
  await expect(page.getByText(/not zero real-world risk/)).toBeVisible()
})
