import { describe, expect, it } from 'vitest'
import {
  applyVerifyOverrides,
  buildPlayRequiredRows,
  hydratePlayRequiredRows,
  serializePlayRequiredRows,
  isPrNotApplicable,
  matchesIpbCard,
  matchesPrCard,
  summarizeIpbRows,
  summarizeRows,
  parseVerifyOverrides,
  pruneVerifyOverrides,
  verifyOverrideKey,
  type PlayRequiredRow,
  type VerifyOverrideMap,
} from '@/lib/beaten'
import type { BeatenGamesData } from '@/types/beaten'
import type { IpbDiscordData } from '@/types/ipb-discord'
import type { Giveaway, User } from '@/types'

function makeRow(overrides: Partial<PlayRequiredRow> = {}): PlayRequiredRow {
  return {
    key: 'steam1::abcde/game',
    giveawayLink: 'abcde/game',
    giveawayName: 'Game',
    endTimestamp: 0,
    game: {
      name: 'Game',
      appId: 1,
      packageId: null,
      headerImageUrl: null,
      hltbMainStoryHours: null,
      unreleased: false,
      releaseDate: null,
    },
    winner: { steamId: 'steam1', username: 'winner', isExMember: false, avatarUrl: null },
    discord: null,
    type: 'required_play',
    isPlayRequired: true,
    prRegistered: true,
    prSheetStatus: null,
    ipbSheetStatus: null,
    isIpb: false,
    ipbStatus: 'not_submitted',
    steam: {},
    attestation: {
      confirmed: false,
      iPlayedBro: false,
      requiredPlay: true,
      requirementsMet: false,
    },
    beaten: {
      verdict: 'pending',
      marker: null,
      noMarkerReason: null,
      beaten: null,
      unlockTime: null,
      checkedAt: null,
      noDataReason: null,
      resolvedAppId: null,
      resolvedAppName: null,
    },
    likelyBeaten: { isLikely: false },
    ...overrides,
  }
}

describe('verifyOverrideKey', () => {
  it('joins the row key and verify type', () => {
    expect(verifyOverrideKey('steam1::abcde/game', 'play_required')).toBe('steam1::abcde/game:play_required')
  })
})

describe('parseVerifyOverrides', () => {
  it('returns an empty map for null/missing input', () => {
    expect(parseVerifyOverrides(null)).toEqual({})
    expect(parseVerifyOverrides(undefined)).toEqual({})
  })

  it('returns an empty map for malformed JSON', () => {
    expect(parseVerifyOverrides('{not json')).toEqual({})
  })

  it('drops entries with an invalid state or a missing timestamp', () => {
    const raw = JSON.stringify({
      good: { state: 'verified', at: '2026-01-01T00:00:00.000Z' },
      badState: { state: 'maybe', at: '2026-01-01T00:00:00.000Z' },
      missingAt: { state: 'verified' },
      notAnObject: 'nope',
    })
    expect(parseVerifyOverrides(raw)).toEqual({
      good: { state: 'verified', at: '2026-01-01T00:00:00.000Z' },
    })
  })
})

