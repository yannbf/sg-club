import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import type { BundleGamesResponse } from '../types/steamgifts.js'
import { delay, isRateLimitedHtml } from '../utils/common.js'
import { logError } from '../utils/log-error.js'

/**
 * Generates per-game "insights" for every game on the group wishlist (an
 * app_id-having entry in wishlist.json): which group members OWN it (Steam
 * library), which members WANT it (Steam wishlist), and whether it's
 * "bundled" on SteamGifts (i.e. appears in the bundle-games search — a
 * signal that it may be reduced/no-CV). Feeds a website tooltip.
 *
 * Steam review summaries are NOT fetched here — they're collected once by
 * the website-data job (packages/scraper/src/api/fetch-game-prices.ts),
 * which already iterates the union of giveaways.json + wishlist.json games,
 * and written to game_data.json instead. This script only owns the data that
 * genuinely belongs to the wishlist job: per-member ownership/wishlist
 * status and the SteamGifts bundled flag.
 *
 * Two independent, rate-limited data sources are involved:
 *  - Steam Web API (per-member owned games + wishlist) — cheap, no persistent
 *    cache needed, re-fetched fully every run.
 *  - SteamGifts bundle-games search (per target game) — rate-limited, so
 *    results are cached to disk (data/game-insights-cache.json) with a TTL
 *    so reruns are cheap and an interrupted run can resume.
 *
 * Env vars:
 *  - GAME_INSIGHTS_LIMIT=N — only process the first N target wishlist entries
 *    (testing).
 *  - MEMBER_LIMIT=N — only fetch Steam data for the first N group members
 *    (testing; member fetching is otherwise always full).
 *  - SKIP_BUNDLED=1 — don't fetch bundle status for apps not already cached;
 *    leaves `bundled: null` for those.
 *
 * Run with: pnpm --filter scraper game-insights
 */

const currentDir = dirname(fileURLToPath(import.meta.url))
const rootEnvPath = resolve(currentDir, '../../../../.env')
loadEnv({ path: existsSync(rootEnvPath) ? rootEnvPath : undefined })

const API_KEY = process.env.STEAM_API_KEY
const STEAM_BASE = 'https://api.steampowered.com'

const dataDir = resolve(currentDir, '../../../website/public/data')
const wishlistPath = resolve(dataDir, 'wishlist.json')
const usersPath = resolve(dataDir, 'group_users.json')
const outputPath = resolve(dataDir, 'game_insights.json')

const cacheDir = resolve(currentDir, '../../data')
const cachePath = resolve(cacheDir, 'game-insights-cache.json')

const BUNDLED_FALSE_STALE_MS = 90 * 24 * 60 * 60 * 1000 // 90 days — bundling is rare
/** Cap SG bundle-games fetches per run so a mass cache expiry can't blow the
 *  CI job timeout; the backlog drains across runs (and staggers future
 *  expiries as a side effect). */
const MAX_BUNDLED_FETCHES_PER_RUN = parseInt(
  process.env.BUNDLED_PER_RUN ?? '300',
  10,
)

interface WishlistEntry {
  name: string
  app_id: number | null
  package_id: number | null
  steam_url: string
  image_url: string | null
  wishlist_count: number
}

interface Member {
  username: string
  steam_id: string
  avatar_url?: string
}

export interface GameInsight {
  bundled: boolean | null
  owners: string[]
  wanters: string[]
}

export interface GameInsightsData {
  last_updated: string
  total_members: number
  members_with_library_data: number
  members_with_wishlist_data: number
  games: Record<string, GameInsight>
}

interface CacheBundledEntry {
  fetched_at: string
  bundled: boolean
}

interface InsightsCache {
  bundled: Record<string, CacheBundledEntry>
}

// --- Cache persistence ---

function loadCache(): InsightsCache {
  if (existsSync(cachePath)) {
    try {
      const raw = JSON.parse(readFileSync(cachePath, 'utf-8'))
      // Older cache files may still have a "reviews" section (reviews were
      // moved to game_data.json) — it's simply ignored and dropped on the
      // next save.
      return { bundled: raw.bundled ?? {} }
    } catch (error) {
      console.warn('⚠️  Could not parse existing cache, starting fresh:', error)
    }
  }
  return { bundled: {} }
}

function saveCache(cache: InsightsCache): void {
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true })
  writeFileSync(cachePath, JSON.stringify(cache, null, 2))
}

// --- Steam Web API: per-member owned games / wishlist ---

async function fetchOwnedGames(steamId: string): Promise<Set<number> | null> {
  const url = `${STEAM_BASE}/IPlayerService/GetOwnedGames/v0001/?key=${API_KEY}&steamid=${steamId}&format=json`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data: any = await res.json()
    const games = data?.response?.games
    if (!Array.isArray(games) || games.length === 0) return null
    return new Set(games.map((g: { appid: number }) => g.appid))
  } catch (error) {
    logError(error, `Failed to fetch owned games for steamId ${steamId}`)
    return null
  }
}

