import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyShLinkPrecedence,
  buildOverrideKey,
  cachedMarkerToGameEntry,
  cachedPlayerCheckToWinEntry,
  cachedWinForMarker,
  checkAnyOfApinamesBeaten,
  checkPlayerBeaten,
  chooseStoredPlayerCheck,
  decideOverrideState,
  isAppResolutionExpired,
  isMarkerEntryExpired,
  isPackageResolutionExpired,
  NEGATIVE_ANSWER_TTL_MS,
  orderMarkerWork,
  parseOverrideSteamHuntersLink,
  parseOverrideSteamLink,
  resolveOverrideAchievement,
  SCHEMA_UNAVAILABLE_TTL_MS,
  shouldKeepCachedMarker,
  type AppResolutionCacheEntry,
  type MarkerCacheEntry,
  type OverrideResolution,
  type PackageResolutionCacheEntry,
  type PlayerCheckCacheEntry,
} from './generate-beaten-data'

// The pipeline reads and writes its JSON files through node:fs; the
// pipeline tests below run it against an in-memory file map keyed by
// basename, with every Steam / Steam Hunters / sheet call mocked.
const mocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  fetchBeatenOverrides: vi.fn(),
  getSchemaAchievements: vi.fn(),
  getGlobalAchievementPercentages: vi.fn(),
  getPlayerAchievementsForApp: vi.fn(),
  checkProfileVisibility: vi.fn(),
  getPackageDetails: vi.fn(),
  getAppDetails: vi.fn(),
  fetchSteamHuntersAchievements: vi.fn(),
  fetchSteamHuntersTags: vi.fn(),
}))

vi.mock('node:fs', () => {
  const base = (p: unknown) => String(p).split('/').pop() as string
  return {
    existsSync: (p: unknown) => mocks.files.has(base(p)),
    readFileSync: (p: unknown) => {
      const content = mocks.files.get(base(p))
      if (content === undefined) throw new Error(`ENOENT ${String(p)}`)
      return content
    },
    writeFileSync: (p: unknown, data: unknown) => {
      mocks.files.set(base(p), String(data))
    },
    mkdirSync: () => undefined,
    appendFileSync: () => undefined,
  }
})
vi.mock('../utils/log-error.js', () => ({ logError: vi.fn() }))
vi.mock('../utils/common.js', () => ({ delay: async () => undefined }))
vi.mock('../api/fetch-proof-of-play.js', () => ({
  GiveawayPointsManager: {
    getInstance: () => ({ fetchBeatenOverrides: mocks.fetchBeatenOverrides }),
  },
}))
vi.mock('../api/fetch-steam-data.js', () => ({
  SteamGameChecker: class {
    getSchemaAchievements = mocks.getSchemaAchievements
    getGlobalAchievementPercentages = mocks.getGlobalAchievementPercentages
    getPlayerAchievementsForApp = mocks.getPlayerAchievementsForApp
    checkProfileVisibility = mocks.checkProfileVisibility
    getPackageDetails = mocks.getPackageDetails
    getAppDetails = mocks.getAppDetails
  },
}))
vi.mock('../api/fetch-steamhunters-data.js', () => ({
  STEAMHUNTERS_DELAY_MS: 0,
  fetchSteamHuntersAchievements: mocks.fetchSteamHuntersAchievements,
  fetchSteamHuntersTags: mocks.fetchSteamHuntersTags,
}))

// The real BEATEN_OVERRIDES row for FINAL FANTASY VII REMAKE INTERGRADE, used
// to verify parsing against actual sheet data.
const FF7R_STEAM_LINK =
  'https://store.steampowered.com/app/1462040/FINAL_FANTASY_VII_REMAKE_INTERGRADE/'
const FF7R_SH_LINK =
  'https://steamhunters.com/apps/1462040/achievements/19/users?unlocked=true'

describe('parseOverrideSteamLink', () => {
  it('parses a store app URL', () => {
    expect(parseOverrideSteamLink(FF7R_STEAM_LINK)).toEqual({ kind: 'app', appId: 1462040 })
  })

  it('parses a store sub URL', () => {
    expect(parseOverrideSteamLink('https://store.steampowered.com/sub/12345/SomeBundle/')).toEqual({
      kind: 'sub',
      packageId: 12345,
    })
  })

  it('parses a steamcommunity app URL', () => {
    expect(parseOverrideSteamLink('https://steamcommunity.com/app/730')).toEqual({
      kind: 'app',
      appId: 730,
    })
  })

  it('parses a bare app id', () => {
    expect(parseOverrideSteamLink('440')).toEqual({ kind: 'app', appId: 440 })
  })

  it('ignores surrounding whitespace', () => {
    expect(parseOverrideSteamLink('  440  ')).toEqual({ kind: 'app', appId: 440 })
  })

  it('returns null for garbage input', () => {
    expect(parseOverrideSteamLink('not a link')).toBeNull()
    expect(parseOverrideSteamLink('https://example.com/app/440')).toBeNull()
    expect(parseOverrideSteamLink('')).toBeNull()
  })
})

const SCHEMA = [
  { name: 'ACH_ENDING', displayName: "Destiny's Crossroads" },
  { name: 'ACH_SECRET_ENDING', displayName: 'True Ending' },
  { name: 'ACH_NO_DISPLAY_NAME' },
]

describe('resolveOverrideAchievement', () => {
  it('matches by display name, case-insensitively', () => {
    expect(resolveOverrideAchievement("destiny's crossroads", SCHEMA)).toEqual({
      apinames: ['ACH_ENDING'],
    })
  })

  it('matches by apiname when no display name matches', () => {
    expect(resolveOverrideAchievement('ach_no_display_name', SCHEMA)).toEqual({
      apinames: ['ACH_NO_DISPLAY_NAME'],
    })
  })

  it('resolves multiple | separated alternatives', () => {
    expect(resolveOverrideAchievement("Destiny's Crossroads | True Ending", SCHEMA)).toEqual({
      apinames: ['ACH_ENDING', 'ACH_SECRET_ENDING'],
    })
  })

  it('treats NONE case-insensitively as "no valid ending achievement"', () => {
    expect(resolveOverrideAchievement('none', SCHEMA)).toEqual({ none: true })
    expect(resolveOverrideAchievement('NONE', SCHEMA)).toEqual({ none: true })
  })

  it('returns null when an alternative cannot be resolved', () => {
    expect(resolveOverrideAchievement('Nonexistent Achievement', SCHEMA)).toBeNull()
    expect(resolveOverrideAchievement("Destiny's Crossroads | Nonexistent", SCHEMA)).toBeNull()
  })
})

