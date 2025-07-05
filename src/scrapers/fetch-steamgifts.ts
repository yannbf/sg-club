import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  Giveaway,
  SteamGiftsResponse,
  BundleGame,
  BundleGamesResponse,
  CVStatus,
} from '../types/steamgifts.js'
import { delay, formatDate } from '../utils/common.js'

// API-specific Creator interface (different from HTML scraping)
interface Creator {
  id: number
  steam_id: string
  username: string
}

// API-specific Group interface (different from HTML scraping)
interface Group {
  id: number
  gid: string
  name: string
}

class SteamGiftsFetcher {
  private readonly baseUrl =
    'https://www.steamgifts.com/group/WlYTQ/thegiveawaysclub/search' as const
  private readonly cookie =
    'PHPSESSID=91ic94969ca1030jaons7142nq852vmq9mfvis7lbqi35i7i' as const
  private readonly bundleGamesUrl =
    'https://www.steamgifts.com/bundle-games/search' as const

  // Cache for bundle game data to avoid duplicate API calls
  // Key can be app_id (number) or game name (string) for games without app_id
  private bundleGameCache = new Map<number | string, BundleGame | null>()

  private async fetchPage(page: number): Promise<SteamGiftsResponse> {
    const url = new URL(this.baseUrl)
    url.searchParams.set('page', page.toString())
    url.searchParams.set('format', 'json')

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Cookie: this.cookie,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    return (await response.json()) as SteamGiftsResponse
  }

  private async fetchBundleGames(appId: number): Promise<BundleGamesResponse> {
    const url = new URL(this.bundleGamesUrl)
    url.searchParams.set('q', appId.toString())
    url.searchParams.set('format', 'json')

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Cookie: this.cookie,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    return (await response.json()) as BundleGamesResponse
  }

  private async fetchBundleGamesByName(
    gameName: string
  ): Promise<BundleGamesResponse> {
    const url = new URL(this.bundleGamesUrl)
    url.searchParams.set('q', gameName)
    url.searchParams.set('format', 'json')

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Cookie: this.cookie,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    return (await response.json()) as BundleGamesResponse
  }

  private async getCVStatus(giveaway: Giveaway): Promise<CVStatus> {
    // Determine cache key - use app_id if available, otherwise use game name
    const cacheKey = giveaway.app_id || giveaway.name
    const searchBy = giveaway.app_id ? 'app_id' : 'name'

    // Check cache first
    if (this.bundleGameCache.has(cacheKey)) {
      const bundleGame = this.bundleGameCache.get(cacheKey)!
      console.log(
        `💾 Cache hit for ${giveaway.name} (${searchBy}: ${cacheKey})`
      )
      return this.calculateCVStatus(giveaway, bundleGame)
    }

    try {
      console.log(
        `🔍 Fetching CV data for: ${giveaway.name} (${searchBy}: ${cacheKey})`
      )

      // Fetch bundle game data
      const bundleData = giveaway.app_id
        ? await this.fetchBundleGames(giveaway.app_id)
        : await this.fetchBundleGamesByName(giveaway.name)

      // Add 500ms delay to avoid hitting API quota
      await delay(500)

      if (!bundleData.success || bundleData.results.length === 0) {
        // Game not found in bundle games = FULL_CV
        console.log(`✅ ${giveaway.name} -> FULL_CV (not in bundle games)`)
        this.bundleGameCache.set(cacheKey, null)
        return 'FULL_CV'
      }

      // Find the game in the results
      const bundleGame = bundleData.results.find((game: BundleGame) =>
        giveaway.app_id
          ? game.app_id === giveaway.app_id
          : game.name.toLowerCase() === giveaway.name.toLowerCase()
      )

      if (!bundleGame) {
        // Game not found in bundle games = FULL_CV
        console.log(
          `✅ ${giveaway.name} -> FULL_CV (${searchBy} not found in bundle games)`
        )
        this.bundleGameCache.set(cacheKey, null)
        return 'FULL_CV'
      }

      // Cache the bundle game data
      this.bundleGameCache.set(cacheKey, bundleGame)

      // Calculate and return CV status
      return this.calculateCVStatus(giveaway, bundleGame)
    } catch (error) {
      console.error(`❌ Error fetching CV data for ${giveaway.name}:`, error)
      // Cache null to avoid repeated failed requests
      this.bundleGameCache.set(cacheKey, null)
      return 'FULL_CV'
    }
  }

