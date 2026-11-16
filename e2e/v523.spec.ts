import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { filePayload, planNames, readIdb, seedLegacy } from './helpers'

/* V5.2.3: transactional persistence, migration, recovery, export / import. */

const plan = (id: string, name: string, extra: object = {}) => ({ v: 4, id, name, currency: 'EUR', ...extra })
const LEGACY = { activeId: 'a', scenarios: [plan('a', 'Alpha', { initial: 12345 }), plan('b', 'Beta')] }

async function openWith(page: Page, doc: unknown, hash = '#/compare') {
  await page.goto('/?lang=en')
  await seedLegacy(page, doc)
  await page.goto(`/?lang=en${hash}`)
  await page.locator('.scen-name').first().waitFor()
}
const menu = (page: Page) => page.getByRole('button', { name: 'Saved plans: export, import or recover' })
const choose = async (page: Page, item: string) => {
  await menu(page).click()
  await page.getByRole('menuitem', { name: item }).click()
}

test.describe('persistence and migration', () => {
  test('a returning user: original plans are migrated once, the original key is untouched, and a reload changes nothing', async ({ page }) => {
    await openWith(page, LEGACY)
    await expect.poll(() => planNames(page)).toEqual(['Alpha', 'Beta'])
    const first = await readIdb(page)
    expect(first.rev).toBe(1)
    expect(first.backups.map((b) => b.kind)).toEqual(['migration'])
    const legacyBefore = await page.evaluate(() => localStorage.getItem('investcalc.v2.scenarios'))
    for (let i = 0; i < 3; i++) {
      await page.reload()
      await page.locator('.scen-name').first().waitFor()
    }
    const after = await readIdb(page)
    expect(after.rev, 'idempotent: reloads do not write').toBe(1)
    expect(after.backups).toHaveLength(1)
    expect(await page.locator('.scen-name').count()).toBe(2)
    expect(await page.evaluate(() => localStorage.getItem('investcalc.v2.scenarios'))).toBe(legacyBefore)
  })

  test('edits are saved to IndexedDB with a new revision and survive a reload', async ({ page }) => {
    await openWith(page, LEGACY)
    await page.locator('.scen-name').first().fill('Renamed')
    await expect.poll(() => planNames(page)).toEqual(['Renamed', 'Beta'])
    expect((await readIdb(page)).rev).toBeGreaterThan(1)
    await page.reload()
    await expect(page.locator('.scen-name').first()).toHaveValue('Renamed')
  })

  test('an unreadable original is kept as a backup and never modified', async ({ page }) => {
    await page.goto('/?lang=en')
    await seedLegacy(page, '{"scenarios":[{"v":4,"id":"a","name":"Precious')
    await page.goto('/?lang=en#/compare')
    await page.locator('.scen-name').first().waitFor()
    await expect.poll(async () => (await readIdb(page)).backups.some((b) => b.kind === 'unreadable')).toBe(true)
    expect(await page.evaluate(() => localStorage.getItem('investcalc.v2.scenarios'))).toBe('{"scenarios":[{"v":4,"id":"a","name":"Precious')
  })

  test('a revision conflict is detected inside the transaction: the stale writer is refused, nothing is overwritten', async ({ page }) => {
    await openWith(page, LEGACY)
    // A second writer (another tab) commits revision 2 directly.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const r = indexedDB.open('investcalc')
          r.onsuccess = () => {
            const db = r.result
            const tx = db.transaction('doc', 'readwrite')
            const st = tx.objectStore('doc')
            const g = st.get('plans')
            g.onsuccess = () => st.put({ rev: g.result.rev + 1, raw: JSON.stringify({ activeId: 'a', scenarios: [{ v: 4, id: 'a', name: 'Written elsewhere', currency: 'EUR' }] }), at: 1 }, 'plans')
            tx.oncomplete = () => (db.close(), resolve())
          }
        }),
    )
    await page.locator('.scen-name').first().fill('Stale edit')
    await expect(page.getByRole('dialog', { name: 'Your plans changed in another tab' })).toBeVisible({ timeout: 8000 })
    expect(await planNames(page)).toEqual(['Written elsewhere'])
    await expect.poll(async () => (await readIdb(page)).backups.some((b) => b.kind === 'conflict' && b.raw.includes('Stale edit'))).toBe(true)
  })

  test('undo after another tab changed the plans cannot silently destroy that version', async ({ context }) => {
    const A = await context.newPage()
    await A.goto('/?lang=en')
    await seedLegacy(A, LEGACY)
    await A.goto('/?lang=en#/compare')
    await A.locator('.scen-name').first().waitFor()
    const B = await context.newPage()
    await B.goto('/?lang=en#/compare')
    await B.locator('.scen-name').first().waitFor()
    await A.locator('.scen-name').first().fill('Alpha by A')
    await expect.poll(() => planNames(B)).toContain('Alpha by A')
    await B.locator('.scen-name').nth(1).fill('Beta by B')
    await expect(A.locator('.scen-name').nth(1)).toHaveValue('Beta by B', { timeout: 6000 }) // A adopted B's save
    // A undoes: that reaches back past B's change. B's version must stay recoverable.
    await A.locator('main').first().click({ position: { x: 5, y: 5 } })
    await A.keyboard.press('Control+z')
    await expect.poll(async () => (await readIdb(A)).backups.some((b) => b.raw.includes('Beta by B'))).toBe(true)
  })
})

