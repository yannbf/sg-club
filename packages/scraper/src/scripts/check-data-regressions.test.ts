import { describe, expect, it } from 'vitest'
import {
  checkBeaten,
  checkChallenge,
  checkData,
  checkGameInsights,
  checkGroupUsers,
  checkSerialized,
  decideExit,
} from './check-data-regressions.js'

const groupUsers = (play: Record<string, unknown> | undefined) => ({
  users: {
    alice: {
      steam_id: '1',
      giveaways_won: [{ link: 'abc/game', ...(play ? { steam_play_data: play } : {}) }],
    },
  },
})

describe('checkGroupUsers', () => {
  it('reports nothing when play data is unchanged or grows', () => {
    const previous = groupUsers({ playtime_minutes: 60, achievements_unlocked: 3 })
    const next = groupUsers({ playtime_minutes: 90, achievements_unlocked: 3 })
    expect(checkGroupUsers(previous, next)).toEqual([])
  })

  it('reports playtime and achievements that went down', () => {
    const previous = groupUsers({ playtime_minutes: 60, achievements_unlocked: 3 })
    const next = groupUsers({ playtime_minutes: 0, achievements_unlocked: 0 })
    expect(checkGroupUsers(previous, next).map((f) => f.field)).toEqual([
      'steam_play_data.playtime_minutes',
      'steam_play_data.achievements_unlocked',
    ])
  })

  it('reports play data that disappeared from a win that is still listed', () => {
    const previous = groupUsers({ playtime_minutes: 60, achievements_unlocked: 3 })
    const findings = checkGroupUsers(previous, groupUsers(undefined))
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ key: '1::abc/game', field: 'steam_play_data' })
  })

  it('ignores a win or a member that is no longer listed', () => {
    const previous = groupUsers({ playtime_minutes: 60, achievements_unlocked: 3 })
    expect(checkGroupUsers(previous, { users: { alice: { steam_id: '1', giveaways_won: [] } } })).toEqual([])
    expect(checkGroupUsers(previous, { users: {} })).toEqual([])
  })

  it('reports a file that lost most of its members', () => {
    const user = (id: string) => ({ steam_id: id, giveaways_won: [] })
    const previous = { users: { a: user('1'), b: user('2'), c: user('3'), d: user('4') } }
    const findings = checkGroupUsers(previous, { users: { a: user('1') } })
    expect(findings).toEqual([expect.objectContaining({ key: '*', field: 'users_present', from: 4, to: 1 })])
  })
})

const participant = (overrides: Record<string, unknown> = {}) => ({
  steam_id: '1',
  owned: true,
  is_complete: true,
  is_winner: true,
  wrote_review: true,
  playtime_total_minutes: 588,
  achievements_unlocked_total: 18,
  ...overrides,
})

describe('checkChallenge', () => {
  it('reports ownership, completion and winner status lost on a hidden pull', () => {
    const previous = { participants: [participant()] }
    const next = { participants: [participant({ owned: false, is_complete: false, is_winner: false })] }
    expect(checkChallenge(previous, next).map((f) => f.field)).toEqual(['owned', 'is_complete', 'is_winner'])
  })

  it('reports counters that went down, for participants and non-participants', () => {
    const previous = {
      participants: [participant()],
      nonParticipants: [{ steam_id: '2', playtime_total_minutes: 30, achievements_unlocked_total: 2 }],
    }
    const next = {
      participants: [participant({ playtime_total_minutes: 0 })],
      nonParticipants: [{ steam_id: '2', playtime_total_minutes: 0, achievements_unlocked_total: 2 }],
    }
    expect(checkChallenge(previous, next).map((f) => `${f.key}:${f.field}`)).toEqual([
      '1:playtime_total_minutes',
      '2:playtime_total_minutes',
    ])
  })

  it('ignores a participant who is no longer listed and flags gained, not lost', () => {
    const previous = { participants: [participant({ is_winner: false })] }
    expect(checkChallenge(previous, { participants: [participant()] })).toEqual([])
    expect(checkChallenge(previous, { participants: [] })).toEqual([])
  })
})

const beaten = (verdict: boolean | null, apiname = 'ENDING') => ({
  games: { '10': { marker: { apiname } } },
  wins: { '1::10': { beaten: verdict } },
})

describe('checkBeaten', () => {
  it('reports a verdict that stopped being true under the same marker', () => {
    expect(checkBeaten(beaten(true), beaten(null))).toEqual([
      expect.objectContaining({ key: '1::10', field: 'beaten', from: true, to: null }),
    ])
  })

  it('ignores a verdict that changed because the marker changed', () => {
    expect(checkBeaten(beaten(true), beaten(false, 'OTHER'))).toEqual([])
  })

  it('ignores an unchanged verdict and a win that is no longer listed', () => {
    expect(checkBeaten(beaten(true), beaten(true))).toEqual([])
    expect(checkBeaten(beaten(true), { games: { '10': { marker: { apiname: 'ENDING' } } }, wins: {} })).toEqual([])
  })
})

const insights = (owners: string[], libraryCount: number, totalMembers = 10) => ({
  total_members: totalMembers,
  members_with_library_data: libraryCount,
  members_with_wishlist_data: libraryCount,
  games: { '10': { owners, wanters: owners } },
})

describe('checkGameInsights', () => {
  it('reports a mass loss of owner/wanter entries and of member coverage', () => {
    const previous = insights(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], 10)
    const fields = checkGameInsights(previous, insights(['1', '2'], 2)).map((f) => f.field)
    expect(fields).toEqual([
      'owners_pairs',
      'wanters_pairs',
      'members_with_library_data',
      'members_with_wishlist_data',
    ])
  })

  it('accepts a small drop', () => {
    const previous = insights(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], 10)
    expect(checkGameInsights(previous, insights(['1', '2', '3', '4', '5', '6', '7', '8', '9'], 9))).toEqual([])
  })
})

describe('checkData / checkSerialized', () => {
  it('routes a file to its check by name', () => {
    const previous = { participants: [participant()] }
    const next = { participants: [participant({ is_winner: false })] }
    const outcome = checkData('packages/website/public/data/challenge_vellum.json', previous, next)
    expect(outcome.error).toBeUndefined()
    expect(outcome.findings.map((f) => f.field)).toEqual(['is_winner'])
  })

  it('reports an unexpected shape or malformed JSON as an error instead of throwing', () => {
    expect(checkData('group_users.json', { users: [] }, null).error).toBeDefined()
    expect(checkData('unknown.json', {}, {}).error).toBeDefined()
    const outcome = checkSerialized('group_users.json', '{"users":{}}', '{not json')
    expect(outcome.findings).toEqual([])
    expect(outcome.error).toBeDefined()
  })
})

describe('decideExit', () => {
  it('fails by default only when there are findings', () => {
    expect(decideExit(0, {})).toMatchObject({ exitCode: 0, mode: 'fail', annotation: 'error' })
    expect(decideExit(2, {})).toMatchObject({ exitCode: 1, mode: 'fail', annotation: 'error' })
  })

  it('never fails in warn mode or when a regression is explicitly allowed', () => {
    expect(decideExit(2, { DATA_REGRESSION_MODE: 'warn' })).toMatchObject({ exitCode: 0, annotation: 'warning' })
    expect(decideExit(2, { ALLOW_DATA_REGRESSION: '1' })).toMatchObject({ exitCode: 0, annotation: 'warning' })
  })
})
