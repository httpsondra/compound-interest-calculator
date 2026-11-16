/** "Nice" axis ticks covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): { ticks: number[]; lo: number; hi: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [0, 1], lo: 0, hi: 1 }
  if (max - min < 1e-9) {
    max = min + (Math.abs(min) || 1)
  }
  const span = max - min
  const raw = span / Math.max(1, count)
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : v)
  return { ticks, lo, hi }
}

/** Year tick step so that roughly ≤ maxLabels labels fit. */
export function yearStep(totalYears: number, maxLabels: number): number {
  for (const s of [1, 2, 5, 10, 20, 25, 50]) if (totalYears / s <= maxLabels) return s
  return 100
}
