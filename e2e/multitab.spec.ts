import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const plan = (id: string, name: string) => ({ v: 4, id, name, currency: 'EUR' })
const SEED = { activeId: 'a', scenarios: [plan('a', 'Alpha'), plan('b', 'Beta')] }

/** Two tabs of one browser profile: they share localStorage, as real tabs do. */
async function twoTabs(ctx: BrowserContext): Promise<[Page, Page]> {
  await ctx.addInitScript((seed) => {
    if (!localStorage.getItem('seeded')) {
      localStorage.setItem('investcalc.v2.scenarios', JSON.stringify(seed))
      localStorage.setItem('seeded', '1')
    }
  }, SEED)
  const A = await ctx.newPage()
  await A.goto('/?lang=en#/compare')
  await A.locator('.scen-name').first().waitFor()
  const B = await ctx.newPage()
  await B.goto('/?lang=en#/compare')
  await B.locator('.scen-name').nth(1).waitFor()
  return [A, B]
}

const stored = (p: Page) =>
  p.evaluate(() => (JSON.parse(localStorage.getItem('investcalc.v2.scenarios') ?? '{"scenarios":[]}') as { scenarios: { name: string }[] }).scenarios.map((x) => x.name))
const backups = (p: Page) =>
  p.evaluate(() => (JSON.parse(localStorage.getItem('investcalc.v2.backups') ?? '[]') as { raw: string }[]).map((b) => b.raw))
const conflict = (p: Page) => p.getByRole('dialog', { name: 'Your plans changed in another tab' })

/**
 * Both tabs have unsaved edits inside the same save window: a real conflict. Returns the tab that shows it.
 *
 * Investigation (V5.2.1): the old version made the edits one after the other and then required exactly one dialog.
 * The app saves 250 ms after an edit. Under parallel load the second `fill` can land after the first tab has
 * already saved; the second tab then has nothing unsaved, adopts that save silently, and its own edit merges on
 * top. Reproduced (16 runs, 8 workers): no dialog, stored plans contain BOTH edits, the other version is in the
 * backups — correct application behaviour, but not the "simultaneous" case. The cause was the test's timing
 * assumption, not the app. The edits now start together; if the machine was too slow to make them overlap, that
 * run is verified to have lost nothing and the experiment is repeated from the seed (bounded), so the conflict
 * assertions always run against a genuine conflict and are never weakened.
 */
async function concurrentEdits(A: Page, B: Page, opts: { backupsWork?: boolean } = {}): Promise<Page> {
  for (let attempt = 1; attempt <= 6; attempt++) {
    await Promise.all([B.locator('.scen-name').nth(1).fill('Beta edited in B'), A.locator('.scen-name').first().fill('Alpha renamed by A')])
    await Promise.all([A.waitForTimeout(1500), B.waitForTimeout(1500)])
    const inA = await conflict(A).isVisible()
    const inB = await conflict(B).isVisible()
    if (inA !== inB) return inA ? A : B
    expect(inA || inB, 'two dialogs at once is never valid').toBe(false)
    // No overlap: sequential saves. Nothing may be lost: both edits are saved (or backed up).
    // (Skipped only by the test that makes backups impossible on purpose: nothing can be preserved there.)
    if (opts.backupsWork !== false)
      await expect.poll(async () => { const all = await everything(A); return all.includes('Alpha renamed by A') && all.includes('Beta edited in B') }, { timeout: 8000, message: 'no edit lost' }).toBe(true)
    await A.evaluate((seed) => {
      localStorage.setItem('investcalc.v2.scenarios', JSON.stringify(seed))
      localStorage.removeItem('investcalc.v2.backups')
    }, SEED)
    await Promise.all([A.reload(), B.reload()])
    await Promise.all([A.locator('.scen-name').nth(1).waitFor(), B.locator('.scen-name').nth(1).waitFor()])
  }
  throw new Error('the two edits never overlapped inside one save window after 6 attempts')
}

/** Every saved name and backup text that exists for this profile (nothing may be missing from both). */
async function everything(p: Page): Promise<string> {
  return (await stored(p)).join('|') + '||' + (await backups(p)).join('||')
}

