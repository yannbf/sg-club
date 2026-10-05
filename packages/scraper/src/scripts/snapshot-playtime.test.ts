import { describe, expect, it } from 'vitest'
import {
  buildSnapshot,
  floorEntry,
  previousMonthKey,
  type GroupUsersFile,
  type PlaytimeSnapshot,
} from './snapshot-playtime.js'

const AT = new Date('2026-10-01T00:00:00Z')

const usersFile = (
  wins: { link: string; steam_play_data?: { playtime_minutes?: number; achievements_unlocked?: number } }[],
): GroupUsersFile => ({
  users: { u1: { username: 'a', steam_id: '1', giveaways_won: wins } },
})

const prevSnapshot = (members: PlaytimeSnapshot['members']): PlaytimeSnapshot => ({
  captured_at: '2026-09-01T00:00:00.000Z',
  members,
})

describe('floorEntry', () => {
  it('returns the current entry when there is no previous one', () => {
    expect(floorEntry([10, 2])).toEqual([10, 2])
  })

  it('floors each metric independently', () => {
    expect(floorEntry([0, 5], [300, 3])).toEqual([300, 5])
  })
})

describe('previousMonthKey', () => {
  it('steps back one month and across a year boundary', () => {
    expect(previousMonthKey('2026-10')).toBe('2026-09')
    expect(previousMonthKey('2026-01')).toBe('2025-12')
  })
})

describe('buildSnapshot monotonic against the previous snapshot', () => {
  it('keeps the previous value when the current read is zero', () => {
    const { snapshot } = buildSnapshot(
      usersFile([{ link: 'abc/game', steam_play_data: { playtime_minutes: 0, achievements_unlocked: 0 } }]),
      null,
      AT,
      undefined,
      prevSnapshot({ '1': { abc: [600, 4] } }),
    )
    expect(snapshot.members['1'].abc).toEqual([600, 4])
  })

  it('floors a lower read at the previous value', () => {
    const { snapshot } = buildSnapshot(
      usersFile([{ link: 'abc/game', steam_play_data: { playtime_minutes: 100, achievements_unlocked: 1 } }]),
      null,
      AT,
      undefined,
      prevSnapshot({ '1': { abc: [600, 4] } }),
    )
    expect(snapshot.members['1'].abc).toEqual([600, 4])
  })

  it('grows normally when the current read is higher', () => {
    const { snapshot } = buildSnapshot(
      usersFile([{ link: 'abc/game', steam_play_data: { playtime_minutes: 900, achievements_unlocked: 6 } }]),
      null,
      AT,
      undefined,
      prevSnapshot({ '1': { abc: [600, 4] } }),
    )
    expect(snapshot.members['1'].abc).toEqual([900, 6])
  })

  it('carries the previous entry forward for a win with no stats object', () => {
    const { snapshot } = buildSnapshot(
      usersFile([{ link: 'abc/game' }]),
      null,
      AT,
      undefined,
      prevSnapshot({ '1': { abc: [600, 4] } }),
    )
    expect(snapshot.members['1'].abc).toEqual([600, 4])
  })

  it('ignores previous entries for other members and wins', () => {
    const { snapshot } = buildSnapshot(
      usersFile([{ link: 'abc/game', steam_play_data: { playtime_minutes: 50 } }]),
      null,
      AT,
      undefined,
      prevSnapshot({ '1': { zzz: [999, 9] }, '2': { abc: [999, 9] } }),
    )
    expect(snapshot.members).toEqual({ '1': { abc: [50, 0] } })
  })

  it('stores the current read as-is when there is no previous snapshot', () => {
    const { snapshot } = buildSnapshot(
      usersFile([{ link: 'abc/game', steam_play_data: { playtime_minutes: 120, achievements_unlocked: 2 } }]),
      null,
      AT,
    )
    expect(snapshot.members['1'].abc).toEqual([120, 2])
  })

  it('stores an unreadable win with no history as zero, not omitted', () => {
    // chart-data's delta walk reads a missing entry as [0, 0], so omitting it
    // would not avoid the full-lifetime delta the following month.
    const { snapshot } = buildSnapshot(
      usersFile([{ link: 'abc/game', steam_play_data: {} }]),
      null,
      AT,
      undefined,
      prevSnapshot({}),
    )
    expect(snapshot.members['1'].abc).toEqual([0, 0])
  })

  it('skips a win with no stats object and no history', () => {
    const { snapshot } = buildSnapshot(usersFile([{ link: 'abc/game' }]), null, AT)
    expect(snapshot.members).toEqual({})
  })

  it('applies the floor to ex-members too', () => {
    const { snapshot } = buildSnapshot(
      null,
      usersFile([{ link: 'abc/game', steam_play_data: { playtime_minutes: 0 } }]),
      AT,
      undefined,
      prevSnapshot({ '1': { abc: [60, 1] } }),
    )
    expect(snapshot.members['1'].abc).toEqual([60, 1])
  })
})
