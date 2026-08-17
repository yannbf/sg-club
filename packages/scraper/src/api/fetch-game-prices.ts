import { existsSync } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import { setTimeout } from 'timers/promises'
import { hltb } from './fetch-hltb-data'
import { steamChecker } from './fetch-steam-data'

interface Giveaway {
  app_id?: number
  package_id?: number
  name: string
}

interface WishlistEntry {
  name: string
  app_id: number | null
  package_id: number | null
}

/** A deduplicated item pulled from either giveaways.json or wishlist.json. */
interface TargetItem {
  app_id: number | null
  package_id: number | null
  name: string
}

interface GameData {
  name: string
  app_id: number | null
  package_id: number | null
  app_id_for_package_id?: number | null
  price_usd_full: number | null
  price_usd_reduced: number | null
  needs_manual_update: boolean
  hltb_main_story_hours: number | null
  // When we last asked HLTB about this game. Lets a null result act as a
  // negative cache (HLTB simply has no entry for many giveaway games) instead
  // of being retried on every run.
  hltb_checked_at?: string | null
  // Steam store review summary — fetched incrementally (see
  // REVIEWS_PER_RUN cap below), independent of the price/HLTB cache-forever
  // semantics since review data legitimately goes stale over time.
  rating_percent: number | null
  review_count: number | null
  review_score_desc: string | null
  reviews_updated_at: string | null
  // Steam store release status. `coming_soon` is what the play-required rules
  // read: an unreleased game can't be played, so it must not count toward a
  // member's unplayed total or deadline warnings. Fetched incrementally like
  // reviews, but a released game is never re-checked (see the pass below).
  coming_soon: boolean | null
  release_date: string | null
  release_checked_at: string | null
  // Steam's own store art URL. The flat
  // `store_item_assets/steam/apps/<id>/header.jpg` path the site builds from an
  // app id 404s for apps Steam has moved behind a per-app content hash — new
  // releases, mostly, which is most of what gets given away. appdetails is the
  // only place that hash is published, so it's resolved here and stored.
  header_image_url: string | null
  header_image_checked_at: string | null
}

interface ApiResponse {
  error: string | null
  result: {
    app_id: number
    name: string
    price: number
  }
}

interface ReviewSummary {
  rating_percent: number | null
  review_count: number | null
  review_score_desc: string | null
}

interface ReleaseStatus {
  coming_soon: boolean
  release_date: string | null
}

/**
 * `null` is a per-app failure (delisted, region-locked, transient) — skip that
 * app and carry on. `'rate_limited'` means Steam is refusing the whole
 * endpoint, so the pass should stop and let the next run continue where it
 * left off, rather than burning its remaining wallclock on guaranteed 429s.
 */
type ReleaseFetchResult = ReleaseStatus | null | 'rate_limited'

interface Stats {
  totalGames: number
  newlyProcessed: number
  errors: number
  skipped: number
  newGamesProcessed: number
  newGamesDeferred: number
  reviewsFetched: number
  reviewsFailed: number
  reviewsDeferred: number
  releasesFetched: number
  releasesFailed: number
  releasesDeferred: number
  headerArtFetched: number
  headerArtFailed: number
  headerArtDeferred: number
}

const DELAY_BETWEEN_REQUESTS = 1000 // 1 second delay between requests
const API_BASE_URL = 'https://esgst.rafaelgomes.xyz/api/game'

const REVIEWS_DELAY_MS = 300
const REVIEWS_STALE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days — review scores move slowly

// appdetails is far stingier than appreviews (roughly 200 requests per 5
// minutes per IP), so this pass paces itself well below that rather than
// reusing the review pass's 300ms.
const RELEASE_DELAY_MS = 1500
// How long an unreleased verdict is trusted. Only `coming_soon: true` games
// are ever re-checked (a released game cannot un-release), and a release date
// that slips or lands needs to be picked up within a day or two, since it
// decides whether the win starts counting against its owner.
const RELEASE_STALE_MS = 2 * 24 * 60 * 60 * 1000 // 2 days
// Art moves only when a developer replaces it, so a resolved URL is trusted for
// a month. A miss is retried after a week: an app with no store page today
// (unreleased, delisted, region-locked) may well have one next week.
const HEADER_ART_STALE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const HEADER_ART_RETRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const HEADER_ART_DELAY_MS = 1500
// How long a null HLTB result is trusted before we ask again. Most nulls are
// games HLTB will never have, so retrying often is pure wasted wallclock.
const HLTB_NULL_RETRY_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

