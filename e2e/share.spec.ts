import { expect, test, type Page } from '@playwright/test'

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const plan = (id: string, name: string) => ({ v: 4, id, name, currency: 'EUR' })
const FOUR = [plan('a', 'Mine a'), plan('b', 'Mine b'), plan('c', 'Mine c'), plan('d', 'Mine d')]
const SHARED = b64url({ sv: 2, s: { v: 4, name: 'Shared', currency: 'EUR' } })

/** Seed four saved plans once per browser context (survives in-test reloads). */
async function seedFour(page: Page, active = 'd') {
  await page.addInitScript(
    ([docs, act]) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('investcalc.v2.scenarios', JSON.stringify({ activeId: act, scenarios: docs }))
        sessionStorage.setItem('seeded', '1')
      }
    },
    [FOUR, active] as const,
  )
}
const names = (page: Page) => page.locator('.scen-name').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Replace a saved plan?' })

test('four saved plans and a shared link: a confirmation dialog, Cancel is the initial focus, nothing changes', async ({ page }) => {
  await seedFour(page)
  await page.goto(`/?lang=en&s=${SHARED}#/compare`)
  await expect(dialog(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await expect(page.locator('.scen')).toHaveCount(4)
  expect(await names(page)).toEqual(['Mine a', 'Mine b', 'Mine c', 'Mine d'])
})

test('the pending import survives notification lifetimes (no timer can remove it)', async ({ page }) => {
  await seedFour(page)
  await page.goto(`/?lang=en&s=${SHARED}#/compare`)
  await expect(dialog(page)).toBeVisible()
  // Longer than any toast lifetime (3.8 s and 6 s): the prompt is state, not a notification.
  await page.waitForTimeout(7000)
  await expect(dialog(page)).toBeVisible()
  await expect(page.locator('.scen')).toHaveCount(4)
})

test('reloading while the confirmation is open restores it exactly once, with no duplicate import', async ({ page }) => {
  await seedFour(page)
  await page.goto(`/?lang=en&s=${SHARED}#/compare`)
  await expect(dialog(page)).toBeVisible()
  await page.reload()
  await expect(dialog(page)).toBeVisible()
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await expect(page.locator('.scen')).toHaveCount(4)
  expect(await names(page)).toEqual(['Mine a', 'Mine b', 'Mine c', 'Mine d'])
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog(page)).toBeHidden()
  await page.reload()
  await expect(dialog(page)).toBeHidden() // URL cleaned up: no second prompt
})

test('cancelling leaves every saved plan unchanged, removes the link and says so', async ({ page }) => {
  await seedFour(page)
  await page.goto(`/?lang=en&s=${SHARED}#/compare`)
  await expect(dialog(page)).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByText('Shared calculation not loaded.')).toBeVisible()
  expect(await names(page)).toEqual(['Mine a', 'Mine b', 'Mine c', 'Mine d'])
  expect(page.url()).not.toContain('s=')
})

test('Escape cancels the import', async ({ page }) => {
  await seedFour(page)
  await page.goto(`/?lang=en&s=${SHARED}#/compare`)
  await expect(dialog(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
  expect(await names(page)).toEqual(['Mine a', 'Mine b', 'Mine c', 'Mine d'])
  expect(page.url()).not.toContain('s=')
})

test('keyboard only: choose a plan with the radio buttons, confirm with Enter, focus is not lost to the top of the page', async ({ page }) => {
  await seedFour(page, 'a')
  await page.goto(`/?lang=en&s=${SHARED}#/compare`)
  await expect(dialog(page)).toBeVisible()
  // Tab order inside the dialog: radio group, then Cancel, then Replace.
  await page.keyboard.press('Shift+Tab') // from Cancel into the choices
  const radioC = page.getByRole('radio', { name: 'Mine c' })
  await radioC.focus()
  await page.keyboard.press('Space')
  await expect(radioC).toBeChecked()
  await page.getByRole('button', { name: 'Replace plan' }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog(page)).toBeHidden()
  expect(await names(page)).toEqual(['Mine a', 'Mine b', 'Shared', 'Mine d'])
  // Focus is somewhere meaningful, not on <body> at the top of the page.
  const focused = await page.evaluate(() => document.activeElement?.tagName)
  expect(focused).not.toBe('BODY')
})

test('the dialog traps focus while open', async ({ page }) => {
  await seedFour(page)
  await page.goto(`/?lang=en&s=${SHARED}#/compare`)
  await expect(dialog(page)).toBeVisible()
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab')
  const inside = await page.evaluate(() => !!document.activeElement?.closest('dialog[open]'))
  expect(inside).toBe(true)
})

test('a malformed or unsupported link loads nothing, saves nothing and is removed from the URL', async ({ page }) => {
  await seedFour(page)
  for (const bad of ['not-a-link!!', b64url({ sv: 9, s: { v: 4 } }), 'a'.repeat(9000)]) {
    await page.goto(`/?lang=en&s=${bad}#/compare`)
    await expect(page.getByText('This link is not a valid calculation, so nothing was loaded.')).toBeVisible()
    await expect(dialog(page)).toBeHidden()
    await expect(page.locator('.scen')).toHaveCount(4)
    expect(await names(page)).toEqual(['Mine a', 'Mine b', 'Mine c', 'Mine d'])
    expect(page.url()).not.toContain('s=')
  }
})

test('rapid repeated openings of the same link produce one prompt and no duplicate plans', async ({ page }) => {
  await seedFour(page)
  for (let i = 0; i < 4; i++) await page.goto(`/?lang=en&s=${SHARED}#/compare`, { waitUntil: 'commit' })
  await page.goto(`/?lang=en&s=${SHARED}#/compare`)
  await expect(dialog(page)).toBeVisible()
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Replace plan' }).click()
  await expect(dialog(page)).toBeHidden()
  const all = await names(page)
  expect(all.filter((n) => n === 'Shared')).toHaveLength(1)
  expect(all).toHaveLength(4)
})

test('below the limit the shared plan is added directly with Undo, and no dialog appears', async ({ page }) => {
  await page.goto(`/?lang=en&s=${SHARED}#/compare`)
  await expect(page.getByText(/Loaded a shared calculation/)).toBeVisible()
  await expect(dialog(page)).toBeHidden()
  await expect(page.locator('.scen-name')).toHaveCount(2)
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('.scen-name')).toHaveCount(1)
})

test('pressing Enter on a radio button does not replace a plan; only Replace plan does', async ({ page }) => {
  await seedFour(page, 'a')
  await page.goto(`/?lang=en&s=${SHARED}#/compare`)
  await expect(dialog(page)).toBeVisible()
  await expect(page.locator('.scen')).toHaveCount(4)
  await page.getByRole('radio', { name: 'Mine a' }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog(page)).toBeVisible()
  expect(await names(page)).toEqual(['Mine a', 'Mine b', 'Mine c', 'Mine d'])
})
