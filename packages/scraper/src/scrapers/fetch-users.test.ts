import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { SteamGiftsUserFetcher } from './fetch-users'
import type { User, GamePrice } from '../types/steamgifts'

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

  beforeEach(() => {
    fetcher = new SteamGiftsUserFetcher()
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockGamePrices))
  })

  describe('calculateStats', () => {
    it('should calculate a giveaway ratio of -1 when a user has won 3 FCV games without proof of play and sent 0', () => {
      const user: Partial<User> = {
        giveaways_won: [
          {
            name: 'Game A',
            link: 'abc/a',
            cv_status: 'FULL_CV',
            proof_of_play: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game B',
            link: 'def/b',
            cv_status: 'FULL_CV',
            proof_of_play: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game C',
            link: 'ghi/c',
            cv_status: 'FULL_CV',
            proof_of_play: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
        ],
        giveaways_created: [],
      }
      const stats = fetcher.calculateStats(user as User)
      expect(stats.giveaway_ratio).toBe(-1)
    })

    it('should have a ratio of 0 if the user won 3 FCV games but provided proof of play for all', () => {
      const user: Partial<User> = {
        giveaways_won: [
          {
            name: 'Game A',
            link: 'abc/a',
            cv_status: 'FULL_CV',
            proof_of_play: true,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game B',
            link: 'def/b',
            cv_status: 'FULL_CV',
            proof_of_play: true,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game C',
            link: 'ghi/c',
            cv_status: 'FULL_CV',
            proof_of_play: true,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
        ],
        giveaways_created: [],
      }
      const stats = fetcher.calculateStats(user as User)
      expect(stats.giveaway_ratio).toBe(0)
    })

    it('should have a ratio of 0 if the user won 3 FCV games without proof, but sent 1 FCV game', () => {
      const user: Partial<User> = {
        giveaways_won: [
          {
            name: 'Game A',
            link: 'abc/a',
            cv_status: 'FULL_CV',
            proof_of_play: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game B',
            link: 'def/b',
            cv_status: 'FULL_CV',
            proof_of_play: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game C',
            link: 'ghi/c',
            cv_status: 'FULL_CV',
            proof_of_play: false,
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
          },
        ],
      }
      const stats = fetcher.calculateStats(user as User)
      expect(stats.giveaway_ratio).toBe(0)
    })

    it('should calculate ratio based only on FCV games, ignoring RCV and NCV', () => {
      const user: Partial<User> = {
        giveaways_won: [
          {
            name: 'Game A',
            link: 'abc/a',
            cv_status: 'FULL_CV',
            proof_of_play: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game B',
            link: 'def/b',
            cv_status: 'FULL_CV',
            proof_of_play: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game C',
            link: 'ghi/c',
            cv_status: 'FULL_CV',
            proof_of_play: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game A',
            link: 'jkl/a',
            cv_status: 'REDUCED_CV',
            proof_of_play: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'No CV Game',
            link: 'mno/ncv',
            cv_status: 'NO_CV',
            proof_of_play: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
        ],
        giveaways_created: [],
      }
      const stats = fetcher.calculateStats(user as User)
      expect(stats.giveaway_ratio).toBe(-1)
    })

    it('should calculate a ratio of -0.67 for a user who won 5 FCV games and gave 1', () => {
      const user: Partial<User> = {
        giveaways_won: [
          {
            name: 'Game A',
            link: 'abc/a',
            cv_status: 'FULL_CV',
            proof_of_play: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game B',
            link: 'def/b',
            cv_status: 'FULL_CV',
            proof_of_play: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game C',
            link: 'ghi/c',
            cv_status: 'FULL_CV',
            proof_of_play: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game A',
            link: 'jkl/a',
            cv_status: 'FULL_CV',
            proof_of_play: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          },
          {
            name: 'Game B',
            link: 'mno/b',
            cv_status: 'FULL_CV',
            proof_of_play: false,
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
          },
        ],
      }
      const stats = fetcher.calculateStats(user as User)
      expect(stats.giveaway_ratio).toBeCloseTo(-0.666)
    })

    it('should calculate real value stats correctly', () => {
      const user: Partial<User> = {
        giveaways_won: [
          {
            name: 'Game A',
            link: 'abc/a',
            cv_status: 'FULL_CV',
            proof_of_play: false,
            end_timestamp: 0,
            is_shared: false,
            required_play: false,
            status: 'received',
          }, // $10
          {
            name: 'Game B',
            link: 'def/b',
            cv_status: 'REDUCED_CV',
            proof_of_play: false,
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
          },
        ],
      }
      const stats = fetcher.calculateStats(user as User)
      expect(stats.real_total_sent_value).toBe(30)
      expect(stats.real_total_received_value).toBe(20) // 10 (full) + 10 (reduced)
      expect(stats.real_total_value_difference).toBe(10)
    })
  })
})