/**
 * How many brand-new games (not yet present in game_data.json) get the full
 * ESGST + HLTB treatment in a single run. Games already in giveaways.json
 * churn slowly, but wishlist.json can dump a ~1000-game one-time backlog on
 * the union set — without a cap that would blow past the CI job's 30-min
 * timeout. Anything over the cap is simply skipped this run (never added to
 * the map), so it's picked up automatically on the next 8h run.
 */
function getNewGamesCap(): number {
  const raw = process.env.GAME_DATA_NEW_PER_RUN
  const parsed = raw !== undefined ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 150
}

/** How many stale/missing review summaries get fetched in a single run. */
function getReviewsPerRunCap(): number {
  const raw = process.env.GAME_DATA_REVIEWS_PER_RUN
  const parsed = raw !== undefined ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 200
}

/** How many stale/missing release statuses get fetched in a single run. */
function getReleasesPerRunCap(): number {
  const raw = process.env.GAME_DATA_RELEASE_PER_RUN
  const parsed = raw !== undefined ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 200
}

/** How many stale/missing store-art URLs get resolved in a single run. */
function getHeaderArtPerRunCap(): number {
  const raw = process.env.GAME_DATA_HEADER_ART_PER_RUN
  const parsed = raw !== undefined ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 200
}

async function fetchGameData(
  type: 'app' | 'sub',
  id: number
): Promise<ApiResponse> {
  const response = await fetch(`${API_BASE_URL}/${type}/${id}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch game data: ${response.statusText}`)
  }
  const data = (await response.json()) as ApiResponse
  return data
}

// Helper functions to separate concerns
async function fetchPriceData(
  type: 'app' | 'sub',
  id: number,
  existingGame: GameData | null,
  cache: Map<number, GameData>
): Promise<{
  name: string
  price_usd_full: number | null
  price_usd_reduced: number | null
  needs_manual_update: boolean
}> {
  // First check in cached data. Note != null, not truthiness: free games have
  // price 0, and a truthy check made every one of them refetch on every run.
  const cachedGame = cache.get(id) ?? existingGame
  if (cachedGame && cachedGame.price_usd_full != null) {
    console.log(
      `💰 Using cached price data: $${(cachedGame.price_usd_full / 100).toFixed(
        2
      )}`
    )
    return {
      name: cachedGame.name,
      price_usd_full: cachedGame.price_usd_full,
      price_usd_reduced: cachedGame.price_usd_reduced,
      needs_manual_update: cachedGame.needs_manual_update,
    }
  }

  // Otherwise, fetch new data
  try {
    console.log(`🎮 Fetching ${type} ${id}...`)
    await setTimeout(DELAY_BETWEEN_REQUESTS)
    const data = await fetchGameData(type, id)

    if (!data.error && data.result) {
      console.log(
        `✅ Got "${data.result.name}" - $${(data.result.price / 100).toFixed(
          2
        )}`
      )
      return {
        name: data.result.name,
        price_usd_full: data.result.price,
        price_usd_reduced: Math.round(data.result.price * 0.15),
        needs_manual_update: false,
      }
    } else {
      console.log(
        `⚠️ API returned error or no result for ${type} ${id}:`,
        data.error
      )
      // If we have any existing data, use it even if it needs update
      if (existingGame) {
        console.log('📝 Falling back to existing data')
        return {
          name: existingGame.name,
          price_usd_full: existingGame.price_usd_full,
          price_usd_reduced: existingGame.price_usd_reduced,
          needs_manual_update: true,
        }
      }
      return {
        name: '', // Will be filled by giveaway name
        price_usd_full: null,
        price_usd_reduced: null,
        needs_manual_update: true,
      }
    }
  } catch (error) {
    console.error(`❌ Error fetching data for ${type} ${id}:`, error)
    // If we have any existing data, use it even if it needs update
    if (existingGame) {
      console.log('📝 Falling back to existing data')
      return {
        name: existingGame.name,
        price_usd_full: existingGame.price_usd_full,
        price_usd_reduced: existingGame.price_usd_reduced,
        needs_manual_update: true,
      }
    }
    return {
      name: '', // Will be filled by giveaway name
      price_usd_full: null,
      price_usd_reduced: null,
      needs_manual_update: true,
    }
  }
}

