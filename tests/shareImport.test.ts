import { describe, expect, it } from 'vitest'
import { defaultScenario, type Scenario } from '../src/model/scenario'
import { decodeShare, encodeShare } from '../src/model/serialize'
import { addScenario, defaultTarget, importNeedsChoice, replaceScenario, targetExists } from '../src/state/shareImport'
import type { Doc } from '../src/state/store'

const named = (id: string, name: string): Scenario => ({ ...defaultScenario('EUR', name), id })
const four = (activeId = 'd'): Doc => ({ scenarios: ['a', 'b', 'c', 'd'].map((x) => named(x, `Mine ${x}`)), activeId })
const incoming = named('shared', 'Shared')

describe('share import rules', () => {
  it('four saved plans and an incoming link: a choice is needed, proposal is the oldest non-active plan', () => {
    const doc = four('a')
    expect(importNeedsChoice(doc, incoming)).toBe(true)
    expect(defaultTarget(doc)).toBe('b')
  })
  it('below the limit nothing is replaced', () => {
    const doc: Doc = { scenarios: [named('a', 'A')], activeId: 'a' }
    expect(importNeedsChoice(doc, incoming)).toBe(false)
    expect(addScenario(doc, incoming).scenarios.map((x) => x.id)).toEqual(['a', 'shared'])
  })
  it('replaces exactly the chosen plan, by ID, even when the active plan changed afterwards', () => {
    const doc = four('a')
    const target = 'c'
    // The user switches the active plan before confirming: the target is still 'c'.
    const switched = { ...doc, activeId: 'b' }
    const out = replaceScenario(switched, target, incoming)!
    expect(out.scenarios.map((x) => x.id)).toEqual(['a', 'b', 'shared', 'd'])
    expect(out.activeId).toBe('shared')
  })
  it('a deleted target stops the replacement: nothing changes and no other plan is chosen', () => {
    const doc = four('a')
    const withoutC: Doc = { ...doc, scenarios: doc.scenarios.filter((x) => x.id !== 'c') }
    expect(targetExists(withoutC, 'c')).toBe(false)
    expect(replaceScenario(withoutC, 'c', incoming)).toBeNull()
  })
  it('never loses a plan other than the chosen one', () => {
    const doc = four('a')
    for (const target of ['a', 'b', 'c', 'd']) {
      const out = replaceScenario(doc, target, incoming)!
      const kept = out.scenarios.map((x) => x.id)
      expect(kept).toHaveLength(4)
      for (const id of ['a', 'b', 'c', 'd'].filter((x) => x !== target)) expect(kept).toContain(id)
    }
  })
  it('a shared link with the same ID as a saved plan does not duplicate or drop plans', () => {
    const doc = four('a')
    const dup = named('b', 'Shared copy')
    const out = replaceScenario(doc, 'c', dup)!
    expect(out.scenarios.filter((x) => x.id === 'b')).toHaveLength(1)
  })
})

describe('malformed and unsupported share links', () => {
  const token = (payload: unknown) => btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  it('rejects garbage, wrong envelope versions and oversized input without throwing', () => {
    expect(decodeShare('')).toBeNull()
    expect(decodeShare('not base64 !!')).toBeNull()
    expect(decodeShare('a'.repeat(9000))).toBeNull()
    expect(decodeShare(token({ sv: 1, s: { v: 4 } }))).toBeNull()
    expect(decodeShare(token({ sv: 3, s: { v: 4 } }))).toBeNull()
    expect(decodeShare(token({ s: { v: 4 } }))).toBeNull()
    expect(decodeShare(token('just a string'))).toBeNull()
  })
  it('a valid link still decodes after the rejects', () => {
    const ok = decodeShare(encodeShare(named('x', 'Valid')))
    expect(ok?.name).toBe('Valid')
  })
})