describe('applyVerifyOverrides', () => {
  it('returns rows unchanged when there are no overrides', () => {
    const rows = [makeRow()]
    expect(applyVerifyOverrides(rows, {})).toBe(rows)
  })

  it('flips attestation.confirmed for a play_required override', () => {
    const row = makeRow()
    const overrides: VerifyOverrideMap = {
      [verifyOverrideKey(row.key, 'play_required')]: { state: 'verified', at: new Date().toISOString() },
    }
    const [next] = applyVerifyOverrides([row], overrides)
    expect(next.attestation.confirmed).toBe(true)
  })

  it('flips ipbStatus to verified for an ipb override, and back to submitted/not_submitted on unverify', () => {
    const withDiscord = makeRow({
      key: 'steam1::with-discord/game',
      ipbStatus: 'verified',
      discord: { thread_id: 't1', url: 'https://discord', thread_created_at: '2026-01-01T00:00:00.000Z' } as PlayRequiredRow['discord'],
    })
    const withoutDiscord = makeRow({ key: 'steam1::without-discord/game', ipbStatus: 'verified', discord: null })

    const unverify: VerifyOverrideMap = {
      [verifyOverrideKey(withDiscord.key, 'ipb')]: { state: 'unverified', at: new Date().toISOString() },
    }
    const [nextWithDiscord] = applyVerifyOverrides([withDiscord], unverify)
    expect(nextWithDiscord.ipbStatus).toBe('submitted')

    const [nextWithoutDiscord] = applyVerifyOverrides([withoutDiscord], unverify)
    // different row key, so the override above doesn't apply — sanity-check via its own key instead.
    const unverify2: VerifyOverrideMap = {
      [verifyOverrideKey(withoutDiscord.key, 'ipb')]: { state: 'unverified', at: new Date().toISOString() },
    }
    const [nextWithoutDiscord2] = applyVerifyOverrides([withoutDiscord], unverify2)
    expect(nextWithoutDiscord).toBe(withoutDiscord) // untouched: wrong key
    expect(nextWithoutDiscord2.ipbStatus).toBe('not_submitted')
  })

  it('sets prRegistered for a registered override, without touching attestation.confirmed', () => {
    const row = makeRow({ prRegistered: false })
    const overrides: VerifyOverrideMap = {
      [verifyOverrideKey(row.key, 'play_required')]: { state: 'registered', at: new Date().toISOString() },
    }
    const [next] = applyVerifyOverrides([row], overrides)
    expect(next.prRegistered).toBe(true)
    expect(next.attestation.confirmed).toBe(false)
  })

  it('a verified play_required override also implies prRegistered', () => {
    const row = makeRow({ prRegistered: false })
    const overrides: VerifyOverrideMap = {
      [verifyOverrideKey(row.key, 'play_required')]: { state: 'verified', at: new Date().toISOString() },
    }
    const [next] = applyVerifyOverrides([row], overrides)
    expect(next.prRegistered).toBe(true)
    expect(next.attestation.confirmed).toBe(true)
  })
})

describe('pruneVerifyOverrides', () => {
  it('drops an override once the row already agrees with it', () => {
    const row = makeRow({ attestation: { ...makeRow().attestation, confirmed: true } })
    const overrides: VerifyOverrideMap = {
      [verifyOverrideKey(row.key, 'play_required')]: { state: 'verified', at: new Date().toISOString() },
    }
    expect(pruneVerifyOverrides(overrides, [row])).toEqual({})
  })

  it('keeps an override the row still disagrees with', () => {
    const row = makeRow() // attestation.confirmed: false
    const overrides: VerifyOverrideMap = {
      [verifyOverrideKey(row.key, 'play_required')]: { state: 'verified', at: new Date().toISOString() },
    }
    expect(pruneVerifyOverrides(overrides, [row])).toEqual(overrides)
  })

  it('drops overrides older than 7 days regardless of agreement', () => {
    const row = makeRow()
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    const overrides: VerifyOverrideMap = {
      [verifyOverrideKey(row.key, 'play_required')]: { state: 'verified', at: eightDaysAgo },
    }
    expect(pruneVerifyOverrides(overrides, [row])).toEqual({})
  })

  it('keeps an override for a row that no longer exists in `rows`, until it expires', () => {
    const overrides: VerifyOverrideMap = {
      'gone::gone/game:play_required': { state: 'verified', at: new Date().toISOString() },
    }
    expect(pruneVerifyOverrides(overrides, [])).toEqual(overrides)
  })

  it('drops a registered override once the row is already registered', () => {
    const row = makeRow({ prRegistered: true })
    const overrides: VerifyOverrideMap = {
      [verifyOverrideKey(row.key, 'play_required')]: { state: 'registered', at: new Date().toISOString() },
    }
    expect(pruneVerifyOverrides(overrides, [row])).toEqual({})
  })

  it('keeps a registered override the row still disagrees with', () => {
    const row = makeRow({ prRegistered: false })
    const overrides: VerifyOverrideMap = {
      [verifyOverrideKey(row.key, 'play_required')]: { state: 'registered', at: new Date().toISOString() },
    }
    expect(pruneVerifyOverrides(overrides, [row])).toEqual(overrides)
  })
})

