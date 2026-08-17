import type { Giveaway, UserGroupData } from '@/types'
import type { CreatorResolver } from '@/lib/creator-resolver'

/**
 * What a winner did with the game they won, at chip scale. Kept minimal on
 * purpose: these maps are serialized into the static HTML of pages that already
 * ship every giveaway, so only the displayed fields travel.
 */
export interface WinnerPlayStats {
  /** Omitted when Steam exposes no stats for this win (unowned, delisted, …). */
  playtime_minutes?: number
  achievements_unlocked?: number
  achievements_total?: number
  is_playtime_private?: boolean
  /** Winner posted the "I played, bro!" attestation. */
  attested?: boolean
  /** The giveaway carried a play requirement, and whether it was signed off. */
  required_play?: boolean
  requirements_met?: boolean
}

/** Lookup key for one winner's stats on one giveaway. */
export function winnerPlayStatsKey(
  rawWinner: string,
  giveawayLink: string,
): string {
  return `${rawWinner}::${giveawayLink}`
}

/**
 * Play stats per (winner, giveaway), keyed by the winner value exactly as it
 * appears on the giveaway so the card can look up what it already holds.
 *
 * The data lives on the *user* record (`giveaways_won[]`), and winners are
 * recorded as steam_ids or as raw usernames for renamed/deleted accounts —
 * hence the resolver. Ex-members keep their won-game records too, so pass both
 * user groups.
 */
export function buildWinnerPlayStats(
  giveaways: Giveaway[],
  userGroups: Array<UserGroupData | null>,
  resolver: CreatorResolver,
): Record<string, WinnerPlayStats> {
  const byUserAndLink = new Map<string, WinnerPlayStats>()
  for (const group of userGroups) {
    for (const user of Object.values(group?.users ?? {})) {
      for (const won of user.giveaways_won ?? []) {
        const key = winnerPlayStatsKey(user.steam_id, won.link)
        if (byUserAndLink.has(key)) continue
        const stats: WinnerPlayStats = {}
        const play = won.steam_play_data
        if (play?.owned && !play.has_no_available_stats) {
          stats.playtime_minutes = play.playtime_minutes
          stats.achievements_unlocked = play.achievements_unlocked
          stats.achievements_total = play.achievements_total
          if (play.is_playtime_private) stats.is_playtime_private = true
        }
        if (won.i_played_bro) stats.attested = true
        if (won.required_play) {
          stats.required_play = true
          if (won.required_play_meta?.requirements_met)
            stats.requirements_met = true
        }
        if (Object.keys(stats).length > 0) byUserAndLink.set(key, stats)
      }
    }
  }

  const statsByWin: Record<string, WinnerPlayStats> = {}
  for (const giveaway of giveaways) {
    for (const winner of giveaway.winners ?? []) {
      if (!winner.name) continue
      const steamId = resolver.canonicalSteamId(winner.name)
      const stats = byUserAndLink.get(
        winnerPlayStatsKey(steamId, giveaway.link),
      )
      if (stats)
        statsByWin[winnerPlayStatsKey(winner.name, giveaway.link)] = stats
    }
  }
  return statsByWin
}