describe('parseOverrideSteamHuntersLink', () => {
  it('parses appId and achievementId from the real FF7R link', () => {
    expect(parseOverrideSteamHuntersLink(FF7R_SH_LINK)).toEqual({
      appId: 1462040,
      achievementId: 19,
    })
  })

  it('returns null for a non-matching URL', () => {
    expect(parseOverrideSteamHuntersLink('https://steamhunters.com/apps/1462040')).toBeNull()
  })
})

describe('buildOverrideKey', () => {
  it('builds a NONE signature', () => {
    expect(buildOverrideKey(1462040, { none: true })).toBe('1462040:NONE')
  })

  it('sorts apinames so order does not affect the signature', () => {
    expect(buildOverrideKey(730, { apinames: ['B', 'A'] })).toBe(
      buildOverrideKey(730, { apinames: ['A', 'B'] }),
    )
  })

  it('differs when the apiname set differs', () => {
    expect(buildOverrideKey(730, { apinames: ['A'] })).not.toBe(
      buildOverrideKey(730, { apinames: ['A', 'B'] }),
    )
  })
})

describe('applyShLinkPrecedence', () => {
  it('keeps the name-resolved apinames when there is no SH link', () => {
    expect(applyShLinkPrecedence(['ACH_ENDING'], undefined)).toEqual({
      apinames: ['ACH_ENDING'],
      disagreed: false,
    })
  })

  it('keeps the apinames when the SH link agrees', () => {
    expect(applyShLinkPrecedence(['ACH_ENDING'], 'ACH_ENDING')).toEqual({
      apinames: ['ACH_ENDING'],
      disagreed: false,
    })
  })

  it('the link wins when it disagrees with the name match', () => {
    expect(applyShLinkPrecedence(['ACH_ENDING'], 'ACH_OTHER')).toEqual({
      apinames: ['ACH_OTHER'],
      disagreed: true,
    })
  })
})

const achievement = (apiname: string, achieved: 0 | 1, unlocktime = 0) => ({
  apiname,
  achieved,
  unlocktime,
})

describe('checkAnyOfApinamesBeaten', () => {
  it('is beaten when the single apiname is unlocked', () => {
    expect(checkAnyOfApinamesBeaten([achievement('A', 1, 100)], ['A'])).toEqual({
      found: true,
      beaten: true,
      unlock_time: 100,
    })
  })

  it('is not beaten when the single apiname is locked', () => {
    expect(checkAnyOfApinamesBeaten([achievement('A', 0)], ['A'])).toEqual({
      found: true,
      beaten: false,
      unlock_time: null,
    })
  })

  it('is beaten when any listed apiname is unlocked', () => {
    const achievements = [achievement('A', 0), achievement('B', 1, 200)]
    expect(checkAnyOfApinamesBeaten(achievements, ['A', 'B'])).toEqual({
      found: true,
      beaten: true,
      unlock_time: 200,
    })
  })

  it('uses the earliest unlock time among the unlocked alternatives', () => {
    const achievements = [achievement('A', 1, 300), achievement('B', 1, 100)]
    expect(checkAnyOfApinamesBeaten(achievements, ['A', 'B'])).toEqual({
      found: true,
      beaten: true,
      unlock_time: 100,
    })
  })

  it('found is false when none of the apinames appear in player data at all', () => {
    expect(checkAnyOfApinamesBeaten([achievement('C', 1, 100)], ['A', 'B'])).toEqual({
      found: false,
      beaten: false,
      unlock_time: null,
    })
  })

  it('found is true but beaten is false when apinames appear but are all locked', () => {
    const achievements = [achievement('A', 0), achievement('B', 0)]
    expect(checkAnyOfApinamesBeaten(achievements, ['A', 'B'])).toEqual({
      found: true,
      beaten: false,
      unlock_time: null,
    })
  })
})

const HOUR = 60 * 60 * 1000

const markerOf = (apiname: string, source: 'override' | 'steamhunters' = 'override') => ({
  apiname,
  name: apiname,
  description: '',
  global_percent: 5,
  source,
  sh_achievement_id: 1,
})

const markerEntry = (apiname: string, overrideKey?: string): MarkerCacheEntry => ({
  fetched_at: '2026-01-01T00:00:00.000Z',
  marker: markerOf(apiname),
  no_marker_reason: null,
  story_tag_count: 0,
  ...(overrideKey ? { override_key: overrideKey } : {}),
})

const playerEntry = (
  apiname: string,
  beaten: boolean | null,
  ageMs = HOUR,
): PlayerCheckCacheEntry => ({
  fetched_at: new Date(Date.now() - ageMs).toISOString(),
  marker_apiname: apiname,
  beaten,
  unlock_time: beaten ? 123 : null,
  no_data_reason: beaten === null ? 'profile_private' : null,
})

describe('decideOverrideState', () => {
  const resolution = (partial: Partial<OverrideResolution> = {}): OverrideResolution => ({
    overrides: new Map(),
    undetermined: new Set(),
    authoritative: true,
    ...partial,
  })

  it('applies a resolved row and is stale when the cached key differs', () => {
    const r = resolution({ overrides: new Map([[1, { apinames: ['A'] }]]) })
    expect(decideOverrideState(1, r, '1:B')).toMatchObject({ overrideKey: '1:A', stale: true, held: false })
    expect(decideOverrideState(1, r, '1:A')).toMatchObject({ overrideKey: '1:A', stale: false, held: false })
  })

  it('clears a cached override only when the sheet was read and the row is gone', () => {
    expect(decideOverrideState(1, resolution(), '1:A')).toEqual({
      override: undefined,
      overrideKey: undefined,
      stale: true,
      held: false,
    })
  })

  it('is not stale when there was no override to begin with', () => {
    expect(decideOverrideState(1, resolution(), undefined)).toMatchObject({ stale: false })
  })

  it('keeps the cached override when the sheet was not read', () => {
    expect(decideOverrideState(1, resolution({ authoritative: false }), '1:A')).toEqual({
      override: undefined,
      overrideKey: '1:A',
      stale: false,
      held: true,
    })
  })

  it('keeps the cached override for an app whose row failed to resolve', () => {
    const r = resolution({ undetermined: new Set([1]) })
    expect(decideOverrideState(1, r, '1:A')).toMatchObject({ overrideKey: '1:A', stale: false, held: true })
    // Other apps are unaffected by one app's failure.
    expect(decideOverrideState(2, r, '2:A')).toMatchObject({ stale: true, held: false })
  })

  it('an unresolved row wins over a duplicate row that did resolve', () => {
    const r = resolution({
      overrides: new Map([[1, { apinames: ['A'] }]]),
      undetermined: new Set([1]),
    })
    expect(decideOverrideState(1, r, '1:B')).toMatchObject({ override: undefined, stale: false, held: true })
  })
})