function makeUser(overrides: Partial<User> = {}): User {
  return {
    username: 'winner',
    profile_url: '',
    avatar_url: '',
    stats: {
      total_sent_count: 0,
      total_sent_value: 0,
      total_received_count: 0,
      total_received_value: 0,
      total_gift_difference: 0,
      total_value_difference: 0,
      fcv_sent_count: 0,
      rcv_sent_count: 0,
      ncv_sent_count: 0,
      fcv_received_count: 0,
      rcv_received_count: 0,
      ncv_received_count: 0,
      fcv_gift_difference: 0,
      real_total_sent_count: 0,
      real_total_sent_value: 0,
      real_total_received_count: 0,
      real_total_received_value: 0,
      real_total_gift_difference: 0,
      real_total_value_difference: 0,
      shared_sent_count: 0,
      shared_received_count: 0,
      last_giveaway_created_at: null,
      last_giveaway_won_at: null,
    },
    steam_id: 'steam1',
    ...overrides,
  }
}

function makeGiveaway(overrides: Partial<Giveaway> = {}): Giveaway {
  return {
    id: 'abcde',
    name: 'Game',
    points: 1,
    copies: 1,
    app_id: 0,
    link: 'abcde/game',
    created_timestamp: 0,
    start_timestamp: 0,
    end_timestamp: 0,
    region_restricted: false,
    invite_only: false,
    whitelist: false,
    group: true,
    contributor_level: 0,
    comment_count: 0,
    entry_count: 1,
    creator: 'creator',
    cv_status: 'FULL_CV',
    ...overrides,
  }
}

describe('buildPlayRequiredRows — ipbStatus', () => {
  it('is "submitted", not "verified", for a Play Required sign-off with no i_played_bro', () => {
    const giveaway = makeGiveaway({ app_id: 1 })
    const user = makeUser({
      giveaways_won: [
        {
          name: 'Game',
          link: giveaway.link,
          cv_status: 'FULL_CV',
          status: 'won',
          end_timestamp: 0,
          required_play: true,
          required_play_meta: { requirements_met: true },
        },
      ],
    })
    const ipbDiscord: IpbDiscordData = {
      last_updated: '2026-01-01T00:00:00.000Z',
      wins: {
        'steam1::abcde/game': {
          thread_id: '1',
          url: 'https://discord/1',
          thread_name: 'Game',
        },
      },
      unmatched_threads: [],
    }

    const rows = buildPlayRequiredRows({
      memberUsers: [user],
      exMemberUsers: [],
      giveaways: [giveaway],
      gameData: [],
      beatenGames: null,
      ipbDiscord,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].attestation.confirmed).toBe(true)
    expect(rows[0].ipbStatus).toBe('submitted')
  })

  it('treats a steam_forum submission entry the same as a discord one for submitted/verified', () => {
    const giveaway = makeGiveaway({ app_id: 1 })
    const user = makeUser({
      giveaways_won: [
        { name: 'Game', link: giveaway.link, cv_status: 'FULL_CV', status: 'won', end_timestamp: 0 },
      ],
    })
    const ipbDiscord: IpbDiscordData = {
      last_updated: '2026-01-01T00:00:00.000Z',
      wins: {
        'steam1::abcde/game': {
          source: 'steam_forum',
          thread_id: '123456',
          url: 'https://steamcommunity.com/comment/1',
          thread_name: 'Game',
          owner_discord_name: 'winner',
        },
      },
      unmatched_threads: [],
    }

    const submittedRows = buildPlayRequiredRows({
      memberUsers: [user],
      exMemberUsers: [],
      giveaways: [giveaway],
      gameData: [],
      beatenGames: null,
      ipbDiscord,
    })
    expect(submittedRows[0].ipbStatus).toBe('submitted')
    expect(submittedRows[0].isIpb).toBe(true)

    const verifiedUser = makeUser({
      giveaways_won: [
        {
          name: 'Game',
          link: giveaway.link,
          cv_status: 'FULL_CV',
          status: 'won',
          end_timestamp: 0,
          i_played_bro: true,
        },
      ],
    })
    const verifiedRows = buildPlayRequiredRows({
      memberUsers: [verifiedUser],
      exMemberUsers: [],
      giveaways: [giveaway],
      gameData: [],
      beatenGames: null,
      ipbDiscord,
    })
    expect(verifiedRows[0].ipbStatus).toBe('verified')
  })
})

