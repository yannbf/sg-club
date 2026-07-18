import {
  getWishlist,
  getAllGiveaways,
  getGameInsights,
  getGameData,
  getAllUsersAsArray,
} from '@/lib/data'
import { Giveaway } from '@/types'
import WishlistClient, { GiveawayStats, UserLookup } from './client'

function buildGiveawayStats(
  giveaways: Giveaway[],
): Record<string, GiveawayStats> {
  const stats: Record<
    string,
    { giveawayCount: number; totalEntries: number; endedCount: number }
  > = {}

  const now = Math.floor(Date.now() / 1000)

  for (const ga of giveaways) {
    const key =
      ga.app_id != null
        ? `app:${ga.app_id}`
        : ga.package_id != null
          ? `sub:${ga.package_id}`
          : `name:${ga.name.toLowerCase()}`

    if (!stats[key]) {
      stats[key] = { giveawayCount: 0, totalEntries: 0, endedCount: 0 }
    }
    stats[key].giveawayCount++
    if (ga.end_timestamp <= now) {
      stats[key].endedCount++
      stats[key].totalEntries += ga.entry_count ?? 0
    }
  }

  const result: Record<string, GiveawayStats> = {}
  for (const [key, s] of Object.entries(stats)) {
    result[key] = {
      giveawayCount: s.giveawayCount,
      averageEntries:
        s.endedCount > 0 ? Math.round(s.totalEntries / s.endedCount) : null,
    }
  }
  return result
}

export default async function WishlistPage() {
  const [wishlist, giveaways, insights, gameData, users] = await Promise.all([
    getWishlist(),
    getAllGiveaways(),
    getGameInsights(),
    getGameData(),
    getAllUsersAsArray(),
  ])

  const gameDataByAppId: Record<string, (typeof gameData)[number]> = {}
  for (const game of gameData) {
    if (game.app_id != null) {
      gameDataByAppId[String(game.app_id)] = game
    }
  }

  const usersLookup: UserLookup = {}
  for (const user of users) {
    usersLookup[user.steam_id] = {
      username: user.username,
      avatar_url: user.avatar_url,
    }
  }

  // Two views: "group-exclusive" (default) hides shared + whitelist GAs
  // since they're not really representative of how the group itself has
  // distributed a game; "all" includes everything.
  const exclusiveGiveaways = giveaways.filter(
    (g) => !g.is_shared && !g.whitelist,
  )
  const giveawayStats = {
    exclusive: buildGiveawayStats(exclusiveGiveaways),
    all: buildGiveawayStats(giveaways),
  }

  return (
    <WishlistClient
      entries={wishlist?.entries ?? []}
      lastUpdated={wishlist?.last_updated ?? null}
      giveawayStats={giveawayStats}
      insights={insights}
      gameDataByAppId={gameDataByAppId}
      users={usersLookup}
    />
  )
}
