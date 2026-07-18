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
  // Steam store review summary — fetched incrementally (see
  // REVIEWS_PER_RUN cap below), independent of the price/HLTB cache-forever
  // semantics since review data legitimately goes stale over time.
  rating_percent: number | null
  review_count: number | null
  review_score_desc: string | null
  reviews_updated_at: string | null
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
}

const DELAY_BETWEEN_REQUESTS = 1000 // 1 second delay between requests
const API_BASE_URL = 'https://esgst.rafaelgomes.xyz/api/game'

const REVIEWS_DELAY_MS = 300
const REVIEWS_STALE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days — review scores move slowly

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
  // First check in cached data
  const cachedGame = cache.get(id) ?? existingGame
  if (cachedGame?.price_usd_full) {
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
): Promise<number | null> {
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
    return cachedGame.hltb_main_story_hours
  }

  // Otherwise, fetch new data
  try {
    console.log(`🕹️ Fetching HLTB data for "${gameName}"...`)
    const hltbData = await hltb.getGameInfo(gameName)
    console.log(`✅ HLTB data: ${hltbData.mainStoryHours} hours`)
    return hltbData.mainStoryHours
  } catch (error) {
    console.error(`❌ Error fetching HLTB data for "${gameName}":`, error)
    return null
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
        rating_percent: existingGame?.rating_percent ?? null,
        review_count: existingGame?.review_count ?? null,
        review_score_desc: existingGame?.review_score_desc ?? null,
        reviews_updated_at: existingGame?.reviews_updated_at ?? null,
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
        gameData.hltb_main_story_hours = await fetchHltbData(
          id,
          gameData.name,
          existingGame,
          runtimeCache
        )
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
