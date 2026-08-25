import { describe, expect, it } from 'vitest'
import {
  applyVerifyOverrides,
  parseVerifyOverrides,
  pruneVerifyOverrides,
  verifyOverrideKey,
  type PlayRequiredRow,
  type VerifyOverrideMap,
} from '@/lib/beaten'

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
      noDataReason: null,
      resolvedAppId: null,
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
})
