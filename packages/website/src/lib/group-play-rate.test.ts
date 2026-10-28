import { describe, expect, it } from 'vitest'
import {
  buildGroupPlayRate,
  classifyWinEvidence,
  playRatePercent,
  requiredPlayRatePercent,
} from '@/lib/group-play-rate'
import {
  PLAYED_HLTB_CAP_MINUTES,
  UNKNOWN_LENGTH_PLAYED_MINUTES,
} from '@/lib/play-status'
import type { Giveaway, User } from '@/types'
import { ipbDiscordWinKey, type IpbDiscordData } from '@/types/ipb-discord'

type Win = NonNullable<User['giveaways_won']>[number]
type PlayData = NonNullable<Win['steam_play_data']>

function playData(overrides: Partial<PlayData> = {}): PlayData {
  return {
    owned: true,
    playtime_minutes: 0,
    playtime_formatted: '0 minutes',
    achievements_unlocked: 0,
    achievements_total: 10,
    achievements_percentage: 0,
    never_played: true,
    is_playtime_private: false,
    has_no_available_stats: false,
    last_checked: 0,
    ...overrides,
  }
}

const steamPlayed = playData({
  playtime_minutes: 600,
  achievements_unlocked: 8,
  achievements_percentage: 80,
  never_played: false,
})

function win(link: string, overrides: Partial<Win> = {}): Win {
  return {
    name: link,
    link,
    cv_status: 'FULL_CV',
    status: 'received',
    end_timestamp: 1,
    steam_play_data: steamPlayed,
    ...overrides,
  }
}

function giveaway(link: string, overrides: Partial<Giveaway> = {}): Giveaway {
  return {
    id: link,
    name: link,
    points: 20,
    copies: 1,
    app_id: 1,
    link,
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
    ...overrides,
  }
}

function user(wins: Win[]): User {
  return {
    username: 'member',
    profile_url: '',
    avatar_url: '',
    steam_id: '76561198000000001',
    stats: {} as User['stats'],
    giveaways_won: wins,
  }
}

const noHltb = () => null

function withPlay(overrides: Partial<PlayData>): Win {
  return win('a', { steam_play_data: playData(overrides) })
}

describe('classifyWinEvidence', () => {
  it('is played when unconfirmed but Steam shows play above the bar', () => {
    expect(classifyWinEvidence(win('a'))).toBe('played')
  })

  it('is confirmed when Steam-played and also confirmed', () => {
    expect(classifyWinEvidence(win('a', { i_played_bro: true }))).toBe(
      'confirmed',
    )
    expect(
      classifyWinEvidence(
        win('a', { required_play_meta: { requirements_met: true } }),
      ),
    ).toBe('confirmed')
  })

  it('is confirmed when Steam shows no play but a mod confirmed it', () => {
    expect(
      classifyWinEvidence(
        win('a', { steam_play_data: playData(), i_played_bro: true }),
      ),
    ).toBe('confirmed')
    expect(
      classifyWinEvidence(
        win('a', {
          steam_play_data: playData(),
          required_play_meta: { requirements_met: true },
        }),
      ),
    ).toBe('confirmed')
  })

  it('is confirmed without any Steam data when a mod confirmed play', () => {
    expect(
      classifyWinEvidence(
        win('a', { steam_play_data: undefined, i_played_bro: true }),
      ),
    ).toBe('confirmed')
  })

  it('is unknown without Steam data', () => {
    expect(classifyWinEvidence(win('a', { steam_play_data: undefined }))).toBe(
      'unknown',
    )
  })

  it('is unknown when the library was unreadable and nothing was recorded', () => {
    expect(
      classifyWinEvidence(
        win('a', {
          steam_play_data: playData({
            has_no_available_stats: true,
            no_stats_reason: 'library_unavailable',
          }),
        }),
      ),
    ).toBe('unknown')
  })

  it('is unknown when playtime is private and nothing was recorded', () => {
    expect(
      classifyWinEvidence(
        win('a', { steam_play_data: playData({ is_playtime_private: true }) }),
      ),
    ).toBe('unknown')
  })

  it('is unplayed for zero playtime on a game with no Steam achievement stats', () => {
    expect(
      classifyWinEvidence(
        win('a', {
          steam_play_data: playData({
            has_no_available_stats: true,
            no_stats_reason: 'no_steam_stats',
          }),
        }),
      ),
    ).toBe('unplayed')
  })

  it('is unplayed when some playtime was recorded but short of the bar', () => {
    expect(
      classifyWinEvidence(
        win('a', {
          steam_play_data: playData({
            playtime_minutes: 20,
            has_no_available_stats: true,
            no_stats_reason: 'library_unavailable',
          }),
        }),
      ),
    ).toBe('unplayed')
  })

  it('is unplayed for readable stats with no play', () => {
    expect(classifyWinEvidence(win('a', { steam_play_data: playData() }))).toBe(
      'unplayed',
    )
  })

  describe('played bar', () => {
    it('passes at 10% of achievements', () => {
      expect(
        classifyWinEvidence(
          withPlay({ achievements_unlocked: 1, achievements_total: 10 }),
        ),
      ).toBe('played')
    })

    it('fails at 9% of achievements when the playtime bar is also unmet', () => {
      expect(
        classifyWinEvidence(
          withPlay({ achievements_unlocked: 9, achievements_total: 100 }),
        ),
      ).toBe('unplayed')
    })

    it('ignores never_played and judges from the numbers', () => {
      expect(
        classifyWinEvidence(
          withPlay({
            never_played: true,
            achievements_unlocked: 2,
            achievements_total: 10,
          }),
        ),
      ).toBe('played')
    })

    it('passes on playtime at 25% of the HowLongToBeat main story despite low achievements', () => {
      const play = {
        playtime_minutes: 120,
        achievements_unlocked: 1,
        achievements_total: 100,
      }
      expect(classifyWinEvidence(withPlay(play), 8)).toBe('played')
      expect(
        classifyWinEvidence(withPlay({ ...play, playtime_minutes: 119 }), 8),
      ).toBe('unplayed')
    })

    it('caps the required playtime at the HowLongToBeat cap', () => {
      expect(
        classifyWinEvidence(
          withPlay({ playtime_minutes: PLAYED_HLTB_CAP_MINUTES }),
          500,
        ),
      ).toBe('played')
      expect(
        classifyWinEvidence(
          withPlay({ playtime_minutes: PLAYED_HLTB_CAP_MINUTES - 1 }),
          500,
        ),
      ).toBe('unplayed')
    })

    it('falls back to the unknown-length bar without a HowLongToBeat length', () => {
      const atBar = withPlay({
        playtime_minutes: UNKNOWN_LENGTH_PLAYED_MINUTES,
      })
      const belowBar = withPlay({
        playtime_minutes: UNKNOWN_LENGTH_PLAYED_MINUTES - 1,
      })
      expect(classifyWinEvidence(atBar)).toBe('played')
      expect(classifyWinEvidence(atBar, null)).toBe('played')
      expect(classifyWinEvidence(atBar, 0)).toBe('played')
      expect(classifyWinEvidence(belowBar, null)).toBe('unplayed')
    })

    it('never passes the playtime bar with zero playtime', () => {
      expect(classifyWinEvidence(withPlay({}), 0.1)).toBe('unplayed')
    })
  })

  it('is confirmed when a mod confirmed play that falls below the bar', () => {
    expect(
      classifyWinEvidence(
        win('a', {
          steam_play_data: playData({
            playtime_minutes: 20,
            achievements_unlocked: 1,
            achievements_total: 100,
          }),
          i_played_bro: true,
        }),
      ),
    ).toBe('confirmed')
  })
})

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0)