test('simultaneous edits: a conflict is raised, nothing is overwritten, both versions are kept', async ({ context }) => {
  const [A, B] = await twoTabs(context)
  const conflicted = await concurrentEdits(A, B)
  const other = conflicted === A ? B : A
  // The tab with the conflict has not written anything.
  expect((await everything(other))).toContain('Alpha renamed by A')
  // Both edits exist before any decision.
  const all = await everything(A)
  expect(all).toContain('Alpha renamed by A')
  expect(all).toContain('Beta edited in B')
  await conflicted.getByRole('button', { name: 'Keep this tab’s plans' }).click()
  await expect(conflict(conflicted)).toBeHidden()
  const after = await everything(A)
  expect(after).toContain('Alpha renamed by A')
  expect(after).toContain('Beta edited in B')
})

test('a tab without unsaved changes adopts another tab’s changes silently', async ({ context }) => {
  const [A, B] = await twoTabs(context)
  await A.locator('.scen-name').first().fill('Renamed in A')
  await A.waitForTimeout(600)
  await expect(B.locator('.scen-name').first()).toHaveValue('Renamed in A', { timeout: 5000 })
  await expect(conflict(B)).toBeHidden()
})

test('reloading while a conflict is pending restores the saved plans, keeps the unsaved version as a backup', async ({ context }) => {
  const [A, B] = await twoTabs(context)
  const conflicted = await concurrentEdits(A, B)
  await conflicted.reload()
  await expect(conflict(conflicted)).toBeHidden()
  expect(await everything(A)).toContain('Beta edited in B')
  expect(await everything(A)).toContain('Alpha renamed by A')
})

test('choosing the other tab’s plans shows the saved plans and keeps this tab’s version as a backup', async ({ context }) => {
  const [A, B] = await twoTabs(context)
  const conflicted = await concurrentEdits(A, B)
  const other = conflicted === A ? B : A
  const mineName = conflicted === A ? 'Alpha renamed by A' : 'Beta edited in B'
  await conflicted.getByRole('button', { name: 'Use the other tab’s plans' }).click()
  await expect(conflict(conflicted)).toBeHidden()
  // This tab now shows exactly what is saved: the other tab's plans.
  const shown = await conflicted.locator('.scen-name').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
  expect(shown).toEqual(await stored(other))
  expect((await backups(other)).some((r) => r.includes(mineName))).toBe(true)
})

test('the conflict dialog cannot be dismissed with Escape: a decision is required', async ({ context }) => {
  const [A, B] = await twoTabs(context)
  const conflicted = await concurrentEdits(A, B)
  await conflicted.keyboard.press('Escape')
  await expect(conflict(conflicted)).toBeVisible()
})

test('a second save by the other tab while the dialog is open is backed up, not lost', async ({ context }) => {
  const [A, B] = await twoTabs(context)
  const conflicted = await concurrentEdits(A, B)
  const other = conflicted === A ? B : A
  // The other tab saves again while the conflict dialog is still open.
  await other.locator('.scen-name').first().fill('Second edit by the other tab')
  await other.waitForTimeout(800)
  await conflicted.getByRole('button', { name: 'Keep this tab’s plans' }).click()
  await expect(conflict(conflicted)).toBeHidden()
  expect(await everything(conflicted)).toContain('Second edit by the other tab')
})

test('a corrupted saved plan is backed up on load and never overwritten silently', async ({ context }) => {
  const corrupt = '{"scenarios":[{"v":4,"id":"a","name":"Precious'
  await context.addInitScript((raw) => {
    if (!localStorage.getItem('seeded')) {
      localStorage.setItem('investcalc.v2.scenarios', raw)
      localStorage.setItem('seeded', '1')
    }
  }, corrupt)
  const page = await context.newPage()
  await page.goto('/?lang=en#/compare')
  await page.waitForTimeout(1200) // an idle load must not write
  expect(await page.evaluate(() => localStorage.getItem('investcalc.v2.scenarios'))).toBe(corrupt)
  expect((await backups(page)).some((r) => r === corrupt)).toBe(true)
})

test('opening a second tab does not wipe the first tab’s undo history or raise a conflict', async ({ context }) => {
  const [A, B] = await twoTabs(context)
  await A.locator('.scen-name').first().fill('Alpha renamed by A')
  await A.waitForTimeout(600)
  await expect(conflict(B)).toBeHidden()
  await A.locator('.scen-name').first().click()
  await A.keyboard.press('Escape')
  await A.locator('main').first().click({ position: { x: 5, y: 5 } })
  await A.keyboard.press('Control+z')
  await expect(A.locator('.scen-name').first()).toHaveValue('Alpha', { timeout: 3000 })
})

