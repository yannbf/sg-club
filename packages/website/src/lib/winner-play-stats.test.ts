import { describe, expect, it } from 'vitest'
import { createCreatorResolver } from '@/lib/creator-resolver'
import {
  buildWinnerPlayStats,
  winnerPlayStatsKey,
} from '@/lib/winner-play-stats'
import type { Giveaway, SteamIdMap, User, UserGroupData } from '@/types'

const STEAM_ID = '76561198000000001'

const steamIdMap: SteamIdMap = {
  [STEAM_ID]: { current: 'NewName', previous: [{ username: 'OldName', changed_at: '2026-01-01' }] },
}

function giveaway(winner: string): Giveaway {
  return {
    id: 'abc',
    name: 'SANABI',
    points: 20,
    copies: 1,
    app_id: 1562700,
    link: 'OPkXn/sanabi',
    created_timestamp: 0,
    start_timestamp: 0,
    end_timestamp: 1,
    region_restricted: false,
    invite_only: false,
    whitelist: false,
    group: true,
    contributor_level: 0,
    comment_count: 0,
    entry_count: 10,
    creator: '76561198000000002',
    winners: [{ name: winner, status: 'received' }],
  }
}

function userGroup(won: NonNullable<User['giveaways_won']>): UserGroupData {
  return {
    lastUpdated: 0,
    users: {
      [STEAM_ID]: {
        username: 'NewName',
        profile_url: '',
        avatar_url: '',
        steam_id: STEAM_ID,
        stats: {} as User['stats'],
        giveaways_won: won,
      },
    },
  }
}

const playedWin = {
  name: 'SANABI',
  link: 'OPkXn/sanabi',
  cv_status: 'FULL_CV' as const,
  status: 'received',
  end_timestamp: 1,
  steam_play_data: {
    owned: true,
    playtime_minutes: 1698,
    playtime_formatted: '28 hours 18 minutes',
    achievements_unlocked: 21,
    achievements_total: 21,
    achievements_percentage: 100,
    never_played: false,
    is_playtime_private: false,
    has_no_available_stats: false,
    last_checked: 0,
  },
}

describe('buildWinnerPlayStats', () => {
  const resolver = createCreatorResolver(steamIdMap)

  it('keys stats by the winner value the giveaway carries', () => {
    const stats = buildWinnerPlayStats(
      [giveaway(STEAM_ID)],
      [userGroup([playedWin])],
      resolver,
    )
    expect(stats[winnerPlayStatsKey(STEAM_ID, 'OPkXn/sanabi')]).toEqual({
      playtime_minutes: 1698,
      achievements_unlocked: 21,
      achievements_total: 21,
    })
  })

  it('matches winners recorded under a previous username', () => {
    const stats = buildWinnerPlayStats(
      [giveaway('OldName')],
      [userGroup([playedWin])],
      resolver,
    )
    expect(stats[winnerPlayStatsKey('OldName', 'OPkXn/sanabi')]).toBeDefined()
  })

  it('keeps attestation and proof-of-play flags without Steam stats', () => {
    const stats = buildWinnerPlayStats(
      [giveaway(STEAM_ID)],
      [
        userGroup([
          {
            ...playedWin,
            steam_play_data: undefined,
            i_played_bro: true,
            required_play: true,
            required_play_meta: { requirements_met: true },
          },
        ]),
      ],
      resolver,
    )
    expect(stats[winnerPlayStatsKey(STEAM_ID, 'OPkXn/sanabi')]).toEqual({
      attested: true,
      required_play: true,
      requirements_met: true,
    })
  })

  it('skips wins with nothing to show', () => {
    const stats = buildWinnerPlayStats(
      [giveaway(STEAM_ID)],
      [
        userGroup([
          {
            ...playedWin,
            steam_play_data: {
              ...playedWin.steam_play_data,
              owned: false,
              has_no_available_stats: true,
            },
          },
        ]),
      ],
      resolver,
    )
    expect(stats).toEqual({})
  })
})