describe('buildPlayRequiredRows — beatenVerdictFor via package_resolutions', () => {
  it('resolves a package-only giveaway to its resolved app id/name instead of package_only', () => {
    const giveaway = makeGiveaway({ app_id: undefined as unknown as number, package_id: 999 })
    const user = makeUser({
      giveaways_won: [{ name: 'Game', link: giveaway.link, cv_status: 'FULL_CV', status: 'won', end_timestamp: 0, required_play: true }],
    })
    const beatenGames: BeatenGamesData = {
      last_updated: '2026-01-01T00:00:00.000Z',
      games: {
        '123': {
          marker: { apiname: 'WIN', name: 'Finished', global_percent: 10, source: 'test' },
          no_marker_reason: null,
          checked_at: '2026-01-01T00:00:00.000Z',
        },
      },
      wins: {
        'steam1::123': { beaten: true, unlock_time: 1000, no_data_reason: null, checked_at: '2026-01-01T00:00:00.000Z' },
      },
      package_resolutions: { '999': { app_id: 123, app_name: 'Resolved Game' } },
    }

    const rows = buildPlayRequiredRows({
      memberUsers: [user],
      exMemberUsers: [],
      giveaways: [giveaway],
      gameData: [],
      beatenGames,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].beaten.verdict).toBe('beaten_verified')
    expect(rows[0].beaten.resolvedAppId).toBe(123)
    expect(rows[0].beaten.resolvedAppName).toBe('Resolved Game')
  })

  it('falls back to package_only when the package has no resolution', () => {
    const giveaway = makeGiveaway({ app_id: undefined as unknown as number, package_id: 111 })
    const user = makeUser({
      giveaways_won: [{ name: 'Game', link: giveaway.link, cv_status: 'FULL_CV', status: 'won', end_timestamp: 0, required_play: true }],
    })
    const beatenGames: BeatenGamesData = {
      last_updated: '2026-01-01T00:00:00.000Z',
      games: {},
      wins: {},
    }

    const rows = buildPlayRequiredRows({
      memberUsers: [user],
      exMemberUsers: [],
      giveaways: [giveaway],
      gameData: [],
      beatenGames,
    })

    expect(rows[0].beaten.verdict).toBe('package_only')
    expect(rows[0].beaten.resolvedAppId).toBeNull()
  })

  it('surfaces a DLC entry resolved_app_name alongside resolved_app_id', () => {
    const giveaway = makeGiveaway({ app_id: 456 })
    const user = makeUser({
      giveaways_won: [{ name: 'DLC', link: giveaway.link, cv_status: 'FULL_CV', status: 'won', end_timestamp: 0, required_play: true }],
    })
    const beatenGames: BeatenGamesData = {
      last_updated: '2026-01-01T00:00:00.000Z',
      games: {
        '456': {
          marker: { apiname: 'WIN', name: 'Finished', global_percent: 10, source: 'test' },
          no_marker_reason: null,
          checked_at: '2026-01-01T00:00:00.000Z',
          resolved_app_id: 42,
          resolved_app_name: 'Base Game',
        },
      },
      wins: {
        'steam1::456': { beaten: false, unlock_time: null, no_data_reason: null, checked_at: '2026-01-01T00:00:00.000Z' },
      },
    }

    const rows = buildPlayRequiredRows({
      memberUsers: [user],
      exMemberUsers: [],
      giveaways: [giveaway],
      gameData: [],
      beatenGames,
    })

    expect(rows[0].beaten.verdict).toBe('not_beaten')
    expect(rows[0].beaten.resolvedAppId).toBe(42)
    expect(rows[0].beaten.resolvedAppName).toBe('Base Game')
  })
})

