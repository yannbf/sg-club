import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { load } from 'cheerio'
import type {
  Giveaway,
  BundleGame,
  BundleGamesResponse,
  CVStatus,
} from '../types/steamgifts.js'
import {
  delay,
  formatDate,
  parseSteamUrl,
  generateIdFromCode,
} from '../utils/common.js'

// HTML-specific Creator interface (different from API)
interface Creator {
  username: string
  avatar: string
  role: string
}

interface ScrapingStats {
  totalGiveaways: number
  newGiveaways: number
  updatedGiveaways: number
  pagesFetched: number
  oldestDate: Date
  newestDate: Date
}

export class SteamGiftsHTMLScraper {
  private readonly baseUrl = 'https://www.steamgifts.com'
  private readonly startUrl = '/group/WlYTQ/thegiveawaysclub'
  private readonly cookie =
    'PHPSESSID=91ic94969ca1030jaons7142nq852vmq9mfvis7lbqi35i7i'
  private readonly bundleGamesUrl =
    'https://www.steamgifts.com/bundle-games/search' as const
  // Change this for debugging purposes whenever needed
  private readonly pageLimit?: number

  // Cache for bundle game data to avoid duplicate API calls
  // Key can be app_id (number) or game name (string) for games without app_id
  private bundleGameCache = new Map<number | string, BundleGame | null>()

  constructor(pageLimit?: number) {
    this.pageLimit = pageLimit
  }

