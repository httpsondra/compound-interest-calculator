import { uid, type Period } from './scenario'

/*
 * Pure operations on the contiguous contribution timeline. Every operation
 * keeps the total covered length unchanged unless explicitly extending or
 * trimming, so editing never silently opens gaps or overlaps.
 */

/** Move the end boundary of period i to `endYear` (1-based, inclusive). The next period absorbs the change. */
export function setEndYear(periods: Period[], i: number, endYear: number): Period[] {
  const start = periods.slice(0, i).reduce((a, p) => a + p.years, 0) + 1
  const wanted = Math.max(1, Math.round(endYear) - start + 1)
  const next = periods[i + 1]
  if (!next) return periods.map((p, k) => (k === i ? { ...p, years: wanted } : p))
  const maxYears = periods[i].years + next.years - 1
  const years = Math.min(wanted, maxYears)
  const delta = years - periods[i].years
  return periods.map((p, k) => (k === i ? { ...p, years } : k === i + 1 ? { ...p, years: p.years - delta } : p))
}

/** Split period i into two consecutive periods with the same settings. */
export function splitPeriod(periods: Period[], i: number): Period[] {
  const p = periods[i]
  if (p.years < 2) {
    return [...periods.slice(0, i + 1), { ...p, id: uid('p'), years: 1 }, ...periods.slice(i + 1)]
  }
  const first = Math.ceil(p.years / 2)
  return [...periods.slice(0, i), { ...p, years: first }, { ...p, id: uid('p'), years: p.years - first }, ...periods.slice(i + 1)]
}

/** Add a period at the end: fills an uncovered tail, otherwise splits the last period. */
export function addPeriod(periods: Period[], horizonYears: number): Period[] {
  const covered = periods.reduce((a, p) => a + p.years, 0)
  const last = periods[periods.length - 1]
  if (!last) return [{ id: uid('p'), years: Math.max(1, horizonYears), amount: 0, frequency: 'monthly', paused: false }]
  if (covered < horizonYears) {
    return [...periods, { ...last, id: uid('p'), years: horizonYears - covered, paused: false }]
  }
  return splitPeriod(periods, periods.length - 1)
}

/** Remove period i; its years merge into the previous period (or the next one when removing the first). */
export function removePeriod(periods: Period[], i: number): Period[] {
  if (periods.length <= 1) return periods
  const gone = periods[i]
  const rest = periods.filter((_, k) => k !== i)
  const target = i > 0 ? i - 1 : 0
  return rest.map((p, k) => (k === target ? { ...p, years: p.years + gone.years } : p))
}

/** Swap period i with its neighbour (dir −1 = earlier, +1 = later). */
export function movePeriod(periods: Period[], i: number, dir: -1 | 1): Period[] {
  const j = i + dir
  if (j < 0 || j >= periods.length) return periods
  const out = periods.slice()
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

/** Extend the last period so the timeline covers `years`. */
export function extendTo(periods: Period[], years: number): Period[] {
  const covered = periods.reduce((a, p) => a + p.years, 0)
  if (!periods.length || covered >= years) return periods
  return periods.map((p, k) => (k === periods.length - 1 ? { ...p, years: p.years + years - covered } : p))
}

/** Drop or shorten periods so that the timeline ends exactly at `years`. */
export function trimTo(periods: Period[], years: number): Period[] {
  const out: Period[] = []
  let used = 0
  for (const p of periods) {
    if (used >= years) break
    const len = Math.min(p.years, years - used)
    out.push({ ...p, years: len })
    used += len
  }
  return out.length ? out : periods.slice(0, 1)
}
