import { writeFileSync, readFileSync, existsSync } from 'node:fs'

// Type definitions for the API response
interface Creator {
  id: number
  steam_id: string
  username: string
}

interface Giveaway {
  id: number
  name: string
  points: number
  copies: number
  app_id: number | null
  package_id: number | null
  link: string
  created_timestamp: number
  start_timestamp: number
  end_timestamp: number
  region_restricted: boolean
  invite_only: boolean
  whitelist: boolean
  group: boolean
  contributor_level: number
  comment_count: number
  entry_count: number
  creator: Creator
}

interface Group {
  id: number
  gid: string
  name: string
}

interface SteamGiftsResponse {
  success: boolean
  page: number
  per_page: number
  group: Group
  results: Giveaway[]
}

class SteamGiftsFetcher {
  private readonly baseUrl =
    'https://www.steamgifts.com/group/WlYTQ/thegiveawaysclub/search' as const
  private readonly cookie =
    'PHPSESSID=91ic94969ca1030jaons7142nq852vmq9mfvis7lbqi35i7i' as const

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
    filename: string = 'all_giveaways.json'
  ): Promise<Giveaway[]> {
    try {
      // Load existing giveaways
      const existingGiveaways = this.loadExistingGiveaways(filename)
      const twoWeeksAgoTimestamp = this.getTwoWeeksAgoTimestamp()

      console.log(
        `🚀 Fetching new giveaways (stopping at giveaways that ended 2+ weeks ago)...`
      )

      let page = 1
      let newGiveawaysCount = 0
      let shouldContinue = true

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

        for (const giveaway of response.results) {
          // Check if this giveaway ended more than 2 weeks ago
          if (giveaway.end_timestamp < twoWeeksAgoTimestamp) {
            console.log(
              `⏰ Reached cutoff point: giveaway "${
                giveaway.name
              }" ended ${new Date(
                giveaway.end_timestamp * 1000
              ).toLocaleString()}`
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
          existingGiveaways.set(giveaway.id, giveaway)
        }

        // Add a small delay to be respectful to the server
        await new Promise((resolve) => setTimeout(resolve, 100))
        page++
      }

      // Convert map back to array and sort by created_timestamp (newest first)
      const allGiveaways = Array.from(existingGiveaways.values())
      allGiveaways.sort((a, b) => b.created_timestamp - a.created_timestamp)

      console.log(`\n📊 Summary:`)
      console.log(`  • Total giveaways: ${allGiveaways.length}`)
      console.log(`  • New giveaways found: ${newGiveawaysCount}`)
      console.log(`  • Pages fetched: ${page - 1}`)

      return allGiveaways
    } catch (error) {
      console.error('❌ Error fetching giveaways:', error)
      throw error
    }
  }
}

// Main execution
async function main(): Promise<void> {
  const fetcher = new SteamGiftsFetcher()
  const filename = 'all_giveaways.json'

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

      console.log('\n=== LATEST 10 GIVEAWAYS ===')
      allGiveaways.slice(0, 10).forEach((giveaway: Giveaway, index: number) => {
        const createdDate = new Date(giveaway.created_timestamp * 1000)
        const endDate = new Date(giveaway.end_timestamp * 1000)
        const isActive = giveaway.end_timestamp > Date.now() / 1000
        const status = isActive ? '🟢 Active' : '🔴 Ended'

        console.log(
          `${index + 1}. ${giveaway.name} (${
            giveaway.points
          } points) - ${status} - Ends: ${endDate.toLocaleString()}`
        )
      })

      // Save to file
      writeFileSync(filename, JSON.stringify(allGiveaways, null, 2))
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