async function fetchHltbData(
  id: number,
  gameName: string,
  existingGame: GameData | null,
  cache: Map<number, GameData>
): Promise<{ hours: number | null; checkedAt: string | null }> {
  // First check runtime cache for any game with this name
  const cachedGame = cache.get(id) ?? existingGame

  // Then check existing game data
  if (
    cachedGame &&
    cachedGame.hltb_main_story_hours !== null &&
    cachedGame.hltb_main_story_hours !== undefined
  ) {
    console.log(
      `📝 Using cached HLTB data: ${cachedGame.hltb_main_story_hours} hours`
    )
    return {
      hours: cachedGame.hltb_main_story_hours,
      checkedAt: cachedGame.hltb_checked_at ?? null,
    }
  }

  // Negative cache: a recent null answer means HLTB (probably) has no entry
  // for this game — trust that for a while instead of re-asking every run.
  if (
    cachedGame?.hltb_checked_at &&
    Date.now() - new Date(cachedGame.hltb_checked_at).getTime() <
      HLTB_NULL_RETRY_MS
  ) {
    return { hours: null, checkedAt: cachedGame.hltb_checked_at }
  }

  // Otherwise, fetch new data
  try {
    console.log(`🕹️ Fetching HLTB data for "${gameName}"...`)
    const hltbData = await hltb.getGameInfo(gameName)
    console.log(`✅ HLTB data: ${hltbData.mainStoryHours} hours`)
    // A null here is a genuine "HLTB has no entry" answer — stamp it so the
    // negative cache kicks in.
    return { hours: hltbData.mainStoryHours, checkedAt: new Date().toISOString() }
  } catch (error) {
    // Transient failure (HLTB throws on network/5xx) — keep the old stamp so
    // the next run retries instead of negative-caching an outage for 30 days.
    console.error(`❌ Error fetching HLTB data for "${gameName}":`, error)
    return { hours: null, checkedAt: cachedGame?.hltb_checked_at ?? null }
  }
}

/**
 * Fetch a Steam store review summary for a single app, with linear backoff
 * retry on 429/5xx (mirrors getJsonWithRetry in generate-challenge-data.ts).
 * Non-retryable HTTP errors (e.g. 404 for a delisted app) fail fast.
 * Returns null on exhausted retries or a non-retryable failure.
 */
async function fetchReviewSummary(
  appId: number,
  attempts = 4
): Promise<ReviewSummary | null> {
  const url =
    `https://store.steampowered.com/appreviews/${appId}?json=1` +
    `&language=all&purchase_type=all&num_per_page=0`

  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url)
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`Retryable ${response.status} ${response.statusText}`)
      }
      if (!response.ok) {
        console.warn(
          `⚠️ Review fetch failed for appid ${appId}: ${response.status} ${response.statusText}`
        )
        return null
      }
      const data = (await response.json()) as {
        query_summary?: {
          review_score_desc?: string
          total_positive?: number
          total_reviews?: number
        }
      }
      const qs = data.query_summary ?? {}
      const totalReviews = qs.total_reviews ?? 0
      const totalPositive = qs.total_positive ?? 0
      return {
        rating_percent:
          totalReviews > 0
            ? Math.round((totalPositive / totalReviews) * 100)
            : null,
        review_count: totalReviews,
        review_score_desc: qs.review_score_desc ?? null,
      }
    } catch (error) {
      lastErr = error
      if (attempt < attempts) await setTimeout(500 * attempt)
    }
  }
  console.warn(
    `⚠️ Review fetch failed after ${attempts} attempts for appid ${appId}:`,
    String(lastErr)
  )
  return null
}

