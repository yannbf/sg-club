import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  classifyOwnedGames,
  classifyWishlist,
  cvStatusFromCache,
  fetchBundleStatus,
  fetchOwnedGames,
  fetchWishlist,
  mergeMemberOutcomes,
  refreshBundledEntry,
  resolveWishlistOutcome,
  type GameInsightsData,
  type MemberSteamOutcome,
  type SteamListOutcome,
} from './generate-game-insights-data'

const NOW = 1_750_000_000
const PAST = NOW - 86_400
const FUTURE = NOW + 86_400

describe('cvStatusFromCache', () => {
  it('returns null when the app has no cached bundle status', () => {
    expect(cvStatusFromCache(undefined, NOW)).toBeNull()
  })

  it('returns null for a bundled entry cached before CV timestamps existed', () => {
    expect(
      cvStatusFromCache({ fetched_at: '2026-07-18T10:44:07.581Z', bundled: true }, NOW),
    ).toBeNull()
  })

  it('treats an unbundled game as full CV', () => {
    expect(
      cvStatusFromCache(
        {
          fetched_at: '2026-09-05T00:00:00.000Z',
          bundled: false,
          reduced_value_timestamp: null,
          no_value_timestamp: null,
        },
        NOW,
      ),
    ).toBe('FULL_CV')
  })

  it('reports reduced CV once the reduced cutoff has passed', () => {
    expect(
      cvStatusFromCache(
        {
          fetched_at: '2026-09-05T00:00:00.000Z',
          bundled: true,
          reduced_value_timestamp: PAST,
          no_value_timestamp: null,
        },
        NOW,
      ),
    ).toBe('REDUCED_CV')
  })

  it('reports no CV once the no-value cutoff has passed, even without a reduced cutoff', () => {
    expect(
      cvStatusFromCache(
        {
          fetched_at: '2026-09-05T00:00:00.000Z',
          bundled: true,
          reduced_value_timestamp: null,
          no_value_timestamp: PAST,
        },
        NOW,
      ),
    ).toBe('NO_CV')
  })

  it('prefers no CV over reduced CV when both cutoffs have passed', () => {
    expect(
      cvStatusFromCache(
        {
          fetched_at: '2026-09-05T00:00:00.000Z',
          bundled: true,
          reduced_value_timestamp: PAST - 86_400,
          no_value_timestamp: PAST,
        },
        NOW,
      ),
    ).toBe('NO_CV')
  })

  it('falls back to the reduced cutoff while the no-value cutoff is still in the future', () => {
    expect(
      cvStatusFromCache(
        {
          fetched_at: '2026-09-05T00:00:00.000Z',
          bundled: true,
          reduced_value_timestamp: PAST,
          no_value_timestamp: FUTURE,
        },
        NOW,
      ),
    ).toBe('REDUCED_CV')
  })

  it('stays full CV while every cutoff is still in the future', () => {
    expect(
      cvStatusFromCache(
        {
          fetched_at: '2026-09-05T00:00:00.000Z',
          bundled: true,
          reduced_value_timestamp: FUTURE,
          no_value_timestamp: FUTURE,
        },
        NOW,
      ),
    ).toBe('FULL_CV')
  })
})

const read = (...appIds: number[]): SteamListOutcome => ({
  status: 'read',
  appIds: new Set(appIds),
})
const hidden: SteamListOutcome = { status: 'hidden' }
const failed: SteamListOutcome = { status: 'failed' }

describe('classifyOwnedGames', () => {
  it('reads a games array', () => {
    expect(classifyOwnedGames({ response: { game_count: 2, games: [{ appid: 10 }, { appid: 20 }] } })).toEqual(
      read(10, 20),
    )
  })

  it('reads an empty games array as a successful empty library', () => {
    expect(classifyOwnedGames({ response: { game_count: 0, games: [] } })).toEqual(read())
  })

  it('reads an explicit game_count of 0 without a games array', () => {
    expect(classifyOwnedGames({ response: { game_count: 0 } })).toEqual(read())
  })

  it('treats an empty response as hidden game details', () => {
    expect(classifyOwnedGames({ response: {} })).toEqual(hidden)
    expect(classifyOwnedGames({})).toEqual(hidden)
  })

  it('treats a missing body as a failed request', () => {
    expect(classifyOwnedGames(null)).toEqual(failed)
  })
})

