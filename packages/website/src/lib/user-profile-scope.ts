import type { GameData, Giveaway, User } from '@/types'

/**
 * The slice of the full giveaway list one profile page reads. The profile only
 * ever looks giveaways up by link — for its own created/won/entered records —
 * or lists the ones its owner created, so everything else is dead weight in
 * the serialised page. Order is preserved because the client relies on
 * `.find`, stable sorts and list order over this array.
 */
export function scopeGiveawaysToUser(
  giveaways: Giveaway[],
  user: Pick<User, 'giveaways_created' | 'giveaways_won'>,
  entryLinks: Iterable<string>,
  createdByUser: Giveaway[],
): Giveaway[] {
  const links = new Set<string>(entryLinks)
  for (const g of user.giveaways_created ?? []) links.add(g.link)
  for (const g of user.giveaways_won ?? []) links.add(g.link)
  for (const g of createdByUser) links.add(g.link)
  return giveaways.filter((g) => links.has(g.link))
}

/**
 * The game records a set of giveaways can resolve to, in their original order.
 *
 * Two lookups run over the result and both are last-record-wins, so every
 * record that could answer either one is kept rather than only one per key:
 * `findGameData` (app_id, then package_id) and `useGameData`, which keys its
 * map by `app_id ?? package_id`.
 */
export function scopeGameDataToGiveaways(
  gameData: GameData[],
  giveaways: Array<Pick<Giveaway, 'app_id' | 'package_id'>>,
): GameData[] {
  const appIds = new Set<number>()
  const packageIds = new Set<number>()
  const hookKeys = new Set<number>()
  for (const g of giveaways) {
    if (g.app_id != null) appIds.add(g.app_id)
    if (g.package_id != null) packageIds.add(g.package_id)
    const key = g.app_id ?? g.package_id
    if (key != null) hookKeys.add(key)
  }
  return gameData.filter((game) => {
    if (game.app_id != null && appIds.has(game.app_id)) return true
    if (game.package_id != null && packageIds.has(game.package_id)) return true
    const key = game.app_id ?? game.package_id
    return key != null && hookKeys.has(key)
  })
}

/**
 * steam_id -> avatar URL for every member. The profile resolves avatars for
 * people other than its owner (winners, creators) and treats presence in this
 * map as "is a current member", so the keys must cover the whole roster.
 */
export function buildAvatarLookup(
  users: Record<string, Pick<User, 'steam_id' | 'avatar_url'>> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.values(users ?? {}).map((u) => [u.steam_id, u.avatar_url]),
  )
}