/**
 * Fetch a Steam store release status for a single app. `filters=release_date`
 * keeps the response to a few dozen bytes instead of the full (often >100KB)
 * appdetails payload. Same linear-backoff retry as fetchReviewSummary.
 *
 * Returns null on a failure or on `success: false` (delisted or region-locked
 * apps), which the caller treats as "unknown" — never as "released", since
 * that would resurrect the very warnings this data exists to suppress.
 */
async function fetchReleaseStatus(
  appId: number,
  attempts = 3
): Promise<ReleaseFetchResult> {
  const url =
    `https://store.steampowered.com/api/appdetails/?appids=${appId}` +
    `&filters=release_date&cc=us&l=en`

  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url)
      // A 429 here means the rolling window is spent; no amount of in-loop
      // backoff we're willing to wait will clear it.
      if (response.status === 429) return 'rate_limited'
      if (response.status >= 500) {
        throw new Error(`Retryable ${response.status} ${response.statusText}`)
      }
      if (!response.ok) {
        console.warn(
          `⚠️ Release fetch failed for appid ${appId}: ${response.status} ${response.statusText}`
        )
        return null
      }
      const data = (await response.json()) as Record<
        string,
        {
          success?: boolean
          data?: { release_date?: { coming_soon?: boolean; date?: string } }
        }
      >
      const entry = data[String(appId)]
      if (!entry?.success || !entry.data?.release_date) return null
      return {
        coming_soon: entry.data.release_date.coming_soon === true,
        release_date: entry.data.release_date.date || null,
      }
    } catch (error) {
      lastErr = error
      if (attempt < attempts) await setTimeout(500 * attempt)
    }
  }
  console.warn(
    `⚠️ Release fetch failed after ${attempts} attempts for appid ${appId}:`,
    String(lastErr)
  )
  return null
}

/**
 * Games whose release status is worth (re-)fetching this run, most urgent
 * first. A game already known to be released is skipped forever — it cannot
 * un-release — so the steady-state pass is tiny and the bulk of the work is
 * the one-time backfill of never-checked games.
 *
 * That backfill is ordered by app ID, highest first. Steam hands out app IDs
 * in ascending order, so the newest games — the only ones that can still be
 * unreleased — are checked in the first run instead of waiting behind
 * thousands of long-released back-catalogue titles.
 */
/**
 * Resolve a game's store header art. `filters=basic` is the smallest appdetails
 * slice that still carries `header_image`, and its URL embeds the content hash
 * that the flat CDN path lacks. Falls back to the capsule when a store page
 * carries no header.
 *
 * Returns null on failure or `success: false`; `'rate_limited'` stops the pass
 * for the same reason `fetchReleaseStatus` does.
 */
async function fetchHeaderArt(
  appId: number,
  attempts = 3,
): Promise<string | null | 'rate_limited'> {
  const url =
    `https://store.steampowered.com/api/appdetails/?appids=${appId}` +
    `&filters=basic&cc=us&l=en`

  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url)
      if (response.status === 429) return 'rate_limited'
      if (response.status >= 500) {
        throw new Error(`Retryable ${response.status} ${response.statusText}`)
      }
      if (!response.ok) {
        console.warn(
          `⚠️ Header art fetch failed for appid ${appId}: ${response.status} ${response.statusText}`
        )
        return null
      }
      const data = (await response.json()) as Record<
        string,
        {
          success?: boolean
          data?: { header_image?: string; capsule_image?: string }
        }
      >
      const entry = data[String(appId)]
      if (!entry?.success) return null
      return entry.data?.header_image || entry.data?.capsule_image || null
    } catch (error) {
      lastErr = error
      if (attempt < attempts) await setTimeout(attempt * 1000)
    }
  }

  console.warn(`⚠️ Header art fetch failed for appid ${appId}:`, lastErr)
  return null
}