test('an unsaved edit in one tab does not produce a conflict in a tab that was only opened', async ({ context }) => {
  const [A, B] = await twoTabs(context)
  await A.locator('.scen-name').first().fill('Unsaved in A')
  // B is opened (and loaded) while A's edit is still unsaved.
  const C = await context.newPage()
  await C.goto('/?lang=en#/compare')
  await C.locator('.scen-name').first().waitFor()
  await A.waitForTimeout(600)
  await expect(conflict(C)).toBeHidden()
  await expect(conflict(B)).toBeHidden()
  // C was opened before A's save landed; it adopts that save once it arrives (no conflict, no prompt).
  await expect(C.locator('.scen-name').first()).toHaveValue('Unsaved in A', { timeout: 8000 })
})

test('if a backup cannot be kept, the choice is refused: nothing is overwritten and the user is told', async ({ context }) => {
  await context.addInitScript(() => {
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'investcalc.v2.backups') throw new DOMException('full', 'QuotaExceededError')
      return orig.call(this, k, v)
    }
  })
  const [A, B] = await twoTabs(context)
  const conflicted = await concurrentEdits(A, B, { backupsWork: false })
  const other = conflicted === A ? B : A
  const storedBefore = await stored(other)
  await conflicted.getByRole('button', { name: 'Keep this tab’s plans' }).click()
  await expect(conflicted.getByRole('alert')).toContainText('could not be made safely')
  await expect(conflict(conflicted)).toBeVisible()
  expect(await stored(other)).toEqual(storedBefore)
})

test('undo is unavailable while the conflict dialog is open, so it saves what the dialog shows', async ({ context }) => {
  const [A, B] = await twoTabs(context)
  const conflicted = await concurrentEdits(A, B)
  await conflicted.keyboard.press('Control+z')
  await expect(conflict(conflicted)).toBeVisible()
  await conflicted.getByRole('button', { name: 'Keep this tab’s plans' }).click()
  await expect(conflict(conflicted)).toBeHidden()
  const shown = await conflicted.locator('.scen-name').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
  expect(await stored(conflicted)).toEqual(shown)
})

test('undo after adopting another tab’s save keeps that save in the backups (review P1)', async ({ context }) => {
  const [A, B] = await twoTabs(context)
  await B.locator('.scen-name').nth(1).fill('B1 saved by B')
  await B.waitForTimeout(1200)
  await expect(A.locator('.scen-name').nth(1)).toHaveValue('B1 saved by B', { timeout: 5000 })
  await A.locator('.scen-name').first().fill('A1')
  await A.waitForTimeout(1200)
  await A.locator('main').first().click({ position: { x: 5, y: 5 } })
  await A.keyboard.press('Control+z')
  await A.waitForTimeout(1200)
  expect(await everything(A)).toContain('B1 saved by B')
})

test('“use the other tab’s plans” is refused when this tab’s version cannot be backed up (review P1)', async ({ context }) => {
  await context.addInitScript(() => {
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'investcalc.v2.backups') throw new DOMException('full', 'QuotaExceededError')
      return orig.call(this, k, v)
    }
  })
  const [A, B] = await twoTabs(context)
  const conflicted = await concurrentEdits(A, B, { backupsWork: false })
  const other = conflicted === A ? B : A
  const storedBefore = await stored(other)
  await conflicted.getByRole('button', { name: 'Use the other tab’s plans' }).click()
  await expect(conflict(conflicted)).toBeVisible()
  await expect(conflicted.getByRole('alert')).toContainText('could not be made safely')
  expect(await stored(other)).toEqual(storedBefore)
})

test('unreadable saved plans are not overwritten when no backup can be kept (review P1, on load)', async ({ context }) => {
  const corrupt = 'not-json{'
  await context.addInitScript((raw) => {
    if (!localStorage.getItem('seeded')) {
      localStorage.setItem('investcalc.v2.scenarios', raw)
      localStorage.setItem('seeded', '1')
    }
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'investcalc.v2.backups') throw new DOMException('full', 'QuotaExceededError')
      return orig.call(this, k, v)
    }
  }, corrupt)
  const page = await context.newPage()
  await page.goto('/?lang=en#/compare')
  await page.locator('.scen-name').first().waitFor()
  await page.locator('.scen-name').first().fill('Renamed')
  await page.waitForTimeout(1200)
  expect(await page.evaluate(() => localStorage.getItem('investcalc.v2.scenarios'))).toBe(corrupt)
  await expect(page.getByText(/could not save your plans/)).toBeVisible()
})

