import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  SteamGiftsUserFetcher,
  mergePlayData,
  evaluateLeaverGuard,
  parseSteamGroupMemberIds,
  evaluateKickSyncGuard,
  computeKickSyncDecisions,
  fetchSteamGroupMemberIds,
  pickPersistedFields,
  mergeWithExisting,
  findRejoinedExMember,
  restoreRejoinedMember,
  hasPlaytimeBaseline,
  shouldFetchWin,
  oldestPendingCheck,
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

  describe('calculateUserWarnings play rate', () => {
    const YEAR_SEC = 365 * 24 * 60 * 60
    const playRateWarnings = (wins: object[], firstSeenAgoSec = YEAR_SEC): string[] =>
      fetcher
        .calculateUserWarnings(
          {
            username: 'subject',
            steam_id: '1',
            stats: {
              first_seen_at: Date.now() / 1000 - firstSeenAgoSec,
              last_giveaway_created_at: Date.now() / 1000,
            },
            giveaways_won: wins,
          } as unknown as User,
          [],
        )
        .filter((w) => w === 'zero_play_rate_with_wins' || w === 'low_play_rate_many_wins')

    const win = (i: number, steam_play_data?: object, extra: object = {}) => ({
      name: `Game ${i}`,
      link: `win/${i}`,
      end_timestamp: 1,
      required_play: false,
      steam_play_data,
      ...extra,
    })
    const wins = (count: number, steam_play_data?: object, extra: object = {}) =>
      Array.from({ length: count }, (_, i) => win(i, steam_play_data, extra))

    const playedData = { playtime_minutes: 600, never_played: false }
    const unplayedData = { playtime_minutes: 0, achievements_unlocked: 0, never_played: true }
    const hiddenData = {
      playtime_minutes: 0,
      achievements_unlocked: 0,
      never_played: true,
      has_no_available_stats: true,
      no_stats_reason: 'library_unavailable',
    }

    it('raises no play-rate warning when every win is unreadable', () => {
      expect(playRateWarnings(wins(6, hiddenData))).toEqual([])
      expect(playRateWarnings(wins(6, undefined))).toEqual([])
    })

    it('judges a member on the readable wins, ignoring the unreadable ones', () => {
      // 1 played of 2 readable is 50%: no warning, however many wins are hidden.
      expect(
        playRateWarnings([...wins(1, playedData), ...wins(1, unplayedData), ...wins(8, hiddenData)]),
      ).toEqual([])
      // Four hidden wins don't rescue a member whose three readable wins are all unplayed.
      expect(playRateWarnings([...wins(3, unplayedData), ...wins(4, hiddenData)])).toEqual([
        'zero_play_rate_with_wins',
      ])
    })

    it('applies the minimum-wins thresholds to readable wins', () => {
      // Two readable unplayed wins are below the "more than 2" bar for a zero rate.
      expect(playRateWarnings([...wins(2, unplayedData), ...wins(6, hiddenData)])).toEqual([])
      // One played of six readable (17%) trips the low-rate warning; of four it would not.
      expect(playRateWarnings([...wins(1, playedData), ...wins(5, unplayedData)])).toEqual([
        'low_play_rate_many_wins',
      ])
      expect(playRateWarnings([...wins(1, playedData), ...wins(3, unplayedData), ...wins(4, hiddenData)])).toEqual([])
    })

    it('counts an achievement-less game with real playtime as played', () => {
      const noAchievements = {
        playtime_minutes: 600,
        never_played: false,
        has_no_available_stats: true,
        no_stats_reason: 'no_steam_stats',
      }
      expect(playRateWarnings([...wins(1, noAchievements), ...wins(3, unplayedData)])).toEqual([])
      expect(playRateWarnings([...wins(1, noAchievements), ...wins(4, unplayedData)])).toEqual([
        'low_play_rate_many_wins',
      ])
    })

    it('still warns on a genuinely low readable play rate', () => {
      expect(playRateWarnings(wins(3, unplayedData))).toEqual(['zero_play_rate_with_wins'])
    })

    it('counts attested wins as played and leaves unreleased wins out', () => {
      expect(playRateWarnings([...wins(3, unplayedData, { i_played_bro: true })])).toEqual([])
      expect(playRateWarnings([...wins(2, unplayedData), ...wins(4, unplayedData, { unreleased: true })])).toEqual([])
    })

    it('suppresses play-rate warnings for members who have not been around two months', () => {
      expect(playRateWarnings(wins(3, unplayedData), 10 * 24 * 60 * 60)).toEqual([])
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
    const nothingKnown = {
      ...proven,
      owned: false,
      playtime_minutes: 0,
      achievements_unlocked: 0,
      achievements_total: 0,
      achievements_percentage: 0,
      never_played: true,
    }
    expect(mergePlayData(nothingKnown, libraryUnreadable)).toBe(libraryUnreadable)
  })

  describe('a snapshot that proves ownership but no play', () => {
    const ownedUnplayed = {
      ...proven,
      playtime_minutes: 0,
      playtime_formatted: '0 minutes',
      achievements_unlocked: 0,
      achievements_percentage: 0,
      never_played: true,
    }
    const packageDelisted = {
      ...libraryUnreadable,
      no_stats_reason: 'package_delisted' as const,
    }

    it('survives an unreadable library', () => {
      const merged = mergePlayData(ownedUnplayed, libraryUnreadable)
      expect(merged.owned).toBe(true)
      expect(merged.achievements_total).toBe(48)
      expect(merged.has_no_available_stats).toBeFalsy()
      expect(merged.stats_hidden_at).toBeTypeOf('number')
    })

    it('survives a delisted-package result', () => {
      const merged = mergePlayData(ownedUnplayed, packageDelisted)
      expect(merged.owned).toBe(true)
      expect(merged.achievements_total).toBe(48)
    })

    it('survives when only the achievement total was recorded', () => {
      const notOwned = { ...ownedUnplayed, owned: false }
      expect(mergePlayData(notOwned, libraryUnreadable).achievements_total).toBe(48)
    })

    it('is still replaced by a readable result', () => {
      const readable = { ...proven, playtime_minutes: 5, playtime_formatted: '5 minutes', achievements_unlocked: 0, achievements_percentage: 0 }
      expect(mergePlayData(ownedUnplayed, readable)).toBe(readable)
    })

    it('is still replaced by a readable "not in library" result', () => {
      const notInLibrary = { ...libraryUnreadable, no_stats_reason: 'not_in_library' as const }
      expect(mergePlayData(ownedUnplayed, notInLibrary)).toBe(notInLibrary)
    })
  })

  describe('a partial fresh read', () => {
    const breakdownEntry = (app_id: number, unlocked: number, total: number) => ({
      app_id,
      name: `App ${app_id}`,
      owned: true,
      playtime_minutes: 100,
      playtime_formatted: '1 hour 40 minutes',
      achievements_unlocked: unlocked,
      achievements_total: total,
      achievements_percentage: total ? Number(((unlocked / total) * 100).toFixed(1)) : 0,
    })
    const threeGames = {
      ...proven,
      playtime_minutes: 300,
      playtime_formatted: '5 hours',
      achievements_unlocked: 60,
      achievements_total: 100,
      achievements_percentage: 60,
      games_breakdown: [
        breakdownEntry(1, 30, 50),
        breakdownEntry(2, 20, 30),
        breakdownEntry(3, 10, 20),
      ],
    }
    const oneGame = {
      ...proven,
      playtime_minutes: 100,
      playtime_formatted: '1 hour 40 minutes',
      achievements_unlocked: 30,
      achievements_total: 50,
      achievements_percentage: 60,
      games_breakdown: [breakdownEntry(1, 30, 50)],
    }

    it('keeps the larger totals, a matching percentage and the fuller breakdown', () => {
      const merged = mergePlayData(threeGames, oneGame)
      expect(merged.playtime_minutes).toBe(300)
      expect(merged.achievements_unlocked).toBe(60)
      expect(merged.achievements_total).toBe(100)
      expect(merged.achievements_percentage).toBe(60)
      expect(merged.games_breakdown).toHaveLength(3)
    })

    it('never pairs the floored unlocked count with the smaller fresh total', () => {
      // Fresh read: 40 of 60. Stored: 94 unlocked of 100.
      const stored = { ...proven, achievements_unlocked: 94, achievements_total: 100, achievements_percentage: 94 }
      const fresh = { ...proven, achievements_unlocked: 40, achievements_total: 60, achievements_percentage: 66.7 }
      const merged = mergePlayData(stored, fresh)
      expect(merged.achievements_unlocked).toBe(94)
      expect(merged.achievements_total).toBe(100)
      expect(merged.achievements_percentage).toBe(94)
    })

    it('floors on a playtime drop alone and still corrects the totals', () => {
      const merged = mergePlayData(threeGames, { ...oneGame, achievements_unlocked: 61, achievements_total: 62 })
      expect(merged.playtime_minutes).toBe(300)
      expect(merged.achievements_unlocked).toBe(61)
      expect(merged.achievements_total).toBe(100)
      expect(merged.achievements_percentage).toBe(61)
    })

    it('keeps the fresh breakdown when it covers every game', () => {
      const fresh = {
        ...threeGames,
        playtime_minutes: 400,
        games_breakdown: [breakdownEntry(1, 30, 50), breakdownEntry(2, 20, 30), breakdownEntry(3, 15, 20)],
        achievements_unlocked: 65,
      }
      expect(mergePlayData(threeGames, fresh).games_breakdown).toBe(fresh.games_breakdown)
    })

    it('keeps the previous breakdown when the fresh read has none', () => {
      const { games_breakdown: _drop, ...noBreakdown } = oneGame
      expect(mergePlayData(threeGames, noBreakdown).games_breakdown).toBe(threeGames.games_breakdown)
    })
  })

  describe('achievements unreadable on an otherwise readable pull', () => {
    const noAchievements = {
      ...proven,
      playtime_minutes: 1500,
      playtime_formatted: '25 hours',
      achievements_unlocked: 0,
      achievements_total: 0,
      achievements_percentage: 0,
      has_no_available_stats: true,
      no_stats_reason: 'no_steam_stats' as const,
    }

    it('carries the recorded achievements and ignores the fresh no-stats markers', () => {
      const merged = mergePlayData(proven, noAchievements)
      expect(merged.playtime_minutes).toBe(1500)
      expect(merged.achievements_unlocked).toBe(30)
      expect(merged.achievements_total).toBe(48)
      expect(merged.achievements_percentage).toBe(62.5)
      expect(merged.has_no_available_stats).toBeUndefined()
      expect(merged.no_stats_reason).toBeUndefined()
      expect(merged.never_played).toBe(false)
    })

    it('carries a recorded 0-of-N list too, where no unlocked count would floor', () => {
      const zeroOfFifty = { ...proven, achievements_unlocked: 0, achievements_total: 50, achievements_percentage: 0 }
      const merged = mergePlayData(zeroOfFifty, noAchievements)
      expect(merged.achievements_total).toBe(50)
      expect(merged.has_no_available_stats).toBeUndefined()
    })

    it('restores the recorded no-stats markers rather than inventing none', () => {
      const flagged = { ...proven, has_no_available_stats: true, no_stats_reason: 'no_steam_stats' as const }
      const merged = mergePlayData(flagged, noAchievements)
      expect(merged.has_no_available_stats).toBe(true)
      expect(merged.no_stats_reason).toBe('no_steam_stats')
    })

    it('still accepts a game that never had achievements', () => {
      const merged = mergePlayData({ ...noAchievements, playtime_minutes: 100 }, noAchievements)
      expect(merged.has_no_available_stats).toBe(true)
      expect(merged.no_stats_reason).toBe('no_steam_stats')
    })
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

describe('parseSteamGroupMemberIds', () => {
  it('extracts every steamID64 from the members XML', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<memberList>
  <groupID64>103582791429521408</groupID64>
  <members>
    <steamID64>76561198000000001</steamID64>
    <steamID64>76561198000000002</steamID64>
  </members>
</memberList>`
    const ids = parseSteamGroupMemberIds(xml)
    expect(ids).toEqual(
      new Set(['76561198000000001', '76561198000000002']),
    )
  })

  it('returns an empty set when there are no members', () => {
    expect(parseSteamGroupMemberIds('<memberList></memberList>').size).toBe(0)
  })
})

describe('evaluateKickSyncGuard', () => {
  it('does not guard when the Steam group roughly matches the SG roster', () => {
    expect(evaluateKickSyncGuard(130, 127).guarded).toBe(false)
  })

  it('guards when the Steam group looks truncated or blocked', () => {
    // 130 SG members, only 40 came back from the Steam group XML.
    const result = evaluateKickSyncGuard(130, 40)
    expect(result.guarded).toBe(true)
    expect(result.sgRosterSize).toBe(130)
    expect(result.steamGroupSize).toBe(40)
  })

  it('does not guard at exactly half (only fewer than half trips it)', () => {
    expect(evaluateKickSyncGuard(130, 65).guarded).toBe(false)
  })
})

describe('computeKickSyncDecisions', () => {
  const steamGroupIds = new Set(['1', '2'])

  it('flags a real-steam_id user missing from the Steam group', () => {
    const decisions = computeKickSyncDecisions(
      [{ username: 'kicked', steam_id: '3' }],
      steamGroupIds,
    )
    expect(decisions).toEqual([{ username: 'kicked', action: 'flag' }])
  })

  it('does not re-flag a user already marked kicked_pending_sync', () => {
    const decisions = computeKickSyncDecisions(
      [{ username: 'kicked', steam_id: '3', kicked_pending_sync: true }],
      steamGroupIds,
    )
    expect(decisions).toEqual([])
  })

  it('clears a user who reappears in the Steam group', () => {
    const decisions = computeKickSyncDecisions(
      [{ username: 'back', steam_id: '1', kicked_pending_sync: true }],
      steamGroupIds,
    )
    expect(decisions).toEqual([{ username: 'back', action: 'clear' }])
  })

  it('leaves a present, un-flagged user untouched', () => {
    const decisions = computeKickSyncDecisions(
      [{ username: 'fine', steam_id: '1' }],
      steamGroupIds,
    )
    expect(decisions).toEqual([])
  })

  it('skips users with a synthetic steam_id', () => {
    const decisions = computeKickSyncDecisions(
      [{ username: 'nosteam', steam_id: 'username:nosteam' }],
      steamGroupIds,
    )
    expect(decisions).toEqual([])
  })
})

describe('shouldFetchWin', () => {
  const HOUR = 60 * 60 * 1000
  const win = (lastChecked?: number) =>
    ({
      name: 'Game A',
      link: 'abc/a',
      end_timestamp: 1_700_000_000,
      ...(lastChecked === undefined
        ? {}
        : { steam_play_data: { last_checked: lastChecked } }),
    }) as any

  it('fetches a win that has never been checked', () => {
    expect(shouldFetchWin(win(), 'daily')).toBe(true)
  })

  it('fetches a win checked in yesterday\'s run, even short of 24h', () => {
    // The daily cron drifts, so a run can start before the previous run's
    // checks turn a full day old. At a 24h threshold those members scored
    // zero pending wins and sat out an entire extra day.
    expect(shouldFetchWin(win(Date.now() - 23 * HOUR), 'daily')).toBe(true)
  })

  it('leaves a win checked a few hours ago alone', () => {
    expect(shouldFetchWin(win(Date.now() - 6 * HOUR), 'daily')).toBe(false)
  })

  it('fetches everything in all mode', () => {
    expect(shouldFetchWin(win(Date.now()), 'all')).toBe(true)
  })
})

describe('oldestPendingCheck', () => {
  const HOUR = 60 * 60 * 1000
  const giveawayByLink = new Map<string, any>([
    ['abc/a', { link: 'abc/a', app_id: 1 }],
    ['def/b', { link: 'def/b', app_id: 2 }],
    ['ghi/c', { link: 'ghi/c' }],
  ])
  const win = (link: string, lastChecked?: number) =>
    ({
      name: link,
      link,
      end_timestamp: 1_700_000_000,
      ...(lastChecked === undefined
        ? {}
        : { steam_play_data: { last_checked: lastChecked } }),
    }) as any

  it('reports the stalest pending win, not the freshest', () => {
    const stalest = Date.now() - 3 * 24 * HOUR
    const user = {
      username: 'u',
      steam_id: '1',
      giveaways_won: [win('abc/a', Date.now() - 22 * HOUR), win('def/b', stalest)],
    } as any
    expect(oldestPendingCheck(user, giveawayByLink, 'daily')).toBe(stalest)
  })

  it('reports 0 when a win has never been checked', () => {
    const user = {
      username: 'u',
      steam_id: '1',
      giveaways_won: [win('abc/a', Date.now() - 22 * HOUR), win('def/b')],
    } as any
    expect(oldestPendingCheck(user, giveawayByLink, 'daily')).toBe(0)
  })

  it('ignores wins that are not due and giveaways with no Steam id', () => {
    const user = {
      username: 'u',
      steam_id: '1',
      giveaways_won: [win('abc/a', Date.now() - HOUR), win('ghi/c')],
    } as any
    expect(oldestPendingCheck(user, giveawayByLink, 'daily')).toBe(0)
  })
})

describe('pickPersistedFields', () => {
  const base = { username: 'u', steam_id: '1', stats: {} } as unknown as User

  it('copies kick-sync state and play recency from the existing record', () => {
    expect(
      pickPersistedFields({
        ...base,
        kicked_pending_sync: true,
        kick_detected_at: 123,
        last_played_at: 456,
      }),
    ).toEqual({
      kicked_pending_sync: true,
      kick_detected_at: 123,
      last_played_at: 456,
    })
  })

  it('copies the SG profile metadata written after the roster merge', () => {
    expect(
      pickPersistedFields({
        ...base,
        registered_at: 1_500_000_000,
        contributor_level: 4.5,
        last_online_at: 1_700_000_000,
        last_online_checked_at: 1_700_000_001_000,
      }),
    ).toEqual({
      registered_at: 1_500_000_000,
      contributor_level: 4.5,
      last_online_at: 1_700_000_000,
      last_online_checked_at: 1_700_000_001_000,
    })
  })

  it('keeps a null last_online_at and a zero contributor level', () => {
    expect(
      pickPersistedFields({ ...base, last_online_at: null, contributor_level: 0 }),
    ).toEqual({ last_online_at: null, contributor_level: 0 })
  })

  it('returns nothing when the existing record has none of them', () => {
    expect(pickPersistedFields(base)).toEqual({})
  })
})

describe('mergeWithExisting', () => {
  const scraped = {
    username: 'u',
    steam_id: '',
    profile_url: '/user/u',
    avatar_url: '',
    stats: { total_sent_count: 9 },
  } as unknown as User
  const stored = {
    username: 'u',
    steam_id: '76561190000000001',
    profile_url: '/user/u',
    avatar_url: '',
    registered_at: 1_500_000_000,
    contributor_level: 4.5,
    last_online_at: 1_700_000_000,
    last_online_checked_at: 1_700_000_001_000,
    stats: { total_sent_count: 1, fcv_sent_count: 3 },
  } as unknown as User

  it('keeps SG profile metadata the roster scrape cannot supply', () => {
    const merged = mergeWithExisting(scraped, stored)
    expect(merged.registered_at).toBe(1_500_000_000)
    expect(merged.contributor_level).toBe(4.5)
    expect(merged.last_online_at).toBe(1_700_000_000)
    expect(merged.last_online_checked_at).toBe(1_700_000_001_000)
    expect(merged.steam_id).toBe('76561190000000001')
    expect(merged.stats.total_sent_count).toBe(9)
    expect(merged.stats.fcv_sent_count).toBe(3)
  })

  it('lets a value already on the scraped entry win over the stored one', () => {
    const merged = mergeWithExisting(
      { ...scraped, contributor_level: 5, last_online_at: 1_800_000_000 },
      stored,
    )
    expect(merged.contributor_level).toBe(5)
    expect(merged.last_online_at).toBe(1_800_000_000)
    expect(merged.registered_at).toBe(1_500_000_000)
  })
})

describe('findRejoinedExMember', () => {
  const exMember = (username: string, steam_id: string) =>
    ({ username, steam_id, stats: {} }) as unknown as User
  const record = {
    '76561190000000001': exMember('Alice', '76561190000000001'),
    'username:Bob': exMember('Bob', 'username:Bob'),
  }

  it('matches a real Steam ID by key', () => {
    expect(findRejoinedExMember(record, 'Renamed', '76561190000000001')).toBe(
      record['76561190000000001'],
    )
  })

  it('matches a synthetic-keyed record by username, ignoring case', () => {
    expect(findRejoinedExMember(record, 'bob', 'username:bob')).toBe(
      record['username:Bob'],
    )
  })

  it('does not match a real-keyed record by username alone', () => {
    expect(findRejoinedExMember(record, 'Alice', 'username:Alice')).toBeUndefined()
  })

  it('returns nothing for someone who never left', () => {
    expect(findRejoinedExMember(record, 'Carol', '76561190000000003')).toBeUndefined()
    expect(findRejoinedExMember({}, 'Carol', 'username:Carol')).toBeUndefined()
  })
})

describe('restoreRejoinedMember', () => {
  const play = {
    owned: true,
    playtime_minutes: 600,
    playtime_formatted: '10 hours',
    achievements_unlocked: 10,
    achievements_total: 20,
    achievements_percentage: 50,
    never_played: false,
  }
  const scraped = {
    username: 'Alice',
    steam_id: 'username:Alice',
    profile_url: '/user/Alice',
    avatar_url: 'a.png',
    stats: { total_sent_count: 4, first_seen_at: 2_000_000_000 },
  } as unknown as User
  const exMember = {
    username: 'Alice',
    steam_id: '76561190000000001',
    profile_url: '/user/Alice',
    avatar_url: 'old.png',
    steam_profile_url: 'https://steamcommunity.com/profiles/76561190000000001',
    country_code: 'br',
    left_at_timestamp: 1_690_000_000_000,
    kicked_pending_sync: true,
    kick_detected_at: 1_689_000_000_000,
    last_played_at: 1_688_000_000_000,
    registered_at: 1_400_000_000,
    giveaways_won: [
      {
        name: 'Game',
        link: 'abc/game',
        end_timestamp: 1_600_000_000,
        steam_play_data: { ...play, last_checked: 1_689_000_000_000 },
      },
    ],
    stats: { total_sent_count: 1, fcv_sent_count: 2, first_seen_at: 1_500_000_000 },
  } as unknown as User

  it('brings back Steam identity and per-win Steam data', () => {
    const restored = restoreRejoinedMember(scraped, exMember)
    expect(restored.steam_id).toBe('76561190000000001')
    expect(restored.country_code).toBe('br')
    expect(restored.last_played_at).toBe(1_688_000_000_000)
    expect(restored.registered_at).toBe(1_400_000_000)
    expect(restored.giveaways_won?.[0].steam_play_data?.playtime_minutes).toBe(600)
    expect(restored.stats.fcv_sent_count).toBe(2)
  })

  it('takes roster fields from the scraped entry', () => {
    const restored = restoreRejoinedMember(scraped, exMember)
    expect(restored.avatar_url).toBe('a.png')
    expect(restored.stats.total_sent_count).toBe(4)
  })

  it('drops state that only described the departure', () => {
    const restored = restoreRejoinedMember(scraped, exMember)
    expect(restored).not.toHaveProperty('left_at_timestamp')
    expect(restored).not.toHaveProperty('kicked_pending_sync')
    expect(restored).not.toHaveProperty('kick_detected_at')
  })

  it('keeps the original join date', () => {
    expect(restoreRejoinedMember(scraped, exMember).stats.first_seen_at).toBe(1_500_000_000)
  })

  it('stamps a join date when the record never had one', () => {
    const { first_seen_at: _drop, ...stats } = exMember.stats
    const restored = restoreRejoinedMember(scraped, { ...exMember, stats } as User)
    expect(restored.stats.first_seen_at).toBeGreaterThan(1_700_000_000)
  })

  it('does not erase values already resolved on the scraped entry', () => {
    const resolved = { ...scraped, steam_profile_url: 'https://x', country_code: 'us' } as User
    const bare = { ...exMember, steam_profile_url: undefined, country_code: undefined } as User
    const restored = restoreRejoinedMember(resolved, bare)
    expect(restored.steam_profile_url).toBe('https://x')
    expect(restored.country_code).toBe('us')
  })
})

describe('hasPlaytimeBaseline', () => {
  const snapshot = {
    owned: true,
    playtime_minutes: 100,
    playtime_formatted: '1 hour 40 minutes',
    achievements_unlocked: 0,
    achievements_total: 0,
    achievements_percentage: 0,
    never_played: true,
  }

  it('is false for a win with no stored snapshot', () => {
    expect(hasPlaytimeBaseline(undefined)).toBe(false)
  })

  it('is true for a real measurement, including an achievement-less game', () => {
    expect(hasPlaytimeBaseline(snapshot)).toBe(true)
    expect(hasPlaytimeBaseline({ ...snapshot, no_stats_reason: 'no_steam_stats' })).toBe(true)
  })

  it('is false for a snapshot that measured nothing', () => {
    for (const reason of ['library_unavailable', 'package_delisted', 'not_in_library'] as const) {
      expect(hasPlaytimeBaseline({ ...snapshot, playtime_minutes: 0, no_stats_reason: reason })).toBe(false)
    }
  })
})

describe('fetchSteamGroupMemberIds', () => {
  const ok = (body: string) =>
    ({ ok: true, status: 200, text: async () => body }) as Response
  const status = (code: number) =>
    ({ ok: false, status: code, text: async () => '' }) as Response

  it('retries after a 429 and returns the ids once the feed responds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(status(429))
      .mockResolvedValueOnce(ok('<steamID64>1</steamID64><steamID64>2</steamID64>'))
    const ids = await fetchSteamGroupMemberIds(fetchImpl, 3)
    expect(ids).toEqual(new Set(['1', '2']))
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('returns null once every attempt fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(status(429))
    const ids = await fetchSteamGroupMemberIds(fetchImpl, 3)
    expect(ids).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})
