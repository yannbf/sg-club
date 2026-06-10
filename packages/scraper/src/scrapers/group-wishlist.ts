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
}

const BASE_URL = 'https://www.steamgifts.com'
const START_PATH = '/group/WlYTQ/thegiveawaysclub/wishlist'
const MAX_PAGES = 40
const MIN_COUNT = 2

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

export async function scrapeGroupWishlist(): Promise<WishlistEntry[]> {
  const all: WishlistEntry[] = []
  let currentPath: string | null = START_PATH
  let pages = 0

  while (currentPath && pages < MAX_PAGES) {
    const html = await fetchPage(currentPath)
    pages++

    const entries = parseWishlistPage(html)
    if (entries.length === 0) {
      console.log('📭 No entries on page, stopping')
      break
    }

    all.push(...entries)

    const lastCount = entries[entries.length - 1].wishlist_count
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

  // Dedupe by app_id / package_id / name (SG occasionally returns the same
  // entry on multiple pages). Keep the entry with the highest wishlist_count.
  const seen = new Map<string, WishlistEntry>()
  for (const entry of all) {
    const key =
      entry.app_id != null
        ? `app:${entry.app_id}`
        : entry.package_id != null
          ? `sub:${entry.package_id}`
          : `name:${entry.name.toLowerCase()}`
    const existing = seen.get(key)
    if (!existing || entry.wishlist_count > existing.wishlist_count) {
      seen.set(key, entry)
    }
  }

  // Filter out singletons and sort
  const filtered = Array.from(seen.values())
    .filter((e) => e.wishlist_count >= MIN_COUNT)
    .sort((a, b) => b.wishlist_count - a.wishlist_count)

  console.log(
    `📊 Wishlist: ${filtered.length} entries with ≥${MIN_COUNT} wishers (${pages} pages fetched)`,
  )

  return filtered
}