describe('chooseStoredPlayerCheck', () => {
  const NOW = '2026-02-01T00:00:00.000Z'
  const nullResult = {
    beaten: null,
    unlock_time: null,
    no_data_reason: 'profile_private',
  } as const
  const marker = markerOf('A')

  it.each([true, false])(
    'keeps a cached %s verdict computed against the same marker when the fresh result is null',
    (verdict) => {
      const cached = playerEntry('A', verdict, 48 * HOUR)
      const { store, emit } = chooseStoredPlayerCheck(cached, nullResult, marker, NOW)
      expect(store).toBeUndefined()
      expect(emit).toEqual(cachedPlayerCheckToWinEntry(cached))
    },
  )

  it.each([true, false])(
    'keeps a cached %s verdict for another marker but emits the fresh null result',
    (verdict) => {
      const cached = playerEntry('B', verdict, 48 * HOUR)
      const { store, emit } = chooseStoredPlayerCheck(cached, nullResult, marker, NOW)
      expect(store).toBeUndefined()
      expect(emit).toEqual({ ...nullResult, checked_at: NOW })
    },
  )

  it('replaces a cached verdict with a fresh definite one', () => {
    const fresh = { beaten: true, unlock_time: 9, no_data_reason: null }
    const { store, emit } = chooseStoredPlayerCheck(playerEntry('A', false), fresh, marker, NOW)
    expect(store).toEqual({ fetched_at: NOW, marker_apiname: 'A', ...fresh })
    expect(emit).toEqual({ ...fresh, checked_at: NOW })
  })

  it('stores a fresh null when the cached entry is also null or absent', () => {
    expect(chooseStoredPlayerCheck(playerEntry('A', null), nullResult, marker, NOW).store).toEqual({
      fetched_at: NOW,
      marker_apiname: 'A',
      ...nullResult,
    })
    expect(chooseStoredPlayerCheck(undefined, nullResult, marker, NOW).store).toBeDefined()
  })
})

describe('cachedWinForMarker', () => {
  it('only returns an entry computed against the current marker', () => {
    const cached = playerEntry('A', true)
    expect(cachedWinForMarker(cached, markerOf('A'))).toEqual(cachedPlayerCheckToWinEntry(cached))
    expect(cachedWinForMarker(cached, markerOf('B'))).toBeUndefined()
    expect(cachedWinForMarker(undefined, markerOf('A'))).toBeUndefined()
  })
})

describe('cachedMarkerToGameEntry', () => {
  it('carries the marker, reason and resolution of the cached entry', () => {
    const entry: MarkerCacheEntry = {
      ...markerEntry('A', '1:A'),
      resolved_app_id: 7,
      resolved_app_name: 'Base',
    }
    expect(cachedMarkerToGameEntry(entry)).toEqual({
      marker: entry.marker,
      no_marker_reason: null,
      story_tag_count: 0,
      checked_at: entry.fetched_at,
      resolved_app_id: 7,
      resolved_app_name: 'Base',
    })
  })
})

describe('checkPlayerBeaten', () => {
  const marker = markerOf('A')
  const checkerWith = (
    achievements: unknown,
    visibility: { is_public: boolean } = { is_public: true },
  ) => ({
    getPlayerAchievementsForApp: vi.fn().mockResolvedValue(achievements),
    checkProfileVisibility: vi.fn().mockResolvedValue(visibility),
  })

  it('lets a request failure from the achievements lookup propagate', async () => {
    const checker = checkerWith(null)
    checker.getPlayerAchievementsForApp.mockRejectedValue(new Error('429'))
    await expect(checkPlayerBeaten('U', 1, marker, checker as never)).rejects.toThrow('429')
  })

  it('lets a request failure from the visibility check propagate', async () => {
    const checker = checkerWith(null)
    checker.checkProfileVisibility.mockRejectedValue(new Error('timeout'))
    await expect(checkPlayerBeaten('U', 1, marker, checker as never)).rejects.toThrow('timeout')
  })

  it('reads a genuinely empty achievement list as no stats', async () => {
    expect(await checkPlayerBeaten('U', 1, marker, checkerWith([]) as never)).toEqual({
      beaten: null,
      unlock_time: null,
      no_data_reason: 'no_stats',
    })
  })

  it('classifies null as private or no stats by profile visibility', async () => {
    expect((await checkPlayerBeaten('U', 1, marker, checkerWith(null, { is_public: false }) as never)).no_data_reason).toBe(
      'profile_private',
    )
    expect((await checkPlayerBeaten('U', 1, marker, checkerWith(null, { is_public: true }) as never)).no_data_reason).toBe(
      'no_stats',
    )
  })

  it('reports a definite verdict from the player achievements', async () => {
    const checker = checkerWith([{ apiname: 'A', achieved: 1, unlocktime: 50 }])
    expect(await checkPlayerBeaten('U', 1, marker, checker as never)).toEqual({
      beaten: true,
      unlock_time: 50,
      no_data_reason: null,
    })
  })
})

// --- Pipeline runs over an in-memory file map ---

const NOW = Date.parse('2026-10-04T12:00:00.000Z')
const DAY = 24 * HOUR
const isoAt = (ms: number) => new Date(ms).toISOString()
const ago = (ms: number) => isoAt(Date.now() - ms)

const negativeMarker = (
  reason: NonNullable<MarkerCacheEntry['no_marker_reason']>,
  fetchedAt: string,
): MarkerCacheEntry => ({
  fetched_at: fetchedAt,
  marker: null,
  no_marker_reason: reason,
  story_tag_count: 0,
})

