/** CSV export. Czech uses `;` with decimal comma (Excel CZ default); English uses `,` with decimal dot. */
export function buildCsv(opts: {
  lang: 'cs' | 'en'
  meta: [string, string | number][]
  header: string[]
  rows: (string | number)[][]
}): string {
  const sep = opts.lang === 'cs' ? ';' : ','
  const fmt = (v: string | number) => {
    if (typeof v === 'number') {
      if (Number.isInteger(v) && Math.abs(v) < 1e4) return String(v)
      const s = (Math.round(v * 100) / 100).toFixed(2)
      return opts.lang === 'cs' ? s.replace('.', ',') : s
    }
    return /[";,\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  }
  const lines = [
    ...opts.meta.map((r) => r.map(fmt).join(sep)),
    '',
    opts.header.map(fmt).join(sep),
    ...opts.rows.map((r) => r.map(fmt).join(sep)),
  ]
  return lines.join('\r\n')
}

export function downloadCsv(opts: Parameters<typeof buildCsv>[0] & { filename: string }) {
  const blob = new Blob(['﻿' + buildCsv(opts)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = opts.filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
