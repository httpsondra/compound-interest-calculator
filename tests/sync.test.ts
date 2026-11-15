import { describe, expect, it } from 'vitest'
import { BACKUP_LIMIT, isConflict, parseBackups, withBackup } from '../src/state/sync'

describe('multi-tab conflict rules', () => {
  it('no conflict when storage still holds what this tab last saw', () => {
    expect(isConflict('{"a":1}', '{"a":1}')).toBe(false)
  })
  it('another tab saved since: conflict', () => {
    expect(isConflict('{"a":1}', '{"a":2}')).toBe(true)
  })
  it('nothing stored yet is not a conflict; storage appearing after first load is', () => {
    expect(isConflict(null, null)).toBe(false)
    expect(isConflict(null, '{"a":2}')).toBe(true)
  })
  it('backups are newest first and capped; the oldest is dropped', () => {
    let list = parseBackups(null)
    for (let i = 0; i < BACKUP_LIMIT + 3; i++) list = withBackup(list, `v${i}`, i)
    expect(list).toHaveLength(BACKUP_LIMIT)
    expect(list[0].raw).toBe(`v${BACKUP_LIMIT + 2}`)
    expect(list[list.length - 1].raw).toBe('v3')
  })
  it('unreadable backup storage yields an empty list, never an exception', () => {
    expect(parseBackups('{not json')).toEqual([])
    expect(parseBackups('{"x":1}')).toEqual([])
    expect(parseBackups('[{"raw":5}]')).toEqual([])
    expect(parseBackups(JSON.stringify([{ raw: 'ok', savedAt: 1 }]))).toEqual([{ raw: 'ok', savedAt: 1 }])
  })
})
