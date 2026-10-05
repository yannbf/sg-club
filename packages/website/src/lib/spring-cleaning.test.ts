import { describe, it, expect } from 'vitest'
import { analyzeSpringCleaning, computePlayRate } from './spring-cleaning'
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

describe('computePlayRate', () => {
  const win = (steam_play_data?: object, extra: object = {}) => ({
    name: 'Game',
    link: 'abc/game',
    steam_play_data,
    ...extra,
  })
  const played = win({ playtime_minutes: 300, never_played: false })
  const unplayed = win({ playtime_minutes: 0, never_played: true })
  const delisted = win({
    playtime_minutes: 0,
    achievements_unlocked: 0,
    never_played: true,
    has_no_available_stats: true,
    no_stats_reason: 'package_delisted',
  })
  const rateOf = (giveaways_won: object[]) =>
    computePlayRate(dormantUser('u', { giveaways_won: giveaways_won as never }))

  it('leaves unreadable wins out of the rate and reports them in noStatsCount', () => {
    expect(rateOf([played, unplayed, delisted, win()])).toEqual({
      played: 1,
      total: 2,
      percentage: 50,
      noStatsCount: 2,
    })
  })

  it('counts an achievement-less game with real playtime as played', () => {
    const noAchievements = win({
      playtime_minutes: 600,
      never_played: false,
      has_no_available_stats: true,
      no_stats_reason: 'no_steam_stats',
    })
    expect(rateOf([noAchievements, unplayed])).toMatchObject({ played: 1, total: 2, noStatsCount: 0 })
  })

  it('counts attested wins as played and excludes unreleased wins entirely', () => {
    expect(
      rateOf([win(undefined, { i_played_bro: true }), unplayed, win(undefined, { unreleased: true })])
    ).toEqual({ played: 1, total: 2, percentage: 50, noStatsCount: 0 })
  })

  it('reports a 0 percentage with no readable wins', () => {
    expect(rateOf([delisted, win()])).toEqual({ played: 0, total: 0, percentage: 0, noStatsCount: 2 })
  })
})

describe('analyzeSpringCleaning play rate', () => {
  const winWith = (i: number, steam_play_data?: object) => ({
    name: `Game ${i}`,
    link: `abc/game-${i}`,
    end_timestamp: yearAgo,
    cv_status: 'FULL_CV',
    steam_play_data,
  })
  const delisted = {
    playtime_minutes: 0,
    achievements_unlocked: 0,
    never_played: true,
    has_no_available_stats: true,
    no_stats_reason: 'package_delisted',
  }
  const unplayed = { playtime_minutes: 0, never_played: true }
  const playFlags = (wins: object[]) => {
    const result = analyzeSpringCleaning(
      [dormantUser('subject', { giveaways_won: wins as never })],
      [],
      [],
      null,
      null,
      { nowSec },
    )
    return [...result.expel, ...result.warn][0].flags.filter((f) => f.id === 'bad_play_rate')
  }

  it('raises no bad-play-rate flag when every win is unreadable', () => {
    expect(playFlags([1, 2, 3, 4].map((i) => winWith(i, delisted)))).toEqual([])
    expect(playFlags([1, 2, 3, 4].map((i) => winWith(i)))).toEqual([])
  })

  it('judges the member on the readable wins only', () => {
    // Two readable wins are below the three-win minimum, however many are hidden.
    expect(playFlags([winWith(1, unplayed), winWith(2, unplayed), ...[3, 4, 5].map((i) => winWith(i, delisted))])).toEqual([])
    const flags = playFlags([1, 2, 3].map((i) => winWith(i, unplayed)).concat([4, 5].map((i) => winWith(i, delisted))))
    expect(flags).toHaveLength(1)
    expect(flags[0].label).toBe('0% play rate — 0 out of 3 wins played')
    expect(flags[0].detail).toContain('2 of 5 wins have no Steam stats')
  })

  it('still flags a genuinely low readable play rate', () => {
    const flags = playFlags([1, 2, 3, 4].map((i) => winWith(i, unplayed)))
    expect(flags).toHaveLength(1)
    expect(flags[0].severity).toBe('expel')
  })
})