async function fetchWishlist(steamId: string): Promise<Set<number> | null> {
  const url = `${STEAM_BASE}/IWishlistService/GetWishlist/v1/?steamid=${steamId}`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data: any = await res.json()
    const items = data?.response?.items
    if (!Array.isArray(items) || items.length === 0) return null
    return new Set(items.map((it: { appid: number }) => it.appid))
  } catch (error) {
    logError(error, `Failed to fetch wishlist for steamId ${steamId}`)
    return null
  }
}

// --- SteamGifts bundle-games search (mirrors group-giveaways.ts's
// fetchBundleGames + the Cloudflare-aware rate-limit handling used
// throughout the SG scrapers) ---

const BUNDLE_GAMES_URL = 'https://www.steamgifts.com/bundle-games/search'
const SG_MAX_RETRIES = 5

function buildSgHeaders(): Record<string, string> {
  const cookie = process.env.SG_COOKIE
  const accessToken = process.env.SG_TOKEN
  return {
    ...(cookie ? { Cookie: cookie } : {}),
    ...(accessToken ? { 'X-Access-Token': accessToken } : {}),
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  }
}

async function fetchBundleGames(
  appId: number,
  retryCount = 0,
): Promise<BundleGamesResponse> {
  const url = new URL(BUNDLE_GAMES_URL)
  url.searchParams.set('q', String(appId))
  url.searchParams.set('format', 'json')

  const response = await fetch(url, { method: 'GET', headers: buildSgHeaders() })
  // Read the body up front: a Cloudflare block can arrive with a 403/503 or
  // even a 2xx status even for this "JSON" endpoint, so status alone can't be
  // trusted — sniff the body like the other SG scrapers do.
  const text = await response.text()
  const rateLimited =
    response.status === 429 ||
    response.status === 403 ||
    response.status === 503 ||
    isRateLimitedHtml(text)

  if (rateLimited) {
    if (retryCount < SG_MAX_RETRIES) {
      const waitMs = 20_000 * Math.pow(1.5, retryCount)
      console.log(
        `⚠️  SG rate limited on bundle-games for appid ${appId} — backing off ${Math.round(
          waitMs / 1000,
        )}s (retry ${retryCount + 1}/${SG_MAX_RETRIES})`,
      )
      await delay(waitMs)
      return fetchBundleGames(appId, retryCount + 1)
    }
    throw new Error(
      `Rate limited fetching bundle-games for appid ${appId} after ${SG_MAX_RETRIES} retries`,
    )
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching bundle-games for appid ${appId}`)
  }

  return JSON.parse(text) as BundleGamesResponse
}

async function checkBundled(appId: number): Promise<boolean> {
  const data = await fetchBundleGames(appId)
  if (!data.success || !data.results?.length) return false
  return data.results.some((g) => g.app_id === appId)
}

// --- Main pipeline ---

export async function generateGameInsightsData(): Promise<void> {
  if (!API_KEY) {
    console.error('❌ STEAM_API_KEY not set')
    process.exit(1)
  }

  console.log('🚀 Starting game insights generation...')

  const wishlistJson = JSON.parse(readFileSync(wishlistPath, 'utf-8'))
  const usersJson = JSON.parse(readFileSync(usersPath, 'utf-8'))

  const allEntries: WishlistEntry[] = wishlistJson.entries ?? []
  let targetEntries = allEntries.filter(
    (e): e is WishlistEntry & { app_id: number } => e.app_id != null,
  )

  const insightsLimit = Number(process.env.GAME_INSIGHTS_LIMIT)
  if (Number.isFinite(insightsLimit) && insightsLimit > 0) {
    targetEntries = targetEntries.slice(0, insightsLimit)
    console.log(
      `🔧 GAME_INSIGHTS_LIMIT set — processing first ${targetEntries.length} wishlist entries`,
    )
  }

  const targetAppIds = Array.from(new Set(targetEntries.map((e) => e.app_id!)))
  console.log(`🎯 Target games (app_id wishlist entries): ${targetAppIds.length}`)

  const allMembers: Member[] = Object.values(usersJson.users ?? {})
  const totalMembers = allMembers.length

  let members = allMembers
  const memberLimit = Number(process.env.MEMBER_LIMIT)
  if (Number.isFinite(memberLimit) && memberLimit > 0) {
    members = members.slice(0, memberLimit)
    console.log(
      `🔧 MEMBER_LIMIT set — fetching Steam data for first ${members.length} of ${totalMembers} members`,
    )
  }

  // --- Per-member Steam data: owners/wanters per target appid ---
  const ownersByApp = new Map<number, Set<string>>()
  const wantersByApp = new Map<number, Set<string>>()
  const targetAppIdSet = new Set(targetAppIds)
  for (const appId of targetAppIds) {
    ownersByApp.set(appId, new Set())
    wantersByApp.set(appId, new Set())
  }

  let membersWithLibraryData = 0
  let membersWithWishlistData = 0

  console.log(`👥 Fetching Steam library/wishlist data for ${members.length} member(s)...`)
  for (let i = 0; i < members.length; i++) {
    const member = members[i]
    process.stderr.write(
      `\r👤 [${i + 1}/${members.length}] ${member.username.padEnd(24)}`,
    )

    const ownedAppIds = await fetchOwnedGames(member.steam_id)
    await delay(200)
    const wishlistAppIds = await fetchWishlist(member.steam_id)
    await delay(200)

    if (ownedAppIds) {
      membersWithLibraryData++
      for (const appId of ownedAppIds) {
        if (targetAppIdSet.has(appId)) ownersByApp.get(appId)!.add(member.steam_id)
      }
    }
    if (wishlistAppIds) {
      membersWithWishlistData++
      for (const appId of wishlistAppIds) {
        if (targetAppIdSet.has(appId)) wantersByApp.get(appId)!.add(member.steam_id)
      }
    }

    if ((i + 1) % 20 === 0) {
      console.log(
        `\n📊 Progress: ${i + 1}/${members.length} members — ${membersWithLibraryData} public libraries, ${membersWithWishlistData} public wishlists so far`,
      )
    }
  }
  process.stderr.write('\n')
  console.log(
    `✅ Member data complete — ${membersWithLibraryData}/${members.length} public libraries, ${membersWithWishlistData}/${members.length} public wishlists`,
  )

  // --- Per-game bundle data (cached) ---
  const cache = loadCache()
  const skipBundled = process.env.SKIP_BUNDLED === '1'
  const now = Date.now()

  const games: Record<string, GameInsight> = {}
  let fetchCount = 0
  let deferredBundled = 0

  console.log(`🎮 Fetching bundle data for ${targetAppIds.length} game(s)...`)
  for (let i = 0; i < targetAppIds.length; i++) {
    const appId = targetAppIds[i]

    // Bundled: true is permanent; false refetches after 90 days; missing
    // entries are skipped entirely when SKIP_BUNDLED=1. Fetches are capped
    // per run; anything over the cap keeps its cached value (or null) and
    // waits for the next run.
    let bundledEntry = cache.bundled[appId]
    const bundledStale =
      !bundledEntry ||
      (bundledEntry.bundled === false &&
        now - new Date(bundledEntry.fetched_at).getTime() >
          BUNDLED_FALSE_STALE_MS)
    if (bundledStale && fetchCount >= MAX_BUNDLED_FETCHES_PER_RUN) {
      deferredBundled++
    } else if (bundledStale && !(skipBundled && !cache.bundled[appId])) {
      try {
        const bundled = await checkBundled(appId)
        bundledEntry = { fetched_at: new Date().toISOString(), bundled }
        cache.bundled[appId] = bundledEntry
        fetchCount++
      } catch (error) {
        console.warn(`⚠️  Failed to fetch bundle status for appid ${appId}:`, String(error))
      }
      await delay(2000)
    }

    const ownerSet = ownersByApp.get(appId) ?? new Set<string>()
    const wanterSet = wantersByApp.get(appId) ?? new Set<string>()

    games[String(appId)] = {
      bundled: bundledEntry ? bundledEntry.bundled : null,
      owners: Array.from(ownerSet),
      wanters: Array.from(wanterSet),
    }

    if (fetchCount > 0 && fetchCount % 50 === 0) {
      saveCache(cache)
      console.log(`💾 Cache checkpoint saved (${fetchCount} fresh fetches so far)`)
    }

    if ((i + 1) % 25 === 0 || i === targetAppIds.length - 1) {
      console.log(`📈 Games processed: ${i + 1}/${targetAppIds.length}`)
    }
  }

  saveCache(cache)

  const output: GameInsightsData = {
    last_updated: new Date().toISOString(),
    total_members: totalMembers,
    members_with_library_data: membersWithLibraryData,
    members_with_wishlist_data: membersWithWishlistData,
    games,
  }

  writeFileSync(outputPath, JSON.stringify(output, null, 2))
  console.log(
    `💾 Game insights saved to ${outputPath} (${Object.keys(games).length} games, ${fetchCount} fresh bundle fetches${deferredBundled > 0 ? `, ${deferredBundled} deferred to next run` : ''})`,
  )
}

if (
  import.meta.url.startsWith('file:') &&
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  await generateGameInsightsData()
}
