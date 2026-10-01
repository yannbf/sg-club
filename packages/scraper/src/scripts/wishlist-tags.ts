import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  fetchSteamTags,
  getCachedSteamTags,
  saveSteamTagsCache,
  steamTagsKey,
  STEAM_TAGS_DELAY_MS,
} from '../api/fetch-steam-tags.js'
import type { WishlistEntry } from '../scrapers/group-wishlist.js'
import { delay } from '../utils/common.js'
import type { WishlistData } from './generate-wishlist-data.js'

/** Tags kept per wishlist entry, most-voted first. */
export const WISHLIST_TAGS_PER_GAME = 10

/** Cache is written after this many fetches so an interrupted run keeps its progress. */
const SAVE_EVERY = 25
const LOG_EVERY = 25
/** Consecutive failed fetches after which Steam is assumed to be rate limiting. */
const MAX_CONSECUTIVE_FAILURES = 10

export interface WishlistTagsDeps {
  fetchTags: (ids: {
    app_id: number | null
    package_id: number | null
  }) => Promise<string[] | null>
  getCached: (key: string) => string[] | undefined
  saveCache: () => void
  delayMs: number
  delay: (ms: number) => Promise<void>
}

const defaultDeps: WishlistTagsDeps = {
  fetchTags: fetchSteamTags,
  getCached: getCachedSteamTags,
  saveCache: saveSteamTagsCache,
  delayMs: STEAM_TAGS_DELAY_MS,
  delay,
}

/**
 * Fetches Steam tags for wishlist entries that have none cached (at most
 * `limit` fetches), then sets `tags` on every entry from the cache: its top
 * WISHLIST_TAGS_PER_GAME tags. Entries whose tags are unknown or known to be
 * empty get no `tags` field. Mutates and returns `entries`.
 */
export async function attachWishlistTags(
  entries: WishlistEntry[],
  options: { limit?: number; deps?: Partial<WishlistTagsDeps> } = {},
): Promise<WishlistEntry[]> {
  const deps = { ...defaultDeps, ...options.deps }

  let pending = entries.filter((e) => {
    const key = steamTagsKey(e)
    return key !== null && deps.getCached(key) === undefined
  })
  if (options.limit !== undefined) pending = pending.slice(0, options.limit)

  if (pending.length > 0) {
    console.log(`🏷️  Fetching Steam tags for ${pending.length} wishlist games...`)
    let fetched = 0
    let failures = 0
    let consecutiveFailures = 0
    for (const entry of pending) {
      if (fetched > 0) await deps.delay(deps.delayMs)
      const tags = await deps.fetchTags(entry)
      fetched++
      if (tags === null) {
        failures++
        consecutiveFailures++
      } else {
        consecutiveFailures = 0
      }
      if (fetched % SAVE_EVERY === 0) deps.saveCache()
      if (fetched % LOG_EVERY === 0) {
        console.log(`   ${fetched}/${pending.length} fetched (${failures} failed)`)
      }
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.warn(
          `⚠️  ${MAX_CONSECUTIVE_FAILURES} Steam tag fetches failed in a row — likely rate limited, stopping early`,
        )
        break
      }
    }
    deps.saveCache()
    console.log(`🏷️  Tag fetch done: ${fetched - failures} ok, ${failures} failed`)
  }

  for (const entry of entries) {
    const key = steamTagsKey(entry)
    const tags = key ? deps.getCached(key) : undefined
    if (tags && tags.length > 0) entry.tags = tags.slice(0, WISHLIST_TAGS_PER_GAME)
    else delete entry.tags
  }
  return entries
}

const WISHLIST_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../website/public/data/wishlist.json',
)

/** Adds tags to the existing wishlist.json without scraping. `LIMIT=<n>` caps
 *  the number of Steam fetches for a partial run. */
export async function backfillWishlistTags(): Promise<void> {
  if (!existsSync(WISHLIST_FILE)) {
    throw new Error(`No wishlist snapshot at ${WISHLIST_FILE}`)
  }
  const data: WishlistData = JSON.parse(readFileSync(WISHLIST_FILE, 'utf-8'))
  const limit = process.env.LIMIT ? Number(process.env.LIMIT) : undefined
  if (limit !== undefined && !(limit >= 0)) {
    throw new Error(`Invalid LIMIT: ${process.env.LIMIT}`)
  }
  await attachWishlistTags(data.entries, { limit })
  writeFileSync(WISHLIST_FILE, JSON.stringify(data, null, 2))
  console.log(`💾 Wishlist saved to ${WISHLIST_FILE}`)
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await backfillWishlistTags()
  }
}
