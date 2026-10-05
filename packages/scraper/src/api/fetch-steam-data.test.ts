import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/log-error.js', () => ({ logError: vi.fn() }))

import { SteamGameChecker } from './fetch-steam-data'

type Route = (url: string) => Response | Promise<Response>

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

/** Stub global fetch with the first route whose key is contained in the URL. */
function stubFetch(routes: Record<string, Route>) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    for (const [needle, route] of Object.entries(routes)) {
      if (url.includes(needle)) return route(url)
    }
    throw new Error(`unrouted request: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const newChecker = () => new SteamGameChecker('test-key')

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('getPlayerAchievementsForApp', () => {
  const achievements = (list: { apiname: string; achieved: number }[]) =>
    json({ playerstats: { success: true, achievements: list } })

  it('returns the list on a successful response', async () => {
    stubFetch({
      GetPlayerAchievements: () =>
        achievements([
          { apiname: 'A', achieved: 1 },
          { apiname: 'B', achieved: 0 },
        ]),
    })
    const result = await newChecker().getPlayerAchievementsForApp('1', 10)
    expect(result).toHaveLength(2)
  })

  it('returns [] only for a successful response that lists no achievements', async () => {
    stubFetch({
      GetPlayerAchievements: () => json({ playerstats: { success: true } }),
    })
    expect(await newChecker().getPlayerAchievementsForApp('1', 10)).toEqual([])
  })

  it('returns null when the app has no stats', async () => {
    stubFetch({
      GetPlayerAchievements: () =>
        json(
          { playerstats: { error: 'Requested app has no stats', success: false } },
          400,
        ),
    })
    expect(await newChecker().getPlayerAchievementsForApp('1', 10)).toBeNull()
  })

  it('returns null when the profile is not public', async () => {
    stubFetch({
      GetPlayerAchievements: () =>
        json(
          { playerstats: { error: 'Profile is not public', success: false } },
          403,
        ),
    })
    expect(await newChecker().getPlayerAchievementsForApp('1', 10)).toBeNull()
  })

  it.each([429, 500, 503])('throws on HTTP %i', async (status) => {
    stubFetch({ GetPlayerAchievements: () => new Response('', { status }) })
    await expect(
      newChecker().getPlayerAchievementsForApp('1', 10),
    ).rejects.toThrow()
  })

  it('throws on a 200 body reporting success=false', async () => {
    stubFetch({
      GetPlayerAchievements: () => json({ playerstats: { success: false } }),
    })
    await expect(
      newChecker().getPlayerAchievementsForApp('1', 10),
    ).rejects.toThrow(/success=false/)
  })

  it('throws when the request itself fails', async () => {
    stubFetch({
      GetPlayerAchievements: () => {
        throw new Error('network down')
      },
    })
    await expect(
      newChecker().getPlayerAchievementsForApp('1', 10),
    ).rejects.toThrow('network down')
  })
})

describe('checkProfileVisibility', () => {
  const summary = (players: { communityvisibilitystate: number }[]) =>
    json({ response: { players } })

  it('reports a public profile', async () => {
    stubFetch({
      GetPlayerSummaries: () => summary([{ communityvisibilitystate: 3 }]),
    })
    expect(await newChecker().checkProfileVisibility('1')).toEqual({
      is_public: true,
      visibility_state: 3,
    })
  })

  it('reports a private profile', async () => {
    stubFetch({
      GetPlayerSummaries: () => summary([{ communityvisibilitystate: 1 }]),
    })
    expect(await newChecker().checkProfileVisibility('1')).toEqual({
      is_public: false,
      visibility_state: 1,
    })
  })

  it('treats "no player found" as private', async () => {
    stubFetch({ GetPlayerSummaries: () => summary([]) })
    expect(await newChecker().checkProfileVisibility('1')).toEqual({
      is_public: false,
      visibility_state: 0,
    })
  })

  it('throws on an HTTP failure instead of reporting private', async () => {
    stubFetch({ GetPlayerSummaries: () => new Response('', { status: 429 }) })
    await expect(newChecker().checkProfileVisibility('1')).rejects.toThrow()
  })

  it('throws when the request itself fails', async () => {
    stubFetch({
      GetPlayerSummaries: () => {
        throw new Error('network down')
      },
    })
    await expect(newChecker().checkProfileVisibility('1')).rejects.toThrow(
      'network down',
    )
  })
})

describe('getGameAppsForSubId', () => {
  const pkg = (appIds: number[]) =>
    json({
      '99': {
        success: true,
        data: {
          name: 'Bundle',
          apps: appIds.map((id) => ({ id, name: `App ${id}` })),
        },
      },
    })
  const app = (id: number, type = 'game') =>
    json({
      [String(id)]: {
        success: true,
        data: { type, steam_appid: id, name: `Game ${id}` },
      },
    })

  /** The 1s pause between member lookups needs the clock driven by hand. */
  async function settle<T>(promise: Promise<T>): Promise<T> {
    const outcome = promise.then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    await vi.runAllTimersAsync()
    const result = await outcome
    if ('error' in result) throw result.error
    return result.value
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('resolves every member app of a package', async () => {
    stubFetch({
      packagedetails: () => pkg([1, 2, 3]),
      'appids=1': () => app(1),
      'appids=2': () => app(2),
      'appids=3': () => app(3),
    })
    for (const options of [undefined, { strict: true }]) {
      const games = await settle(newChecker().getGameAppsForSubId(99, options))
      expect(games.map((g) => g.appId)).toEqual([1, 2, 3])
    }
  })

  it('lenient mode returns the apps that resolved when one lookup fails', async () => {
    stubFetch({
      packagedetails: () => pkg([1, 2, 3]),
      'appids=1': () => app(1),
      'appids=2': () => new Response('', { status: 500 }),
      'appids=3': () => app(3),
    })
    const games = await settle(newChecker().getGameAppsForSubId(99))
    expect(games.map((g) => g.appId)).toEqual([1, 3])
  })

  it('strict mode throws when a member lookup fails with an HTTP error', async () => {
    stubFetch({
      packagedetails: () => pkg([1, 2, 3]),
      'appids=1': () => app(1),
      'appids=2': () => new Response('', { status: 429 }),
      'appids=3': () => app(3),
    })
    await expect(
      settle(newChecker().getGameAppsForSubId(99, { strict: true })),
    ).rejects.toThrow(/2/)
  })

  it('strict mode throws when a member lookup throws', async () => {
    stubFetch({
      packagedetails: () => pkg([1, 2]),
      'appids=1': () => app(1),
      'appids=2': () => {
        throw new Error('socket hang up')
      },
    })
    await expect(
      settle(newChecker().getGameAppsForSubId(99, { strict: true })),
    ).rejects.toThrow()
  })

  it('strict mode does not treat a resolved non-game member as a failure', async () => {
    stubFetch({
      packagedetails: () => pkg([1, 2]),
      'appids=1': () => app(1),
      'appids=2': () => app(2, 'dlc'),
    })
    const games = await settle(
      newChecker().getGameAppsForSubId(99, { strict: true }),
    )
    expect(games.map((g) => g.appId)).toEqual([1])
  })

  it('strict mode throws when the package request itself fails', async () => {
    stubFetch({ packagedetails: () => new Response('', { status: 503 }) })
    await expect(
      settle(newChecker().getGameAppsForSubId(99, { strict: true })),
    ).rejects.toThrow()
    expect(await settle(newChecker().getGameAppsForSubId(99))).toEqual([])
  })

  it('returns [] for a package the store reports as unavailable, even in strict mode', async () => {
    stubFetch({ packagedetails: () => json({ '99': { success: false } }) })
    expect(
      await settle(newChecker().getGameAppsForSubId(99, { strict: true })),
    ).toEqual([])
  })

  it('getAppIdForSubId stays lenient', async () => {
    stubFetch({
      packagedetails: () => pkg([1, 2]),
      'appids=1': () => new Response('', { status: 500 }),
      'appids=2': () => app(2),
    })
    expect(await settle(newChecker().getAppIdForSubId(99))).toBe(2)
  })
})

describe('getGamePlayData', () => {
  const owned = (games: { appid: number; playtime_forever: number }[]) =>
    json({ response: { games } })

  beforeEach(() => {
    vi.useFakeTimers()
  })

  async function settle<T>(promise: Promise<T>): Promise<T> {
    const outcome = promise.then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    await vi.runAllTimersAsync()
    const result = await outcome
    if ('error' in result) throw result.error
    return result.value
  }

  it('does not record a failed achievements request as 0 of 0', async () => {
    stubFetch({
      GetOwnedGames: () => owned([{ appid: 10, playtime_forever: 300 }]),
      GetPlayerAchievements: () => new Response('', { status: 429 }),
    })
    await expect(
      settle(newChecker().getGamePlayData('1', 10, 'app')),
    ).rejects.toThrow()
  })

  it('still reports owned playtime for a game with no achievement stats', async () => {
    stubFetch({
      GetOwnedGames: () => owned([{ appid: 10, playtime_forever: 300 }]),
      GetPlayerAchievements: () =>
        json(
          { playerstats: { error: 'Requested app has no stats', success: false } },
          400,
        ),
    })
    const data = await settle(newChecker().getGamePlayData('1', 10, 'app'))
    expect(data.owned).toBe(true)
    expect(data.playtime_minutes).toBe(300)
    expect(data.no_stats_reason).toBe('no_steam_stats')
  })

  it('aborts a package pull when a member app could not be resolved', async () => {
    stubFetch({
      packagedetails: () =>
        json({
          '99': {
            success: true,
            data: {
              name: 'Bundle',
              apps: [
                { id: 1, name: 'One' },
                { id: 2, name: 'Two' },
              ],
            },
          },
        }),
      'appids=1': () =>
        json({
          '1': { success: true, data: { type: 'game', steam_appid: 1, name: 'One' } },
        }),
      'appids=2': () => new Response('', { status: 500 }),
      GetOwnedGames: () => owned([{ appid: 1, playtime_forever: 60 }]),
    })
    await expect(
      settle(newChecker().getGamePlayData('1', 99, 'sub')),
    ).rejects.toThrow()
  })
})