  private calculateCVStatus(
    giveaway: Giveaway,
    bundleGame: BundleGame | null
  ): CVStatus {
    if (!bundleGame) {
      return 'FULL_CV'
    }

    // Check CV status based on timestamps
    const hasReducedTimestamp = bundleGame.reduced_value_timestamp !== null
    const hasNoValueTimestamp = bundleGame.no_value_timestamp !== null

    if (hasNoValueTimestamp && hasReducedTimestamp) {
      // Both timestamps exist, check if no_value_timestamp is earlier than created_timestamp
      if (bundleGame.no_value_timestamp! < giveaway.created_timestamp) {
        console.log(
          `❌ ${giveaway.name} -> NO_CV (no value timestamp earlier than creation)`
        )
        return 'NO_CV'
      }
    }

    if (hasReducedTimestamp && !hasNoValueTimestamp) {
      // Only reduced timestamp exists, check if it's earlier than created_timestamp
      if (bundleGame.reduced_value_timestamp! < giveaway.created_timestamp) {
        console.log(
          `⚠️  ${giveaway.name} -> REDUCED_CV (reduced value timestamp earlier than creation)`
        )
        return 'REDUCED_CV'
      }
    }

    // Default to FULL_CV if conditions aren't met
    console.log(`✅ ${giveaway.name} -> FULL_CV (conditions not met)`)
    return 'FULL_CV'
  }

  private loadExistingGiveaways(filename: string): Map<number, Giveaway> {
    const giveawayMap = new Map<number, Giveaway>()

    if (existsSync(filename)) {
      try {
        const data = readFileSync(filename, 'utf-8')
        const existingGiveaways: Giveaway[] = JSON.parse(data)

        for (const giveaway of existingGiveaways) {
          giveawayMap.set(giveaway.id, giveaway)
        }

        console.log(`📁 Loaded ${existingGiveaways.length} existing giveaways`)
      } catch (error) {
        console.warn(`⚠️  Could not load existing file: ${error}`)
      }
    } else {
      console.log('📄 No existing file found, starting fresh')
    }

    return giveawayMap
  }