describe('buildGroupPlayRate', () => {
  it('differs between exclusive and all only by shared wins', () => {
    const giveaways = [
      giveaway('plain'),
      giveaway('required'),
      giveaway('shared', { is_shared: true }),
      giveaway('whitelist', { whitelist: true }),
      giveaway('shared-required', { is_shared: true, required_play: true }),
    ]
    const result = buildGroupPlayRate(
      [
        user([
          win('plain'),
          win('required', { required_play: true, steam_play_data: playData() }),
          win('shared'),
          win('whitelist', { steam_play_data: playData() }),
          win('shared-required', { required_play: true }),
        ]),
      ],
      giveaways,
      noHltb,
      null,
    )

    expect(result.exclusive.overall).toEqual({
      played: 1,
      confirmed: 0,
      unplayed: 1,
    })
    expect(result.exclusive.noRequirement).toEqual({
      played: 1,
      confirmed: 0,
      unplayed: 0,
    })
    expect(result.exclusive.required).toEqual({
      approved: 0,
      played: 0,
      unplayed: 1,
    })
    expect(result.all.overall).toEqual({
      played: 3,
      confirmed: 0,
      unplayed: 2,
    })
    expect(result.all.noRequirement).toEqual({
      played: 2,
      confirmed: 0,
      unplayed: 1,
    })
    expect(result.all.required).toEqual({
      approved: 0,
      played: 1,
      unplayed: 1,
    })
  })

  it('populates the shared row only in the all table', () => {
    const result = buildGroupPlayRate(
      [
        user([
          win('plain'),
          win('shared'),
          win('white', { steam_play_data: playData() }),
        ]),
      ],
      [
        giveaway('plain'),
        giveaway('shared', { is_shared: true }),
        giveaway('white', { whitelist: true }),
      ],
      noHltb,
      null,
    )
    expect(sum(result.exclusive.shared)).toBe(0)
    expect(result.all.shared).toEqual({
      played: 1,
      confirmed: 0,
      unplayed: 1,
    })
  })

  it('splits play-required wins three ways, approval beating Steam evidence', () => {
    const links = [
      'approved-unplayed',
      'approved-played',
      'played',
      'confirmed',
      'unplayed',
      'unknown',
    ]
    const result = buildGroupPlayRate(
      [
        user([
          win('approved-unplayed', {
            required_play: true,
            required_play_meta: { requirements_met: true },
            steam_play_data: playData(),
          }),
          win('approved-played', {
            required_play: true,
            required_play_meta: { requirements_met: true },
          }),
          win('played', { required_play: true }),
          win('confirmed', {
            required_play: true,
            i_played_bro: true,
            steam_play_data: playData(),
          }),
          win('unplayed', { required_play: true, steam_play_data: playData() }),
          win('unknown', { required_play: true, steam_play_data: undefined }),
        ]),
      ],
      links.map((l) => giveaway(l)),
      noHltb,
      null,
    )
    expect(result.exclusive.required).toEqual({
      approved: 2,
      played: 2,
      unplayed: 2,
    })
    expect(sum(result.exclusive.noRequirement)).toBe(0)
  })

  it('counts a submission from Discord, i_played_bro or the sheet once each', () => {
    const wins = [
      win('discord'),
      win('flag', { i_played_bro: true }),
      win('sheet', { ipb_sheet_status: 'na' }),
      win('all-three', { i_played_bro: true, ipb_sheet_status: 'na' }),
      win('none'),
    ]
    const me = user(wins)
    const ipbDiscord: IpbDiscordData = {
      last_updated: '',
      unmatched_threads: [],
      wins: {
        [ipbDiscordWinKey(me.steam_id, 'discord')]: {
          thread_id: '1',
          url: '',
          thread_name: '',
        },
        [ipbDiscordWinKey(me.steam_id, 'all-three')]: {
          thread_id: '2',
          url: '',
          thread_name: '',
        },
      },
    }
    const result = buildGroupPlayRate(
      [me],
      wins.map((w) => giveaway(w.link)),
      noHltb,
      ipbDiscord,
    )
    expect(result.exclusive.ipb).toEqual({ submitted: 4 })
  })

  it('skips deleted wins and wins whose giveaway is not in the counted list', () => {
    const result = buildGroupPlayRate(
      [user([win('kept'), win('gone', { deleted: true }), win('missing')])],
      [giveaway('kept'), giveaway('gone')],
      noHltb,
      null,
    )
    expect(result.exclusive.overall.played).toBe(1)
    expect(sum(result.exclusive.overall)).toBe(1)
  })

  it('counts unreleased wins separately and nowhere else', () => {
    const result = buildGroupPlayRate(
      [user([win('soon', { unreleased: true, steam_play_data: undefined })])],
      [giveaway('soon')],
      noHltb,
      null,
    )
    expect(result.unreleased).toBe(1)
    expect(sum(result.all.overall)).toBe(0)
    expect(result.all.ipb.submitted).toBe(0)
  })

  it('judges each win against the supplied HowLongToBeat length', () => {
    const lowAchievements = {
      playtime_minutes: 120,
      achievements_unlocked: 1,
      achievements_total: 100,
    }
    const result = buildGroupPlayRate(
      [
        user([
          win('slow', { steam_play_data: playData(lowAchievements) }),
          win('quick', { steam_play_data: playData(lowAchievements) }),
        ]),
      ],
      [giveaway('slow', { app_id: 1 }), giveaway('quick', { app_id: 2 })],
      (g) => (g.app_id === 1 ? 40 : 4),
      null,
    )
    expect(result.exclusive.overall.unplayed).toBe(1)
    expect(result.exclusive.overall.played).toBe(1)
  })

  it('aggregates across users', () => {
    const result = buildGroupPlayRate(
      [user([win('a')]), user([win('a', { steam_play_data: playData() })])],
      [giveaway('a')],
      noHltb,
      null,
    )
    expect(result.exclusive.overall.played).toBe(1)
    expect(result.exclusive.overall.unplayed).toBe(1)
  })
})

describe('buildGroupPlayRate unreadable evidence', () => {
  it('counts a win with unreadable Steam stats as not played', () => {
    const result = buildGroupPlayRate(
      [user([win('a', { steam_play_data: undefined }), win('b')])],
      [giveaway('a'), giveaway('b')],
      noHltb,
      null,
    )
    expect(result.exclusive.overall).toEqual({ played: 1, confirmed: 0, unplayed: 1 })
    expect(playRatePercent(result.exclusive.overall)).toBe(50)
  })
})

describe('playRatePercent', () => {
  it('counts played and confirmed over every counted win', () => {
    expect(playRatePercent({ played: 6, confirmed: 2, unplayed: 2 })).toBe(80)
  })

  it('is null when there are no wins', () => {
    expect(playRatePercent({ played: 0, confirmed: 0, unplayed: 0 })).toBeNull()
  })
})

describe('requiredPlayRatePercent', () => {
  it('counts approved and played over every play-required win', () => {
    expect(requiredPlayRatePercent({ approved: 2, played: 1, unplayed: 1 })).toBe(75)
  })

  it('is null when there are no play-required wins', () => {
    expect(requiredPlayRatePercent({ approved: 0, played: 0, unplayed: 0 })).toBeNull()
  })
})
