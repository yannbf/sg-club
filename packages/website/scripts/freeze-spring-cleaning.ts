/**
 * Freezes a spring-cleaning edition into a self-contained snapshot.
 *
 * Each edition is a point-in-time record: we run the analysis against the
 * CURRENT data and write the fully-resolved result (names, avatars, game links,
 * every reason) to public/data/spring-cleaning/<slug>.json. The edition page
 * reads that file, so an old cleaning always renders exactly as it was detected
 * — even after flagged members leave the group or fix their play rate.
 *
 * Usage (from packages/website):
 *   pnpm freeze-spring-cleaning            # freeze the latest edition
 *   pnpm freeze-spring-cleaning 2026       # freeze a specific edition by slug
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  analyzeSpringCleaning,
  getSpringCleaningEdition,
  LATEST_SPRING_CLEANING,
  type SpringCleaningSnapshot,
} from '../src/lib/spring-cleaning'
import type {
  Giveaway,
  GameData,
  User,
  UserEntry,
  WishlistData,
} from '../src/types'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = join(ROOT, 'public', 'data')

const readJson = <T>(name: string): T =>
  JSON.parse(readFileSync(join(DATA_DIR, name), 'utf8')) as T

/** Pivot user_entries.json ({ link: [{steam_id, joined_at}] }) by steam_id. */
function pivotUserEntries(
  input: Record<string, Array<{ steam_id: string; joined_at: number }>>,
): UserEntry {
  const out: UserEntry = {}
  for (const [link, entries] of Object.entries(input)) {
    for (const { steam_id, joined_at } of entries) {
      ;(out[steam_id] ??= []).push({ link, joined_at })
    }
  }
  return out
}

function main() {
  const slug = process.argv[2] ?? LATEST_SPRING_CLEANING.slug
  const edition = getSpringCleaningEdition(slug)
  if (!edition) {
    console.error(`✖ Unknown spring-cleaning edition: "${slug}"`)
    process.exit(1)
  }

  // Mirror the website's getAllUsers(): load members, drop the disallow list,
  // and annotate Discord membership (case-insensitive by username).
  const usersFile = readJson<{
    lastUpdated: number
    users: Record<string, User>
  }>('group_users.json')
  const disallow = new Set(['CupcakeDollykins'])
  const discordRaw = readJson<{ members?: Record<string, boolean> }>(
    'discord_members.json',
  )
  const discord = new Map(
    Object.entries(discordRaw.members ?? {}).map(([n, v]) => [
      n.toLowerCase(),
      v,
    ]),
  )
  const users: User[] = Object.values(usersFile.users)
    .filter((u) => !disallow.has(u.username))
    .map((u) => ({ ...u, discord_member: discord.get(u.username.toLowerCase()) }))

  const giveaways =
    readJson<{ giveaways: Giveaway[] }>('giveaways.json').giveaways
  const gameData = readJson<GameData[]>('game_data.json')
  const wishlist = readJson<WishlistData>('wishlist.json')
  const userEntries = pivotUserEntries(readJson('user_entries.json'))

  const nowSec = Math.floor(Date.now() / 1000)
  const result = analyzeSpringCleaning(
    users,
    giveaways,
    gameData,
    wishlist,
    userEntries,
    { nowSec },
  )

  const snapshot: SpringCleaningSnapshot = {
    edition,
    generatedAt: nowSec,
    sourceLastUpdated: usersFile.lastUpdated ?? null,
    result,
  }

  const outDir = join(DATA_DIR, 'spring-cleaning')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `${edition.slug}.json`)
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2))

  console.log(
    `✅ Froze ${edition.label}: ${result.expel.length} expel, ${result.warn.length} warn, ` +
      `${result.totalAnalyzed} analyzed → public/data/spring-cleaning/${edition.slug}.json`,
  )
}

main()