describe('negative-answer expiry', () => {
  it('defines the TTLs as 7 days for a missing schema and 30 days for other negatives', () => {
    expect(SCHEMA_UNAVAILABLE_TTL_MS).toBe(7 * DAY)
    expect(NEGATIVE_ANSWER_TTL_MS).toBe(30 * DAY)
  })

  describe('isMarkerEntryExpired', () => {
    it.each([
      ['schema_unavailable', SCHEMA_UNAVAILABLE_TTL_MS],
      ['no_marker_found', NEGATIVE_ANSWER_TTL_MS],
      ['no_achievements', NEGATIVE_ANSWER_TTL_MS],
    ] as const)('%s is fresh just inside its TTL and expired at it', (reason, ttl) => {
      expect(isMarkerEntryExpired(negativeMarker(reason, isoAt(NOW - ttl + 1)), NOW)).toBe(false)
      expect(isMarkerEntryExpired(negativeMarker(reason, isoAt(NOW - ttl)), NOW)).toBe(true)
      expect(isMarkerEntryExpired(negativeMarker(reason, isoAt(NOW - ttl - DAY)), NOW)).toBe(true)
    })

    it('treats a missing or unreadable timestamp as expired', () => {
      const entry = negativeMarker('no_marker_found', '')
      expect(isMarkerEntryExpired(entry, NOW)).toBe(true)
      expect(isMarkerEntryExpired({ ...entry, fetched_at: undefined as unknown as string }, NOW)).toBe(true)
      expect(isMarkerEntryExpired({ ...entry, fetched_at: 'not a date' }, NOW)).toBe(true)
    })

    it('never expires a found marker, however old', () => {
      expect(isMarkerEntryExpired({ ...markerEntry('A'), fetched_at: isoAt(NOW - 1000 * DAY) }, NOW)).toBe(false)
    })

    it('never expires a negative that is not a request outcome', () => {
      const old = isoAt(NOW - 1000 * DAY)
      expect(isMarkerEntryExpired(negativeMarker('override_none', old), NOW)).toBe(false)
      expect(isMarkerEntryExpired(negativeMarker('package', old), NOW)).toBe(false)
    })
  })

  describe('isAppResolutionExpired', () => {
    const unresolved = (fetchedAt: string): AppResolutionCacheEntry => ({
      fetched_at: fetchedAt,
      resolved_app_id: null,
    })

    it('expires an unresolved answer at the TTL boundary', () => {
      expect(isAppResolutionExpired(unresolved(isoAt(NOW - NEGATIVE_ANSWER_TTL_MS + 1)), NOW)).toBe(false)
      expect(isAppResolutionExpired(unresolved(isoAt(NOW - NEGATIVE_ANSWER_TTL_MS)), NOW)).toBe(true)
      expect(isAppResolutionExpired(unresolved(''), NOW)).toBe(true)
    })

    it('never expires a resolved base game', () => {
      expect(
        isAppResolutionExpired({ fetched_at: isoAt(NOW - 1000 * DAY), resolved_app_id: 300 }, NOW),
      ).toBe(false)
    })
  })

  describe('isPackageResolutionExpired', () => {
    const unresolved = (fetchedAt: string): PackageResolutionCacheEntry => ({
      fetched_at: fetchedAt,
      app_id: null,
    })

    it('expires an unresolved answer at the TTL boundary', () => {
      expect(isPackageResolutionExpired(unresolved(isoAt(NOW - NEGATIVE_ANSWER_TTL_MS + 1)), NOW)).toBe(false)
      expect(isPackageResolutionExpired(unresolved(isoAt(NOW - NEGATIVE_ANSWER_TTL_MS)), NOW)).toBe(true)
      expect(isPackageResolutionExpired(unresolved(''), NOW)).toBe(true)
    })

    it('never expires a resolved app', () => {
      expect(
        isPackageResolutionExpired({ fetched_at: isoAt(NOW - 1000 * DAY), app_id: 100 }, NOW),
      ).toBe(false)
    })
  })

  describe('shouldKeepCachedMarker', () => {
    it('keeps a cached marker when the fresh answer has none', () => {
      expect(shouldKeepCachedMarker(markerEntry('A'), { marker: null }, false)).toBe(true)
    })

    it('does not keep it when the fresh answer has a marker', () => {
      expect(shouldKeepCachedMarker(markerEntry('A'), { marker: markerOf('B') }, false)).toBe(false)
    })

    it('lets a negative cached entry or a missing one be replaced', () => {
      const negative = negativeMarker('no_marker_found', isoAt(NOW))
      expect(shouldKeepCachedMarker(negative, { marker: null }, false)).toBe(false)
      expect(shouldKeepCachedMarker(undefined, { marker: null }, false)).toBe(false)
    })

    it('exempts detection driven by an override change', () => {
      expect(shouldKeepCachedMarker(markerEntry('A', '100:A'), { marker: null }, true)).toBe(false)
    })
  })

  describe('orderMarkerWork', () => {
    const markers: Record<string, MarkerCacheEntry> = {
      '1': negativeMarker('no_marker_found', isoAt(NOW - 50 * DAY)),
      '2': negativeMarker('no_marker_found', isoAt(NOW - 90 * DAY)),
      '3': negativeMarker('no_marker_found', isoAt(NOW - 40 * DAY)),
      '4': negativeMarker('no_marker_found', ''),
    }
    const rechecks = new Set([1, 2, 3, 4])

    it('puts every non-recheck first in input order, then rechecks oldest first', () => {
      const order = orderMarkerWork([1, 9, 2, 8, 3, 4], markers, (id) => rechecks.has(id))
      // 4 has no timestamp and counts as oldest.
      expect(order).toEqual([9, 8, 4, 2, 1, 3])
    })

    it('loses and duplicates nothing', () => {
      const ids = [1, 2, 3, 4, 5, 6]
      expect(orderMarkerWork(ids, markers, (id) => rechecks.has(id)).sort()).toEqual(ids)
    })
  })
})

const SCHEMA_TWO = [
  { name: 'A', displayName: 'Ending', description: 'finish the story' },
  { name: 'B', displayName: 'Other', description: 'something else' },
]
const ROW_A = {
  steamLink: 'https://store.steampowered.com/app/100/',
  game: 'Game',
  achievement: 'Ending',
}
const ROW_OTHER_APP = { ...ROW_A, steamLink: 'https://store.steampowered.com/app/200/' }
const SH_LINK_A = 'https://steamhunters.com/apps/100/achievements/1/users'

