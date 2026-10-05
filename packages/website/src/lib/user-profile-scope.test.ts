import { describe, it, expect } from 'vitest'
import {
  buildAvatarLookup,
  scopeGameDataToGiveaways,
  scopeGiveawaysToUser,
} from './user-profile-scope'
import { buildGameDataIndex, findGameData } from './chart-data'
import type { GameData, Giveaway, User } from '@/types'

const ga = (link: string, app_id?: number, package_id?: number) =>
  ({ link, app_id, package_id }) as unknown as Giveaway

const game = (
  name: string,
  app_id: number | null,
  package_id: number | null = null,
) => ({ name, app_id, package_id }) as unknown as GameData

describe('scopeGiveawaysToUser', () => {
  const giveaways = [ga('a/a'), ga('b/b'), ga('c/c'), ga('d/d'), ga('e/e'), ga('f/f')]
  const user = {
    giveaways_created: [{ link: 'b/b' }],
    giveaways_won: [{ link: 'c/c' }],
  } as unknown as User

  it('keeps created, won, entered and resolver-created giveaways in original order', () => {
    const scoped = scopeGiveawaysToUser(giveaways, user, ['e/e'], [giveaways[5]])
    expect(scoped.map((g) => g.link)).toEqual(['b/b', 'c/c', 'e/e', 'f/f'])
  })

  it('tolerates a user with no created or won records', () => {
    const bare = {} as User
    expect(scopeGiveawaysToUser(giveaways, bare, [], [])).toEqual([])
  })
})

describe('scopeGameDataToGiveaways', () => {
  it('keeps every record either lookup could resolve to, in order', () => {
    const records = [
      game('older app 10', 10),
      game('package 500', null, 500),
      game('unrelated', 99),
      game('newer app 10', 10),
      game('app 20 via package 700', 20, 700),
    ]
    const giveaways = [ga('x', 10), ga('y', undefined, 500), ga('z', undefined, 700)]
    const scoped = scopeGameDataToGiveaways(records, giveaways)
    expect(scoped.map((g) => g.name)).toEqual([
      'older app 10',
      'package 500',
      'newer app 10',
      'app 20 via package 700',
    ])
  })

  it('resolves identically to the full list for every scoped giveaway', () => {
    const records = [
      game('a', 1, 100),
      game('b', null, 100),
      game('c', 2),
      game('d', 3, 100),
      game('e', 4),
    ]
    const giveaways = [ga('x', 1, 100), ga('y', undefined, 100), ga('z', 2)]
    const full = buildGameDataIndex(records)
    const scoped = buildGameDataIndex(scopeGameDataToGiveaways(records, giveaways))
    for (const g of giveaways) {
      expect(findGameData(g.app_id, g.package_id, scoped)).toBe(
        findGameData(g.app_id, g.package_id, full),
      )
    }
  })
})

describe('buildAvatarLookup', () => {
  it('keys by steam_id and keeps members without an avatar', () => {
    const lookup = buildAvatarLookup({
      one: { steam_id: '1', avatar_url: 'http://a' },
      two: { steam_id: '2', avatar_url: undefined as unknown as string },
    })
    expect(lookup['1']).toBe('http://a')
    expect(Object.prototype.hasOwnProperty.call(lookup, '2')).toBe(true)
  })

  it('returns an empty lookup when there are no users', () => {
    expect(buildAvatarLookup(undefined)).toEqual({})
  })
})