describe('not applicable', () => {
  it('isPrNotApplicable is true for NO/NA cells without sign-off only', () => {
    expect(isPrNotApplicable(makeRow({ prSheetStatus: 'no' }))).toBe(true)
    expect(isPrNotApplicable(makeRow({ prSheetStatus: 'na' }))).toBe(true)
    expect(isPrNotApplicable(makeRow({ prSheetStatus: 'yes' }))).toBe(false)
    expect(isPrNotApplicable(makeRow({ prSheetStatus: null }))).toBe(false)
    expect(
      isPrNotApplicable(
        makeRow({ prSheetStatus: 'na', attestation: { ...makeRow().attestation, confirmed: true } }),
      ),
    ).toBe(false)
  })

  it('matches the not_applicable card and leaves pending_verification', () => {
    const na = makeRow({ prSheetStatus: 'na' })
    const pending = makeRow()
    expect(matchesPrCard(na, 'not_applicable')).toBe(true)
    expect(matchesPrCard(na, 'pending_verification')).toBe(false)
    expect(matchesPrCard(pending, 'not_applicable')).toBe(false)
    expect(matchesPrCard(pending, 'pending_verification')).toBe(true)

    const ipbNa = makeRow({ ipbStatus: 'not_applicable', isIpb: true })
    expect(matchesIpbCard(ipbNa, 'not_applicable')).toBe(true)
    expect(matchesIpbCard(ipbNa, 'pending_verification')).toBe(false)
  })

  it('summaries count not applicable rows separately', () => {
    const rows = [
      makeRow({ key: 'a', prSheetStatus: 'na' }),
      makeRow({ key: 'b', prSheetStatus: 'no' }),
      makeRow({ key: 'c' }),
      makeRow({ key: 'd', ipbStatus: 'not_applicable', isIpb: true }),
    ]
    const summary = summarizeRows(rows)
    expect(summary.notApplicable).toBe(2)
    expect(summary.pendingVerification).toBe(2)
    expect(summarizeIpbRows(rows).notApplicable).toBe(1)
  })

  it('parses a not_applicable override', () => {
    const raw = JSON.stringify({
      'steam1::abcde/game:play_required': { state: 'not_applicable', at: '2026-01-01T00:00:00.000Z' },
    })
    expect(parseVerifyOverrides(raw)['steam1::abcde/game:play_required'].state).toBe('not_applicable')
  })

  it('applies not_applicable and unverified overrides to both types', () => {
    const row = makeRow({ prRegistered: false })
    const overrides: VerifyOverrideMap = {
      [verifyOverrideKey(row.key, 'play_required')]: { state: 'not_applicable', at: 'x' },
      [verifyOverrideKey(row.key, 'ipb')]: { state: 'not_applicable', at: 'x' },
    }
    const [na] = applyVerifyOverrides([row], overrides)
    expect(na.attestation.confirmed).toBe(false)
    expect(na.prRegistered).toBe(true)
    expect(na.prSheetStatus).toBe('na')
    expect(na.ipbStatus).toBe('not_applicable')
    expect(na.ipbSheetStatus).toBe('na')

    const reopened = applyVerifyOverrides([na], {
      [verifyOverrideKey(row.key, 'play_required')]: { state: 'unverified', at: 'x' },
      [verifyOverrideKey(row.key, 'ipb')]: { state: 'unverified', at: 'x' },
    })[0]
    expect(reopened.prSheetStatus).toBeNull()
    expect(reopened.ipbSheetStatus).toBeNull()
    expect(reopened.ipbStatus).toBe('not_submitted')
  })

  it('verified overrides set the sheet status to yes', () => {
    const row = makeRow()
    const [v] = applyVerifyOverrides([row], {
      [verifyOverrideKey(row.key, 'play_required')]: { state: 'verified', at: 'x' },
      [verifyOverrideKey(row.key, 'ipb')]: { state: 'verified', at: 'x' },
    })
    expect(v.prSheetStatus).toBe('yes')
    expect(v.ipbSheetStatus).toBe('yes')
  })

  it('prunes a not_applicable override once the row agrees, keeps it otherwise', () => {
    const overrides: VerifyOverrideMap = {
      'steam1::abcde/game:play_required': { state: 'not_applicable', at: new Date().toISOString() },
    }
    expect(pruneVerifyOverrides(overrides, [makeRow({ prSheetStatus: 'no' })])).toEqual({})
    expect(pruneVerifyOverrides(overrides, [makeRow()])).toEqual(overrides)

    const ipbOverrides: VerifyOverrideMap = {
      'steam1::abcde/game:ipb': { state: 'not_applicable', at: new Date().toISOString() },
    }
    expect(pruneVerifyOverrides(ipbOverrides, [makeRow({ ipbStatus: 'not_applicable' })])).toEqual({})
    expect(pruneVerifyOverrides(ipbOverrides, [makeRow()])).toEqual(ipbOverrides)
  })

  it('builds rows for wins that carry only a sheet status', () => {
    const giveaway = makeGiveaway({ app_id: 1 })
    const user = makeUser({
      giveaways_won: [
        {
          name: 'Game',
          link: giveaway.link,
          cv_status: 'FULL_CV',
          status: 'won',
          end_timestamp: 0,
          required_play_sheet_status: 'na',
          ipb_sheet_status: 'no',
        },
      ],
    })
    const rows = buildPlayRequiredRows({
      memberUsers: [user],
      exMemberUsers: [],
      giveaways: [giveaway],
      gameData: [],
      beatenGames: null,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('both')
    expect(rows[0].isPlayRequired).toBe(true)
    expect(rows[0].prRegistered).toBe(true)
    expect(rows[0].prSheetStatus).toBe('na')
    expect(rows[0].ipbSheetStatus).toBe('no')
    expect(rows[0].ipbStatus).toBe('not_applicable')
    expect(isPrNotApplicable(rows[0])).toBe(true)
  })
})

describe('serializePlayRequiredRows / hydratePlayRequiredRows', () => {
  const marker = {
    apiname: 'WIN',
    name: 'Win',
    description: 'Beat it',
    global_percent: 12,
    source: 'steam',
    sh_achievement_id: null,
    any_of_apinames: null,
  } as unknown as NonNullable<PlayRequiredRow['beaten']['marker']>

  function rows(): PlayRequiredRow[] {
    const base = makeRow()
    return [
      makeRow({ key: 'steam1::a/game', giveawayLink: 'a/game', beaten: { ...base.beaten, verdict: 'not_beaten', marker } }),
      makeRow({
        key: 'steam2::a/game',
        giveawayLink: 'a/game',
        winner: { steamId: 'steam2', username: 'other', isExMember: true, avatarUrl: 'x' },
        steam: { playtimeMinutes: 90, playtimeFormatted: '1h 30m' },
        beaten: { ...base.beaten, verdict: 'not_beaten', marker },
      }),
      makeRow({
        key: 'steam1::b/other',
        giveawayLink: 'b/other',
        game: { ...base.game, name: 'Other', appId: null, packageId: 7 },
      }),
    ]
  }

  it('round-trips rows exactly', () => {
    const original = rows()
    expect(hydratePlayRequiredRows(serializePlayRequiredRows(original))).toEqual(original)
  })

  it('stores each distinct game, winner and marker once', () => {
    const payload = serializePlayRequiredRows(rows())
    expect(Object.keys(payload.games)).toHaveLength(2)
    expect(Object.keys(payload.winners)).toHaveLength(2)
    expect(Object.keys(payload.markers)).toHaveLength(1)
    expect(payload.rows[2].beaten.markerId).toBeNull()
  })

  it('keeps differing objects under the same key apart', () => {
    const base = makeRow()
    const original = [
      makeRow(),
      makeRow({ key: 'steam1::c/x', game: { ...base.game, headerImageUrl: 'img' } }),
    ]
    const payload = serializePlayRequiredRows(original)
    expect(Object.keys(payload.games)).toHaveLength(2)
    expect(hydratePlayRequiredRows(payload)).toEqual(original)
  })
})
