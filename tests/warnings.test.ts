import { describe, expect, it } from 'vitest'
import { defaultScenario, uid, validateScenario, type Scenario } from '../src/model/scenario'

const scheduled = (years: number[], withdrawal: Partial<Scenario['withdrawal']> = {}): Scenario => {
  const s = defaultScenario('CZK')
  return {
    ...s,
    horizonYears: 40,
    contribMode: 'schedule',
    periods: years.map((y) => ({ id: uid('p'), years: y, amount: 5000, frequency: 'monthly' as const, paused: false })),
    withdrawal: { ...s.withdrawal, ...withdrawal },
  }
}
const short = (s: Scenario) => validateScenario(s).some((i) => i.code === 'scheduleShort')

describe('contribution-gap warning is context-aware (V5)', () => {
  it('warns when the schedule ends early and nothing explains it', () => {
    expect(short(scheduled([10, 10]))).toBe(true)
  })
  it('does not warn when contributions stop exactly when withdrawals begin, by the user’s own setting', () => {
    expect(short(scheduled([16, 16], { enabled: true, startYear: 33, stopContributions: true }))).toBe(false)
  })
  it('does not warn when the schedule runs past the withdrawal start with “stop contributions” on', () => {
    expect(short(scheduled([20, 20], { enabled: true, startYear: 33, stopContributions: true }))).toBe(false)
  })
  it('still warns when the schedule ends BEFORE the withdrawal start (a real gap)', () => {
    expect(short(scheduled([10, 10], { enabled: true, startYear: 33, stopContributions: true }))).toBe(true)
  })
  it('still warns when withdrawals exist but contributions are NOT set to stop', () => {
    expect(short(scheduled([16, 16], { enabled: true, startYear: 33, stopContributions: false }))).toBe(true)
  })
  it('still warns when withdrawals are disabled', () => {
    expect(short(scheduled([16, 16], { enabled: false, startYear: 33, stopContributions: true }))).toBe(true)
  })
})