const unlocked = (apiname: string) => [{ apiname, achieved: 1, unlocktime: 50 }]
const privateProfile = () => {
  mocks.getPlayerAchievementsForApp.mockResolvedValue(null)
  mocks.checkProfileVisibility.mockResolvedValue({ is_public: false })
}

interface Seed {
  markers?: Record<string, MarkerCacheEntry>
  playerChecks?: Record<string, PlayerCheckCacheEntry>
}

function seed({ markers = {}, playerChecks = {} }: Seed) {
  const link = 'https://www.steamgifts.com/giveaway/abcde/game'
  const win = { link, required_play: true }
  mocks.files.set(
    'giveaways.json',
    JSON.stringify({
      giveaways: [{ link, app_id: 100, package_id: null, deleted: false, end_timestamp: 1, entry_count: 5 }],
    }),
  )
  mocks.files.set(
    'group_users.json',
    JSON.stringify({ users: { U1: { giveaways_won: [win] }, U2: { giveaways_won: [win] } } }),
  )
  mocks.files.set(
    'beaten-cache.json',
    JSON.stringify({ markers, player_checks: playerChecks, app_resolutions: {}, package_resolutions: {} }),
  )
}

interface AppSeed {
  appId: number
  /** Win through a package-only giveaway instead of a direct app id. */
  packageId?: number
}

/** Seeds one required-play win per app, for U1, plus the given cache sections. */
function seedApps(
  apps: AppSeed[],
  cacheSections: {
    markers?: Record<string, MarkerCacheEntry>
    appResolutions?: Record<string, AppResolutionCacheEntry>
    packageResolutions?: Record<string, PackageResolutionCacheEntry>
  } = {},
) {
  const giveaways = apps.map(({ appId, packageId }) => ({
    link: `https://www.steamgifts.com/giveaway/g${appId}/game`,
    app_id: packageId == null ? appId : null,
    package_id: packageId ?? null,
    deleted: false,
    end_timestamp: 1,
    entry_count: 5,
  }))
  mocks.files.set('giveaways.json', JSON.stringify({ giveaways }))
  mocks.files.set(
    'group_users.json',
    JSON.stringify({
      users: {
        U1: { giveaways_won: giveaways.map((g) => ({ link: g.link, required_play: true })) },
      },
    }),
  )
  mocks.files.set(
    'beaten-cache.json',
    JSON.stringify({
      markers: cacheSections.markers ?? {},
      player_checks: {},
      app_resolutions: cacheSections.appResolutions ?? {},
      package_resolutions: cacheSections.packageResolutions ?? {},
    }),
  )
}

async function runPipeline(env: Record<string, string> = {}) {
  // Pin every flag the module reads so a local .env cannot change the run.
  const defaults = {
    SKIP_STEAM_API: '',
    SKIP_STEAMHUNTERS: '',
    STEAMHUNTERS_TAGS_FILE: '',
    MARKER_FETCH_CAP: '200',
    MARKER_ENRICH_CAP: '300',
    BEATEN_LIMIT: '',
    BEATEN_PLAYER_LIMIT: '',
  }
  for (const [name, value] of Object.entries({ ...defaults, ...env })) vi.stubEnv(name, value)
  // The module reads its env flags once at import.
  vi.resetModules()
  const mod = await import('./generate-beaten-data')
  await mod.generateBeatenData()
  return {
    output: JSON.parse(mocks.files.get('beaten_games.json')!),
    cache: JSON.parse(mocks.files.get('beaten-cache.json')!),
  }
}

