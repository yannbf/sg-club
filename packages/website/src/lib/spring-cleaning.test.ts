import { describe, it, expect } from 'vitest'
import { analyzeSpringCleaning } from './spring-cleaning'
import type { User } from '@/types'

const nowSec = 1_800_000_000
const yearAgo = nowSec - 365 * 24 * 60 * 60

function dormantUser(username: string, extra: Partial<User> = {}): User {
  return {
    username,
    steam_id: `id-${username}`,
    profile_url: `/user/${username}`,
    avatar_url: '',
    stats: {
      first_seen_at: yearAgo,
      last_giveaway_created_at: yearAgo,
      giveaway_ratio: 0,
    },
    giveaways_won: [],
    giveaways_created: [],
    ...extra,
  } as unknown as User
}

describe('analyzeSpringCleaning', () => {
  it('flags a dormant long-time member', () => {
    const result = analyzeSpringCleaning(
      [dormantUser('dormant')],
      [],
      [],
      null,
      null,
      { nowSec },
    )
    expect(result.totalAnalyzed).toBe(1)
    expect([...result.expel, ...result.warn].map((u) => u.username)).toEqual([
      'dormant',
    ])
  })

  it('skips members already kicked from the Steam group', () => {
    const result = analyzeSpringCleaning(
      [dormantUser('kicked', { kicked_pending_sync: true })],
      [],
      [],
      null,
      null,
      { nowSec },
    )
    expect(result.totalAnalyzed).toBe(0)
    expect(result.expel).toEqual([])
    expect(result.warn).toEqual([])
  })
})
