import { writeFileSync } from 'node:fs'

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

  private async getLastPage(): Promise<number> {
    console.log('Fetching last page...')
    const response = await this.fetchPage(99999)
    console.log(`Last page is: ${response.page}`)
    return response.page
  }

  public async fetchAllGiveaways(): Promise<Giveaway[]> {
    try {
      const lastPage = await this.getLastPage()
      const allGiveaways: Giveaway[] = []

      console.log(`Fetching all pages from ${lastPage} to 1...`)

      // Fetch all pages from last to first
      for (let page = lastPage; page >= 1; page--) {
        console.log(`Fetching page ${page}/${lastPage}...`)

        const response = await this.fetchPage(page)

        if (!response.success) {
          console.error(`Failed to fetch page ${page}`)
          continue
        }

        allGiveaways.push(...response.results)

        // Add a small delay to be respectful to the server
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      console.log(`Fetched ${allGiveaways.length} giveaways total`)

      // Sort by created_timestamp (newest first)
      allGiveaways.sort((a, b) => b.created_timestamp - a.created_timestamp)

      return allGiveaways
    } catch (error) {
      console.error('Error fetching giveaways:', error)
      throw error
    }
  }
}

// Main execution
async function main(): Promise<void> {
  const fetcher = new SteamGiftsFetcher()

  try {
    console.log('🚀 Starting to fetch all giveaways...')
    const allGiveaways = await fetcher.fetchAllGiveaways()

    console.log('\n=== SUMMARY ===')
    console.log(`📊 Total giveaways: ${allGiveaways.length}`)

    if (allGiveaways.length > 0) {
      const oldestDate = new Date(
        allGiveaways[allGiveaways.length - 1].created_timestamp * 1000
      )
      const newestDate = new Date(allGiveaways[0].created_timestamp * 1000)

      console.log(
        `📅 Date range: ${oldestDate.toLocaleString()} to ${newestDate.toLocaleString()}`
      )

      console.log('\n=== FIRST 10 GIVEAWAYS (sorted by created_timestamp) ===')
      allGiveaways.slice(0, 10).forEach((giveaway, index) => {
        const createdDate = new Date(giveaway.created_timestamp * 1000)
        console.log(
          `${index + 1}. ${giveaway.name} (${
            giveaway.points
          } points) - Created: ${createdDate.toLocaleString()}`
        )
      })

      // Save to file
      const filename = 'all_giveaways.json'
      writeFileSync(filename, JSON.stringify(allGiveaways, null, 2))
      console.log(`\n💾 All giveaways saved to ${filename}`)
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