describe('pipeline', () => {
  beforeEach(() => {
    mocks.files.clear()
    for (const fn of Object.values(mocks)) if (typeof fn === 'function') fn.mockReset()
    mocks.fetchBeatenOverrides.mockResolvedValue([])
    mocks.getSchemaAchievements.mockResolvedValue(SCHEMA_TWO)
    mocks.getGlobalAchievementPercentages.mockResolvedValue({ A: 30, B: 10 })
    mocks.getPlayerAchievementsForApp.mockResolvedValue(null)
    mocks.checkProfileVisibility.mockResolvedValue({ is_public: true })
    mocks.fetchSteamHuntersAchievements.mockResolvedValue([
      { apiName: 'A', achievementId: 1 },
      { apiName: 'B', achievementId: 2 },
    ])
    mocks.fetchSteamHuntersTags.mockResolvedValue({
      status: 'ok',
      candidates: [{ apiName: 'B', isDlc: false, isLaterUpdate: false }],
    })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  describe('override state cannot be determined', () => {
    const cachedState = (): Seed => ({
      markers: { '100': markerEntry('A', '100:A') },
      playerChecks: {
        'U1::100': playerEntry('A', true, 48 * HOUR),
        'U2::100': playerEntry('A', false, HOUR),
      },
    })

    const scenarios: Array<[string, () => void, Record<string, string>?]> = [
      ['the sheet fetch fails', () => mocks.fetchBeatenOverrides.mockRejectedValue(new Error('sheet down'))],
      ['the sheet has no usable rows', () => mocks.fetchBeatenOverrides.mockResolvedValue([])],
      [
        'the achievement schema is unavailable for the row',
        () => {
          mocks.fetchBeatenOverrides.mockResolvedValue([ROW_A])
          mocks.getSchemaAchievements.mockResolvedValue(null)
        },
      ],
      [
        'the row names an achievement the schema lacks',
        () => mocks.fetchBeatenOverrides.mockResolvedValue([{ ...ROW_A, achievement: 'Missing' }]),
      ],
      [
        'the Steam Hunters lookup for the row fails',
        () => {
          mocks.fetchBeatenOverrides.mockResolvedValue([{ ...ROW_A, steamHuntersLink: SH_LINK_A }])
          mocks.fetchSteamHuntersAchievements.mockResolvedValue(null)
        },
      ],
      [
        'resolving the row throws',
        () => {
          mocks.fetchBeatenOverrides.mockResolvedValue([ROW_A])
          mocks.getSchemaAchievements.mockRejectedValue(new Error('network'))
        },
      ],
      ['Steam API calls are skipped', () => undefined, { SKIP_STEAM_API: '1' }],
    ]

    it.each(scenarios)('keeps the cached override marker and player checks when %s', async (_name, arrange, env) => {
      const state = cachedState()
      seed(state)
      arrange()

      const { output, cache } = await runPipeline(env)

      expect(cache.markers['100']).toEqual(state.markers!['100'])
      expect(cache.player_checks).toEqual(state.playerChecks)
      expect(output.games['100'].marker.apiname).toBe('A')
      expect(output.wins['U1::100']).toMatchObject({ beaten: true })
      expect(output.wins['U2::100']).toMatchObject({ beaten: false })
      expect(mocks.fetchSteamHuntersTags).not.toHaveBeenCalled()
      expect(mocks.getPlayerAchievementsForApp).not.toHaveBeenCalled()
    })
  })

  describe('the sheet was read and the row is gone', () => {
    const cachedState = (): Seed => ({
      markers: { '100': markerEntry('A', '100:A') },
      playerChecks: {
        'U1::100': playerEntry('A', true, 48 * HOUR),
        'U2::100': playerEntry('A', false, HOUR),
      },
    })

    it('clears the override, keeps a proven verdict through an unreadable check, and re-checks the rest', async () => {
      const state = cachedState()
      seed(state)
      // The sheet now only lists another app; the auto-detected marker is B.
      mocks.fetchBeatenOverrides.mockResolvedValue([ROW_OTHER_APP])
      mocks.getPlayerAchievementsForApp.mockImplementation(async (steamId: string) =>
        steamId === 'U1' ? null : unlocked('B'),
      )
      mocks.checkProfileVisibility.mockResolvedValue({ is_public: false })

      const { output, cache } = await runPipeline()

      expect(cache.markers['100'].override_key).toBeUndefined()
      expect(cache.markers['100'].marker).toMatchObject({ apiname: 'B', source: 'steamhunters' })

      // U1 went private: the proof for the old marker is kept untouched and
      // the output carries the fresh unreadable result for the new marker.
      expect(cache.player_checks['U1::100']).toEqual(state.playerChecks!['U1::100'])
      expect(output.wins['U1::100']).toMatchObject({ beaten: null, no_data_reason: 'profile_private' })

      // U2's not-beaten entry is re-checked and replaced by the fresh verdict.
      expect(mocks.getPlayerAchievementsForApp).toHaveBeenCalledWith('U2', 100)
      expect(cache.player_checks['U2::100']).toMatchObject({ marker_apiname: 'B', beaten: true })
      expect(output.wins['U2::100']).toMatchObject({ beaten: true })
    })

    it('re-checks a not-beaten entry even when the re-detected marker has the same apiname', async () => {
      seed(cachedState())
      mocks.fetchBeatenOverrides.mockResolvedValue([ROW_OTHER_APP])
      mocks.fetchSteamHuntersTags.mockResolvedValue({
        status: 'ok',
        candidates: [{ apiName: 'A', isDlc: false, isLaterUpdate: false }],
      })
      mocks.getPlayerAchievementsForApp.mockResolvedValue(unlocked('A'))

      const { output } = await runPipeline()

      expect(mocks.getPlayerAchievementsForApp).toHaveBeenCalledTimes(1)
      expect(mocks.getPlayerAchievementsForApp).toHaveBeenCalledWith('U2', 100)
      // The proven verdict is not re-checked.
      expect(output.wins['U1::100']).toMatchObject({ beaten: true })
      expect(output.wins['U2::100']).toMatchObject({ beaten: true })
    })
  })

  describe('a marker refresh that cannot complete', () => {
    // The sheet row now names A while the cache holds an override for B.
    const staleState = (): Seed => ({
      markers: { '100': markerEntry('B', '100:B') },
      playerChecks: {
        'U1::100': playerEntry('B', true, 48 * HOUR),
        'U2::100': playerEntry('B', false, HOUR),
      },
    })

    it('emits the cached marker entry when the per-run cap defers the refresh', async () => {
      const state = staleState()
      seed(state)
      mocks.fetchBeatenOverrides.mockResolvedValue([ROW_A])

      const { output, cache } = await runPipeline({ MARKER_FETCH_CAP: '0' })

      expect(output.games['100']).toEqual(cachedMarkerToGameEntry(state.markers!['100']))
      expect(cache.markers['100']).toEqual(state.markers!['100'])
      expect(output.wins['U1::100']).toMatchObject({ beaten: true })
      expect(output.wins['U2::100']).toMatchObject({ beaten: false })
    })

    it('emits the cached marker entry when detection throws', async () => {
      const state = staleState()
      seed(state)
      mocks.fetchBeatenOverrides.mockResolvedValue([ROW_A])
      mocks.getGlobalAchievementPercentages.mockRejectedValue(new Error('network'))

      const { output, cache } = await runPipeline()

      expect(output.games['100']).toEqual(cachedMarkerToGameEntry(state.markers!['100']))
      expect(cache.markers['100']).toEqual(state.markers!['100'])
      expect(cache.player_checks).toEqual(state.playerChecks)
      expect(output.wins['U1::100']).toMatchObject({ beaten: true })
    })
  })

  describe('a player check that cannot produce an answer', () => {
    // The sheet row matches the cached override, so the marker stays A.
    const arrange = (playerChecks: Record<string, PlayerCheckCacheEntry>) => {
      seed({ markers: { '100': markerEntry('A', '100:A') }, playerChecks })
      mocks.fetchBeatenOverrides.mockResolvedValue([ROW_A])
    }

    it('keeps a stale not-beaten verdict when the fresh check is unreadable', async () => {
      const stale = playerEntry('A', false, 20 * HOUR)
      arrange({ 'U1::100': stale })
      privateProfile()

      const { output, cache } = await runPipeline()

      expect(mocks.getPlayerAchievementsForApp).toHaveBeenCalledWith('U1', 100)
      expect(cache.player_checks['U1::100']).toEqual(stale)
      expect(output.wins['U1::100']).toEqual(cachedPlayerCheckToWinEntry(stale))
    })

    it('replaces a stale verdict when the fresh check is definite', async () => {
      arrange({ 'U1::100': playerEntry('A', false, 20 * HOUR) })
      mocks.getPlayerAchievementsForApp.mockResolvedValue(unlocked('A'))

      const { output, cache } = await runPipeline()

      expect(cache.player_checks['U1::100']).toMatchObject({ marker_apiname: 'A', beaten: true })
      expect(output.wins['U1::100']).toMatchObject({ beaten: true })
    })

    it('emits the cached verdict when the check throws', async () => {
      const stale = playerEntry('A', false, 20 * HOUR)
      arrange({ 'U1::100': stale })
      mocks.getPlayerAchievementsForApp.mockRejectedValue(new Error('429'))

      const { output, cache } = await runPipeline()

      expect(cache.player_checks['U1::100']).toEqual(stale)
      expect(output.wins['U1::100']).toEqual(cachedPlayerCheckToWinEntry(stale))
    })

    it('does not emit a verdict computed against another marker when the check throws', async () => {
      const other = playerEntry('B', true, 20 * HOUR)
      arrange({ 'U1::100': other })
      mocks.getPlayerAchievementsForApp.mockRejectedValue(new Error('timeout'))

      const { output, cache } = await runPipeline()

      expect(cache.player_checks['U1::100']).toEqual(other)
      expect(output.wins['U1::100']).toBeUndefined()
    })

    it('never re-checks a beaten verdict for the same marker', async () => {
      const proven = playerEntry('A', true, 400 * HOUR)
      arrange({ 'U1::100': proven })
      privateProfile()

      const { output } = await runPipeline()

      expect(mocks.getPlayerAchievementsForApp).not.toHaveBeenCalledWith('U1', 100)
      expect(output.wins['U1::100']).toEqual(cachedPlayerCheckToWinEntry(proven))
    })
  })

  describe('negative answers expire', () => {
    const notDlc = (ageMs: number): AppResolutionCacheEntry => ({
      fetched_at: ago(ageMs),
      resolved_app_id: null,
    })

    it('re-detects an expired schema_unavailable entry and replaces it with the positive answer', async () => {
      seedApps([{ appId: 100 }], {
        markers: { '100': negativeMarker('schema_unavailable', ago(8 * DAY)) },
        appResolutions: { '100': notDlc(DAY) },
      })

      const { output, cache } = await runPipeline()

      expect(cache.markers['100'].marker).toMatchObject({ apiname: 'B', source: 'steamhunters' })
      expect(cache.markers['100'].no_marker_reason).toBeNull()
      expect(Date.now() - Date.parse(cache.markers['100'].fetched_at)).toBeLessThan(HOUR)
      expect(output.games['100'].marker.apiname).toBe('B')
    })

    it('does not re-detect a schema_unavailable entry inside its TTL', async () => {
      const entry = negativeMarker('schema_unavailable', ago(6 * DAY))
      seedApps([{ appId: 100 }], { markers: { '100': entry }, appResolutions: { '100': notDlc(DAY) } })

      const { output, cache } = await runPipeline()

      expect(mocks.getSchemaAchievements).not.toHaveBeenCalled()
      expect(cache.markers['100']).toEqual(entry)
      expect(output.games['100']).toEqual(cachedMarkerToGameEntry(entry))
    })

    it('re-detects an expired no_marker_found entry and refreshes its timestamp when still negative', async () => {
      const entry = negativeMarker('no_marker_found', ago(31 * DAY))
      seedApps([{ appId: 100 }], { markers: { '100': entry } })
      mocks.getGlobalAchievementPercentages.mockResolvedValue(null)

      const { output, cache } = await runPipeline()

      expect(mocks.getSchemaAchievements).toHaveBeenCalledWith(100)
      expect(cache.markers['100']).toMatchObject({ marker: null, no_marker_reason: 'no_marker_found' })
      expect(Date.parse(cache.markers['100'].fetched_at)).toBeGreaterThan(Date.parse(entry.fetched_at))
      expect(Date.now() - Date.parse(cache.markers['100'].fetched_at)).toBeLessThan(HOUR)
      expect(output.games['100'].no_marker_reason).toBe('no_marker_found')
    })

    it('does not re-detect a no_marker_found entry inside its TTL', async () => {
      seedApps([{ appId: 100 }], { markers: { '100': negativeMarker('no_marker_found', ago(29 * DAY)) } })

      await runPipeline()

      expect(mocks.getSchemaAchievements).not.toHaveBeenCalled()
    })

    it('never re-detects a found marker, however old', async () => {
      const entry = { ...markerEntry('A'), fetched_at: ago(400 * DAY) }
      seedApps([{ appId: 100 }], { markers: { '100': entry } })

      const { cache } = await runPipeline()

      expect(mocks.getSchemaAchievements).not.toHaveBeenCalled()
      expect(cache.markers['100']).toEqual(entry)
    })

    it('an expired not-a-DLC answer no longer suppresses the re-detect, and is re-asked', async () => {
      seedApps([{ appId: 100 }], {
        markers: { '100': negativeMarker('schema_unavailable', ago(DAY)) },
        appResolutions: { '100': notDlc(31 * DAY) },
      })
      mocks.getSchemaAchievements.mockImplementation(async (appId: number) =>
        appId === 300 ? SCHEMA_TWO : null,
      )
      mocks.getAppDetails.mockResolvedValue({ type: 'dlc', fullgameAppId: 300, fullgameName: 'Base' })

      const { cache } = await runPipeline()

      expect(mocks.getAppDetails).toHaveBeenCalledWith(100)
      expect(cache.app_resolutions['100']).toMatchObject({ resolved_app_id: 300, resolved_app_name: 'Base' })
      expect(cache.markers['100']).toMatchObject({ resolved_app_id: 300, marker: { apiname: 'B' } })
    })

    it('keeps a fresh not-a-DLC answer and does not ask appdetails again', async () => {
      seedApps([{ appId: 100 }], {
        markers: { '100': negativeMarker('schema_unavailable', ago(8 * DAY)) },
        appResolutions: { '100': notDlc(29 * DAY) },
      })
      mocks.getSchemaAchievements.mockResolvedValue(null)

      const { cache } = await runPipeline()

      expect(mocks.getAppDetails).not.toHaveBeenCalled()
      expect(cache.markers['100']).toMatchObject({ marker: null, no_marker_reason: 'schema_unavailable' })
    })

    it('refreshes an expired not-a-DLC answer that is still unresolved', async () => {
      const stale = notDlc(31 * DAY)
      seedApps([{ appId: 100 }], {
        markers: { '100': negativeMarker('schema_unavailable', ago(8 * DAY)) },
        appResolutions: { '100': stale },
      })
      mocks.getSchemaAchievements.mockResolvedValue(null)
      mocks.getAppDetails.mockResolvedValue(null)

      const { cache } = await runPipeline()

      expect(mocks.getAppDetails).toHaveBeenCalledWith(100)
      expect(cache.app_resolutions['100'].resolved_app_id).toBeNull()
      expect(Date.parse(cache.app_resolutions['100'].fetched_at)).toBeGreaterThan(Date.parse(stale.fetched_at))
    })

    it('re-asks an expired unresolved package and stores the app it now resolves to', async () => {
      seedApps([{ appId: 0, packageId: 555 }], {
        packageResolutions: { '555': { fetched_at: ago(31 * DAY), app_id: null } },
      })
      mocks.getPackageDetails.mockResolvedValue({ name: 'Game', apps: [{ id: 100, name: 'Game' }] })

      const { output, cache } = await runPipeline()

      expect(mocks.getPackageDetails).toHaveBeenCalledWith(555)
      expect(cache.package_resolutions['555']).toMatchObject({ app_id: 100, app_name: 'Game' })
      expect(output.package_resolutions['555']).toMatchObject({ app_id: 100 })
      expect(output.games['100'].marker.apiname).toBe('B')
    })

    it('refreshes an expired unresolved package that is still unresolved', async () => {
      const stale = { fetched_at: ago(31 * DAY), app_id: null }
      seedApps([{ appId: 0, packageId: 555 }], { packageResolutions: { '555': stale } })
      mocks.getPackageDetails.mockResolvedValue(null)

      const { cache } = await runPipeline()

      expect(cache.package_resolutions['555'].app_id).toBeNull()
      expect(Date.parse(cache.package_resolutions['555'].fetched_at)).toBeGreaterThan(Date.parse(stale.fetched_at))
    })

    it('keeps a fresh unresolved package and a resolved one of any age', async () => {
      seedApps(
        [
          { appId: 0, packageId: 555 },
          { appId: 0, packageId: 556 },
        ],
        {
          packageResolutions: {
            '555': { fetched_at: ago(29 * DAY), app_id: null },
            '556': { fetched_at: ago(400 * DAY), app_id: 100, app_name: 'Game' },
          },
        },
      )

      await runPipeline()

      expect(mocks.getPackageDetails).not.toHaveBeenCalled()
    })

    it('does not re-ask expired negatives when Steam API calls are skipped', async () => {
      const marker = negativeMarker('no_marker_found', ago(60 * DAY))
      const resolution = notDlc(60 * DAY)
      seedApps([{ appId: 100 }], { markers: { '100': marker }, appResolutions: { '100': resolution } })

      const { cache } = await runPipeline({ SKIP_STEAM_API: '1' })

      expect(cache.markers['100']).toEqual(marker)
      expect(cache.app_resolutions['100']).toEqual(resolution)
      expect(mocks.getSchemaAchievements).not.toHaveBeenCalled()
    })

    it('emits the cached entry and loses nothing when the cap defers an expired re-check', async () => {
      const entry = negativeMarker('no_marker_found', ago(60 * DAY))
      seedApps([{ appId: 100 }], { markers: { '100': entry } })

      const { output, cache } = await runPipeline({ MARKER_FETCH_CAP: '0' })

      expect(mocks.getSchemaAchievements).not.toHaveBeenCalled()
      expect(cache.markers['100']).toEqual(entry)
      expect(output.games['100']).toEqual(cachedMarkerToGameEntry(entry))
    })

    it('emits the cached entry when the re-check throws, and leaves it expired for the next run', async () => {
      const entry = negativeMarker('no_marker_found', ago(60 * DAY))
      seedApps([{ appId: 100 }], { markers: { '100': entry } })
      mocks.getSchemaAchievements.mockRejectedValue(new Error('network'))

      const { output, cache } = await runPipeline()

      expect(cache.markers['100']).toEqual(entry)
      expect(output.games['100']).toEqual(cachedMarkerToGameEntry(entry))
    })

    describe('under a per-run cap', () => {
      // Expired apps come first in input order; 300 is the oldest of them.
      const arrange = () => {
        seedApps([{ appId: 100 }, { appId: 300 }, { appId: 200 }], {
          markers: {
            '100': negativeMarker('no_marker_found', ago(40 * DAY)),
            '300': negativeMarker('no_marker_found', ago(80 * DAY)),
          },
        })
      }

      it('detects a new app before any expired re-check', async () => {
        arrange()

        const { output, cache } = await runPipeline({ MARKER_FETCH_CAP: '1' })

        expect(cache.markers['200'].marker).toMatchObject({ apiname: 'B' })
        expect(mocks.getSchemaAchievements).toHaveBeenCalledTimes(1)
        expect(mocks.getSchemaAchievements).toHaveBeenCalledWith(200)
        // The deferred re-checks keep their cached answer in the output.
        expect(output.games['100'].no_marker_reason).toBe('no_marker_found')
        expect(output.games['300'].no_marker_reason).toBe('no_marker_found')
        expect(Object.keys(output.games).sort()).toEqual(['100', '200', '300'])
      })

      it('spends the remaining budget on expired re-checks, oldest first', async () => {
        arrange()

        const { cache } = await runPipeline({ MARKER_FETCH_CAP: '2' })

        expect(mocks.getSchemaAchievements.mock.calls.map(([appId]) => appId)).toEqual([200, 300])
        expect(cache.markers['300'].marker).toMatchObject({ apiname: 'B' })
        expect(cache.markers['100'].marker).toBeNull()
        expect(Date.now() - Date.parse(cache.markers['100'].fetched_at)).toBeGreaterThan(39 * DAY)
      })
    })
  })

  describe('a cached marker is not downgraded', () => {
    it('is replaced when the override that produced it is removed, as before', async () => {
      seedApps([{ appId: 100 }], { markers: { '100': markerEntry('A', '100:A') } })
      mocks.fetchBeatenOverrides.mockResolvedValue([ROW_OTHER_APP])
      mocks.getGlobalAchievementPercentages.mockResolvedValue(null)

      const { cache } = await runPipeline()

      expect(cache.markers['100']).toMatchObject({ marker: null, no_marker_reason: 'no_marker_found' })
    })
  })
})