test.describe('lifecycle and failures', () => {
  test('without IndexedDB the localStorage fallback still saves and restores plans', async ({ context }) => {
    await context.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }))
    const page = await context.newPage()
    await page.goto('/?lang=en#/compare')
    await page.locator('.scen-name').first().waitFor()
    await page.locator('.scen-name').first().fill('Fallback save')
    await expect.poll(() => page.evaluate(() => localStorage.getItem('investcalc.v3.mirror') ?? '')).toContain('Fallback save')
    await page.reload()
    await expect(page.locator('.scen-name').first()).toHaveValue('Fallback save')
  })

  test('storage unavailable: the user is told, can export the plans, and keeps working', async ({ context }) => {
    await context.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true })
      const orig = Storage.prototype.setItem
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k.startsWith('investcalc.v3')) throw new DOMException('full', 'QuotaExceededError')
        return orig.call(this, k, v)
      }
    })
    const page = await context.newPage()
    await page.goto('/?lang=en#/compare')
    await page.locator('.scen-name').first().waitFor()
    await page.locator('.scen-name').first().fill('Unsaved but alive')
    await expect(page.getByText(/could not save your plans/)).toBeVisible({ timeout: 8000 })
    const dl = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export plans', exact: true }).click()
    const file = await dl
    expect(file.suggestedFilename()).toMatch(/^investcalc-plans-\d{4}-\d{2}-\d{2}\.json$/)
    await expect(page.locator('.scen-name').first()).toHaveValue('Unsaved but alive')
  })

  test('IndexedDB quota exceeded on a save: reported, edit kept in the tab', async ({ context }) => {
    await context.addInitScript(() => {
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...a: Parameters<typeof put>) {
        if (sessionStorage.getItem('failPut') === '1') throw new DOMException('full', 'QuotaExceededError')
        return put.apply(this, a)
      }
    })
    const page = await context.newPage()
    await page.goto('/?lang=en#/compare')
    await page.locator('.scen-name').first().waitFor()
    await page.waitForTimeout(500)
    await page.evaluate(() => sessionStorage.setItem('failPut', '1'))
    await page.locator('.scen-name').first().fill('Quota edit')
    await expect(page.getByText(/could not save your plans/)).toBeVisible({ timeout: 8000 })
    await expect(page.locator('.scen-name').first()).toHaveValue('Quota edit')
  })

  test('reloading right after an edit (inside the save delay) keeps the edit', async ({ page }) => {
    await openWith(page, LEGACY)
    await page.locator('.scen-name').first().fill('Edit then reload')
    await page.reload()
    await expect(page.locator('.scen-name').first()).toHaveValue('Edit then reload', { timeout: 8000 })
    await expect.poll(() => planNames(page)).toContain('Edit then reload')
  })

  test('closing a tab right after an edit: another open tab finishes the save', async ({ context }) => {
    const A = await context.newPage()
    await A.goto('/?lang=en')
    await seedLegacy(A, LEGACY)
    await A.goto('/?lang=en#/compare')
    await A.locator('.scen-name').first().waitFor()
    const B = await context.newPage()
    await B.goto('/?lang=en#/compare')
    await B.locator('.scen-name').first().waitFor()
    await A.locator('.scen-name').first().fill('Closed quickly')
    await A.close({ runBeforeUnload: true })
    // Where the browser fires no unload events (WebKit), the leftover draft is picked up once it is 4 s old, on the next 2 s check.
    await expect.poll(() => planNames(B), { timeout: 14_000 }).toContain('Closed quickly')
  })
})

