import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { scrapeGroupWishlist } from '../scrapers/group-wishlist'
import type { WishlistEntry } from '../scrapers/group-wishlist'
import { logError } from '../utils/log-error'

// Without SG_COOKIE the scrape gets a Cloudflare challenge on the very first
// page, which surfaces as a rate-limit failure after every back-off. CI passes
// the credentials as real env vars, which dotenv leaves alone.
const currentDir = dirname(fileURLToPath(import.meta.url))
const rootEnvPath = resolve(currentDir, '../../../../.env')
loadEnv({ path: existsSync(rootEnvPath) ? rootEnvPath : undefined })

export interface WishlistData {
  last_updated: string
  entries: WishlistEntry[]
}

/** SteamGifts re-sorts the group wishlist between page requests (tied counts
 *  have no stable tiebreaker), so a crawl misses entries that shift across page
 *  boundaries mid-scrape. scrapeGroupWishlist crawls repeatedly to narrow that;
 *  entries from the previous snapshot that no pass saw are carried over while
 *  their last sighting is within this window — long enough to survive one
 *  missed biweekly scrape, short enough that games actually removed from the
 *  wishlist age out. */
export const CARRY_OVER_MS = 21 * 24 * 60 * 60 * 1000

function entryKey(e: WishlistEntry): string {
  if (e.app_id != null) return `app:${e.app_id}`
  if (e.package_id != null) return `sub:${e.package_id}`
  return `name:${e.name.toLowerCase()}`
}

export function mergeWithPreviousSnapshot(
  scraped: WishlistEntry[],
  previous: WishlistData | null,
  now: Date,
): WishlistEntry[] {
  const nowIso = now.toISOString()
  const merged = new Map<string, WishlistEntry>()

  for (const entry of scraped) {
    merged.set(entryKey(entry), { ...entry, last_seen: nowIso })
  }

  for (const entry of previous?.entries ?? []) {
    const key = entryKey(entry)
    if (merged.has(key)) continue
    // Snapshots from before last_seen existed date every entry at the
    // snapshot's own last_updated.
    const lastSeen = entry.last_seen ?? previous!.last_updated
    const age = now.getTime() - new Date(lastSeen).getTime()
    if (Number.isNaN(age) || age > CARRY_OVER_MS) continue
    merged.set(key, { ...entry, last_seen: lastSeen })
  }

  return Array.from(merged.values()).sort(
    (a, b) => b.wishlist_count - a.wishlist_count,
  )
}

export async function generateWishlistData(): Promise<void> {
  const filename = '../website/public/data/wishlist.json'

  try {
    console.log('🚀 Starting wishlist scraping...')

    let previous: WishlistData | null = null
    if (existsSync(filename)) {
      try {
        previous = JSON.parse(readFileSync(filename, 'utf-8'))
      } catch (error) {
        console.warn('⚠️  Could not read previous wishlist snapshot:', error)
      }
    }

    const scraped = await scrapeGroupWishlist()
    const entries = mergeWithPreviousSnapshot(scraped, previous, new Date())
    const carried = entries.length - scraped.length
    if (carried > 0) {
      console.log(
        `♻️  Carried over ${carried} entries the scrape missed (unstable SG pagination)`,
      )
    }

    const data = {
      last_updated: new Date().toISOString(),
      entries,
    }

    writeFileSync(filename, JSON.stringify(data, null, 2))
    console.log(`💾 Wishlist saved to ${filename} (${entries.length} entries)`)
  } catch (error) {
    const errorMessage = 'Failed to scrape wishlist'
    console.error(`❌ ${errorMessage}:`, error)
    logError(error, errorMessage)
    process.exit(1)
  }
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await generateWishlistData()
  }
}