/**
 * Games whose store art is missing or old enough to re-resolve, never-checked
 * first and then oldest-checked. A game that already has a URL is only revisited
 * once it passes HEADER_ART_STALE_MS; one that came back empty waits out the
 * shorter HEADER_ART_RETRY_MS.
 */
export function selectHeaderArtCandidates(
  games: GameData[],
  now: number
): GameData[] {
  const appIdOf = (game: GameData) => game.app_id || game.app_id_for_package_id || 0

  return games
    .filter((game) => {
      if (!appIdOf(game)) return false
      if (!game.header_image_checked_at) return true
      const age = now - new Date(game.header_image_checked_at).getTime()
      return age > (game.header_image_url ? HEADER_ART_STALE_MS : HEADER_ART_RETRY_MS)
    })
    .sort((a, b) => {
      const aChecked = a.header_image_checked_at
      const bChecked = b.header_image_checked_at
      if (!aChecked && !bChecked) return appIdOf(b) - appIdOf(a)
      if (!aChecked) return -1
      if (!bChecked) return 1
      return new Date(aChecked).getTime() - new Date(bChecked).getTime()
    })
}

export function selectReleaseCandidates(
  games: GameData[],
  now: number
): GameData[] {
  const appIdOf = (game: GameData) => game.app_id || game.app_id_for_package_id || 0

  return games
    .filter((game) => {
      if (!appIdOf(game)) return false
      if (!game.release_checked_at) return true
      if (game.coming_soon !== true) return false
      return now - new Date(game.release_checked_at).getTime() > RELEASE_STALE_MS
    })
    .sort((a, b) => {
      const aChecked = a.release_checked_at
      const bChecked = b.release_checked_at
      if (!aChecked && !bChecked) return appIdOf(b) - appIdOf(a)
      if (!aChecked) return -1
      if (!bChecked) return 1
      return new Date(aChecked).getTime() - new Date(bChecked).getTime()
    })
}

function formatStats(stats: Stats): string {
  return `
📊 Processing Statistics:
------------------------
🎮 Total games in union set: ${stats.totalGames}
✨ Newly processed: ${stats.newlyProcessed}
🆕 New games fetched this run: ${stats.newGamesProcessed}
⏳ New games deferred (cap reached): ${stats.newGamesDeferred}
⭐ Review summaries fetched: ${stats.reviewsFetched}
⚠️  Review fetches failed: ${stats.reviewsFailed}
⏳ Review fetches deferred (cap reached): ${stats.reviewsDeferred}
🗓️  Release statuses fetched: ${stats.releasesFetched}
⚠️  Release fetches failed: ${stats.releasesFailed}
⏳ Release fetches deferred (cap reached): ${stats.releasesDeferred}
🖼️  Store art resolved: ${stats.headerArtFetched}
⚠️  Store art lookups failed: ${stats.headerArtFailed}
⏳ Store art lookups deferred (cap reached): ${stats.headerArtDeferred}
❌ Errors: ${stats.errors}
⏭️  Skipped (no ID): ${stats.skipped}
------------------------
`
}