async function exportFrom(page: Page): Promise<string> {
  const dl = page.waitForEvent('download')
  await choose(page, 'Export plans (JSON)')
  const file = await dl
  const stream = await file.createReadStream()
  const chunks: Uint8Array[] = []
  for await (const c of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(c)
  return new TextDecoder().decode(await new Blob(chunks as BlobPart[]).arrayBuffer())
}

test.describe('export, import and recovery', () => {
  test('export produces a valid versioned file, and importing it elsewhere reproduces the plans', async ({ page, browser }) => {
    await openWith(page, LEGACY)
    const text = await exportFrom(page)
    const json = JSON.parse(text)
    expect(json).toMatchObject({ format: 'investcalc-plans', version: 1 })
    expect(json.scenarios.map((s: { name: string }) => s.name)).toEqual(['Alpha', 'Beta'])
    const other: BrowserContext = await browser.newContext()
    const p2 = await other.newPage()
    await p2.goto('/?lang=en#/compare')
    await p2.locator('.scen-name').first().waitFor()
    await choose(p2, 'Import plans…')
    await p2.getByTestId('import-file').setInputFiles(filePayload(text))
    await p2.getByRole('radio', { name: /Replace my plans/ }).check()
    await p2.getByRole('button', { name: 'Import', exact: true }).click()
    await expect.poll(() => planNames(p2)).toEqual(['Alpha', 'Beta'])
    expect(JSON.parse((await readIdb(p2)).doc!).scenarios[0].initial).toBe(12345)
    await other.close()
  })

  test('import: preview first, add keeps current plans, cancelling changes nothing', async ({ page }) => {
    await openWith(page, { activeId: 'a', scenarios: [plan('a', 'Mine')] })
    await choose(page, 'Import plans…')
    const dlg = page.getByRole('dialog', { name: 'Import plans' })
    await dlg.getByTestId('import-file').setInputFiles(filePayload({ format: 'investcalc-plans', version: 1, scenarios: [plan('x', 'Imported one'), plan('y', 'Imported two')] }))
    await expect(dlg).toContainText('Imported one, Imported two')
    await expect(dlg.getByRole('radio', { name: /Add to my plans/ })).toBeChecked()
    await page.keyboard.press('Escape') // cancel
    await expect(dlg).toBeHidden()
    expect(await planNames(page)).toEqual(['Mine'])
    // again, this time confirmed (add)
    await choose(page, 'Import plans…')
    await dlg.getByTestId('import-file').setInputFiles(filePayload({ format: 'investcalc-plans', version: 1, scenarios: [plan('x', 'Imported one'), plan('y', 'Imported two')] }))
    await dlg.getByRole('button', { name: 'Import', exact: true }).click()
    await expect.poll(() => planNames(page)).toEqual(['Mine', 'Imported one', 'Imported two'])
  })

  test('import: malformed JSON, foreign files and newer versions are refused with a clear message', async ({ page }) => {
    await openWith(page, LEGACY)
    await choose(page, 'Import plans…')
    const dlg = page.getByRole('dialog', { name: 'Import plans' })
    const cases: [unknown, RegExp][] = [
      ['{oops', /not valid JSON/],
      [{ hello: 'world' }, /not an Invest Calc plans file/],
      [{ format: 'investcalc-plans', version: 9, scenarios: [{}] }, /newer version/],
      [{ format: 'investcalc-plans', version: 1, scenarios: [] }, /no plans/],
    ]
    for (const [payload, msg] of cases) {
      await dlg.getByTestId('import-file').setInputFiles(filePayload(payload))
      await expect(dlg.getByRole('alert')).toContainText(msg)
      await expect(dlg.getByRole('button', { name: 'Import', exact: true })).toBeDisabled()
    }
    expect(await planNames(page)).toEqual(['Alpha', 'Beta'])
  })

  test('replace backs the current plans up, can be undone, and the backup can be restored (repeatedly)', async ({ page }) => {
    await openWith(page, LEGACY)
    await choose(page, 'Import plans…')
    const dlg = page.getByRole('dialog', { name: 'Import plans' })
    await dlg.getByTestId('import-file').setInputFiles(filePayload({ format: 'investcalc-plans', version: 1, scenarios: [plan('n', 'From file')] }))
    await dlg.getByRole('radio', { name: /Replace my plans/ }).check()
    await dlg.getByRole('button', { name: 'Import', exact: true }).click()
    await expect.poll(() => planNames(page)).toEqual(['From file'])
    await expect.poll(async () => (await readIdb(page)).backups.some((b) => b.kind === 'import' && b.raw.includes('Alpha'))).toBe(true)

    for (let cycle = 0; cycle < 2; cycle++) {
      await choose(page, 'Recover previous version…')
      const rec = page.getByRole('dialog', { name: 'Recover a previous version' })
      const row = rec.locator('.backup-row', { hasText: 'Alpha, Beta' }).first()
      await expect(row).toContainText('Before an import')
      await expect(row).toContainText('Plans: 2')
      await row.click()
      await rec.getByRole('button', { name: 'Restore this version' }).click()
      await expect(rec).toContainText('Replace your current plans?')
      await expect(rec).toContainText('backed up first')
      await rec.getByRole('button', { name: 'Replace and restore' }).click()
      await expect.poll(() => planNames(page)).toEqual(['Alpha', 'Beta'])
      await expect(page.locator('.scen-name').first()).toHaveValue('Alpha')
      // go back to the single plan for the next cycle through a second restore of the import backup
      await choose(page, 'Import plans…')
      await dlg.getByTestId('import-file').setInputFiles(filePayload({ format: 'investcalc-plans', version: 1, scenarios: [plan('n', 'From file')] }))
      await dlg.getByRole('radio', { name: /Replace my plans/ }).check()
      await dlg.getByRole('button', { name: 'Import', exact: true }).click()
      await expect.poll(() => planNames(page)).toEqual(['From file'])
    }
  })

  test('the saved-plans menu and dialogs are keyboard accessible: Escape closes, focus returns, Tab stays inside', async ({ page }) => {
    await openWith(page, LEGACY)
    await menu(page).focus()
    await page.keyboard.press('Enter')
    await page.getByRole('menuitem', { name: 'Recover previous version…' }).press('Enter')
    const rec = page.getByRole('dialog', { name: 'Recover a previous version' })
    await expect(rec).toBeVisible()
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]'))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(rec).toBeHidden()
    await expect(menu(page)).toBeFocused()
  })

  test('Czech: the saved-plans menu and dialogs are translated', async ({ page }) => {
    await page.goto('/?lang=cs')
    await seedLegacy(page, LEGACY, '/?lang=cs')
    await page.goto('/?lang=cs#/compare')
    await page.locator('.scen-name').first().waitFor()
    await page.getByRole('button', { name: 'Uložené plány: export, import nebo obnova' }).click()
    await page.getByRole('menuitem', { name: 'Obnovit předchozí verzi…' }).click()
    await expect(page.getByRole('dialog', { name: 'Obnovit předchozí verzi' })).toContainText('Před převodem dat')
  })
})
