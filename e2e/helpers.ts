import type { Page } from '@playwright/test'

// Node's Buffer (the e2e project has no @types/node): only `from` is needed, to build upload payloads.
declare const Buffer: { from(text: string): never }

export const filePayload = (doc: unknown) => ({
  name: 'plans.json',
  mimeType: 'application/json',
  buffer: Buffer.from(typeof doc === 'string' ? doc : JSON.stringify(doc)),
})

/**
 * Plant `doc` as the ORIGINAL (v2) saved plans, exactly as a returning user from an older version would have
 * them: IndexedDB and every other key are wiped, so the next page load must migrate from the legacy key.
 * (Planting the legacy key alone is not enough once the application has opened its own storage.)
 */
export async function seedLegacy(page: Page, doc: unknown, base = '/?lang=en') {
  if (page.url() === 'about:blank') await page.goto(base)
  await page.evaluate(async (d) => {
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase('investcalc')
      r.onsuccess = r.onerror = r.onblocked = () => res()
    })
    localStorage.clear()
    localStorage.setItem('investcalc.v2.scenarios', typeof d === 'string' ? d : JSON.stringify(d))
  }, doc)
  // Leave the document so the next goto is a real load (a hash-only navigation would keep the old app running).
  await page.goto('about:blank')
}

/** The saved plans and backups, read straight from IndexedDB (the application's source of truth). */
export const readIdb = (p: Page) =>
  p.evaluate(
    () =>
      new Promise<{ rev: number | null; doc: string | null; backups: { raw: string; kind: string }[] }>((resolve) => {
        const r = indexedDB.open('investcalc')
        r.onerror = () => resolve({ rev: null, doc: null, backups: [] })
        r.onsuccess = () => {
          const db = r.result
          if (!db.objectStoreNames.contains('doc')) return (db.close(), resolve({ rev: null, doc: null, backups: [] }))
          const tx = db.transaction(['doc', 'backups'], 'readonly')
          const g = tx.objectStore('doc').get('plans')
          const b = tx.objectStore('backups').getAll()
          tx.oncomplete = () => {
            db.close()
            const rows = (b.result as { raw: string; kind: string; at: number; id: number }[]).sort((x, y) => y.at - x.at || y.id - x.id)
            resolve({ rev: g.result?.rev ?? null, doc: g.result?.raw ?? null, backups: rows.map((x) => ({ raw: x.raw, kind: x.kind })) })
          }
        }
      }),
  )

export const planNames = async (p: Page) => {
  const d = (await readIdb(p)).doc
  return d ? (JSON.parse(d) as { scenarios: { name: string }[] }).scenarios.map((x) => x.name) : []
}