  private getTwoWeeksAgoTimestamp(): number {
    const twoWeeksAgo = new Date()
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)
    return Math.floor(twoWeeksAgo.getTime() / 1000)
  }

  public async fetchNewGiveaways(
    filename: string = 'data/all_giveaways.json'
  ): Promise<Giveaway[]> {
    try {
      // Load existing giveaways
      const existingGiveaways = this.loadExistingGiveaways(filename)
      const twoWeeksAgoTimestamp = this.getTwoWeeksAgoTimestamp()

      // Check if unlimited fetch mode is enabled
      const unlimitedMode = process.env.FETCH_ALL_PAGES === 'true'

      console.log(
        unlimitedMode
          ? `🚀 Fetching ALL giveaways (unlimited mode - until last page)...`
          : `🚀 Fetching new giveaways (stopping at giveaways that ended 2+ weeks ago)...`
      )

      let page = 1
      let newGiveawaysCount = 0
      let shouldContinue = true

      // For unlimited mode - track page IDs to detect duplicates
      const seenPageIds = new Set<string>()

      while (shouldContinue) {
        console.log(`📄 Fetching page ${page}...`)

        const response = await this.fetchPage(page)

        if (!response.success) {
          console.error(`❌ Failed to fetch page ${page}`)
          break
        }

        if (response.results.length === 0) {
          console.log('📭 No more giveaways found')
          break
        }

        // For unlimited mode - check if we've seen this page before
        if (unlimitedMode) {
          const pageId = response.results.map((g) => g.id).join(',')
          if (seenPageIds.has(pageId)) {
            console.log(
              `🔄 Detected duplicate page content - reached last page`
            )
            break
          }
          seenPageIds.add(pageId)
        }

        for (const giveaway of response.results) {
          // In normal mode, check if this giveaway ended more than 2 weeks ago
          if (!unlimitedMode && giveaway.end_timestamp < twoWeeksAgoTimestamp) {
            console.log(
              `⏰ Reached cutoff point: giveaway "${
                giveaway.name
              }" ended ${formatDate(giveaway.end_timestamp)}`
            )
            shouldContinue = false
            break
          }

          // Add or update the giveaway
          if (!existingGiveaways.has(giveaway.id)) {
            newGiveawaysCount++
            console.log(`➕ New: ${giveaway.name}`)
          } else {
            console.log(`🔄 Updated: ${giveaway.name}`)
          }

          const trimmedGiveaway = {
            ...giveaway,
            // only keep the giveaway id and slug
            link: giveaway.link.replace(
              'https://www.steamgifts.com/giveaway/',
              ''
            ),
          }
          existingGiveaways.set(giveaway.id, trimmedGiveaway)
        }

        // Add a 3-second delay to avoid rate limiting
        await delay(3000)
        page++
      }

      // Convert map back to array and sort by urgency (ending soonest first)
      const allGiveaways = Array.from(existingGiveaways.values())
      const now = Math.floor(Date.now() / 1000)

      // Separate active and ended giveaways
      const activeGiveaways = allGiveaways.filter((g) => g.end_timestamp > now)
      const endedGiveaways = allGiveaways.filter((g) => g.end_timestamp <= now)

      // Sort active giveaways by end date (soonest ending first)
      activeGiveaways.sort((a, b) => a.end_timestamp - b.end_timestamp)

      // Sort ended giveaways by end date (most recently ended first)
      endedGiveaways.sort((a, b) => b.end_timestamp - a.end_timestamp)

      // Combine: active first, then ended
      const sortedGiveaways = [...activeGiveaways, ...endedGiveaways]

      console.log(`\n📊 Summary:`)
      console.log(`  • Total giveaways: ${sortedGiveaways.length}`)
      console.log(`  • Active giveaways: ${activeGiveaways.length}`)
      console.log(`  • Ended giveaways: ${endedGiveaways.length}`)
      console.log(`  • New giveaways found: ${newGiveawaysCount}`)
      console.log(`  • Pages fetched: ${page - 1}`)
      if (unlimitedMode) {
        console.log(`  • Mode: Unlimited (fetched until last page)`)
      } else {
        console.log(`  • Mode: Limited (stopped at 2 weeks ago)`)
      }

      return sortedGiveaways
    } catch (error) {
      console.error('❌ Error fetching giveaways:', error)
      throw error
    }
  }

  public async updateCVStatus(giveaways: Giveaway[]): Promise<Giveaway[]> {
    console.log(
      `\n🎯 Starting CV status update for ${giveaways.length} giveaways...`
    )

    let processedCount = 0
    let cacheHits = 0

    for (const giveaway of giveaways) {
      // Skip if already has CV status
      if (giveaway.cv_status) {
        continue
      }

      // Check if we have this game in cache
      const cacheKey = giveaway.app_id || giveaway.name
      if (this.bundleGameCache.has(cacheKey)) {
        const bundleGame = this.bundleGameCache.get(cacheKey)!
        giveaway.cv_status = this.calculateCVStatus(giveaway, bundleGame)
        cacheHits++
        console.log(
          `💾 Cache hit for ${giveaway.name} -> ${giveaway.cv_status}`
        )
        continue
      }

      // Fetch CV status
      giveaway.cv_status = await this.getCVStatus(giveaway)
      processedCount++

      // Show progress every 10 giveaways
      if (processedCount % 10 === 0) {
        console.log(`🔄 Processed ${processedCount} giveaways...`)
      }
    }

    console.log(`\n📊 CV Status Update Summary:`)
    console.log(`  • Total giveaways: ${giveaways.length}`)
    console.log(`  • Processed: ${processedCount}`)
    console.log(`  • Cache hits: ${cacheHits}`)
    console.log(
      `  • Skipped (already had CV status): ${
        giveaways.length - processedCount - cacheHits
      }`
    )
    console.log(`  • Total cached bundle games: ${this.bundleGameCache.size}`)

    // Count CV status distribution for ALL giveaways
    const totalCvCounts = { FULL_CV: 0, REDUCED_CV: 0, NO_CV: 0, UNKNOWN: 0 }
    for (const giveaway of giveaways) {
      if (giveaway.cv_status) {
        totalCvCounts[giveaway.cv_status]++
      } else {
        totalCvCounts.UNKNOWN++
      }
    }

    console.log(`\n📊 Total CV Status Distribution:`)
    console.log(`  • FULL_CV: ${totalCvCounts.FULL_CV}`)
    console.log(`  • REDUCED_CV: ${totalCvCounts.REDUCED_CV}`)
    console.log(`  • NO_CV: ${totalCvCounts.NO_CV}`)
    console.log(`  • UNKNOWN: ${totalCvCounts.UNKNOWN}`)
    console.log(
      `  • Total: ${
        totalCvCounts.FULL_CV +
        totalCvCounts.REDUCED_CV +
        totalCvCounts.NO_CV +
        totalCvCounts.UNKNOWN
      }`
    )

    return giveaways
  }
}

