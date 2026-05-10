import { getWishlist, getAllGiveaways } from '@/lib/data'
import { Giveaway } from '@/types'
import WishlistClient, { GiveawayStats } from './client'

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
  const [wishlist, giveaways] = await Promise.all([
    getWishlist(),
    getAllGiveaways(),
  ])

  const giveawayStats = buildGiveawayStats(giveaways)

  return (
    <WishlistClient
      entries={wishlist?.entries ?? []}
      lastUpdated={wishlist?.last_updated ?? null}
      giveawayStats={giveawayStats}
    />
  )
}
