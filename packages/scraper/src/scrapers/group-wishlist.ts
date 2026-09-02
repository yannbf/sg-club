import { load } from 'cheerio'
import { delay, isRateLimitedHtml } from '../utils/common.js'
import { logError } from '../utils/log-error.js'

export interface WishlistEntry {
  name: string
  app_id: number | null
  package_id: number | null
  steam_url: string
  image_url: string | null
  wishlist_count: number
  /** ISO timestamp of the last scrape that actually saw this entry. Absent
   *  only in snapshots written before carry-over merging existed. */
  last_seen?: string
}

const BASE_URL = 'https://www.steamgifts.com'
const START_PATH = '/group/WlYTQ/thegiveawaysclub/wishlist'
// The group wishlist is sorted by wisher count descending. We scrape down to
// MIN_COUNT wishers; pagination stops naturally once a page's last entry drops
// below it. MAX_PAGES is only a safety cap — at ~25 rows/page, count 10 lands
// around page ~90, so 120 leaves comfortable headroom without ever scraping the
// long single-wisher tail (which runs 500+ pages).
const MAX_PAGES = 120
const MIN_COUNT = 10
// SteamGifts re-sorts the wishlist between page requests (tied counts have no
// stable tiebreaker), so a single crawl skips entries that shift across a page
// boundary while it is walking. Crawling more than once and unioning the
// results turns those misses into a coin flip per pass; the loop stops early
// once a pass finds nothing new.
const PASSES = parseInt(process.env.WISHLIST_PASSES ?? '2', 10)

function buildHeaders(): Record<string, string> {
  const cookie = process.env.SG_COOKIE
  const accessToken = process.env.SG_TOKEN
  return {
    ...(cookie ? { Cookie: cookie } : {}),
    ...(accessToken ? { 'X-Access-Token': accessToken } : {}),
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  }
}

const MAX_RETRIES = 5

async function fetchPage(path: string, retryCount = 0): Promise<string> {
  const url = BASE_URL + path
  console.log(`📄 Fetching: ${url}`)

  const response = await fetch(url, { method: 'GET', headers: buildHeaders() })

  // Read the body up front: a Cloudflare block can arrive with a 403/503 or even a
  // 2xx status, so detection has to look at the HTML, not just response.ok/status.
  const html = await response.text()
  const rateLimited =
    response.status === 429 ||
    response.status === 403 ||
    response.status === 503 ||
    isRateLimitedHtml(html)

  if (rateLimited) {
    // Honor Retry-After if SG provides it; otherwise back off exponentially:
    // 30s, 60s, 120s, 240s, 480s. SG's group-wishlist endpoint will throttle
    // aggressively when running alongside other scrapes — give it room.
    if (retryCount < MAX_RETRIES) {
      const retryAfterHeader = response.headers.get('retry-after')
      const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null
      const fallbackMs = 30_000 * Math.pow(2, retryCount)
      const waitMs =
        retryAfterSec && Number.isFinite(retryAfterSec)
          ? Math.max(retryAfterSec * 1000, fallbackMs)
          : fallbackMs
      console.log(
        `⚠️  Rate limited on ${url} — backing off ${Math.round(waitMs / 1000)}s ` +
          `(retry ${retryCount + 1}/${MAX_RETRIES})`,
      )
      await delay(waitMs)
      return fetchPage(path, retryCount + 1)
    }
    const error = new Error(`Rate limited fetching ${url} after ${MAX_RETRIES} retries`)
    logError(error, error.message)
    throw error
  }

  if (!response.ok) {
    const error = new Error(`Failed to fetch ${url}: ${response.statusText}`)
    logError(error, error.message)
    throw error
  }

  return html
}

function parseImageUrl(style: string | undefined): string | null {
  if (!style) return null
  const match = style.match(/url\(([^)]+)\)/)
  return match ? match[1] : null
}

function parseSteamUrl(href: string): {
  app_id: number | null
  package_id: number | null
} {
  const appMatch = href.match(/\/app\/(\d+)/)
  if (appMatch) return { app_id: parseInt(appMatch[1], 10), package_id: null }
  const subMatch = href.match(/\/sub\/(\d+)/)
  if (subMatch)
    return { app_id: null, package_id: parseInt(subMatch[1], 10) }
  return { app_id: null, package_id: null }
}

function parseWishlistPage(html: string): WishlistEntry[] {
  const $ = load(html)
  const entries: WishlistEntry[] = []

  $('.table__row-outer-wrap').each((_, el) => {
    try {
      const $row = $(el)
      const name = $row.find('.table__column__heading').text().trim()
      const $link = $row.find('.table__column__secondary-link')
      const steam_url = ($link.attr('href') || '').replace(
        /\?utm_source=SteamGifts/,
        '',
      )
      const image_url = parseImageUrl(
        $row.find('.table_image_thumbnail').attr('style'),
      )
      const countText = $row
        .find('.table__column--width-small')
        .text()
        .trim()
      const wishlist_count = parseInt(countText.replace(/\D+/g, ''), 10) || 0

      const { app_id, package_id } = parseSteamUrl(steam_url)

      if (name) {
        entries.push({
          name,
          app_id,
          package_id,
          steam_url,
          image_url,
          wishlist_count,
        })
      }
    } catch (error) {
      console.warn('⚠️  Error parsing wishlist row:', error)
    }
  })

  return entries
}

