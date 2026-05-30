/**
 * Reconstruct stub User records for SG accounts that have been deleted.
 *
 * Deleted accounts are flagged in `steam_id_map.json` with
 * `deleted_sg_account: true` and a known steam_id. Their giveaway records
 * still exist in `giveaways.json` (both as creators and as winners of other
 * GAs) — we use those to rebuild everything stat-derivable. Steam-API-derived
 * fields (avatar, achievements) aren't accessible without separate calls, so
 * those are left as stub/empty values; the UI surfaces an "Account deleted"
 * badge to make this state explicit.
 *
 * Run via:  pnpm --filter scraper reconstruct-deleted-users
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type {
  CVStatus,
  Giveaway,
  SteamIdMap,
  User,
  UserGiveawaysStats,
  ExMemberData,
} from '../types/steamgifts.js'
import type { GamePrice } from '../types/steamgifts.js'

const DATA_DIR = '../website/public/data'

interface GameDataEntry {
  app_id: number | null
  package_id: number | null
  price_usd_full?: number
  price_usd_reduced?: number
}

function emptyStats(): UserGiveawaysStats {
  return {
    giveaways_created: 0,
    giveaways_with_no_entries: 0,
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
    real_total_sent_value: 0,
    real_total_received_value: 0,
    real_total_value_difference: 0,
    real_total_sent_count: 0,
    real_total_received_count: 0,
    real_total_gift_difference: 0,
    shared_sent_count: 0,
    shared_received_count: 0,
    last_giveaway_created_at: null,
    last_giveaway_won_at: null,
    has_missing_achievements_data: true,
  }
}

function priceFor(
  ga: Giveaway,
  gamesByApp: Map<number, GameDataEntry>,
): number {
  // Use full Steam price in dollars (cents → dollars). Falls back to 0 if the
  // game isn't priced in our data — that mirrors how the website computes
  // value for live users.
  if (ga.app_id != null && gamesByApp.has(ga.app_id)) {
    const cents = gamesByApp.get(ga.app_id)!.price_usd_full
    if (typeof cents === 'number') return cents / 100
  }
  return 0
}

function cvBucket(cv: CVStatus | undefined): 'fcv' | 'rcv' | 'ncv' {
  if (cv === 'FULL_CV') return 'fcv'
  if (cv === 'REDUCED_CV') return 'rcv'
  return 'ncv'
}

function reconstructUser(
  steamId: string,
  username: string,
  giveaways: Giveaway[],
  gamesByApp: Map<number, GameDataEntry>,
  existing?: User,
): User {
  // Created — match by steam_id OR username, because for deleted accounts the
  // scraper kept `creator` as a username string when it couldn't resolve to a
  // steam_id.
  const created = giveaways.filter(
    (g) =>
      !g.deleted &&
      (g.creator === steamId || g.creator_username === username || g.creator === username),
  )

  // Won — search the winners arrays of all live giveaways.
  const won = giveaways.filter(
    (g) =>
      !g.deleted &&
      g.winners?.some(
        (w) => w.name === steamId || w.winner_username === username || w.name === username,
      ),
  )

  const stats = emptyStats()

  for (const ga of created) {
    const copies = ga.copies || 1
    const isShared = ga.is_shared === true
    const value = priceFor(ga, gamesByApp) * copies
    const bucket = cvBucket(ga.cv_status)

    stats.total_sent_count += copies
    stats.total_sent_value += value
    stats[`${bucket}_sent_count`] += copies
    if (isShared) stats.shared_sent_count += copies
    if ((ga.entry_count || 0) === 0) stats.giveaways_with_no_entries += 1
    if (!isShared) {
      stats.real_total_sent_count += copies
      stats.real_total_sent_value += value
    }

    if (
      stats.last_giveaway_created_at == null ||
      ga.created_timestamp > stats.last_giveaway_created_at
    ) {
      stats.last_giveaway_created_at = ga.created_timestamp
    }
  }
  stats.giveaways_created = created.length

  for (const ga of won) {
    const value = priceFor(ga, gamesByApp) // received: 1 key regardless of copies
    const isShared = ga.is_shared === true
    const bucket = cvBucket(ga.cv_status)

    stats.total_received_count += 1
    stats.total_received_value += value
    stats[`${bucket}_received_count`] += 1
    if (isShared) stats.shared_received_count += 1
    if (!isShared) {
      stats.real_total_received_count += 1
      stats.real_total_received_value += value
    }

    if (
      stats.last_giveaway_won_at == null ||
      ga.end_timestamp > stats.last_giveaway_won_at
    ) {
      stats.last_giveaway_won_at = ga.end_timestamp
    }
  }

  // Derived differences
  stats.total_gift_difference =
    stats.total_sent_count - stats.total_received_count
  stats.total_value_difference =
    stats.total_sent_value - stats.total_received_value
  stats.fcv_gift_difference =
    stats.fcv_sent_count - stats.fcv_received_count
  stats.real_total_gift_difference =
    stats.real_total_sent_count - stats.real_total_received_count
  stats.real_total_value_difference =
    stats.real_total_sent_value - stats.real_total_received_value

  // giveaway_ratio: matches the scraper's convention of received÷sent×100 (0
  // when no GAs sent, matching pure "freeloaders"). For our reconstructed
  // users we mimic the same shape.
  stats.giveaway_ratio =
    stats.total_sent_count > 0
      ? Math.round(
          (stats.total_received_count / stats.total_sent_count) * 100,
        )
      : 0

  // The most recent activity (created or won) is our best proxy for when the
  // account was likely abandoned/deleted.
  const lastActivity = Math.max(
    stats.last_giveaway_created_at ?? 0,
    stats.last_giveaway_won_at ?? 0,
  )

  // Fields we can't derive from giveaway data — preserve any manually-set
  // values from an earlier run so a human-curated avatar / country_code
  // survives a re-reconstruction.
  return {
    username,
    profile_url: `/user/${username}`,
    avatar_url: existing?.avatar_url || '',
    steam_id: steamId,
    steam_profile_url: `https://steamcommunity.com/profiles/${steamId}`,
    steam_profile_is_private: existing?.steam_profile_is_private ?? false,
    country_code: existing?.country_code ?? null,
    stats,
    warnings: existing?.warnings ?? [],
    left_at_timestamp:
      existing?.left_at_timestamp ??
      (lastActivity ? lastActivity * 1000 : undefined),
    is_deleted_sg_account: true,
    giveaways_created: created.map((ga) => ({
      name: ga.name,
      link: ga.link,
      cv_status: ga.cv_status ?? 'NO_CV',
      entries: ga.entry_count || 0,
      copies: ga.copies || 1,
      created_timestamp: ga.created_timestamp,
      end_timestamp: ga.end_timestamp,
      had_winners: ga.hasWinners,
      required_play: ga.required_play === true,
      is_shared: ga.is_shared === true,
      winners: ga.winners?.map((w) => ({
        name: w.name,
        winner_username: w.winner_username,
        status: w.status,
        activated: w.name != null && w.status === 'received',
      })),
    })),
    giveaways_won: won.map((ga) => {
      const winner = ga.winners?.find(
        (w) =>
          w.name === steamId || w.winner_username === username || w.name === username,
      )
      return {
        name: ga.name,
        link: ga.link,
        cv_status: ga.cv_status ?? 'NO_CV',
        status: winner?.status ?? 'received',
        end_timestamp: ga.end_timestamp,
        required_play: ga.required_play === true,
        is_shared: ga.is_shared === true,
      }
    }),
  }
}

export function reconstructDeletedUsers(): void {
  const steamIdMapPath = `${DATA_DIR}/steam_id_map.json`
  const giveawaysPath = `${DATA_DIR}/giveaways.json`
  const gameDataPath = `${DATA_DIR}/game_data.json`
  const exMembersPath = `${DATA_DIR}/ex_members.json`

  if (!existsSync(steamIdMapPath)) {
    console.error(`❌ steam_id_map.json not found at ${steamIdMapPath}`)
    process.exit(1)
  }

  const steamIdMap: SteamIdMap = JSON.parse(
    readFileSync(steamIdMapPath, 'utf-8'),
  )
  const giveaways: Giveaway[] = JSON.parse(
    readFileSync(giveawaysPath, 'utf-8'),
  ).giveaways
  const games: (GameDataEntry & GamePrice)[] = JSON.parse(
    readFileSync(gameDataPath, 'utf-8'),
  )
  const gamesByApp = new Map<number, GameDataEntry>()
  for (const g of games) {
    if (g.app_id != null) gamesByApp.set(g.app_id, g)
  }

  const deletedEntries = Object.entries(steamIdMap).filter(
    ([, entry]) => entry.deleted_sg_account === true,
  )
  console.log(
    `🔎 Found ${deletedEntries.length} deleted-account entries in steam_id_map.json`,
  )

  if (deletedEntries.length === 0) {
    console.log('  Nothing to reconstruct.')
    return
  }

  // Load existing ex_members (or initialize)
  let exMembers: ExMemberData
  if (existsSync(exMembersPath)) {
    exMembers = JSON.parse(readFileSync(exMembersPath, 'utf-8'))
  } else {
    exMembers = { lastUpdated: Date.now(), users: {} }
  }

  let added = 0
  let updated = 0
  for (const [steamId, entry] of deletedEntries) {
    const existing = exMembers.users[steamId]
    const user = reconstructUser(
      steamId,
      entry.current,
      giveaways,
      gamesByApp,
      existing,
    )

    if (
      user.stats.total_sent_count === 0 &&
      user.stats.total_received_count === 0
    ) {
      console.log(
        `  ⏭  ${entry.current} — no giveaways found in data; skipping`,
      )
      continue
    }

    if (exMembers.users[steamId]) {
      updated += 1
      console.log(
        `  🔁 ${entry.current} — updating existing ex_member entry ` +
          `(sent: ${user.stats.total_sent_count}, received: ${user.stats.total_received_count})`,
      )
    } else {
      added += 1
      console.log(
        `  ✨ ${entry.current} — adding ex_member entry ` +
          `(sent: ${user.stats.total_sent_count}, received: ${user.stats.total_received_count})`,
      )
    }
    exMembers.users[steamId] = user
  }

  exMembers.lastUpdated = Date.now()
  writeFileSync(exMembersPath, JSON.stringify(exMembers, null, 2))
  console.log(
    `\n✅ Reconstruction complete — ${added} added, ${updated} updated`,
  )
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    reconstructDeletedUsers()
  }
}