test('the conflict dialog keeps Tab and Shift+Tab inside it (review P2)', async ({ context }) => {
  const [A, B] = await twoTabs(context)
  const conflicted = await concurrentEdits(A, B)
  for (let i = 0; i < 6; i++) {
    await conflicted.keyboard.press('Tab')
    expect(await conflicted.evaluate(() => !!document.activeElement?.closest('dialog[open]'))).toBe(true)
  }
  for (let i = 0; i < 4; i++) {
    await conflicted.keyboard.press('Shift+Tab')
    expect(await conflicted.evaluate(() => !!document.activeElement?.closest('dialog[open]'))).toBe(true)
  }
})

test('the dialog shows the newest other-tab plans after a second save while it is open (review P2)', async ({ context }) => {
  const [A, B] = await twoTabs(context)
  const conflicted = await concurrentEdits(A, B)
  const other = conflicted === A ? B : A
  await other.locator('.scen-name').first().fill('Newest from other tab')
  await other.waitForTimeout(1200)
  const shown = await conflicted.getByRole('dialog').innerText()
  expect(shown).toContain('Newest from other tab')
})

test('two tabs whose saves fire at the same moment never lose an edit (cross-tab save lock, V5.2.1 regression)', async ({ context }) => {
  test.setTimeout(75_000)
  // Before the fix, both tabs could read the old stored text, both write, and the later write silently replaced
  // the earlier one: ~3 in 10 runs under load left one edit in neither the plans nor the backups.
  const [A, B] = await twoTabs(context)
  for (let round = 0; round < 5; round++) {
    await Promise.all([B.locator('.scen-name').nth(1).fill(`Beta ${round}`), A.locator('.scen-name').first().fill(`Alpha ${round}`)])
    await Promise.all([A.waitForTimeout(1200), B.waitForTimeout(1200)])
    const shown = (await conflict(A).isVisible()) ? A : (await conflict(B).isVisible()) ? B : null
    if (shown) await shown.getByRole('button', { name: 'Keep this tab’s plans' }).click()
    // A write that another tab overwrote is backed up once it has been verified (about 1.6 s): eventual, so polled.
    await expect.poll(async () => { const all = await everything(A); return all.includes(`Alpha ${round}`) && all.includes(`Beta ${round}`) }, { timeout: 8000, message: `round ${round}: both edits kept` }).toBe(true)
  }
})

/* ───── V5.2.2: lifecycle and fallback paths ───── */

test('closing a tab with an edit still pending (inside the 250 ms save delay) saves it', async ({ context }) => {
  const [A, B] = await twoTabs(context)
  await A.locator('.scen-name').first().fill('Saved on close')
  await A.close({ runBeforeUnload: true })
  await expect.poll(() => stored(B)).toContain('Saved on close')
})

test('without Web Locks the plain save path still keeps both of two simultaneous edits (plans or backups)', async ({ context }) => {
  test.setTimeout(75_000) // three rounds of two tabs, each waiting out the save delay and the eventual backup
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
  })
  const [A, B] = await twoTabs(context)
  expect(await A.evaluate(() => (navigator as { locks?: unknown }).locks)).toBeUndefined()
  for (let round = 0; round < 3; round++) {
    await Promise.all([B.locator('.scen-name').nth(1).fill(`Beta ${round}`), A.locator('.scen-name').first().fill(`Alpha ${round}`)])
    await Promise.all([A.waitForTimeout(1200), B.waitForTimeout(1200)])
    const shown = (await conflict(A).isVisible()) ? A : (await conflict(B).isVisible()) ? B : null
    if (shown) await shown.getByRole('button', { name: 'Keep this tab’s plans' }).click()
    // Without the lock the second tab's backup of its own just-replaced write is made when it notices the
    // other save (storage event, or the 2 s check): eventual, so it is polled rather than read once.
    await expect.poll(async () => (await everything(A)).includes(`Alpha ${round}`) && (await everything(A)).includes(`Beta ${round}`), { timeout: 8000, message: `round ${round}: both edits kept` }).toBe(true)
  }
})

test('if the lock cannot be acquired the save falls back to the plain path and nothing is lost', async ({ context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { value: { request: () => Promise.reject(new Error('lock refused')) }, configurable: true })
  })
  const [A] = await twoTabs(context)
  await A.locator('.scen-name').first().fill('Saved without lock')
  await expect.poll(() => stored(A)).toContain('Saved without lock')
})