  public async fetchPage(
    path: string,
    useCookie: boolean = false
  ): Promise<string> {
    const url = this.baseUrl + path
    console.log(`📄 Fetching: ${url}`)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Cookie: useCookie ? this.cookie : '',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.statusText}`)
    }

    return await response.text()
  }

  async fetchDetailedWinners(giveawayPath: string): Promise<
    Array<{
      name: string | null
      status: 'received' | 'not_received' | 'awaiting_feedback'
    }>
  > {
    const winnersPath = `/giveaway/${giveawayPath}/winners`
    const detailedWinners: Array<{
      name: string | null
      status: 'received' | 'not_received' | 'awaiting_feedback'
    }> = []

    let currentPath: string | null = winnersPath

    while (currentPath) {
      const html = await this.fetchPage(currentPath)
      const pageWinners = this.parseWinnersPage(html)
      detailedWinners.push(...pageWinners)

      // Check for next page
      currentPath = this.getNextPage(html)

      if (currentPath) {
        // Add delay to avoid rate limiting
        await delay(1000)
      }
    }

    return detailedWinners
  }

  private parseWinnersPage(html: string): Array<{
    name: string | null
    status: 'received' | 'not_received' | 'awaiting_feedback'
  }> {
    const $ = load(html)
    const winners: Array<{
      name: string | null
      status: 'received' | 'not_received' | 'awaiting_feedback'
    }> = []

    if ($('.page__heading__breadcrumbs').text().includes('Error')) {
      return []
    }

    $('.table__row-outer-wrap').each((_, el) => {
      try {
        const $row = $(el)
        const $usernameLink = $row.find('.table__column__heading a')
        const username = $usernameLink.text().trim()
        const $statusColumn = $row.find('.table__column--width-small')
        const statusText = $statusColumn.text().trim()

        let name: string | null = username || null
        let status: 'received' | 'not_received' | 'awaiting_feedback' =
          'awaiting_feedback'

        // Check if this is anonymous user
        if (username === 'Anonymous' || !username) {
          name = null
          status = 'awaiting_feedback'
        } else if (
          $statusColumn.find('.icon-green').length &&
          statusText.includes('Received')
        ) {
          status = 'received'
        } else if (
          $statusColumn.find('.icon-red').length &&
          statusText.includes('Not Received')
        ) {
          status = 'not_received'
        } else if (statusText.includes('Awaiting Feedback')) {
          status = 'awaiting_feedback'
        }

        winners.push({ name, status })
      } catch (error) {
        console.warn(`⚠️  Error parsing winner row:`, error)
      }
    })

    return winners
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

  private async getCVStatus(
    giveaway: Giveaway,
    useEndTimestamp: boolean = false
  ): Promise<CVStatus> {
    // Determine cache key - use app_id if available, otherwise use game name
    const cacheKey = giveaway.app_id || giveaway.name
    const searchBy = giveaway.app_id ? 'app_id' : 'name'

    // Check cache first
    if (this.bundleGameCache.has(cacheKey)) {
      const bundleGame = this.bundleGameCache.get(cacheKey)!
      console.log(
        `💾 Cache hit for ${giveaway.name} (${searchBy}: ${cacheKey})`
      )
      return this.calculateCVStatus(giveaway, bundleGame, useEndTimestamp)
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
      return this.calculateCVStatus(giveaway, bundleGame, useEndTimestamp)
    } catch (error) {
      console.error(`❌ Error fetching CV data for ${giveaway.name}:`, error)
      // Cache null to avoid repeated failed requests
      this.bundleGameCache.set(cacheKey, null)
      return 'FULL_CV'
    }
  }

  private calculateCVStatus(
    giveaway: Giveaway,
    bundleGame: BundleGame | null,
    useEndTimestamp: boolean = false
  ): CVStatus {
    if (!bundleGame) {
      return 'FULL_CV'
    }

    // Get the timestamp to compare against - either creation or end timestamp
    const compareTimestamp = useEndTimestamp
      ? giveaway.end_timestamp
      : giveaway.created_timestamp

    // Check CV status based on timestamps
    const hasReducedTimestamp = bundleGame.reduced_value_timestamp !== null
    const hasNoValueTimestamp = bundleGame.no_value_timestamp !== null

    if (hasNoValueTimestamp && hasReducedTimestamp) {
      // Both timestamps exist, check if no_value_timestamp is earlier than compareTimestamp
      if (bundleGame.no_value_timestamp! < compareTimestamp) {
        console.log(
          `❌ ${giveaway.name} -> NO_CV (no value timestamp earlier than ${
            useEndTimestamp ? 'end' : 'creation'
          })`
        )
        return 'NO_CV'
      }
    }

    if (hasReducedTimestamp && !hasNoValueTimestamp) {
      // Only reduced timestamp exists, check if it's earlier than compareTimestamp
      if (bundleGame.reduced_value_timestamp! < compareTimestamp) {
        console.log(
          `⚠️  ${
            giveaway.name
          } -> REDUCED_CV (reduced value timestamp earlier than ${
            useEndTimestamp ? 'end' : 'creation'
          })`
        )
        return 'REDUCED_CV'
      }
    }

    // Default to FULL_CV if conditions aren't met
    console.log(`✅ ${giveaway.name} -> FULL_CV (conditions not met)`)
    return 'FULL_CV'
  }

  private async parseGiveawayDetails(html: string): Promise<{
    required_play: boolean
    is_shared: boolean
    is_whitelist: boolean
  }> {
    const $ = load(html)

    // Check if play is required by looking for text in the description
    const description = $('.page__description').text().trim()
    const required_play = description.toLowerCase().includes('play required')

    // Check if it's a whitelist giveaway
    const is_whitelist = $('.featured__column--whitelist').length > 0

    // Check if it's a shared giveaway by looking at the group name
    // A giveaway is considered shared if it's a whitelist giveaway or if the group name is not "The Giveaways Club"
    const groupText = $('.featured__column--group').text().trim()
    const is_shared =
      is_whitelist ||
      (groupText !== 'The Giveaways Club' && groupText.length > 0)

    return {
      required_play,
      is_shared,
      is_whitelist,
    }
  }

  private async parseGiveaways(html: string): Promise<Giveaway[]> {
    const $ = load(html)
    const giveaways: Giveaway[] = []

    const giveawayElements = $('.giveaway__row-outer-wrap').toArray()

    for (let i = 0; i < giveawayElements.length; i++) {
      const el = giveawayElements[i]
      try {
        const $wrap = $(el)
        const $summary = $wrap.find('.giveaway__summary')
        const $heading = $summary.find('.giveaway__heading')
        const $nameLink = $heading.find('.giveaway__heading__name')

        const name = $nameLink.text().trim()
        const link = $nameLink.attr('href')?.replace('/giveaway/', '') || ''

        // Extract giveaway ID from the link
        const linkParts = link.split('/')
        const giveawayId = linkParts[0] || ''

        // Generate a numeric ID from the giveaway code (for compatibility)
        const id = giveawayId

        const headingText = $heading.text()
        const pointsMatch = headingText.match(/\((\d+)P\)/)
        const points = pointsMatch ? parseInt(pointsMatch[1], 10) : 0

        const copiesMatch = headingText.match(/\((\d+)\s+Copies\)/i)
        const copies = copiesMatch ? parseInt(copiesMatch[1], 10) : 1

        const steamHref = $heading.find('a[rel*="nofollow"]').attr('href') || ''

        // Parse Steam URL to determine if it's a game (app) or bundle (sub)
        let app_id: number | null = null
        let package_id: number | null = null

        if (steamHref.includes('/app/')) {
          // It's a game
          const appIdMatch = steamHref.match(/app\/(\d+)/)
          app_id = appIdMatch ? parseInt(appIdMatch[1], 10) : null
        } else if (steamHref.includes('/sub/')) {
          // It's a bundle/package
          const packageIdMatch = steamHref.match(/sub\/(\d+)/)
          package_id = packageIdMatch ? parseInt(packageIdMatch[1], 10) : null
        }

        const $columns = $summary.find('.giveaway__columns')

        const $timeDiv = $columns.find('div').first()
        const timeText = $timeDiv.text().trim()
        const $endSpan = $timeDiv.find('span')
        const end_timestamp = parseInt(
          $endSpan.attr('data-timestamp') || '0',
          10
        )

        const $createdSpan = $columns.find('.giveaway__column--width-fill span')
        const created_timestamp = parseInt(
          $createdSpan.attr('data-timestamp') || '0',
          10
        )
        const start_timestamp = created_timestamp - 60

        const creatorUsername = $columns
          .find('.giveaway__username')
          .text()
          .trim()
        const creatorAvatar =
          $columns
            .find('.giveaway__username')
            .closest('.giveaway__column')
            .find('img')
            .attr('src') || ''
        const creator: Creator = {
          username: creatorUsername,
          avatar: creatorAvatar,
          role: 'user', // Default role since we can't determine it from HTML
        }

        const region_restricted = !!$columns.find(
          '.giveaway__column--region-restricted'
        ).length
        const whitelist = !!$columns.find('.giveaway__column--whitelist').length
        const invite_only = !!$columns.find('.giveaway__column--invite-only')
          .length
        const group = true // Since we're scraping from a group page

        const entryText = $summary
          .find('.giveaway__links a[href*="/entries"] span')
          .text()
        const entry_count = parseInt(entryText.replace(/\D+/g, ''), 10) || 0

        const commentText = $summary
          .find('.giveaway__links a[href]:not([href*="/entries"]) span')
          .text()
        const comment_count = parseInt(commentText.replace(/\D+/g, ''), 10) || 0

        // Parse winner information if giveaway has ended
        let hasWinners = false
        let winners: Array<{
          name: string | null
          status: 'received' | 'not_received' | 'awaiting_feedback'
        }> = []

        if (timeText.startsWith('Ended')) {
          const $positive = $columns.find('.giveaway__column--positive')
          const $negative = $columns.find('.giveaway__column--negative')

          // Check if we need to fetch detailed winners (only when copies > 3)
          const needsDetailedWinners = copies > 3

          if (needsDetailedWinners && link) {
            try {
              console.log(
                `🔍 Fetching detailed winners for: ${name} (${copies} copies)`
              )
              winners = await this.fetchDetailedWinners(link)
              hasWinners = winners.length > 0
            } catch (error) {
              console.warn(
                `⚠️  Failed to fetch detailed winners for ${name}:`,
                error
              )
              // Fall back to basic parsing
            }
          }

          // Basic parsing for giveaways with ≤3 copies or if detailed fetch failed
          if (winners.length === 0) {
            if ($positive.length) {
              // Winner marked as received
              hasWinners = true
              $positive.find('a[href^="/user/"]').each((_, a) => {
                const name = $(a).text().trim()
                if (name) {
                  winners.push({ name, status: 'received' })
                }
              })
            } else if ($negative.length) {
              // Winner marked as not received
              hasWinners = true
              $negative.find('a[href^="/user/"]').each((_, a) => {
                const name = $(a).text().trim()
                if (name) {
                  winners.push({ name, status: 'not_received' })
                }
              })
            } else if (
              $columns
                .find('div')
                .filter((_, d) => $(d).text().includes('No winners')).length
            ) {
              // Explicitly no winners
              hasWinners = false
              winners = []
            } else {
              // Check for explicit "Awaiting feedback" text
              const hasAwaitingFeedbackText =
                $columns
                  .find('div')
                  .filter((_, d) => $(d).text().includes('Awaiting feedback'))
                  .length > 0

              if (hasAwaitingFeedbackText) {
                // Explicit awaiting feedback - anonymous winners
                hasWinners = true
                // Create anonymous winners based on number of copies
                for (let i = 0; i < copies; i++) {
                  winners.push({ name: null, status: 'awaiting_feedback' })
                }
              } else {
                // Look for winner links, but exclude the creator section
                const $winnerLinks = $columns
                  .find('a[href^="/user/"]')
                  .not('.giveaway__username') // Exclude creator links

                if ($winnerLinks.length > 0) {
                  hasWinners = true
                  $winnerLinks.each((_, a) => {
                    const name = $(a).text().trim()
                    if (name) {
                      // If we have names but no clear feedback status, assume awaiting feedback
                      winners.push({ name, status: 'awaiting_feedback' })
                    }
                  })
                }
              }
            }
          }
        }

        const giveaway: Giveaway = {
          id,
          name,
          points,
          copies,
          app_id,
          package_id,
          link,
          created_timestamp,
          start_timestamp,
          end_timestamp,
          region_restricted,
          invite_only,
          whitelist,
          group,
          contributor_level: 0, // HTML scraping doesn't provide contributor level
          comment_count,
          entry_count,
          creator,
          ...(timeText.startsWith('Ended')
            ? {
                hasWinners,
                winners,
              }
            : {}),
        }

        giveaways.push(giveaway)
      } catch (error) {
        console.warn(`⚠️  Error parsing giveaway ${i + 1}:`, error)
      }
    }

    return giveaways
  }

  private generateNumericId(giveawayCode: string): number {
    return generateIdFromCode(giveawayCode)
  }

  private getNextPage(html: string): string | null {
    const $ = load(html)
    const $pagination = $('.pagination__navigation')
    const $last = $pagination
      .find('a')
      .filter((_, a) => $(a).text().includes('Last'))

    if ($last.length) {
      const $next = $pagination
        .find('a')
        .filter((_, a) => $(a).text().includes('Next'))
      if ($next.length) {
        return $next.attr('href') || null
      }
    }

    return null
  }

  private loadExistingGiveaways(filename: string): Map<string, Giveaway> {
    const giveawayMap = new Map<string, Giveaway>()

    if (existsSync(filename)) {
      try {
        const data = readFileSync(filename, 'utf-8')
        const parsed = JSON.parse(data)

        const existingGiveaways: Giveaway[] = parsed.giveaways || []

        for (const giveaway of existingGiveaways) {
          giveawayMap.set(giveaway.id, giveaway)
        }

        console.log(`📁 Loaded ${existingGiveaways.length} existing giveaways`)

        if (parsed.last_updated) {
          console.log(`   Last updated: ${parsed.last_updated}`)
        }
      } catch (error) {
        console.warn(`⚠️  Could not load existing file: ${error}`)
      }
    } else {
      console.log('📄 No existing file found, starting fresh')
    }

    return giveawayMap
  }

  private getCurrentTimestamp(): number {
    return Math.floor(Date.now() / 1000)
  }

  public async scrapeGiveaways(
    filename: string = '../website/public/data/giveaways.json'
  ): Promise<Giveaway[]> {
    try {
      // Load existing giveaways
      const existingGiveaways = this.loadExistingGiveaways(filename)
      const currentTimestamp = this.getCurrentTimestamp()

      // Check if unlimited fetch mode is enabled
      const unlimitedMode = process.env.FETCH_ALL_PAGES === 'true'

      console.log(
        unlimitedMode
          ? `🚀 Scraping ALL giveaways (unlimited mode - until last page)...`
          : `🚀 Scraping new giveaways (stopping when we reach ended giveaways)...`
      )

      // Log page limit if set
      if (this.pageLimit !== undefined) {
        console.log(`📄 Page limit set to: ${this.pageLimit} pages`)
      }

      let currentPath: string | null = this.startUrl
      let pagesFetched = 0
      let newGiveawaysCount = 0
      let updatedGiveawaysCount = 0

      // For unlimited mode - track page content to detect duplicates
      const seenPageContent = new Set<string>()

      while (currentPath) {
        const html = await this.fetchPage(currentPath)
        pagesFetched++

        // Check if we've hit the page limit
        if (this.pageLimit !== undefined && pagesFetched >= this.pageLimit) {
          console.log(`📄 Reached page limit of ${this.pageLimit} pages`)
          break
        }

        // For unlimited mode - check if we've seen this page content before
        if (unlimitedMode) {
          const contentHash = this.hashContent(html)
          if (seenPageContent.has(contentHash)) {
            console.log(
              `🔄 Detected duplicate page content - reached last page`
            )
            break
          }
          seenPageContent.add(contentHash)
        }

        const giveaways = await this.parseGiveaways(html)

        if (giveaways.length === 0) {
          console.log('📭 No giveaways found on this page')
          break
        }

        let shouldContinue = true

        for (const giveaway of giveaways) {
          // Add or update the giveaway first
          if (!existingGiveaways.has(giveaway.id)) {
            newGiveawaysCount++
            console.log(`➕ New: ${giveaway.name}`)
          } else {
            updatedGiveawaysCount++
            console.log(`🔄 Updated: ${giveaway.name}`)
          }

          existingGiveaways.set(giveaway.id, giveaway)

          // In normal mode, check if this giveaway has ended
          if (!unlimitedMode && giveaway.end_timestamp < currentTimestamp) {
            console.log(
              `⏰ Reached cutoff point: giveaway "${
                giveaway.name
              }" has ended at ${new Date(
                giveaway.end_timestamp * 1000
              ).toLocaleString()}`
            )
            shouldContinue = false
            break
          }
        }

        if (!shouldContinue) {
          break
        }

        // Get next page
        currentPath = this.getNextPage(html)

        if (currentPath) {
          // Add delay to avoid rate limiting
          await delay(1800)
        }
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

      // Display statistics
      const stats: ScrapingStats = {
        totalGiveaways: sortedGiveaways.length,
        newGiveaways: newGiveawaysCount,
        updatedGiveaways: updatedGiveawaysCount,
        pagesFetched,
        oldestDate: new Date(
          sortedGiveaways[sortedGiveaways.length - 1]?.created_timestamp * 1000
        ),
        newestDate: new Date(sortedGiveaways[0]?.created_timestamp * 1000),
      }

      this.displayStats(
        stats,
        unlimitedMode,
        activeGiveaways.length,
        endedGiveaways.length
      )

      // Log the update summary
      console.log(`\n📊 Update Summary:`)
      console.log(
        `  • Total giveaways updated: ${
          newGiveawaysCount + updatedGiveawaysCount
        } out of ${sortedGiveaways.length}`
      )
      console.log(`  • New giveaways added: ${newGiveawaysCount}`)
      console.log(`  • Existing giveaways updated: ${updatedGiveawaysCount}`)

      return sortedGiveaways
    } catch (error) {
      console.error('❌ Error scraping giveaways:', error)
      throw error
    }
  }

  public async updateCVStatus(
    giveaways: Giveaway[],
    isWonGiveaways: boolean = false
  ): Promise<Giveaway[]> {
    console.log(
      `\n🎯 Starting CV status update for ${giveaways.length} ${
        isWonGiveaways ? 'won ' : ''
      }giveaways...`
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
        giveaway.cv_status = this.calculateCVStatus(
          giveaway,
          bundleGame,
          isWonGiveaways
        )
        cacheHits++
        console.log(
          `💾 Cache hit for ${giveaway.name} -> ${giveaway.cv_status}`
        )
        continue
      }

      // Fetch CV status
      giveaway.cv_status = await this.getCVStatus(giveaway, isWonGiveaways)
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

    return giveaways
  }

  private hashContent(html: string): string {
    // Create a simple hash of the page content for duplicate detection
    const giveawayIds = html.match(/\/giveaway\/[A-Za-z0-9]+/g) || []
    return giveawayIds.join(',')
  }

  private displayStats(
    stats: ScrapingStats,
    unlimitedMode: boolean,
    activeCount: number = 0,
    endedCount: number = 0
  ): void {
    console.log(`\n📊 Scraping Summary:`)
    console.log(`  • Total giveaways: ${stats.totalGiveaways}`)
    console.log(`  • Active giveaways: ${activeCount}`)
    console.log(`  • Ended giveaways: ${endedCount}`)
    console.log(`  • New giveaways: ${stats.newGiveaways}`)
    console.log(`  • Updated giveaways: ${stats.updatedGiveaways}`)
    console.log(`  • Pages fetched: ${stats.pagesFetched}`)
    console.log(
      `  • Date range: ${stats.oldestDate.toLocaleString()} to ${stats.newestDate.toLocaleString()}`
    )

    if (unlimitedMode) {
      console.log(`  • Mode: Unlimited (scraped until last page)`)
    } else {
      console.log(`  • Mode: Limited (stopped at ended giveaways)`)
    }

    console.log(`\n📈 Additional Stats:`)
    console.log(`  • Data source: HTML scraping`)
    console.log(`  • Includes winner information: Yes`)
    console.log(`  • Rate limiting: 3 seconds between requests`)
  }
}

// Main execution
async function main(): Promise<void> {
  const scraper = new SteamGiftsHTMLScraper()
  const filename = '../website/public/data/giveaways.json'

  try {
    console.log('🚀 Starting giveaway scraping...')
    const allGiveaways = await scraper.scrapeGiveaways(filename)

    if (allGiveaways.length > 0) {
      // Update CV status for all giveaways
      const updatedGiveaways = await scraper.updateCVStatus(allGiveaways)
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

          let winnerInfo = ''
          if (giveaway.hasWinners !== undefined) {
            if (giveaway.hasWinners && giveaway.winners?.length) {
              // Analyze winner status
              const receivedWinners = giveaway.winners.filter(
                (w) => w.status === 'received'
              )
              const notReceivedWinners = giveaway.winners.filter(
                (w) => w.status === 'not_received'
              )
              const awaitingWinners = giveaway.winners.filter(
                (w) => w.status === 'awaiting_feedback'
              )

              const parts = []
              if (receivedWinners.length > 0) {
                parts.push(`🏆 ${receivedWinners.length} received`)
              }
              if (notReceivedWinners.length > 0) {
                parts.push(`❌ ${notReceivedWinners.length} not received`)
              }
              if (awaitingWinners.length > 0) {
                parts.push(`⏳ ${awaitingWinners.length} awaiting`)
              }

              if (parts.length > 0) {
                winnerInfo = ` - ${parts.join(', ')} (${
                  giveaway.winners.length
                } total)`
              } else {
                // Show winner names if no status breakdown
                const winnerNames = giveaway.winners
                  .map((w) => w.name)
                  .filter(Boolean)
                  .join(', ')
                winnerInfo = ` - 🎯 Winners: ${winnerNames}`
              }
            } else {
              winnerInfo = ` - 🚫 No winners`
            }
          }

          console.log(
            `${index + 1}. ${giveaway.name} (${
              giveaway.points
            } points) - ${status} - ${cvEmoji} ${cvStatus}${winnerInfo} - ${timeInfo}`
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

      // Save to file with timestamp
      const dataWithTimestamp = {
        last_updated: new Date().toISOString(),
        giveaways: updatedGiveaways,
      }
      writeFileSync(filename, JSON.stringify(dataWithTimestamp, null, 2))
      console.log(`\n💾 Giveaways saved to ${filename}`)
    } else {
      console.log('⚠️  No giveaways found')
    }
  } catch (error) {
    console.error('❌ Failed to scrape giveaways:', error)
    process.exit(1)
  }
}

// Run the script only if it's the entry point
if (!process.env.VITEST) {
  await main()
}
