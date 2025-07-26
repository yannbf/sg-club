import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { load } from 'cheerio'
import type {
  User,
  UserStats,
  Giveaway,
  CVStatus,
  UserGroupData,
  SteamPlayData,
  GamePrice,
  UserGiveawaysStats,
} from '../types/steamgifts.js'
import { getSteamChecker, type GamePlayData } from '../api/fetch-steam-data.js'
import { delay } from '../utils/common.js'
import { logError } from '../utils/log-error.js'
import { GiveawayPointsManager } from '../api/fetch-proof-of-play.js'

const debug = (args: any) => {
  if (process.env.DEBUG) {
    console.log(args)
  }
}

export class SteamGiftsUserFetcher {
  private readonly baseUrl = 'https://www.steamgifts.com'
  private readonly startUrl = '/group/WlYTQ/thegiveawaysclub/users'
  private readonly cookie =
    'PHPSESSID=91ic94969ca1030jaons7142nq852vmq9mfvis7lbqi35i7i'

  private async fetchPage(path: string): Promise<string> {
    const url = this.baseUrl + path
    console.log(`📄 Fetching: ${url}`)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        // Cookie: this.cookie,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.statusText}`)
    }

    return await response.text()
  }

  private parseUsers(html: string): User[] {
    const $ = load(html)
    const users: User[] = []

    $('.table__row-outer-wrap').each((_, el) => {
      try {
        const $row = $(el)
        const $innerWrap = $row.find('.table__row-inner-wrap')

        // Get username and profile URL
        const $userLink = $innerWrap.find('.table__column__heading')
        const username = $userLink.text().trim()
        const profile_url = $userLink.attr('href') || ''

        // Get avatar URL from background-image style
        const $avatar = $innerWrap.find('.table_image_avatar')
        const avatarStyle = $avatar.attr('style') || ''
        const avatarMatch = avatarStyle.match(/background-image:url\((.*?)\)/)
        const avatar_url = avatarMatch ? avatarMatch[1] : ''

        // Get all columns (skip the first one which is the avatar/user info)
        const $columns = $innerWrap.find('.table__column--width-small')

        if ($columns.length >= 4 && username) {
          // Parse sent data (e.g., "5.0 ($279.95)")
          const sentText = $columns.eq(0).text().trim()
          const sentMatch = sentText.match(/([0-9.]+)\s*\(\$([0-9.,]+)\)/)
          const total_sent_count = sentMatch ? parseFloat(sentMatch[1]) : 0
          const total_sent_value = sentMatch
            ? parseFloat(sentMatch[2].replace(/,/g, ''))
            : 0

          // Parse received data (e.g., "0.0 ($0.00)")
          const receivedText = $columns.eq(1).text().trim()
          const receivedMatch = receivedText.match(
            /([0-9.]+)\s*\(\$([0-9.,]+)\)/
          )
          const total_received_count = receivedMatch
            ? parseFloat(receivedMatch[1])
            : 0
          const total_received_value = receivedMatch
            ? parseFloat(receivedMatch[2].replace(/,/g, ''))
            : 0

          // Parse gift difference (e.g., "+5.0")
          const giftDiffText = $columns.eq(2).text().trim()
          const total_gift_difference =
            parseFloat(giftDiffText.replace(/[+$,]/g, '')) || 0

          // Parse value difference (e.g., "+$279.95")
          const valueDiffText = $columns.eq(3).text().trim()
          const total_value_difference =
            parseFloat(valueDiffText.replace(/[+$,]/g, '')) || 0

          users.push({
            username,
            profile_url,
            avatar_url,
            stats: {
              total_sent_count,
              total_sent_value,
              total_received_count,
              total_received_value,
              total_gift_difference,
              total_value_difference,
              // Initialize CV-specific and ratio stats to 0, will be calculated later
              fcv_sent_count: 0,
              rcv_sent_count: 0,
              ncv_sent_count: 0,
              fcv_received_count: 0,
              rcv_received_count: 0,
              ncv_received_count: 0,
              fcv_gift_difference: 0,
              real_total_sent_value: 0,
              real_total_received_value: 0,
              real_total_value_difference: 0,
              real_total_sent_count: 0,
              real_total_received_count: 0,
              real_total_gift_difference: 0,
              giveaway_ratio: 0,
              shared_sent_count: 0,
              shared_received_count: 0,
              giveaways_created: 0,
              giveaways_with_no_entries: 0,
              last_giveaway_created_at: null,
              last_giveaway_won_at: null,
            },
          })
        }
      } catch (error) {
        console.warn(`⚠️  Error parsing user row:`, error)
      }
    })

    return users
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

  private async fetchUserSteamInfo(
    user: User
  ): Promise<{ steam_id: string | null; steam_profile_url: string | null }> {
    try {
      // const userProfileUrl = this.baseUrl + user.profile_url
      // console.log(`🔍 Fetching Steam info for: ${user.username}`)

      const html = await this.fetchPage(user.profile_url)
      const $ = load(html)

      // Look for Steam profile link
      const $steamLink = $('a[href*="steamcommunity.com"]').filter((_, el) => {
        const href = $(el).attr('href') || ''
        return (
          href.includes('steamcommunity.com/profiles/') ||
          href.includes('steamcommunity.com/id/')
        )
      })

      if ($steamLink.length > 0) {
        const steam_profile_url = $steamLink.attr('href') || null
        let steam_id: string | null = null

        if (steam_profile_url) {
          // Extract Steam ID from profile URL
          const steamIdMatch = steam_profile_url.match(/profiles\/(\d+)/)
          if (steamIdMatch) {
            steam_id = steamIdMatch[1]
          }
        }

        return { steam_id, steam_profile_url }
      }

      return { steam_id: null, steam_profile_url: null }
    } catch (error) {
      const errorMessage = `Error fetching Steam info for ${user.username}`
      console.warn(`⚠️  ${errorMessage}:`, error)
      logError(error, errorMessage)
      return { steam_id: null, steam_profile_url: null }
    }
  }

  private loadGiveawayData(): Giveaway[] {
    const giveawayFilename = '../website/public/data/giveaways.json'

    if (!existsSync(giveawayFilename)) {
      console.log(
        `⚠️  Giveaway file ${giveawayFilename} not found, skipping giveaway enrichment`
      )
      return []
    }

    try {
      const data = readFileSync(giveawayFilename, 'utf-8')
      const giveaways: Giveaway[] = JSON.parse(data).giveaways
      console.log(`📁 Loaded ${giveaways.length} giveaways for user enrichment`)
      return giveaways
    } catch (error) {
      console.warn(`⚠️  Could not load giveaway file: ${error}`)
      return []
    }
  }

  public calculateStats(user: User): UserGiveawaysStats {
    const userStats: Omit<
      UserGiveawaysStats,
      | 'total_sent_count'
      | 'total_sent_value'
      | 'total_received_count'
      | 'total_received_value'
      | 'total_gift_difference'
      | 'total_value_difference'
    > = {
      fcv_sent_count: 0,
      rcv_sent_count: 0,
      ncv_sent_count: 0,
      fcv_received_count: 0,
      rcv_received_count: 0,
      ncv_received_count: 0,
      fcv_gift_difference: 0,
      giveaway_ratio: 0,
      // Add new stats for real values
      real_total_sent_value: 0,
      real_total_received_value: 0,
      real_total_value_difference: 0,
      real_total_sent_count: 0,
      real_total_received_count: 0,
      real_total_gift_difference: 0,
      // Initialize shared giveaway counts
      shared_sent_count: 0,
      shared_received_count: 0,
      giveaways_created: 0,
      giveaways_with_no_entries: 0,
      // Initialize last activity timestamps
      last_giveaway_created_at: user.giveaways_created?.length
        ? Math.max(...user.giveaways_created.map((g) => g.created_timestamp))
        : null,
      last_giveaway_won_at: user.giveaways_won?.length
        ? Math.max(...user.giveaways_won.map((g) => g.end_timestamp))
        : null,
    }

    // Load game prices
    const gamePrices = JSON.parse(
      readFileSync('../website/public/data/game_data.json', 'utf-8')
    ) as GamePrice[]
    const gamePriceMap = new Map(gamePrices.map((game) => [game.name, game]))

    // Count sent giveaways by CV status and calculate real values
    if (user.giveaways_created) {
      const giveawaysWithNoEntriesCount = user.giveaways_created.filter(
        (giveaway) => 'had_winners' in giveaway && !giveaway.had_winners
      ).length

      userStats.giveaways_created = user.giveaways_created.length ?? 0
      userStats.giveaways_with_no_entries = giveawaysWithNoEntriesCount ?? 0

      for (const giveaway of user.giveaways_created) {
        if (!giveaway.had_winners) {
          continue
        }

        // Track shared giveaways
        if (giveaway.is_shared) {
          userStats.shared_sent_count += giveaway.copies
          continue
        }

        switch (giveaway.cv_status) {
          case 'FULL_CV':
            userStats.fcv_sent_count += giveaway.copies
            userStats.real_total_sent_count += giveaway.copies
            const gamePriceFullCV = gamePriceMap.get(giveaway.name)
            if (gamePriceFullCV) {
              const finalValue =
                (gamePriceFullCV.price_usd_full / 100) * giveaway.copies
              debug(`Adding Full CV value for ${giveaway.name}: ${finalValue}`)
              userStats.real_total_sent_value += Number(finalValue.toFixed(2))
            }
            break
          case 'REDUCED_CV':
            userStats.rcv_sent_count += giveaway.copies
            const gamePriceReducedCV = gamePriceMap.get(giveaway.name)
            if (gamePriceReducedCV) {
              userStats.real_total_sent_value += Number(
                (
                  (gamePriceReducedCV.price_usd_reduced / 100) *
                  giveaway.copies
                ).toFixed(2)
              ) // Convert cents to dollars and round to 2 decimals
            }
            break
          case 'NO_CV':
            userStats.ncv_sent_count += giveaway.copies
            // No value added for NO_CV games
            break
        }
      }

      debug(`Total sent value: ${userStats.real_total_sent_value}`)
    }

    // Count received giveaways by CV status and calculate real values
    if (user.giveaways_won) {
      for (const giveaway of user.giveaways_won) {
        // Track shared giveaways
        if (giveaway.is_shared) {
          userStats.shared_received_count++
          continue
        }

        switch (giveaway.cv_status) {
          case 'FULL_CV':
            userStats.real_total_received_count++
            userStats.fcv_received_count++
            const gamePriceFullCV = gamePriceMap.get(giveaway.name)
            if (gamePriceFullCV) {
              userStats.real_total_received_value += Number(
                (gamePriceFullCV.price_usd_full / 100).toFixed(2)
              ) // Convert cents to dollars and round to 2 decimals
            }
            break
          case 'REDUCED_CV':
            userStats.rcv_received_count++
            const gamePriceReducedCV = gamePriceMap.get(giveaway.name)
            if (gamePriceReducedCV) {
              userStats.real_total_received_value += Number(
                (gamePriceReducedCV.price_usd_reduced / 100).toFixed(2)
              ) // Convert cents to dollars and round to 2 decimals
            }
            break
          case 'NO_CV':
            userStats.ncv_received_count++
            // No value added for NO_CV games
            break
        }
      }
    }

    // Calculate gift difference for full CV
    userStats.fcv_gift_difference =
      userStats.fcv_sent_count - userStats.fcv_received_count

    const fcv_won_without_proof_of_play =
      user.giveaways_won?.filter(
        (g) => g.cv_status === 'FULL_CV' && !g.proof_of_play
      ).length || 0

    userStats.giveaway_ratio =
      userStats.fcv_sent_count - fcv_won_without_proof_of_play / 3

    // Calculate real value differences
    userStats.real_total_value_difference = Number(
      (
        userStats.real_total_sent_value - userStats.real_total_received_value
      ).toFixed(2)
    )
    userStats.real_total_gift_difference = Number(
      (
        userStats.real_total_sent_count - userStats.real_total_received_count
      ).toFixed(2)
    )

    return userStats as UserGiveawaysStats
  }

  private async updateSteamPlayData(
    users: Map<string, User>,
    giveaways: Giveaway[]
  ): Promise<void> {
    console.log(`🎮 Updating Steam play data for won games...`)

    let steamCheckedCount = 0
    let steamErrorCount = 0
    let steamSkippedCount = 0
    const steamChecker = getSteamChecker()

    // Calculate timestamp for 2 months ago (60 days)
    const twoMonthsAgo = Date.now() / 1000 - 60 * 24 * 60 * 60

    const usersToUpdate = Array.from(users.values()).filter((u) => u.steam_id)
    const totalUsers = usersToUpdate.length
    let processedUsers = 0

    for (const user of usersToUpdate) {
      processedUsers++
      const username = user.username
      console.log(
        `[${processedUsers}/${totalUsers}] 🎮 Checking Steam data for ${username}`
      )

      if (!user.steam_id) continue

      // Check Steam profile visibility first
      try {
        const visibility = await steamChecker.checkProfileVisibility(
          user.steam_id
        )
        user.steam_profile_is_private = !visibility.is_public
      } catch (error) {
        const errorMessage = `Error checking profile visibility for ${user.username} (${user.steam_id})`
        console.warn(`⚠️  ${errorMessage}:`, error)
        logError(error, errorMessage)
        continue // skip user
      }

      if (user.steam_profile_is_private) {
        console.log(
          `🙈 Skipping Steam data for ${username} (profile is private)`
        )
        users.set(username, user) // Make sure to save the updated private flag
        continue
      }

      if (!user.giveaways_won) continue

      let userUpdated = false

      for (const wonGame of user.giveaways_won) {
        // Find the giveaway to get the app_id
        const giveaway = giveaways.find((g) => g.link === wonGame.link)
        if (!giveaway?.app_id) continue

        // Only check Steam data for giveaways that ended within the last 2 months
        if (wonGame.end_timestamp < twoMonthsAgo) {
          steamSkippedCount++
          console.log(
            `⏭️  Skipping ${username}: ${wonGame.name} (ended ${Math.floor(
              (Date.now() / 1000 - wonGame.end_timestamp) / (24 * 60 * 60)
            )} days ago)`
          )
          continue
        }

        try {
          // console.log(`🔍 Checking Steam data for ${username}: ${wonGame.name}`)
          const gamePlayData = await steamChecker.getGamePlayData(
            user.steam_id,
            giveaway.app_id
          )

          wonGame.steam_play_data = {
            ...gamePlayData,
            last_checked: Date.now(),
          }

          userUpdated = true
          steamCheckedCount++

          // Rate limiting - 1 second between Steam API calls
          await delay(400)
        } catch (error) {
          const errorMessage = `Error checking Steam data for ${username}/${wonGame.name}`
          console.warn(`⚠️  ${errorMessage}:`, error)
          logError(error, errorMessage)
          steamErrorCount++

          // Rate limiting even on errors
          await delay(400)
        }
      }

      if (userUpdated) {
        users.set(username, user)
      }
    }

    console.log(`🎮 Steam data update complete:`)
    console.log(`  • Checked: ${steamCheckedCount}`)
    console.log(`  • Skipped (>2 months old): ${steamSkippedCount}`)
    console.log(`  • Errors: ${steamErrorCount}`)
  }

  private async enrichUsersWithGiveaways(
    existingUsers: Map<string, User>,
    giveaways: Giveaway[]
  ): Promise<void> {
    console.log(`\n🎁 Enriching users with giveaway data...`)

    const pointsManager = GiveawayPointsManager.getInstance()
    const allPointsData = await pointsManager.getAllGiveaways()
    const pointsMap = new Map(allPointsData.map((p) => [p.id, p]))

    let enrichedCount = 0
    const now = Date.now() / 1000 // Current timestamp in seconds
    const totalUsers = existingUsers.size
    // Create a map of giveaways by creator for faster lookup
    const giveawaysByCreator = new Map<string, Giveaway[]>()
    for (const giveaway of giveaways) {
      const creatorGiveaways =
        giveawaysByCreator.get(giveaway.creator.username) || []
      creatorGiveaways.push(giveaway)
      giveawaysByCreator.set(giveaway.creator.username, creatorGiveaways)
    }

    // Process each user
    for (const [username, user] of existingUsers) {
      enrichedCount++
      // Get all giveaways created by this user
      const userGiveaways = giveawaysByCreator.get(username) || []

      // These timestamps are now calculated in calculateStats

      const giveawaysWon: NonNullable<User['giveaways_won']> = []
      const giveawaysCreated: NonNullable<User['giveaways_created']> = []

      // Find giveaways won by this user
      for (const giveaway of giveaways) {
        if (giveaway.winners) {
          for (const winner of giveaway.winners) {
            if (winner.name === username) {
              const giveawayId = giveaway.link.split('/')[0]
              const pointsData = pointsMap.get(giveawayId)

              giveawaysWon.push({
                name: giveaway.name,
                link: giveaway.link,
                cv_status: giveaway.cv_status || 'FULL_CV',
                status: winner.status,
                end_timestamp: giveaway.end_timestamp,
                required_play: giveaway.required_play || false,
                is_shared: giveaway.is_shared || false,
                proof_of_play:
                  (pointsData?.completePlaying &&
                    pointsData?.winner === username) ??
                  false,
              })
            }
          }
        }
      }

      // Find giveaways created by this user
      for (const giveaway of giveaways) {
        if (giveaway.creator.username === username) {
          const giveawayCreated: NonNullable<User['giveaways_created']>[0] = {
            name: giveaway.name,
            link: giveaway.link,
            cv_status: giveaway.cv_status || 'FULL_CV',
            entries: giveaway.entry_count,
            copies: giveaway.copies,
            created_timestamp: giveaway.created_timestamp,
            end_timestamp: giveaway.end_timestamp,
            required_play: giveaway.required_play || false,
            is_shared: giveaway.is_shared || false,
          }

          // Only set had_winners if the giveaway has ended
          if (giveaway.end_timestamp < now) {
            giveawayCreated.had_winners = giveaway.hasWinners || false
          }

          // Add winner details if there are winners
          if (giveaway.winners && giveaway.winners.length > 0) {
            giveawayCreated.winners = giveaway.winners.map((winner) => ({
              name: winner.name,
              status: winner.status,
              activated: winner.name !== null && winner.status === 'received',
            }))
          }

          giveawaysCreated.push(giveawayCreated)
        }
      }

      // Update user with giveaway information
      const updatedUser: User = {
        ...user,
        giveaways_won: giveawaysWon.length > 0 ? giveawaysWon : undefined,
        giveaways_created:
          giveawaysCreated.length > 0 ? giveawaysCreated : undefined,
      }

      // Calculate user stats
      const userStats = this.calculateStats(updatedUser)
      updatedUser.stats = {
        ...updatedUser.stats,
        ...userStats,
      }

      existingUsers.set(username, updatedUser)

      const wonCount = giveawaysWon.length
      const createdCount = giveawaysCreated.length
      console.log(
        `[${enrichedCount}/${totalUsers}] ✅ ${username}: ${wonCount} won, ${createdCount} created`
      )
    }

    console.log(`📊 Enriched ${enrichedCount} users with giveaway data`)
  }

  private loadExistingUsers(filename: string): Map<string, User> {
    const userMap = new Map<string, User>()

    if (existsSync(filename)) {
      try {
        const data = readFileSync(filename, 'utf-8')
        const existingData: UserGroupData = JSON.parse(data)

        const userList = Object.values(existingData.users)

        for (const user of userList) {
          userMap.set(user.username, user)
        }

        console.log(`📁 Loaded ${userList.length} existing users`)
        if (existingData.lastUpdated) {
          console.log(
            `📅 Last updated: ${new Date(
              existingData.lastUpdated
            ).toLocaleString()}`
          )
        }
      } catch (error) {
        console.warn(`⚠️  Could not load existing file: ${error}`)
      }
    } else {
      console.log('📄 No existing file found, starting fresh')
    }

    return userMap
  }

  private mergeUsers(existingUsers: User[], newUsers: User[]): User[] {
    const userMap = new Map<string, User>()

    // Add existing users to map
    existingUsers.forEach((user) => {
      userMap.set(user.username, user)
    })

    // Merge new users
    newUsers.forEach((newUser) => {
      const existingUser = userMap.get(newUser.username)
      if (existingUser) {
        // Update existing user with new stats and preserve Steam info
        userMap.set(newUser.username, {
          ...existingUser,
          ...newUser,
          stats: {
            ...newUser.stats, // Use new stats from current scrape
            // Preserve CV-specific stats if they exist
            fcv_sent_count: existingUser.stats.fcv_sent_count || 0,
            rcv_sent_count: existingUser.stats.rcv_sent_count || 0,
            ncv_sent_count: existingUser.stats.ncv_sent_count || 0,
            fcv_received_count: existingUser.stats.fcv_received_count || 0,
            rcv_received_count: existingUser.stats.rcv_received_count || 0,
            ncv_received_count: existingUser.stats.ncv_received_count || 0,
            fcv_gift_difference: existingUser.stats.fcv_gift_difference || 0,
            giveaway_ratio: existingUser.stats.giveaway_ratio || 0,
          },
          // Preserve Steam info
          steam_id: existingUser.steam_id || newUser.steam_id,
          steam_profile_url:
            existingUser.steam_profile_url || newUser.steam_profile_url,
          // Preserve giveaway data
          giveaways_won: existingUser.giveaways_won,
          giveaways_created: existingUser.giveaways_created,
        })
      } else {
        // New user
        userMap.set(newUser.username, newUser)
      }
    })

    return Array.from(userMap.values())
  }

  private async _fetchAllUsersFromPages(): Promise<User[]> {
    const allScrapedUsers: User[] = []
    let currentPath: string | null = this.startUrl
    let pagesFetched = 0

    console.log('📄 Fetching all user pages...')
    while (currentPath) {
      let html: string
      try {
        html = await this.fetchPage(currentPath)
        pagesFetched++
      } catch (error) {
        const errorMessage = `Failed to fetch page: ${this.baseUrl}${currentPath}`
        console.warn(`⚠️  ${errorMessage}:`, error)
        logError(error, errorMessage)
        break
      }

      const usersOnPage = this.parseUsers(html)
      if (usersOnPage.length === 0) {
        console.log('📭 No more users found.')
        break
      }

      allScrapedUsers.push(...usersOnPage)
      console.log(
        `   ... found ${usersOnPage.length} users on page ${pagesFetched}. Total: ${allScrapedUsers.length}`
      )

      // Get next page
      currentPath = this.getNextPage(html)

      if (currentPath) {
        // Add delay to avoid rate limiting
        await delay(1000)
      }
    }
    console.log(
      `✅ Fetched a total of ${allScrapedUsers.length} users from ${pagesFetched} pages this run.`
    )
    return allScrapedUsers
  }

  public async fetchUsers(
    filename: string = '../website/public/data/group_users.json'
  ): Promise<User[]> {
    try {
      // Load existing users
      const existingUsers = this.loadExistingUsers(filename)

      console.log('🚀 Fetching group users...')

      const attempts = 2
      let bestAttempt: User[] = []
      for (let i = 0; i < attempts; i++) {
        console.log(
          `\n🚀 Attempt ${i + 1} of ${attempts} to fetch user list...`
        )
        const currentAttemptUsers = await this._fetchAllUsersFromPages()
        if (currentAttemptUsers.length > bestAttempt.length) {
          bestAttempt = currentAttemptUsers
        }
        if (i < attempts - 1) {
          await delay(3000) // wait between attempts
        }
      }

      console.log(
        `\n✅ Selected the best result with ${bestAttempt.length} users.`
      )
      const allScrapedUsers = bestAttempt

      let newUsersCount = 0
      let updatedUsersCount = 0
      let steamInfoFetched = 0

      // Track current group members to identify removed users
      const currentGroupUsers = new Set<string>()
      allScrapedUsers.forEach((u) => currentGroupUsers.add(u.username))

      for (const user of allScrapedUsers) {
        // Check if user exists and merge data
        if (!existingUsers.has(user.username)) {
          newUsersCount++
          console.log(`➕ New: ${user.username}`)
          existingUsers.set(user.username, user)
        } else {
          updatedUsersCount++
          console.log(`🔄 Updated: ${user.username}`)

          // Merge existing Steam info and giveaway data with new data
          const existingUser = existingUsers.get(user.username)!
          const updatedUser = {
            ...user,
            steam_id: existingUser.steam_id,
            steam_profile_url: existingUser.steam_profile_url,
            giveaways_won: existingUser.giveaways_won,
            giveaways_created: existingUser.giveaways_created,
            stats: {
              ...user.stats,
              // Preserve existing CV stats if they exist
              fcv_sent_count: existingUser.stats?.fcv_sent_count || 0,
              rcv_sent_count: existingUser.stats?.rcv_sent_count || 0,
              ncv_sent_count: existingUser.stats?.ncv_sent_count || 0,
              fcv_received_count: existingUser.stats?.fcv_received_count || 0,
              rcv_received_count: existingUser.stats?.rcv_received_count || 0,
              ncv_received_count: existingUser.stats?.ncv_received_count || 0,
              fcv_gift_difference: existingUser.stats?.fcv_gift_difference || 0,
              giveaway_ratio: existingUser.stats?.giveaway_ratio || 0,
            },
          }
          existingUsers.set(user.username, updatedUser)
        }
      }

      // Remove users who are no longer in the group
      const removedUsers: string[] = []
      for (const [username] of existingUsers) {
        if (!currentGroupUsers.has(username)) {
          existingUsers.delete(username)
          removedUsers.push(username)
        }
      }

      if (removedUsers.length > 0) {
        console.log(
          `🗑️  Removed ${
            removedUsers.length
          } users no longer in group: ${removedUsers.join(', ')}`
        )
      }

      // Augment users with Steam info if they don't have it (skip if env flag is set)
      const skipSteamApi = process.env.SKIP_STEAM_API === 'true'

      if (skipSteamApi) {
        console.log(
          `\n🚫 Skipping Steam profile fetching (SKIP_STEAM_API=true)`
        )
      } else {
        console.log(`\n🔍 Checking for missing Steam information...`)
        const usersNeedingSteamInfo = Array.from(existingUsers.values()).filter(
          (user) => !user.steam_id && !user.steam_profile_url
        )

        if (usersNeedingSteamInfo.length > 0) {
          console.log(
            `📋 Found ${usersNeedingSteamInfo.length} users without Steam info`
          )

          let steamInfoCounter = 0
          for (const user of usersNeedingSteamInfo) {
            steamInfoCounter++
            try {
              console.log(
                `[${steamInfoCounter}/${usersNeedingSteamInfo.length}] 🔍 Fetching Steam info for: ${user.username}`
              )
              const steamInfo = await this.fetchUserSteamInfo(user)

              if (steamInfo.steam_id || steamInfo.steam_profile_url) {
                const updatedUser = {
                  ...user,
                  steam_id: steamInfo.steam_id,
                  steam_profile_url: steamInfo.steam_profile_url,
                }
                existingUsers.set(user.username, updatedUser)
                steamInfoFetched++

                if (steamInfo.steam_id) {
                  // console.log(
                  //   `✅ ${user.username} -> Steam ID: ${steamInfo.steam_id}`
                  // )
                } else {
                  // console.log(
                  //   `✅ ${user.username} -> Steam profile found (custom URL)`
                  // )
                }
              } else {
                // console.log(`❌ ${user.username} -> No Steam profile found`)
              }

              // Add delay to avoid rate limiting
              await delay(400)
            } catch (error) {
              console.warn(`⚠️  Error processing ${user.username}:`, error)
            }
          }
        } else {
          console.log(
            `✅ All users already have Steam info or no Steam profiles`
          )
        }

        const usersNeedingCountryCodeInfo = Array.from(
          existingUsers.values()
        ).filter((user) => !user.country_code)

        if (usersNeedingCountryCodeInfo.length > 0) {
          console.log(
            `📋 Found ${usersNeedingCountryCodeInfo.length} users without country code info`
          )
          const steamChecker = getSteamChecker()
          for (const user of usersNeedingCountryCodeInfo) {
            if (user.steam_id) {
              const countryCode = await steamChecker.getPlayerCountryCode(
                user.steam_id
              )
              existingUsers.set(user.username, {
                ...user,
                country_code: countryCode,
              })
              console.log(`✅ ${user.username} -> Country code: ${countryCode}`)
              await delay(400)
            } else {
              console.log(
                `❌ ${user.username} -> No Steam ID. Skipping fetching country code`
              )
            }
          }
        }
      }

      // Load giveaway data and enrich users
      const giveaways = this.loadGiveawayData()
      if (giveaways.length > 0) {
        await this.enrichUsersWithGiveaways(existingUsers, giveaways)

        // Update Steam play data for won games (skip if env flag is set)
        const skipSteamApi = process.env.SKIP_STEAM_API === 'true'
        if (skipSteamApi) {
          console.log('🚫 Skipping Steam API calls (SKIP_STEAM_API=true)')
        } else {
          await this.updateSteamPlayData(existingUsers, giveaways)
        }
      }

      // Convert map back to array and sort by username (alphabetically)
      const allUsers = Array.from(existingUsers.values())
      allUsers.sort((a, b) => a.username.localeCompare(b.username))

      // Display statistics
      const stats: UserStats = {
        totalUsers: allUsers.length,
        newUsers: newUsersCount,
        updatedUsers: updatedUsersCount,
        pagesFetched: 0, // This is no longer tracked in the main function
      }

      this.displayStats(stats, steamInfoFetched, removedUsers.length)

      // Convert user array to a record for saving
      const usersRecord: Record<string, User> = {}
      for (const user of allUsers) {
        usersRecord[user.username] = user
      }

      // Save to file with lastUpdated timestamp
      const userGroupData: UserGroupData = {
        lastUpdated: Date.now(),
        users: usersRecord,
      }
      writeFileSync(filename, JSON.stringify(userGroupData, null, 2))
      console.log(`\n💾 Users saved to ${filename}`)

      return allUsers
    } catch (error) {
      console.error('❌ Error fetching users:', error)
      throw error
    }
  }

  private displayStats(
    stats: UserStats,
    steamInfoFetched: number = 0,
    removedUsers: number = 0
  ): void {
    console.log(`\n📊 User Fetching Summary:`)
    console.log(`  • Total users: ${stats.totalUsers}`)
    console.log(`  • New users: ${stats.newUsers}`)
    console.log(`  • Updated users: ${stats.updatedUsers}`)

    if (steamInfoFetched > 0) {
      console.log(`  • Steam info fetched: ${steamInfoFetched}`)
    }

    if (removedUsers > 0) {
      console.log(`  • Removed users: ${removedUsers}`)
    }

    console.log(`\n📈 Additional Stats:`)
    console.log(`  • Data source: HTML scraping`)
    console.log(`  • Rate limiting: 3 seconds between requests`)
  }
}

export const groupMemberScraper = new SteamGiftsUserFetcher()
