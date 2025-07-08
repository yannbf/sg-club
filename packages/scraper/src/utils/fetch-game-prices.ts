import fs from 'fs/promises'
import path from 'path'
import { setTimeout } from 'timers/promises'

interface Giveaway {
  app_id?: number
  package_id?: number
  name: string
}

interface GameData {
  name: string
  app_id: number | null
  package_id: number | null
  price_usd_full: number | null
  price_usd_reduced: number | null
  needs_manual_update: boolean
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

async function processGames() {
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
      '../../../website/public/data/game_prices.json'
    )
    let existingGames: GameData[] = []
    try {
      const existingData = await fs.readFile(existingGamesPath, 'utf-8')
      existingGames = JSON.parse(existingData)
      console.log(`📂 Loaded ${existingGames.length} existing games from cache`)
    } catch (error) {
      console.log('📝 No existing game prices file found, will create new one')
    }

    // Read giveaways data
    const giveawaysPath = path.join(
      import.meta.dirname,
      '../../../website/public/data/giveaways.json'
    )
    const giveawaysData = await fs.readFile(giveawaysPath, 'utf-8')
    const { giveaways }: { giveaways: Giveaway[] } = JSON.parse(giveawaysData)

    console.log(`📚 Found ${giveaways.length} total giveaways to process\n`)
    stats.totalGames = giveaways.length

    const processedIds = new Set(
      existingGames.map((g) => g.app_id || g.package_id)
    )
    const newGames: GameData[] = []
    let processed = 0

    for (const giveaway of giveaways) {
      if (!giveaway.app_id && !giveaway.package_id) {
        stats.skipped++
        continue
      }

      if (giveaway.app_id) {
        if (processedIds.has(giveaway.app_id)) {
          stats.cachedGames++
          if (stats.cachedGames % 100 === 0) {
            console.log(
              `💾 Skipped ${stats.cachedGames} cached games so far...`
            )
          }
          continue
        }

        try {
          console.log(`🎮 Fetching app ${giveaway.app_id}...`)
          await setTimeout(DELAY_BETWEEN_REQUESTS)
          const data = await fetchGameData('app', giveaway.app_id)

          if (!data.error && data.result) {
            console.log(
              `✅ Got "${data.result.name}" - $${(
                data.result.price / 100
              ).toFixed(2)}`
            )
            newGames.push({
              name: data.result.name,
              app_id: data.result.app_id,
              package_id: null,
              price_usd_full: data.result.price,
              price_usd_reduced: Math.round(data.result.price * 0.15),
              needs_manual_update: false,
            })
            const beforeSize = processedIds.size
            processedIds.add(giveaway.app_id)
            const afterSize = processedIds.size
            if (beforeSize === afterSize) {
              console.log(
                `⚠️ Warning: Set size didn't change after adding app_id ${giveaway.app_id}`
              )
            }
            stats.newlyProcessed++
          } else {
            console.log(
              `⚠️ API returned error or no result for app ${giveaway.app_id}:`,
              data.error
            )
            // Add to newGames with needs_manual_update flag
            newGames.push({
              name: giveaway.name,
              app_id: giveaway.app_id,
              package_id: null,
              price_usd_full: null,
              price_usd_reduced: null,
              needs_manual_update: true,
            })
            // Still add to processed to avoid retrying failed apps
            processedIds.add(giveaway.app_id)
            stats.newlyProcessed++
          }

          processed++
          if (processed % 10 === 0) {
            console.log(`\n🔄 Progress: ${processed} games processed\n`)
          }
        } catch (error) {
          console.error(
            `❌ Error fetching data for app ${giveaway.app_id}:`,
            error
          )
          // Add to newGames with needs_manual_update flag
          newGames.push({
            name: giveaway.name,
            app_id: giveaway.app_id,
            package_id: null,
            price_usd_full: null,
            price_usd_reduced: null,
            needs_manual_update: true,
          })
          // Still add to processed to avoid retrying failed apps
          processedIds.add(giveaway.app_id)
          stats.errors++
        }
      } else if (giveaway.package_id) {
        if (processedIds.has(giveaway.package_id)) {
          stats.cachedGames++
          if (stats.cachedGames % 100 === 0) {
            console.log(
              `💾 Skipped ${stats.cachedGames} cached games so far...`
            )
          }
          continue
        }

        try {
          console.log(`📦 Fetching package ${giveaway.package_id}...`)
          await setTimeout(DELAY_BETWEEN_REQUESTS)
          const data = await fetchGameData('sub', giveaway.package_id)

          if (!data.error && data.result) {
            console.log(
              `✅ Got "${data.result.name}" - $${(
                data.result.price / 100
              ).toFixed(2)}`
            )
            newGames.push({
              name: data.result.name,
              app_id: null,
              package_id: giveaway.package_id,
              price_usd_full: data.result.price,
              price_usd_reduced: Math.round(data.result.price * 0.15),
              needs_manual_update: false,
            })
            const beforeSize = processedIds.size
            processedIds.add(giveaway.package_id)
            const afterSize = processedIds.size
            if (beforeSize === afterSize) {
              console.log(
                `⚠️ Warning: Set size didn't change after adding package_id ${giveaway.package_id}`
              )
            }
            stats.newlyProcessed++
          } else {
            console.log(
              `⚠️ API returned error or no result for package ${giveaway.package_id}:`,
              data.error
            )
            // Add to newGames with needs_manual_update flag
            newGames.push({
              name: giveaway.name,
              app_id: null,
              package_id: giveaway.package_id,
              price_usd_full: null,
              price_usd_reduced: null,
              needs_manual_update: true,
            })
            // Still add to processed to avoid retrying failed packages
            processedIds.add(giveaway.package_id)
            stats.newlyProcessed++
          }

          processed++
          if (processed % 10 === 0) {
            console.log(`\n🔄 Progress: ${processed} games processed\n`)
          }
        } catch (error) {
          console.error(
            `❌ Error fetching data for package ${giveaway.package_id}:`,
            error
          )
          // Add to newGames with needs_manual_update flag
          newGames.push({
            name: giveaway.name,
            app_id: null,
            package_id: giveaway.package_id,
            price_usd_full: null,
            price_usd_reduced: null,
            needs_manual_update: true,
          })
          // Still add to processed to avoid retrying failed packages
          processedIds.add(giveaway.package_id)
          stats.errors++
        }
      }
    }

    // Combine existing and new games
    const allGames = [...existingGames, ...newGames]

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
console.log('🚀 Starting game price fetcher...\n')
processGames().catch(console.error)