// Main execution
async function main(): Promise<void> {
  const fetcher = new SteamGiftsFetcher()
  const filename = 'data/all_giveaways.json'

  try {
    console.log('🚀 Starting incremental giveaway update...')
    const allGiveaways = await fetcher.fetchNewGiveaways(filename)

    if (allGiveaways.length > 0) {
      const oldestDate = new Date(
        allGiveaways[allGiveaways.length - 1].created_timestamp * 1000
      )
      const newestDate = new Date(allGiveaways[0].created_timestamp * 1000)

      console.log(
        `📅 Date range: ${oldestDate.toLocaleString()} to ${newestDate.toLocaleString()}`
      )

      // Update CV status for all giveaways
      const updatedGiveaways = await fetcher.updateCVStatus(allGiveaways)

      const now = Date.now() / 1000
      const activeCount = updatedGiveaways.filter(
        (g) => g.end_timestamp > now
      ).length

      console.log('\n=== GIVEAWAYS BY URGENCY (TOP 10) ===')
      updatedGiveaways
        .filter((g) => g.end_timestamp > now) // Only show active giveaways
        .sort((a, b) => a.end_timestamp - b.end_timestamp) // Sort by end time (ascending - soonest first)
        .slice(0, 10)
        .forEach((giveaway: Giveaway, index: number) => {
          const endDate = new Date(giveaway.end_timestamp * 1000)
          const isActive = giveaway.end_timestamp > now
          const status = isActive ? '🟢 Active' : '🔴 Ended'
          const cvStatus = giveaway.cv_status || 'UNKNOWN'
          const cvEmoji =
            cvStatus === 'FULL_CV'
              ? '✅'
              : cvStatus === 'REDUCED_CV'
              ? '⚠️'
              : '❌'

          // Show time until end for active giveaways, or when it ended for ended ones
          const timeInfo = isActive
            ? `Ends: ${endDate.toLocaleString()}`
            : `Ended: ${endDate.toLocaleString()}`

          console.log(
            `${index + 1}. ${giveaway.name} (${
              giveaway.points
            } points) - ${status} - ${cvEmoji} ${cvStatus} - ${timeInfo}`
          )
        })

      if (
        activeCount < updatedGiveaways.length &&
        updatedGiveaways.length > 10
      ) {
        const endedShown = Math.max(0, 10 - activeCount)
        console.log(
          `\n📊 Showing ${Math.min(
            activeCount,
            10
          )} active and ${endedShown} ended giveaways`
        )
      }

      // Save to file
      writeFileSync(filename, JSON.stringify(updatedGiveaways, null, 2))
      console.log(`\n💾 Updated giveaways saved to ${filename}`)
    } else {
      console.log('⚠️  No giveaways found')
    }
  } catch (error) {
    console.error('❌ Failed to fetch giveaways:', error)
    process.exit(1)
  }
}

// Run the script
await main()