describe('classifyWishlist and resolveWishlistOutcome', () => {
  it('reads an items array', () => {
    expect(classifyWishlist({ response: { items: [{ appid: 5 }] } })).toEqual(read(5))
  })

  it('reports an item-less response as hidden until resolved', () => {
    expect(classifyWishlist({ response: {} })).toEqual(hidden)
  })

  it('treats a missing body as a failed request', () => {
    expect(classifyWishlist(null)).toEqual(failed)
  })

  it('resolves an item-less wishlist to empty when the library was read', () => {
    expect(resolveWishlistOutcome(hidden, read(1))).toEqual(read())
  })

  it('keeps an item-less wishlist unreadable when the library was not read', () => {
    expect(resolveWishlistOutcome(hidden, hidden)).toEqual(hidden)
    expect(resolveWishlistOutcome(hidden, failed)).toEqual(hidden)
  })

  it('never upgrades a failed request, whatever the library says', () => {
    expect(resolveWishlistOutcome(failed, read(1))).toEqual(failed)
  })

  it('leaves a read wishlist untouched', () => {
    expect(resolveWishlistOutcome(read(7), hidden)).toEqual(read(7))
  })
})

describe('fetchOwnedGames / fetchWishlist', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const stubFetch = (impl: () => Promise<unknown>) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fn = vi.fn(impl)
    vi.stubGlobal('fetch', fn)
    return fn
  }
  const jsonResponse = (body: unknown, ok = true, status = 200) => ({
    ok,
    status,
    json: async () => body,
  })

  it('classifies a private-profile owned-games answer as hidden', async () => {
    stubFetch(async () => jsonResponse({ response: {} }))
    expect(await fetchOwnedGames('1')).toEqual(hidden)
  })

  it('classifies a public library as read', async () => {
    stubFetch(async () => jsonResponse({ response: { games: [{ appid: 3 }] } }))
    expect(await fetchOwnedGames('1')).toEqual(read(3))
  })

  it('classifies an exhausted retry sequence as failed, not hidden', async () => {
    const fn = stubFetch(async () => jsonResponse({}, false, 500))
    expect(await fetchOwnedGames('1')).toEqual(failed)
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it('classifies a network error on the wishlist as failed', async () => {
    stubFetch(async () => {
      throw new Error('network down')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await fetchWishlist('1')).toEqual(failed)
  })

  it('recovers when a retry succeeds', async () => {
    let calls = 0
    stubFetch(async () =>
      ++calls === 1
        ? jsonResponse({}, false, 429)
        : jsonResponse({ response: { items: [{ appid: 9 }] } }),
    )
    expect(await fetchWishlist('1')).toEqual(read(9))
  })
})

describe('mergeMemberOutcomes', () => {
  const TARGETS = [10, 20, 30]
  const SINCE = 1_700_000_000

  const previousOutput = (
    games: Record<number, { owners?: string[]; wanters?: string[] }>,
    stale?: GameInsightsData['stale_members'],
  ): GameInsightsData => ({
    last_updated: '2026-10-01T00:00:00.000Z',
    total_members: 3,
    members_with_library_data: 3,
    members_with_wishlist_data: 3,
    ...(stale ? { stale_members: stale } : {}),
    games: Object.fromEntries(
      Object.entries(games).map(([appId, g]) => [
        appId,
        { bundled: false, cv_status: null, owners: g.owners ?? [], wanters: g.wanters ?? [] },
      ]),
    ),
  })

  const merge = (
    outcomes: MemberSteamOutcome[],
    previous: GameInsightsData | null,
    nowSeconds = NOW,
  ) => mergeMemberOutcomes({ outcomes, previous, targetAppIds: TARGETS, nowSeconds })

  const sorted = (m: Map<number, Set<string>>, appId: number) => [...(m.get(appId) ?? [])].sort()

  const prev = previousOutput({
    10: { owners: ['a', 'b'], wanters: ['a'] },
    20: { owners: ['a'], wanters: ['b'] },
    30: { owners: [], wanters: ['a', 'b'] },
  })

  it('builds owners and wanters from fresh reads, ignoring non-target apps', () => {
    const r = merge(
      [{ steamId: 'a', library: read(10, 99), wishlist: read(20, 98) }],
      null,
    )
    expect(sorted(r.ownersByApp, 10)).toEqual(['a'])
    expect(sorted(r.wantersByApp, 20)).toEqual(['a'])
    expect([...r.ownersByApp.keys()].sort()).toEqual(TARGETS)
    expect(r.staleMembers).toEqual({})
    expect(r.membersWithLibraryData).toBe(1)
    expect(r.membersWithWishlistData).toBe(1)
  })

  it('lets a fresh read replace the previous snapshot, including a wishlist shrunk to empty', () => {
    const r = merge(
      [
        // Library readable, wishlist item-less: genuinely empty now.
        { steamId: 'a', library: read(30), wishlist: hidden },
        { steamId: 'b', library: read(), wishlist: read(10) },
      ],
      prev,
    )
    expect(sorted(r.ownersByApp, 10)).toEqual([])
    expect(sorted(r.ownersByApp, 30)).toEqual(['a'])
    expect(sorted(r.wantersByApp, 10)).toEqual(['b'])
    expect(sorted(r.wantersByApp, 20)).toEqual([])
    expect(sorted(r.wantersByApp, 30)).toEqual([])
    expect(r.staleMembers).toEqual({})
    expect(r.membersWithLibraryData).toBe(2)
    expect(r.membersWithWishlistData).toBe(2)
  })

  it('carries both owners and wanters for a member whose profile is hidden', () => {
    const r = merge(
      [
        { steamId: 'a', library: hidden, wishlist: hidden },
        { steamId: 'b', library: read(10), wishlist: read() },
      ],
      prev,
    )
    expect(sorted(r.ownersByApp, 10)).toEqual(['a', 'b'])
    expect(sorted(r.ownersByApp, 20)).toEqual(['a'])
    expect(sorted(r.wantersByApp, 10)).toEqual(['a'])
    expect(sorted(r.wantersByApp, 30)).toEqual(['a'])
    expect(r.staleMembers).toEqual({ a: { library_since: NOW, wishlist_since: NOW } })
    expect(r.membersWithLibraryData).toBe(2)
    expect(r.membersWithWishlistData).toBe(2)
  })

  it('carries wanters only when the wishlist request failed but the library was read', () => {
    const r = merge([{ steamId: 'a', library: read(20), wishlist: failed }], prev)
    expect(sorted(r.ownersByApp, 10)).toEqual([])
    expect(sorted(r.ownersByApp, 20)).toEqual(['a'])
    expect(sorted(r.wantersByApp, 10)).toEqual(['a'])
    expect(sorted(r.wantersByApp, 30)).toEqual(['a'])
    expect(r.staleMembers).toEqual({ a: { wishlist_since: NOW } })
  })

  it('carries owners only when the library failed but the wishlist was read', () => {
    const r = merge([{ steamId: 'a', library: failed, wishlist: read() }], prev)
    expect(sorted(r.ownersByApp, 10)).toEqual(['a'])
    expect(sorted(r.wantersByApp, 10)).toEqual([])
    expect(r.staleMembers).toEqual({ a: { library_since: NOW } })
  })

  it('does not carry members who are no longer in the roster', () => {
    const r = merge([{ steamId: 'a', library: hidden, wishlist: hidden }], prev)
    expect(sorted(r.ownersByApp, 10)).toEqual(['a'])
    expect(sorted(r.wantersByApp, 30)).toEqual(['a'])
    expect(Object.keys(r.staleMembers)).toEqual(['a'])
  })

  it('reproduces the previous owners and wanters for current members in a whole-run outage', () => {
    const r = merge(
      [
        { steamId: 'a', library: failed, wishlist: failed },
        { steamId: 'b', library: failed, wishlist: failed },
      ],
      prev,
    )
    for (const appId of TARGETS) {
      expect(sorted(r.ownersByApp, appId)).toEqual(prev.games[appId].owners.slice().sort())
      expect(sorted(r.wantersByApp, appId)).toEqual(prev.games[appId].wanters.slice().sort())
    }
    expect(r.membersWithLibraryData).toBe(2)
    expect(r.membersWithWishlistData).toBe(2)
    expect(Object.keys(r.staleMembers).sort()).toEqual(['a', 'b'])
  })

  it('handles a first run with no previous output', () => {
    const r = merge(
      [
        { steamId: 'a', library: hidden, wishlist: hidden },
        { steamId: 'b', library: read(10), wishlist: read(20) },
      ],
      null,
    )
    expect(sorted(r.ownersByApp, 10)).toEqual(['b'])
    expect(sorted(r.wantersByApp, 20)).toEqual(['b'])
    expect(r.staleMembers).toEqual({})
    expect(r.membersWithLibraryData).toBe(1)
    expect(r.membersWithWishlistData).toBe(1)
  })

  it('only carries games present in both the previous output and the target set', () => {
    const r = mergeMemberOutcomes({
      outcomes: [{ steamId: 'a', library: hidden, wishlist: hidden }],
      previous: previousOutput({ 10: { owners: ['a'] }, 999: { owners: ['a'], wanters: ['a'] } }),
      targetAppIds: [10, 20],
      nowSeconds: NOW,
    })
    expect(sorted(r.ownersByApp, 10)).toEqual(['a'])
    expect(sorted(r.ownersByApp, 20)).toEqual([])
    expect(r.ownersByApp.has(999)).toBe(false)
  })

  it('keeps the original "since" when a member is carried again', () => {
    const stale = previousOutput(
      { 10: { owners: ['a'], wanters: ['a'] } },
      { a: { library_since: SINCE, wishlist_since: SINCE + 5 } },
    )
    const r = merge([{ steamId: 'a', library: hidden, wishlist: hidden }], stale, SINCE + 1000)
    expect(r.staleMembers).toEqual({ a: { library_since: SINCE, wishlist_since: SINCE + 5 } })
  })

  it('clears a stale marker once that list reads successfully, keeping the other', () => {
    const stale = previousOutput(
      { 10: { owners: ['a'], wanters: ['a'] } },
      { a: { library_since: SINCE, wishlist_since: SINCE } },
    )
    const r = merge([{ steamId: 'a', library: read(10), wishlist: failed }], stale, SINCE + 1000)
    expect(r.staleMembers).toEqual({ a: { wishlist_since: SINCE } })

    const cleared = merge([{ steamId: 'a', library: read(10), wishlist: read(10) }], stale)
    expect(cleared.staleMembers).toEqual({})
  })

  it('does not count or mark an unreadable member with nothing to carry', () => {
    const r = merge([{ steamId: 'z', library: hidden, wishlist: hidden }], prev)
    expect(r.membersWithLibraryData).toBe(0)
    expect(r.membersWithWishlistData).toBe(0)
    expect(r.staleMembers).toEqual({})
  })

  it('counts fresh reads and carried members together', () => {
    const r = merge(
      [
        { steamId: 'a', library: read(10), wishlist: read(10) },
        { steamId: 'b', library: hidden, wishlist: hidden },
        { steamId: 'z', library: hidden, wishlist: hidden },
      ],
      prev,
    )
    expect(r.membersWithLibraryData).toBe(2)
    expect(r.membersWithWishlistData).toBe(2)
  })
})

describe('fetchBundleStatus / refreshBundledEntry', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const stubBundleReply = (body: unknown) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
      })),
    )
  }

  const cached = {
    fetched_at: '2026-06-01T00:00:00.000Z',
    bundled: true,
    reduced_value_timestamp: 1_700_000_000,
    no_value_timestamp: null,
  }

  it('reads success with no results as a real "not bundled"', async () => {
    stubBundleReply({ success: true, results: [] })
    expect(await fetchBundleStatus(10)).toEqual({
      bundled: false,
      reduced_value_timestamp: null,
      no_value_timestamp: null,
    })
    const { entry, refreshed } = await refreshBundledEntry(10, undefined)
    expect(refreshed).toBe(true)
    expect(entry).toMatchObject({ bundled: false })
  })

  it('reads a matching result as bundled with its CV timestamps', async () => {
    stubBundleReply({
      success: true,
      results: [
        { app_id: 10, reduced_value_timestamp: 111, no_value_timestamp: 222 },
      ],
    })
    const { entry, refreshed } = await refreshBundledEntry(10, undefined)
    expect(refreshed).toBe(true)
    expect(entry).toMatchObject({
      bundled: true,
      reduced_value_timestamp: 111,
      no_value_timestamp: 222,
    })
  })

  it('treats a reply without success as unreadable rather than "not bundled"', async () => {
    stubBundleReply({ success: false, results: [] })
    await expect(fetchBundleStatus(10)).rejects.toThrow()
  })

  it('caches nothing for an unreadable reply and keeps the existing entry', async () => {
    stubBundleReply({ success: false })
    const kept = await refreshBundledEntry(10, cached)
    expect(kept).toEqual({ entry: cached, refreshed: false })
    expect(cvStatusFromCache(kept.entry, NOW)).toBe('REDUCED_CV')

    const none = await refreshBundledEntry(10, undefined)
    expect(none).toEqual({ entry: undefined, refreshed: false })
  })
})
