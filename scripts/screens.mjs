// Usage: node scripts/screens.mjs <baseURL> <outDir>
// Captures the same app states at desktop and mobile sizes in light and dark themes.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
const [base = 'http://localhost:4173', out = 'screens'] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const scenarios = {
  basic: { currency: 'EUR', initial: 10000, horizonYears: 30, annualReturn: 7, contribMode: 'constant', constant: { amount: 300, frequency: 'monthly' } },
  timeline: {
    currency: 'CZK', initial: 0, startAge: 20, horizonYears: 35, annualReturn: 7, contribMode: 'schedule',
    periods: [
      { years: 5, amount: 2000, frequency: 'monthly' }, { years: 5, amount: 5000, frequency: 'monthly' },
      { years: 10, amount: 12000, frequency: 'monthly' }, { years: 15, amount: 20000, frequency: 'monthly' },
    ],
    goal: { enabled: true, target: 10000000, year: 35, real: false },
  },
  depletion: {
    currency: 'EUR', initial: 20000, startAge: 35, horizonYears: 55, annualReturn: 6, contribMode: 'constant',
    constant: { amount: 400, frequency: 'monthly' },
    withdrawal: { enabled: true, startYear: 31, endYear: null, amount: 2500, frequency: 'monthly', indexed: true, stopContributions: true },
  },
}
const browser = await chromium.launch()
for (const theme of ['light', 'dark']) {
  for (const [device, vp] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    for (const [name, sc] of Object.entries(scenarios)) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: device === 'mobile' ? 2 : 1, colorScheme: theme })
      const page = await ctx.newPage()
      await page.addInitScript(([s, th]) => {
        localStorage.setItem('investcalc.v2.scenarios', JSON.stringify({ scenarios: [{ id: 'sc-1', ...s }], activeId: 'sc-1' }))
        localStorage.setItem('investcalc.theme', th)
        localStorage.setItem('investcalc.lang', 'en')
      }, [sc, theme])
      await page.goto(base + '/?lang=' + (name === 'timeline' ? 'cs' : 'en'))
      await page.waitForTimeout(700)
      await page.screenshot({ path: `${out}/${device}-${theme}-${name}.png`, fullPage: device === 'desktop' ? false : false })
      if (name === 'timeline') {
        await page.screenshot({ path: `${out}/${device}-${theme}-${name}-full.png`, fullPage: true })
      }
      await ctx.close()
    }
  }
}
await browser.close()
