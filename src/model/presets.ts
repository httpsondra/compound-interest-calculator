import { defaultScenario, scaledAmount, uid, type Currency, type Scenario } from './scenario'

export type PresetId = 'zero' | 'longterm' | 'lump' | 'rising' | 'lifecycle'
export const PRESET_IDS: PresetId[] = ['zero', 'longterm', 'lump', 'rising', 'lifecycle']

/** Editable illustrative examples. They are not recommendations. */
export function buildPreset(id: PresetId, currency: Currency, keep?: Partial<Scenario>): Scenario {
  const s = (v: number) => scaledAmount(v, currency)
  const base: Scenario = { ...defaultScenario(currency), ...keep, currency }
  switch (id) {
    case 'zero':
      return { ...base, initial: 0, contribMode: 'constant', constant: { amount: s(3_000), frequency: 'monthly' }, horizonYears: 30, horizonMonths: 0, annualReturn: 7 }
    case 'longterm':
      return { ...base, initial: s(50_000), contribMode: 'constant', constant: { amount: s(5_000), frequency: 'monthly' }, horizonYears: 40, horizonMonths: 0, annualReturn: 7 }
    case 'lump':
      return { ...base, initial: s(1_000_000), contribMode: 'constant', constant: { amount: s(2_000), frequency: 'monthly' }, horizonYears: 20, horizonMonths: 0, annualReturn: 6 }
    case 'rising':
      return {
        ...base,
        initial: 0,
        startAge: 20,
        horizonYears: 35,
        horizonMonths: 0,
        annualReturn: 7,
        contribMode: 'schedule',
        periods: [
          { id: uid('p'), years: 5, amount: s(2_000), frequency: 'monthly', paused: false },
          { id: uid('p'), years: 5, amount: s(5_000), frequency: 'monthly', paused: false },
          { id: uid('p'), years: 10, amount: s(12_000), frequency: 'monthly', paused: false },
          { id: uid('p'), years: 15, amount: s(20_000), frequency: 'monthly', paused: false },
        ],
      }
    case 'lifecycle':
      return {
        ...base,
        initial: s(200_000),
        startAge: 35,
        horizonYears: 55,
        horizonMonths: 0,
        annualReturn: 6,
        contribMode: 'constant',
        constant: { amount: s(8_000), frequency: 'monthly' },
        withdrawal: {
          enabled: true,
          startYear: 31,
          endYear: null,
          amount: s(25_000),
          frequency: 'monthly',
          indexed: true,
          stopContributions: true,
        },
      }
  }
}
