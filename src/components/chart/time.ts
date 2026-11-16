import type { I18n } from '../../i18n'

/**
 * Human-readable tooltip title for a month on a chart's time axis: "Start", "Year 12 · age 42" on whole
 * years and "12 years 6 months · age 42" in between (instead of a decimal like "Year 12.5").
 */
export function chartTitle({ t, fill, duration }: Pick<I18n, 't' | 'fill' | 'duration'>, startAge: number | null | undefined) {
  return (m: number): string => {
    if (m === 0) return t.chart.start
    const y = Math.floor(m / 12)
    if (m % 12 === 0) return startAge != null ? fill(t.chart.yearAge, { year: y, age: startAge + y }) : fill(t.chart.year, { year: y })
    const when = duration(Math.round(m))
    return startAge != null ? `${when} · ${fill(t.summ.age, { n: startAge + y })}` : when
  }
}

/** Axis caption matching the tick labels: "Age" when ages are shown, otherwise "Year". */
export const axisUnit = ({ t }: Pick<I18n, 't'>, startAge: number | null | undefined) => (startAge != null ? t.chart.unitAge : t.chart.unitYear)
