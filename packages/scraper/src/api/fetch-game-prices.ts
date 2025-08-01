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

interface GameData {
  name: string
  app_id: number | null
  package_id: number | null
  app_id_for_package_id?: number | null
  price_usd_full: number | null
  price_usd_reduced: number | null
  needs_manual_update: boolean
  hltb_main_story_hours: number | null
}

interface ApiResponse {
  error: string | null
  result: {
    app_id: number
    name: string
    price: number
  }
}

interface Stats {
  totalGames: number
  cachedGames: number
  newlyProcessed: number
  errors: number
  skipped: number
}

const DELAY_BETWEEN_REQUESTS = 1000 // 1 second delay between requests
const API_BASE_URL = 'https://esgst.rafaelgomes.xyz/api/game'

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

function formatStats(stats: Stats): string {
  return `
📊 Processing Statistics:
------------------------
🎮 Total games found: ${stats.totalGames}
💾 Already in cache: ${stats.cachedGames}
✨ Newly processed: ${stats.newlyProcessed}
❌ Errors: ${stats.errors}
⏭️  Skipped (no ID): ${stats.skipped}
------------------------
`
}

export async function generateGamePrices() {
  console.log('🚀 Starting game price fetcher...\n')
  const stats: Stats = {
    totalGames: 0,
    cachedGames: 0,
    newlyProcessed: 0,
    errors: 0,
    skipped: 0,
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

    console.log(`📚 Found ${giveaways.length} total giveaways to process\n`)
    stats.totalGames = giveaways.length

    // Track what we've processed in this run to avoid duplicates
    const processedInThisRun = new Set<number>()
    let processed = 0

    // Runtime cache for this session
    const runtimeCache = new Map<number, GameData>()

    for (const giveaway of giveaways) {
      if (!giveaway.app_id && !giveaway.package_id) {
        stats.skipped++
        continue
      }

      const id = giveaway.app_id || giveaway.package_id
      if (!id) continue // TypeScript safety

      // Skip if we've already processed this ID in this run
      if (processedInThisRun.has(id)) {
        console.log(
          `⚠️ Skipping duplicate entry for ID ${id} (processed in this run)`
        )
        continue
      }

      const existingGame = existingGamesMap.get(id) || null

      // Fetch price data if needed
      const priceData = await fetchPriceData(
        giveaway.app_id ? 'app' : 'sub',
        id,
        existingGame,
        runtimeCache
      )

      // Create or update game data
      const gameData: GameData = {
        name: priceData.name || giveaway.name,
        app_id: giveaway.app_id || null,
        package_id: giveaway.package_id || null,
        price_usd_full: priceData.price_usd_full,
        price_usd_reduced: priceData.price_usd_reduced,
        needs_manual_update: priceData.needs_manual_update,
        hltb_main_story_hours: null, // Will be updated below
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
      }

      processedInThisRun.add(id) // Mark as processed in this run
      runtimeCache.set(id, gameData) // Add to runtime cache
      stats.newlyProcessed++

      processed++
      if (processed % 10 === 0) {
        console.log(`\n🔄 Progress: ${processed} games processed\n`)
      }
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
