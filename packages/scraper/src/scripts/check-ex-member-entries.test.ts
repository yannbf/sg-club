import { describe, expect, it } from 'vitest'
import type { User } from '../types/steamgifts'
import { buildExMemberCandidates } from './check-ex-member-entries'

const baseUser = (overrides: Partial<User> = {}): User => ({
  username: 'someone',
  profile_url: '/user/someone',
  avatar_url: '',
  steam_id: '1',
  stats: {} as User['stats'],
  ...overrides,
})

describe('buildExMemberCandidates', () => {
  it('carries a real ex-member with pending_sync false and left_at_timestamp as the effective timestamp', () => {
    const exMembers = {
      '1': baseUser({ username: 'leftUser', left_at_timestamp: 1000 }),
    }
    const candidates = buildExMemberCandidates(exMembers, {})
    expect(candidates).toEqual([
      {
        steam_id: '1',
        user: exMembers['1'],
        effective_left_at: 1000,
        pending_sync: false,
      },
    ])
  })

  it('includes a group member flagged kicked_pending_sync, using kick_detected_at as the effective timestamp', () => {
    const groupUsers = {
      '2': baseUser({
        username: 'kickedUser',
        steam_id: '2',
        kicked_pending_sync: true,
        kick_detected_at: 2000,
      }),
    }
    const candidates = buildExMemberCandidates({}, groupUsers)
    expect(candidates).toEqual([
      {
        steam_id: '2',
        user: groupUsers['2'],
        effective_left_at: 2000,
        pending_sync: true,
      },
    ])
  })

  it('excludes group members without kicked_pending_sync set', () => {
    const groupUsers = {
      '3': baseUser({ username: 'fine', steam_id: '3' }),
    }
    expect(buildExMemberCandidates({}, groupUsers)).toEqual([])
  })

  it('combines both sources', () => {
    const exMembers = {
      '1': baseUser({ username: 'leftUser', left_at_timestamp: 1000 }),
    }
    const groupUsers = {
      '2': baseUser({
        username: 'kickedUser',
        steam_id: '2',
        kicked_pending_sync: true,
        kick_detected_at: 2000,
      }),
      '3': baseUser({ username: 'fine', steam_id: '3' }),
    }
    const candidates = buildExMemberCandidates(exMembers, groupUsers)
    expect(candidates.map((c) => c.steam_id).sort()).toEqual(['1', '2'])
  })

  it('defaults the effective timestamp to 0 when the relevant timestamp field is missing', () => {
    const exMembers = { '1': baseUser({ username: 'leftUser' }) }
    const groupUsers = {
      '2': baseUser({
        username: 'kickedUser',
        steam_id: '2',
        kicked_pending_sync: true,
      }),
    }
    const candidates = buildExMemberCandidates(exMembers, groupUsers)
    expect(candidates.every((c) => c.effective_left_at === 0)).toBe(true)
  })
})
