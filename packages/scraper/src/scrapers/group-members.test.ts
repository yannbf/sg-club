import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  SteamGiftsUserFetcher,
  mergePlayData,
  evaluateLeaverGuard,
} from './group-members'
import type { User, GamePrice, Giveaway } from '../types/steamgifts'

vi.mock('node:fs')

describe('SteamGiftsUserFetcher', () => {
  let fetcher: SteamGiftsUserFetcher
  const mockGamePrices: Partial<GamePrice>[] = [
    {
      name: 'Game A',
      app_id: 1,
      price_usd_full: 1000,
      price_usd_reduced: 500,
    },
    {
      name: 'Game B',
      app_id: 2,
      price_usd_full: 2000,
      price_usd_reduced: 1000,
    },
    {
      name: 'Game C',
      app_id: 3,
      price_usd_full: 3000,
      price_usd_reduced: 1500,
    },
    {
      name: 'No CV Game',
      app_id: 4,
      price_usd_full: 0,
      price_usd_reduced: 0,
    },
  ]

  /**
   * calculateStats resolves each giveaway's value through the `giveaways`
   * argument (link -> app_id -> price), so every link used in a fixture needs
   * a matching giveaway here or the value silently comes out as zero.
   */
  const appIdByName: Record<string, number> = {
    'Game A': 1,
    'Game B': 2,
    'Game C': 3,
    'No CV Game': 4,
  }
  const mockGiveaways = Object.entries({
    'abc/a': 'Game A',
    'def/b': 'Game B',
    'ghi/c': 'Game C',
    'jkl/a': 'Game A',
    'jkl/c': 'Game C',
    'mno/b': 'Game B',
    'mno/ncv': 'No CV Game',
    'pqr/c': 'Game C',
  }).map(([link, name]) => ({
    link,
    name,
    app_id: appIdByName[name],
    package_id: null,
  })) as unknown as Giveaway[]

  beforeEach(() => {
    vi.resetModules()
    fetcher = new SteamGiftsUserFetcher()
    // The module reads three different data files lazily; answer each by path
    // so a game-prices payload can't be handed back as giveaways or entries.
    vi.mocked(readFileSync).mockImplementation((path) => {
      const name = String(path)
      if (name.includes('game_data.json')) return JSON.stringify(mockGamePrices)
      if (name.includes('giveaways.json')) return JSON.stringify({ giveaways: [] })
      if (name.includes('user_entries.json')) return JSON.stringify({})
      return JSON.stringify([])
    })
  })

  describe('calculateStats', () => {
    it('should calculate a giveaway ratio of -1 when a user has won 3 FCV games without proof of play and sent 0', async () => {
      const user: Partial<User> = {
        giveaways_won: [
          {
            name: 'Game A',
            link: 'abc/a',
            cv_status: 'FULL_CV',
            i_played_bro: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game B',
            link: 'def/b',
            cv_status: 'FULL_CV',
            i_played_bro: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game C',
            link: 'ghi/c',
            cv_status: 'FULL_CV',
            i_played_bro: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
        ],
        giveaways_created: [],
      }
      const stats = await fetcher.calculateStats(user as User, mockGiveaways)
      expect(stats.giveaway_ratio).toBe(-1)
    })

    it('should have a ratio of 0 if the user won 3 FCV games but provided proof of play for all', async () => {
      const user: Partial<User> = {
        giveaways_won: [
          {
            name: 'Game A',
            link: 'abc/a',
            cv_status: 'FULL_CV',
            i_played_bro: true,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game B',
            link: 'def/b',
            cv_status: 'FULL_CV',
            i_played_bro: true,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game C',
            link: 'ghi/c',
            cv_status: 'FULL_CV',
            i_played_bro: true,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
        ],
        giveaways_created: [],
      }
      const stats = await fetcher.calculateStats(user as User, mockGiveaways)
      expect(stats.giveaway_ratio).toBe(0)
    })

    it('should have a ratio of 0 if the user won 3 FCV games without proof, but sent 1 FCV game', async () => {
      const user: Partial<User> = {
        giveaways_won: [
          {
            name: 'Game A',
            link: 'abc/a',
            cv_status: 'FULL_CV',
            i_played_bro: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game B',
            link: 'def/b',
            cv_status: 'FULL_CV',
            i_played_bro: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game C',
            link: 'ghi/c',
            cv_status: 'FULL_CV',
            i_played_bro: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
        ],
        giveaways_created: [
          {
            name: 'Game A',
            link: 'jkl/a',
            cv_status: 'FULL_CV',
            copies: 1,
            end_timestamp: 0,
            entries: 1,
            had_winners: true,
            is_shared: false,
            required_play: false,
            created_timestamp: 0,
            winners: [
              {
                name: 'User A',
                status: 'received',
                activated: true,
              },
            ],
          },
        ],
      }
      const stats = await fetcher.calculateStats(user as User, mockGiveaways)
      expect(stats.giveaway_ratio).toBe(0)
    })

    it('should calculate ratio based only on FCV games, ignoring RCV and NCV', async () => {
      const user: Partial<User> = {
        giveaways_won: [
          {
            name: 'Game A',
            link: 'abc/a',
            cv_status: 'FULL_CV',
            i_played_bro: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game B',
            link: 'def/b',
            cv_status: 'FULL_CV',
            i_played_bro: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game C',
            link: 'ghi/c',
            cv_status: 'FULL_CV',
            i_played_bro: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game A',
            link: 'jkl/a',
            cv_status: 'REDUCED_CV',
            i_played_bro: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'No CV Game',
            link: 'mno/ncv',
            cv_status: 'NO_CV',
            i_played_bro: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
        ],
        giveaways_created: [],
      }
      const stats = await fetcher.calculateStats(user as User, mockGiveaways)
      expect(stats.giveaway_ratio).toBe(-1)
    })

    it('should calculate a ratio of -0.67 for a user who won 5 FCV games and gave 1', async () => {
      const user: Partial<User> = {
        giveaways_won: [
          {
            name: 'Game A',
            link: 'abc/a',
            cv_status: 'FULL_CV',
            i_played_bro: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game B',
            link: 'def/b',
            cv_status: 'FULL_CV',
            i_played_bro: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game C',
            link: 'ghi/c',
            cv_status: 'FULL_CV',
            i_played_bro: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game A',
            link: 'jkl/a',
            cv_status: 'FULL_CV',
            i_played_bro: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game B',
            link: 'mno/b',
            cv_status: 'FULL_CV',
            i_played_bro: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
        ],
        giveaways_created: [
          {
            name: 'Game C',
            link: 'pqr/c',
            cv_status: 'FULL_CV',
            copies: 1,
            end_timestamp: 0,
            entries: 1,
            had_winners: true,
            is_shared: false,
            required_play: false,
            created_timestamp: 0,
            winners: [
              {
                name: 'User A',
                status: 'received',
                activated: true,
              },
            ],
          },
        ],
      }
      const stats = await fetcher.calculateStats(user as User, mockGiveaways)
      expect(stats.giveaway_ratio).toBeCloseTo(-0.666)
    })

    it('should calculate real value stats correctly', async () => {
      const user: Partial<User> = {
        giveaways_won: [
          {
            name: 'Game A',
            link: 'abc/a',
            cv_status: 'FULL_CV',
            i_played_bro: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          }, // $10
          {
            name: 'Game B',
            link: 'def/b',
            cv_status: 'REDUCED_CV',
            i_played_bro: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          }, // $10 (reduced)
        ],
        giveaways_created: [
          {
            name: 'Game C',
            link: 'jkl/c',
            cv_status: 'FULL_CV',
            copies: 1,
            end_timestamp: 0,
            entries: 1,
            had_winners: true,
            is_shared: false,
            required_play: false,
            created_timestamp: 0,
            winners: [
              {
                name: 'User A',
                status: 'received',
                activated: true,
              },
            ],
          }, // $30
          {
            name: 'No CV Game',
            link: 'mno/ncv',
            cv_status: 'NO_CV',
            copies: 1,
            end_timestamp: 0,
            entries: 1,
            had_winners: true,
            is_shared: false,
            required_play: false,
            created_timestamp: 0,
            winners: [
              {
                name: 'User A',
                status: 'received',
                activated: true,
              },
            ],
          },
        ],
      }
      const stats = await fetcher.calculateStats(user as User, mockGiveaways)
      expect(stats.real_total_sent_value).toBe(30)
      expect(stats.real_total_received_value).toBe(20) // 10 (full) + 10 (reduced)
      expect(stats.real_total_value_difference).toBe(10)
    })
  })
})

describe('mergePlayData', () => {
  const proven = {
    owned: true,
    playtime_minutes: 1100,
    playtime_formatted: '18 hours 20 minutes',
    achievements_unlocked: 30,
    achievements_total: 48,
    achievements_percentage: 62.5,
    never_played: false,
    is_playtime_private: false,
  }
  const libraryUnreadable = {
    owned: false,
    playtime_minutes: 0,
    playtime_formatted: '0 minutes',
    achievements_unlocked: 0,
    achievements_total: 0,
    achievements_percentage: 0,
    never_played: true,
    is_playtime_private: false,
    has_no_available_stats: true,
    no_stats_reason: 'library_unavailable' as const,
  }

  it('keeps proven playtime when the library becomes unreadable', () => {
    const merged = mergePlayData(proven, libraryUnreadable)
    expect(merged.playtime_minutes).toBe(1100)
    expect(merged.achievements_unlocked).toBe(30)
    expect(merged.never_played).toBe(false)
    expect(merged.has_no_available_stats).toBeFalsy()
    expect(merged.stats_hidden_at).toBeTypeOf('number')
  })

  it('accepts a no-stats result when nothing was ever proven', () => {
    expect(mergePlayData(undefined, libraryUnreadable)).toBe(libraryUnreadable)
    const neverPlayed = { ...proven, playtime_minutes: 0, achievements_unlocked: 0, never_played: true }
    expect(mergePlayData(neverPlayed, libraryUnreadable)).toBe(libraryUnreadable)
  })

  it('ratchets playtime and achievements up, never down', () => {
    const partial = { ...proven, playtime_minutes: 60, playtime_formatted: '1 hour', achievements_unlocked: 2 }
    const merged = mergePlayData(proven, partial)
    expect(merged.playtime_minutes).toBe(1100)
    expect(merged.achievements_unlocked).toBe(30)
  })

  it('keeps real playtime for a game that exposes no achievements', () => {
    // `no_steam_stats`: library read fine, playtime is real, game has no
    // achievements. Must not be mistaken for "we saw nothing".
    const achievementless = {
      ...proven,
      playtime_minutes: 32,
      playtime_formatted: '32 minutes',
      achievements_unlocked: 0,
      achievements_total: 0,
      achievements_percentage: 0,
      has_no_available_stats: true,
      no_stats_reason: 'no_steam_stats' as const,
    }
    const merged = mergePlayData(achievementless, libraryUnreadable)
    expect(merged.playtime_minutes).toBe(32)
    expect(merged.never_played).toBe(false)
  })

  it('takes genuine progress from a fresh pull', () => {
    const progressed = { ...proven, playtime_minutes: 2000, playtime_formatted: '33 hours 20 minutes', achievements_unlocked: 40 }
    const merged = mergePlayData(proven, progressed)
    expect(merged.playtime_minutes).toBe(2000)
    expect(merged.achievements_unlocked).toBe(40)
  })
})

describe('evaluateLeaverGuard', () => {
  it('does not guard ordinary attrition below the threshold', () => {
    // 130 -> 128: drop of 2, threshold is max(3, 5% of 130) = 6.
    const result = evaluateLeaverGuard(130, 128)
    expect(result.guarded).toBe(false)
    expect(result.threshold).toBe(7)
    expect(result.drop).toBe(2)
  })

  it('guards a truncated scrape that drops far more than the threshold', () => {
    // The incident this guards against: 130 -> 100, 30 missing.
    const result = evaluateLeaverGuard(130, 100)
    expect(result.guarded).toBe(true)
    expect(result.drop).toBe(30)
    expect(result.threshold).toBe(7)
  })

  it('floors the threshold at 3 for small rosters', () => {
    const result = evaluateLeaverGuard(10, 6)
    expect(result.threshold).toBe(3)
    expect(result.drop).toBe(4)
    expect(result.guarded).toBe(true)
  })

  it('never guards when the scrape grew or held steady', () => {
    expect(evaluateLeaverGuard(130, 130).guarded).toBe(false)
    expect(evaluateLeaverGuard(130, 140).guarded).toBe(false)
  })

  it('respects an absolute override threshold', () => {
    // Deliberate mass-removal: a 30-member drop is expected, override to allow it.
    const result = evaluateLeaverGuard(130, 100, { maxDropOverride: 40 })
    expect(result.guarded).toBe(false)
    expect(result.threshold).toBe(40)
  })

  it('is disabled entirely when asked, even on an extreme drop', () => {
    const result = evaluateLeaverGuard(130, 10, { disabled: true })
    expect(result.guarded).toBe(false)
  })
})
