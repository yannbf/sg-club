import { describe, expect, it } from 'vitest'
import {
  buildGroupPlayRate as buildPlayRate,
  classifyWinProgress,
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

describe('classifyWinProgress', () => {
  it('is complete at 100% of achievements', () => {
    expect(
      classifyWinProgress(withPlay({ achievements_unlocked: 10, achievements_total: 10 })),
    ).toBe('complete')
  })

  it('is played at 25% of achievements, the same bar as never_played', () => {
    expect(
      classifyWinProgress(withPlay({ achievements_unlocked: 25, achievements_total: 100 })),
    ).toBe('played')
  })

  it('is started at 24% of achievements', () => {
    expect(
      classifyWinProgress(withPlay({ achievements_unlocked: 24, achievements_total: 100 })),
    ).toBe('started')
  })

  it('is started with playtime but no achievements unlocked', () => {
    expect(classifyWinProgress(withPlay({ playtime_minutes: 20 }))).toBe('started')
  })

  it('is notStarted with no playtime and no achievements', () => {
    expect(classifyWinProgress(withPlay({}))).toBe('notStarted')
  })

  it('ignores never_played and judges from the numbers', () => {
    expect(
      classifyWinProgress(
        withPlay({ never_played: true, achievements_unlocked: 3, achievements_total: 10 }),
      ),
    ).toBe('played')
  })

  it('judges a game with achievements by them, not by playtime', () => {
    expect(
      classifyWinProgress(
        withPlay({ playtime_minutes: 600, achievements_unlocked: 1, achievements_total: 100 }),
        8,
      ),
    ).toBe('started')
  })

  describe('games without achievements', () => {
    const none = { achievements_total: 0, achievements_unlocked: 0 }

    it('is played at 25% of the HowLongToBeat main story', () => {
      expect(classifyWinProgress(withPlay({ ...none, playtime_minutes: 120 }), 8)).toBe('played')
      expect(classifyWinProgress(withPlay({ ...none, playtime_minutes: 119 }), 8)).toBe('started')
    })

    it('caps the required playtime at the HowLongToBeat cap', () => {
      expect(
        classifyWinProgress(withPlay({ ...none, playtime_minutes: PLAYED_HLTB_CAP_MINUTES }), 500),
      ).toBe('played')
      expect(
        classifyWinProgress(
          withPlay({ ...none, playtime_minutes: PLAYED_HLTB_CAP_MINUTES - 1 }),
          500,
        ),
      ).toBe('started')
    })

    it('falls back to the unknown-length bar without a HowLongToBeat length', () => {
      const atBar = withPlay({ ...none, playtime_minutes: UNKNOWN_LENGTH_PLAYED_MINUTES })
      const belowBar = withPlay({ ...none, playtime_minutes: UNKNOWN_LENGTH_PLAYED_MINUTES - 1 })
      expect(classifyWinProgress(atBar)).toBe('played')
      expect(classifyWinProgress(atBar, null)).toBe('played')
      expect(classifyWinProgress(atBar, 0)).toBe('played')
      expect(classifyWinProgress(belowBar, null)).toBe('started')
    })

    it('stays played, never complete, however long it was played', () => {
      expect(classifyWinProgress(withPlay({ ...none, playtime_minutes: 6000 }), 8)).toBe('played')
    })

    it('is notStarted with zero playtime', () => {
      expect(classifyWinProgress(withPlay(none), 0.1)).toBe('notStarted')
    })
  })

  describe('unreadable Steam stats', () => {
    it('is notStarted without Steam data', () => {
      expect(classifyWinProgress(win('a', { steam_play_data: undefined }))).toBe('notStarted')
    })

    it('is notStarted when the library was unreadable and nothing was recorded', () => {
      expect(
        classifyWinProgress(
          withPlay({ has_no_available_stats: true, no_stats_reason: 'library_unavailable' }),
        ),
      ).toBe('notStarted')
    })

    it('is notStarted when playtime is private and nothing was recorded', () => {
      expect(classifyWinProgress(withPlay({ is_playtime_private: true }))).toBe('notStarted')
    })
  })

  describe('mod confirmation', () => {
    it('is played when a mod confirmed play with no Steam progress', () => {
      expect(classifyWinProgress(win('a', { steam_play_data: playData(), i_played_bro: true }))).toBe(
        'played',
      )
      expect(
        classifyWinProgress(
          win('a', {
            steam_play_data: playData(),
            required_play_meta: { requirements_met: true },
          }),
        ),
      ).toBe('played')
    })

    it('is played without any Steam data when a mod confirmed play', () => {
      expect(
        classifyWinProgress(win('a', { steam_play_data: undefined, i_played_bro: true })),
      ).toBe('played')
    })

    it('is played when confirmed play falls below the bar', () => {
      expect(
        classifyWinProgress(
          win('a', {
            steam_play_data: playData({
              playtime_minutes: 20,
              achievements_unlocked: 1,
              achievements_total: 100,
            }),
            i_played_bro: true,
          }),
        ),
      ).toBe('played')
    })

    it('is complete when confirmed and every achievement is unlocked', () => {
      expect(
        classifyWinProgress(
          win('a', {
            steam_play_data: playData({ achievements_unlocked: 10, achievements_total: 10 }),
            i_played_bro: true,
          }),
        ),
      ).toBe('complete')
    })
  })
})


function buildGroupPlayRate(
  memberUsers: Parameters<typeof buildPlayRate>[0]['memberUsers'],
  giveaways: Parameters<typeof buildPlayRate>[0]['giveaways'],
  hltbHoursFor: Parameters<typeof buildPlayRate>[0]['hltbHoursFor'],
  ipbDiscord: Parameters<typeof buildPlayRate>[0]['ipbDiscord'],
  exMemberUsers: Parameters<typeof buildPlayRate>[0]['memberUsers'] = [],
) {
  return buildPlayRate({ memberUsers, exMemberUsers, giveaways, hltbHoursFor, ipbDiscord })
}

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

    expect(result.members.exclusive.overall).toEqual({ counted: 2, started: 1, played: 1, complete: 0 })
    expect(result.members.exclusive.required).toEqual({
      approved: 0,
      played: 0,
      unplayed: 1,
    })
    expect(result.members.all.overall).toEqual({ counted: 5, started: 3, played: 3, complete: 0 })
    expect(result.members.all.required).toEqual({
      approved: 0,
      played: 1,
      unplayed: 1,
    })
  })

  it('counts shared and whitelist wins only in the all table', () => {
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
    expect(result.members.exclusive.overall.counted).toBe(1)
    expect(result.members.all.overall.counted).toBe(3)
  })

  it('splits play-required wins three ways, approval beating Steam evidence', () => {
    const links = [
      'approved-unplayed',
      'approved-played',
      'played',
      'confirmed',
      'unplayed',
      'unknown',
      'playtime-only',
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
          // Few achievements but enough playtime: in progress for the required
          // row even though the progress tiers judge this game by achievements.
          win('playtime-only', {
            required_play: true,
            steam_play_data: playData({ achievements_unlocked: 0, playtime_minutes: 120 }),
          }),
        ]),
      ],
      links.map((l) => giveaway(l)),
      noHltb,
      null,
    )
    expect(result.members.exclusive.required).toEqual({
      approved: 2,
      played: 3,
      unplayed: 2,
    })
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
    expect(result.members.exclusive.ipb).toEqual({ submitted: 4 })
  })

  it('skips deleted wins and wins whose giveaway is not in the counted list', () => {
    const result = buildGroupPlayRate(
      [user([win('kept'), win('gone', { deleted: true }), win('missing')])],
      [giveaway('kept'), giveaway('gone')],
      noHltb,
      null,
    )
    expect(result.members.exclusive.overall.played).toBe(1)
    expect(result.members.exclusive.overall.counted).toBe(1)
  })

  it('counts unreleased wins separately and nowhere else', () => {
    const result = buildGroupPlayRate(
      [user([win('soon', { unreleased: true, steam_play_data: undefined })])],
      [giveaway('soon')],
      noHltb,
      null,
    )
    expect(result.unreleased).toBe(1)
    expect(result.members.all.overall.counted).toBe(0)
    expect(result.members.all.ipb.submitted).toBe(0)
  })

  it('judges each win against the supplied HowLongToBeat length', () => {
    const lowAchievements = {
      playtime_minutes: 120,
      achievements_unlocked: 0,
      achievements_total: 0,
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
    expect(result.members.exclusive.overall.started).toBe(2)
    expect(result.members.exclusive.overall.played).toBe(1)
  })

  it('tallies an ex-member win only in the withExMembers tables', () => {
    const result = buildGroupPlayRate(
      [user([win('a')])],
      [giveaway('a'), giveaway('b')],
      noHltb,
      null,
      [user([win('b', { steam_play_data: playData() })])],
    )
    expect(result.members.exclusive.overall.counted).toBe(1)
    expect(result.members.all.overall.counted).toBe(1)
    expect(result.withExMembers.exclusive.overall.counted).toBe(2)
    expect(result.withExMembers.all.overall.counted).toBe(2)
  })

  it('leaves both populations equal when there are no ex-members', () => {
    const result = buildGroupPlayRate(
      [user([win('a'), win('s', { required_play: true })])],
      [giveaway('a'), giveaway('s', { is_shared: true })],
      noHltb,
      null,
    )
    expect(result.withExMembers).toEqual(result.members)
  })

  it('aggregates across users', () => {
    const result = buildGroupPlayRate(
      [user([win('a')]), user([win('a', { steam_play_data: playData() })])],
      [giveaway('a')],
      noHltb,
      null,
    )
    expect(result.members.exclusive.overall).toEqual({ counted: 2, started: 1, played: 1, complete: 0 })
  })

  it('tallies each progress tier and keeps started wins out of the required played split', () => {
    const result = buildGroupPlayRate(
      [
        user([
          win('complete', {
            required_play: true,
            steam_play_data: playData({ achievements_unlocked: 10, achievements_total: 10 }),
          }),
          win('played'),
          win('started', {
            required_play: true,
            steam_play_data: playData({ playtime_minutes: 5 }),
          }),
          win('notStarted', { steam_play_data: playData() }),
        ]),
      ],
      ['complete', 'played', 'started', 'notStarted'].map((l) => giveaway(l)),
      noHltb,
      null,
    )
    expect(result.members.exclusive.overall).toEqual({ counted: 4, started: 3, played: 2, complete: 1 })
    expect(result.members.exclusive.required).toEqual({ approved: 0, played: 1, unplayed: 1 })
    expect(playRatePercent(result.members.exclusive.overall)).toBe(50)
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
    expect(result.members.exclusive.overall).toEqual({ counted: 2, started: 1, played: 1, complete: 0 })
    expect(playRatePercent(result.members.exclusive.overall)).toBe(50)
  })
})

describe('playRatePercent', () => {
  it('counts played and confirmed over every counted win', () => {
    expect(playRatePercent({ counted: 10, started: 9, played: 8, complete: 2 })).toBe(80)
  })

  it('is null when there are no wins', () => {
    expect(playRatePercent({ counted: 0, started: 0, played: 0, complete: 0 })).toBeNull()
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