export async function generateGamePrices() {
  console.log('🚀 Starting game price fetcher...\n')
  const stats: Stats = {
    totalGames: 0,
    newlyProcessed: 0,
    errors: 0,
    skipped: 0,
    newGamesProcessed: 0,
    newGamesDeferred: 0,
    reviewsFetched: 0,
    reviewsFailed: 0,
    reviewsDeferred: 0,
    releasesFetched: 0,
    releasesFailed: 0,
    releasesDeferred: 0,
    headerArtFetched: 0,
    headerArtFailed: 0,
    headerArtDeferred: 0,
  }

  try {
    // Read existing games data if it exists
    const existingGamesPath = path.join(
      import.meta.dirname,
      '../../../website/public/data/game_data.json'
    )
    let existingGames: GameData[] = []
    try {
      const existingData = await fs.readFile(existingGamesPath, 'utf-8')
      existingGames = JSON.parse(existingData)
      console.log(`📂 Loaded ${existingGames.length} existing games from cache`)
    } catch (error) {
      console.log('📝 No existing game prices file found, will create new one')
    }

    // Create a map of existing games for faster lookup and updates
    const existingGamesMap = new Map<number, GameData>()
    for (const game of existingGames) {
      if (game.app_id) {
        existingGamesMap.set(game.app_id, game)
      } else if (game.package_id) {
        existingGamesMap.set(game.package_id, game)
      }
    }

    // Read giveaways data
    const giveawaysPath = path.join(
      import.meta.dirname,
      '../../../website/public/data/giveaways.json'
    )
    if (!existsSync(giveawaysPath)) {
      console.log(
        '⚠️ No giveaways.json file found. Please run the scraper first to generate it.'
      )
      process.exit(0)
    }
    const giveawaysData = await fs.readFile(giveawaysPath, 'utf-8')
    const { giveaways }: { giveaways: Giveaway[] } = JSON.parse(giveawaysData)
    console.log(`📚 Found ${giveaways.length} total giveaways`)

    // Read wishlist data (optional — may not exist yet, or on a local run)
    const wishlistPath = path.join(
      import.meta.dirname,
      '../../../website/public/data/wishlist.json'
    )
    let wishlistEntries: WishlistEntry[] = []
    if (existsSync(wishlistPath)) {
      const wishlistData = await fs.readFile(wishlistPath, 'utf-8')
      const parsed = JSON.parse(wishlistData)
      wishlistEntries = parsed.entries ?? []
      console.log(`💝 Found ${wishlistEntries.length} wishlist entries`)
    } else {
      console.log('📝 No wishlist.json found, skipping wishlist union')
    }

    // Build the union of giveaways + wishlist games, deduped by app_id/package_id.
    const targetItemsMap = new Map<number, TargetItem>()
    for (const giveaway of giveaways) {
      const id = giveaway.app_id || giveaway.package_id
      if (!id) {
        stats.skipped++
        continue
      }
      if (!targetItemsMap.has(id)) {
        targetItemsMap.set(id, {
          app_id: giveaway.app_id || null,
          package_id: giveaway.package_id || null,
          name: giveaway.name,
        })
      }
    }
    for (const entry of wishlistEntries) {
      // Skip wishlist entries with no app_id AND no package_id. Entries with
      // a package_id but null app_id are kept.
      const id = entry.app_id || entry.package_id
      if (!id) {
        stats.skipped++
        continue
      }
      if (!targetItemsMap.has(id)) {
        targetItemsMap.set(id, {
          app_id: entry.app_id || null,
          package_id: entry.package_id || null,
          name: entry.name,
        })
      }
    }

    const targetItems = Array.from(targetItemsMap.values())
    console.log(
      `📚 Union set: ${targetItems.length} unique games to consider\n`
    )
    stats.totalGames = targetItems.length

    const newGamesCap = getNewGamesCap()
    console.log(`🆕 New-game cap for this run: ${newGamesCap}\n`)

    // Runtime cache for this session
    const runtimeCache = new Map<number, GameData>()

    let processed = 0

    for (const item of targetItems) {
      const id = item.app_id || item.package_id
      if (!id) continue // TypeScript safety

      const existingGame = existingGamesMap.get(id) || null
      const isNewGame = !existingGame

      if (isNewGame && stats.newGamesProcessed >= newGamesCap) {
        stats.newGamesDeferred++
        continue
      }

      // Fetch price data if needed
      const priceData = await fetchPriceData(
        item.app_id ? 'app' : 'sub',
        id,
        existingGame,
        runtimeCache
      )

      // Create or update game data. Review fields are carried over from the
      // existing entry (or default to null for brand-new games) — they're
      // updated separately below by the incremental review-fetch pass, not
      // here, so this loop never clobbers a previously-fetched rating.
      const gameData: GameData = {
        name: priceData.name || item.name,
        app_id: item.app_id || null,
        package_id: item.package_id || null,
        price_usd_full: priceData.price_usd_full,
        price_usd_reduced: priceData.price_usd_reduced,
        needs_manual_update: priceData.needs_manual_update,
        hltb_main_story_hours: null, // Will be updated below
        hltb_checked_at: existingGame?.hltb_checked_at ?? null,
        rating_percent: existingGame?.rating_percent ?? null,
        review_count: existingGame?.review_count ?? null,
        review_score_desc: existingGame?.review_score_desc ?? null,
        reviews_updated_at: existingGame?.reviews_updated_at ?? null,
        coming_soon: existingGame?.coming_soon ?? null,
        release_date: existingGame?.release_date ?? null,
        release_checked_at: existingGame?.release_checked_at ?? null,
        header_image_url: existingGame?.header_image_url ?? null,
        header_image_checked_at: existingGame?.header_image_checked_at ?? null,
      }

      if (
        existingGame?.package_id &&
        existingGame.app_id_for_package_id === undefined
      ) {
        const appIdForSubId = await steamChecker.getAppIdForSubId(
          existingGame.package_id
        )
        console.log(
          `🔍 Found app ID for package ID ${existingGame.package_id}: ${appIdForSubId}`
        )
        gameData.app_id_for_package_id = appIdForSubId
      }

      // Fetch HLTB data if we have a valid game name
      if (gameData.name) {
        const hltbResult = await fetchHltbData(
          id,
          gameData.name,
          existingGame,
          runtimeCache
        )
        gameData.hltb_main_story_hours = hltbResult.hours
        gameData.hltb_checked_at = hltbResult.checkedAt
      }

      // Update existing game or add new one
      if (existingGame) {
        // Update existing game
        Object.assign(existingGame, gameData)
        console.log(`📝 Updated existing game: ${gameData.name}`)
      } else {
        // Add new game to map
        existingGamesMap.set(id, gameData)
        console.log(`✨ Added new game: ${gameData.name}`)
        stats.newGamesProcessed++
      }

      runtimeCache.set(id, gameData) // Add to runtime cache
      stats.newlyProcessed++

      processed++
      if (processed % 10 === 0) {
        console.log(`\n🔄 Progress: ${processed} games processed\n`)
      }
    }

    if (stats.newGamesDeferred > 0) {
      console.log(
        `⏳ Deferred ${stats.newGamesDeferred} new game(s) to a future run (cap ${newGamesCap} reached)\n`
      )
    }

    // --- Incremental review-summary pass ---
    // Only app_id games are eligible (package-only entries keep nulls).
    // Priority: never-fetched (null) games first, then oldest-fetched first.
    const reviewsPerRunCap = getReviewsPerRunCap()
    const now = Date.now()

    const reviewCandidates = Array.from(existingGamesMap.values()).filter(
      (game) => {
        if (!game.app_id) return false
        if (!game.reviews_updated_at) return true
        return (
          now - new Date(game.reviews_updated_at).getTime() > REVIEWS_STALE_MS
        )
      }
    )
    reviewCandidates.sort((a, b) => {
      if (!a.reviews_updated_at && !b.reviews_updated_at) return 0
      if (!a.reviews_updated_at) return -1
      if (!b.reviews_updated_at) return 1
      return (
        new Date(a.reviews_updated_at).getTime() -
        new Date(b.reviews_updated_at).getTime()
      )
    })

    const reviewsToFetch = reviewCandidates.slice(0, reviewsPerRunCap)
    stats.reviewsDeferred = reviewCandidates.length - reviewsToFetch.length

    console.log(
      `\n⭐ Fetching review summaries for ${reviewsToFetch.length} game(s) (cap ${reviewsPerRunCap}, ${stats.reviewsDeferred} deferred)...\n`
    )

    for (const game of reviewsToFetch) {
      if (!game.app_id) continue // TypeScript safety
      const summary = await fetchReviewSummary(game.app_id)
      if (summary) {
        game.rating_percent = summary.rating_percent
        game.review_count = summary.review_count
        game.review_score_desc = summary.review_score_desc
        game.reviews_updated_at = new Date().toISOString()
        stats.reviewsFetched++
        console.log(
          `⭐ ${game.name}: ${summary.rating_percent ?? 'N/A'}% (${
            summary.review_count ?? 0
          } reviews) — ${summary.review_score_desc ?? 'n/a'}`
        )
      } else {
        stats.reviewsFailed++
      }
      await setTimeout(REVIEWS_DELAY_MS)
    }

    // --- Incremental release-status pass ---
    const releasesPerRunCap = getReleasesPerRunCap()
    const releaseCandidates = selectReleaseCandidates(
      Array.from(existingGamesMap.values()),
      Date.now()
    )
    const releasesToFetch = releaseCandidates.slice(0, releasesPerRunCap)
    stats.releasesDeferred = releaseCandidates.length - releasesToFetch.length

    console.log(
      `\n🗓️ Fetching release status for ${releasesToFetch.length} game(s) (cap ${releasesPerRunCap}, ${stats.releasesDeferred} deferred)...\n`
    )

    for (const game of releasesToFetch) {
      const appId = game.app_id || game.app_id_for_package_id
      if (!appId) continue // TypeScript safety
      const status = await fetchReleaseStatus(appId)
      if (status === 'rate_limited') {
        console.warn(
          `⚠️ Steam rate-limited the release pass — stopping here, the next run resumes from this point.`
        )
        break
      }
      if (status) {
        const justReleased = game.coming_soon === true && !status.coming_soon
        game.coming_soon = status.coming_soon
        game.release_date = status.release_date
        game.release_checked_at = new Date().toISOString()
        stats.releasesFetched++
        if (status.coming_soon) {
          console.log(
            `🗓️ ${game.name}: unreleased (${status.release_date ?? 'no date'})`
          )
        } else if (justReleased) {
          console.log(
            `🚀 ${game.name}: released (${status.release_date ?? 'no date'}) — play requirements now count`
          )
        }
      } else {
        // Leave coming_soon untouched: an unknown answer must not be read as
        // "released". Not stamping release_checked_at means we retry next run.
        stats.releasesFailed++
      }
      await setTimeout(RELEASE_DELAY_MS)
    }

    // --- Incremental store-art pass ---
    const headerArtPerRunCap = getHeaderArtPerRunCap()
    const headerArtCandidates = selectHeaderArtCandidates(
      Array.from(existingGamesMap.values()),
      Date.now()
    )
    const headerArtToFetch = headerArtCandidates.slice(0, headerArtPerRunCap)
    stats.headerArtDeferred = headerArtCandidates.length - headerArtToFetch.length

    console.log(
      `\n🖼️ Resolving store art for ${headerArtToFetch.length} game(s) (cap ${headerArtPerRunCap}, ${stats.headerArtDeferred} deferred)...\n`
    )

    for (const game of headerArtToFetch) {
      const appId = game.app_id || game.app_id_for_package_id
      if (!appId) continue // TypeScript safety
      const art = await fetchHeaderArt(appId)
      if (art === 'rate_limited') {
        console.warn(
          `⚠️ Steam rate-limited the store-art pass — stopping here, the next run resumes from this point.`
        )
        break
      }
      // A null answer is stamped too: it's a real "this app has no store page"
      // for most candidates, and HEADER_ART_RETRY_MS decides when to ask again.
      game.header_image_url = art
      game.header_image_checked_at = new Date().toISOString()
      if (art) {
        stats.headerArtFetched++
      } else {
        stats.headerArtFailed++
      }
      await setTimeout(HEADER_ART_DELAY_MS)
    }

    // Convert map values back to array for saving
    const allGames = Array.from(existingGamesMap.values())

    // Save the results
    await fs.writeFile(
      existingGamesPath,
      JSON.stringify(allGames, null, 2),
      'utf-8'
    )

    console.log(formatStats(stats))
    console.log(`💾 Saved ${allGames.length} total games to database`)
  } catch (error) {
    console.error('❌ Fatal error processing games:', error)
  }
}

// Run the script
// processGames().catch(console.error)