function getNextPage(html: string): string | null {
  const $ = load(html)
  const $next = $('.pagination__navigation a').filter((_, a) =>
    $(a).text().includes('Next'),
  )
  return $next.length ? $next.attr('href') || null : null
}

/** Stable identity for a wishlist entry across crawls. */
function entryKey(entry: WishlistEntry): string {
  if (entry.app_id != null) return `app:${entry.app_id}`
  if (entry.package_id != null) return `sub:${entry.package_id}`
  return `name:${entry.name.toLowerCase()}`
}

/** One top-to-bottom crawl of the wishlist, down to MIN_COUNT wishers. */
async function crawlWishlist(): Promise<{
  entries: WishlistEntry[]
  pages: number
}> {
  const entries: WishlistEntry[] = []
  let currentPath: string | null = START_PATH
  let pages = 0

  while (currentPath && pages < MAX_PAGES) {
    const html = await fetchPage(currentPath)
    pages++

    const pageEntries = parseWishlistPage(html)
    if (pageEntries.length === 0) {
      console.log('📭 No entries on page, stopping')
      break
    }

    entries.push(...pageEntries)

    const lastCount = pageEntries[pageEntries.length - 1].wishlist_count
    if (lastCount < MIN_COUNT) {
      console.log(
        `✅ Reached entries with count < ${MIN_COUNT}, stopping pagination`,
      )
      break
    }

    currentPath = getNextPage(html)
    // Slightly longer per-page delay than 1.5s; SG 429s easily under
    // burst load, especially when the wishlist runs near other scrapes.
    if (currentPath) await delay(2500)
  }

  return { entries, pages }
}

export async function scrapeGroupWishlist(): Promise<WishlistEntry[]> {
  // Dedupe by app_id / package_id / name (SG returns the same entry on
  // several pages when the list re-sorts). Keep the highest count seen.
  const seen = new Map<string, WishlistEntry>()
  let pagesFetched = 0

  for (let pass = 1; pass <= PASSES; pass++) {
    const before = seen.size
    const { entries, pages } = await crawlWishlist()
    pagesFetched += pages

    for (const entry of entries) {
      const key = entryKey(entry)
      const existing = seen.get(key)
      if (!existing || entry.wishlist_count > existing.wishlist_count) {
        seen.set(key, entry)
      }
    }

    const added = seen.size - before
    console.log(`🔁 Pass ${pass}/${PASSES}: ${added} entries not seen before`)
    // A pass that adds nothing means the previous one already saw the whole
    // list — further passes would only re-fetch it.
    if (pass > 1 && added === 0) break
    if (pass < PASSES) await delay(5000)
  }

  // Filter out singletons and sort
  const filtered = Array.from(seen.values())
    .filter((e) => e.wishlist_count >= MIN_COUNT)
    .sort((a, b) => b.wishlist_count - a.wishlist_count)

  console.log(
    `📊 Wishlist: ${filtered.length} entries with ≥${MIN_COUNT} wishers (${pagesFetched} pages fetched)`,
  )

  return filtered
}

/** A game to look up on the group wishlist, as carried by a giveaway. */
export interface WishlistLookupGame {
  name: string
  app_id: number | null
  package_id: number | null
}

/**
 * The group wishlist filtered to a search query. Lets a single game's wisher
 * count be checked without crawling the whole list — which matters because the
 * crawl silently drops entries when SteamGifts re-sorts between page requests
 * (see mergeWithPreviousSnapshot), so "absent from the snapshot" does not mean
 * "not on the wishlist".
 */
export async function searchGroupWishlist(
  query: string,
): Promise<WishlistEntry[]> {
  const html = await fetchPage(`${START_PATH}?q=${encodeURIComponent(query)}`)
  return parseWishlistPage(html)
}

/**
 * Wisher counts for specific games, one search per game. Results are matched
 * back by app/package id, so a search that returns DLC or a same-named game
 * can't be mistaken for the game asked about. A lookup that fails (rate limit,
 * network) is logged and skipped rather than failing the whole batch.
 */
export async function lookupWishlistEntries(
  games: WishlistLookupGame[],
): Promise<WishlistEntry[]> {
  const found: WishlistEntry[] = []
  for (const [index, game] of games.entries()) {
    if (index > 0) await delay(2500)
    try {
      const rows = await searchGroupWishlist(game.name)
      const match = rows.find((row) =>
        game.app_id != null
          ? row.app_id === game.app_id
          : game.package_id != null
            ? row.package_id === game.package_id
            : false,
      )
      if (match) found.push({ ...match, last_seen: new Date().toISOString() })
    } catch (error) {
      logError(error, `Failed wishlist lookup for ${game.name}`)
    }
  }
  console.log(
    `🔎 Wishlist lookups: ${found.length}/${games.length} games resolved`,
  )
  return found
}
