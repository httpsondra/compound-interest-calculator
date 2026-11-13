// Renders og.png (1200×630) and apple-touch-icon.png (180×180) with Playwright.
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
await page.goto('file://' + resolve(root, 'scripts/og.html'))
await page.screenshot({ path: resolve(root, 'public/og.png') })
const svg = readFileSync(resolve(root, 'public/favicon.svg'), 'utf8').replace('rx="9"', 'rx="0"')
await page.setViewportSize({ width: 180, height: 180 })
await page.setContent(`<body style="margin:0">${svg.replace('<svg ', '<svg width="180" height="180" ')}</body>`)
await page.screenshot({ path: resolve(root, 'public/apple-touch-icon.png') })
await browser.close()

// favicon.ico: a 32×32 PNG wrapped in an ICO container (PNG-in-ICO is valid for all modern browsers).
{
  const { writeFileSync } = await import('node:fs')
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: 32, height: 32 } })
  const s = readFileSync(resolve(root, 'public/favicon.svg'), 'utf8')
  await p.setContent(`<body style="margin:0;background:transparent">${s.replace('<svg ', '<svg width="32" height="32" ')}</body>`)
  const png = await p.screenshot({ omitBackground: true })
  await b.close()
  const head = Buffer.alloc(22)
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4)
  head.writeUInt8(32, 6); head.writeUInt8(32, 7); head.writeUInt8(0, 8); head.writeUInt8(0, 9)
  head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12); head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18)
  writeFileSync(resolve(root, 'public/favicon.ico'), Buffer.concat([head, png]))
}
