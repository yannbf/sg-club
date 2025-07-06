import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { load } from 'cheerio'
import type {
  User,
  UserStats,
  Giveaway,
  CVStatus,
  UserGroupData,
  SteamPlayData,
} from '../types/steamgifts.js'
import {
  getSteamChecker,
  type GamePlayData,
} from '../utils/check-steam-game.js'
import { delay } from '../utils/common.js'

class SteamGiftsUserFetcher {
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
              // Initialize CV-specific stats to 0, will be calculated later
              fcv_sent_count: 0,
              rcv_sent_count: 0,
              ncv_sent_count: 0,
              fcv_received_count: 0,
              rcv_received_count: 0,
              ncv_received_count: 0,
              fcv_gift_difference: 0,
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
      const userProfileUrl = this.baseUrl + user.profile_url
      console.log(`🔍 Fetching Steam info for: ${user.username}`)

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
      console.warn(`⚠️  Error fetching Steam info for ${user.username}:`, error)
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
      const giveaways: Giveaway[] = JSON.parse(data)
      console.log(`📁 Loaded ${giveaways.length} giveaways for user enrichment`)
      return giveaways
    } catch (error) {
      console.warn(`⚠️  Could not load giveaway file: ${error}`)
      return []
    }
  }

  private calculateCVStats(user: User): Partial<User['stats']> {
    const cvStats = {
      fcv_sent_count: 0,
      rcv_sent_count: 0,
      ncv_sent_count: 0,
      fcv_received_count: 0,
      rcv_received_count: 0,
      ncv_received_count: 0,
      fcv_gift_difference: 0,
    }

    // Count sent giveaways by CV status
    if (user.giveaways_created) {
      for (const giveaway of user.giveaways_created) {
        switch (giveaway.cv_status) {
          case 'FULL_CV':
            cvStats.fcv_sent_count++
            break
          case 'REDUCED_CV':
            cvStats.rcv_sent_count++
            break
          case 'NO_CV':
            cvStats.ncv_sent_count++
            break
        }
      }
    }

    // Count received giveaways by CV status
    if (user.giveaways_won) {
      for (const giveaway of user.giveaways_won) {
        switch (giveaway.cv_status) {
          case 'FULL_CV':
            cvStats.fcv_received_count++
            break
          case 'REDUCED_CV':
            cvStats.rcv_received_count++
            break
          case 'NO_CV':
            cvStats.ncv_received_count++
            break
        }
      }
    }

    // Calculate gift difference for full CV
    cvStats.fcv_gift_difference =
      cvStats.fcv_sent_count - cvStats.fcv_received_count

    return cvStats
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

    for (const [username, user] of users) {
      if (!user.steam_id || !user.giveaways_won) continue

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
          console.log(`🔍 Checking Steam data for ${username}: ${wonGame.name}`)
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
          await delay(1000)
        } catch (error) {
          console.warn(
            `⚠️  Error checking Steam data for ${username}/${wonGame.name}:`,
            error
          )
          steamErrorCount++

          // Rate limiting even on errors
          await delay(1000)
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

  private enrichUsersWithGiveaways(
    users: Map<string, User>,
    giveaways: Giveaway[]
  ): void {
    console.log(`🔄 Enriching users with giveaway data...`)

    let enrichedCount = 0
    const now = Date.now() / 1000 // Current timestamp in seconds

    for (const [username, user] of users) {
      const giveawaysWon: NonNullable<User['giveaways_won']> = []
      const giveawaysCreated: NonNullable<User['giveaways_created']> = []

      // Find giveaways won by this user
      for (const giveaway of giveaways) {
        if (giveaway.winners) {
          for (const winner of giveaway.winners) {
            if (winner.name === username) {
              giveawaysWon.push({
                name: giveaway.name,
                link: giveaway.link,
                cv_status: giveaway.cv_status || 'FULL_CV',
                status: winner.status,
                end_timestamp: giveaway.end_timestamp,
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
            end_timestamp: giveaway.end_timestamp,
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
      if (giveawaysWon.length > 0 || giveawaysCreated.length > 0) {
        const updatedUser: User = {
          ...user,
          giveaways_won: giveawaysWon.length > 0 ? giveawaysWon : undefined,
          giveaways_created:
            giveawaysCreated.length > 0 ? giveawaysCreated : undefined,
        }

        // Calculate CV-specific stats
        const cvStats = this.calculateCVStats(updatedUser)
        updatedUser.stats = {
          ...updatedUser.stats,
          ...cvStats,
        }

        users.set(username, updatedUser)
        enrichedCount++

        const wonCount = giveawaysWon.length
        const createdCount = giveawaysCreated.length
        console.log(`✅ ${username}: ${wonCount} won, ${createdCount} created`)
      }
    }

    console.log(`📊 Enriched ${enrichedCount} users with giveaway data`)
  }

  private loadExistingUsers(filename: string): Map<string, User> {
    const userMap = new Map<string, User>()

    if (existsSync(filename)) {
      try {
        const data = readFileSync(filename, 'utf-8')
        const existingData: UserGroupData = JSON.parse(data)

        // Handle both old format (User[]) and new format (UserGroupData)
        const existingUsers = Array.isArray(existingData)
          ? existingData
          : existingData.users

        for (const user of existingUsers) {
          userMap.set(user.username, user)
        }

        console.log(`📁 Loaded ${existingUsers.length} existing users`)
        if (!Array.isArray(existingData)) {
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

  public async fetchUsers(
    filename: string = 'website/public/data/group_users.json'
  ): Promise<User[]> {
    try {
      // Load existing users
      const existingUsers = this.loadExistingUsers(filename)

      console.log(`🚀 Fetching group users...`)

      let currentPath: string | null = this.startUrl
      let pagesFetched = 0
      let newUsersCount = 0
      let updatedUsersCount = 0
      let steamInfoFetched = 0

      // Track current group members to identify removed users
      const currentGroupUsers = new Set<string>()

      while (currentPath) {
        const html = await this.fetchPage(currentPath)
        pagesFetched++

        const users = this.parseUsers(html)

        if (users.length === 0) {
          console.log('📭 No users found on this page')
          break
        }

        for (const user of users) {
          currentGroupUsers.add(user.username)

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
                fcv_gift_difference:
                  existingUser.stats?.fcv_gift_difference || 0,
              },
            }
            existingUsers.set(user.username, updatedUser)
          }
        }

        // Get next page
        currentPath = this.getNextPage(html)

        if (currentPath) {
          // Add delay to avoid rate limiting
          await delay(3000)
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

          for (const user of usersNeedingSteamInfo) {
            try {
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
                  console.log(
                    `✅ ${user.username} -> Steam ID: ${steamInfo.steam_id}`
                  )
                } else {
                  console.log(
                    `✅ ${user.username} -> Steam profile found (custom URL)`
                  )
                }
              } else {
                console.log(`❌ ${user.username} -> No Steam profile found`)
              }

              // Add delay to avoid rate limiting
              await delay(1000)
            } catch (error) {
              console.warn(`⚠️  Error processing ${user.username}:`, error)
            }
          }
        } else {
          console.log(
            `✅ All users already have Steam info or no Steam profiles`
          )
        }
      }

      // Load giveaway data and enrich users
      const giveaways = this.loadGiveawayData()
      if (giveaways.length > 0) {
        this.enrichUsersWithGiveaways(existingUsers, giveaways)

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
        pagesFetched,
      }

      this.displayStats(stats, steamInfoFetched, removedUsers.length)

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
    console.log(`  • Pages fetched: ${stats.pagesFetched}`)

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

// Main execution
async function main(): Promise<void> {
  const fetcher = new SteamGiftsUserFetcher()
  const filename = '../website/public/data/group_users.json'

  try {
    console.log('🚀 Starting user fetching...')
    const allUsers = await fetcher.fetchUsers(filename)

    if (allUsers.length > 0) {
      console.log('\n=== TOP 10 CONTRIBUTORS BY VALUE ===')
      allUsers.slice(0, 10).forEach((user: User, index: number) => {
        const giftIcon =
          user.stats.total_gift_difference > 0
            ? '📈'
            : user.stats.total_gift_difference < 0
            ? '📉'
            : '➖'
        const valueIcon =
          user.stats.total_value_difference > 0
            ? '💰'
            : user.stats.total_value_difference < 0
            ? '💸'
            : '💱'
        const steamIcon = user.steam_id ? '🎮' : ''

        console.log(
          `${index + 1}. ${user.username} ${steamIcon} - ${giftIcon} ${
            user.stats.total_gift_difference > 0 ? '+' : ''
          }${user.stats.total_gift_difference.toFixed(1)} gifts, ${valueIcon} ${
            user.stats.total_value_difference > 0 ? '+' : ''
          }$${user.stats.total_value_difference.toFixed(2)}`
        )
        console.log(
          `   Sent: ${user.stats.total_sent_count.toFixed(
            1
          )} ($${user.stats.total_sent_value.toFixed(
            2
          )}) | Received: ${user.stats.total_received_count.toFixed(
            1
          )} ($${user.stats.total_received_value.toFixed(2)})`
        )

        if (user.steam_id) {
          console.log(`   Steam ID: ${user.steam_id}`)
        }

        // Display giveaway activity
        const wonCount = user.giveaways_won?.length || 0
        const createdCount = user.giveaways_created?.length || 0

        if (wonCount > 0 || createdCount > 0) {
          const activityParts = []

          if (wonCount > 0) {
            const wonWithFullCV =
              user.giveaways_won?.filter((g) => g.cv_status === 'FULL_CV')
                .length || 0
            const wonWithReducedCV =
              user.giveaways_won?.filter((g) => g.cv_status === 'REDUCED_CV')
                .length || 0
            const wonWithNoCV =
              user.giveaways_won?.filter((g) => g.cv_status === 'NO_CV')
                .length || 0
            const activatedWins =
              user.giveaways_won?.filter((g) => g.status === 'received')
                .length || 0

            // Steam play data summary
            const gamesWithSteamData =
              user.giveaways_won?.filter(
                (g) => g.steam_play_data && g.steam_play_data.owned
              ).length || 0
            const totalPlaytime =
              user.giveaways_won?.reduce(
                (sum, g) => sum + (g.steam_play_data?.playtime_minutes || 0),
                0
              ) || 0
            const totalAchievements =
              user.giveaways_won?.reduce(
                (sum, g) =>
                  sum + (g.steam_play_data?.achievements_unlocked || 0),
                0
              ) || 0

            activityParts.push(
              `🏆 Won: ${wonCount} (${activatedWins} activated)`
            )
            if (wonWithFullCV > 0)
              activityParts.push(`✅ ${wonWithFullCV} Full CV`)
            if (wonWithReducedCV > 0)
              activityParts.push(`⚠️ ${wonWithReducedCV} Reduced CV`)
            if (wonWithNoCV > 0) activityParts.push(`❌ ${wonWithNoCV} No CV`)

            if (gamesWithSteamData > 0) {
              activityParts.push(`🎮 ${gamesWithSteamData} owned`)
              if (totalPlaytime > 0) {
                const hours = Math.floor(totalPlaytime / 60)
                activityParts.push(`⏱️ ${hours}h played`)
              }
              if (totalAchievements > 0) {
                activityParts.push(`🏅 ${totalAchievements} achievements`)
              }
            }
          }

          if (createdCount > 0) {
            const now = Date.now() / 1000 // Current timestamp in seconds
            const endedGiveaways =
              user.giveaways_created?.filter((g) => g.end_timestamp < now) || []
            const ongoingGiveaways =
              user.giveaways_created?.filter((g) => g.end_timestamp >= now) ||
              []

            const createdWithWinners = endedGiveaways.filter(
              (g) => g.had_winners
            ).length
            const createdWithNoEntries =
              user.giveaways_created?.filter((g) => g.entries === 0).length || 0
            const activatedGiveaways =
              user.giveaways_created?.filter(
                (g) => g.winners && g.winners.some((w) => w.activated)
              ).length || 0
            const totalCopies =
              user.giveaways_created?.reduce((sum, g) => sum + g.copies, 0) || 0

            activityParts.push(
              `🎁 Created: ${createdCount} (${totalCopies} copies)`
            )
            if (endedGiveaways.length > 0 && createdWithWinners > 0)
              activityParts.push(`${createdWithWinners} with winners`)
            if (ongoingGiveaways.length > 0)
              activityParts.push(`${ongoingGiveaways.length} ongoing`)
            if (activatedGiveaways > 0)
              activityParts.push(`${activatedGiveaways} activated by winners`)
            if (createdWithNoEntries > 0)
              activityParts.push(`${createdWithNoEntries} no entries`)
          }

          console.log(`   ${activityParts.join(' | ')}`)
        }
      })

      // Calculate and display summary statistics
      const totalSent = allUsers.reduce(
        (sum, user) => sum + user.stats.total_sent_count,
        0
      )
      const totalSentValue = allUsers.reduce(
        (sum, user) => sum + user.stats.total_sent_value,
        0
      )
      const totalReceived = allUsers.reduce(
        (sum, user) => sum + user.stats.total_received_count,
        0
      )
      const totalReceivedValue = allUsers.reduce(
        (sum, user) => sum + user.stats.total_received_value,
        0
      )

      // Calculate CV-specific stats
      const totalFCVSent = allUsers.reduce(
        (sum, user) => sum + user.stats.fcv_sent_count,
        0
      )
      const totalRCVSent = allUsers.reduce(
        (sum, user) => sum + user.stats.rcv_sent_count,
        0
      )
      const totalNCVSent = allUsers.reduce(
        (sum, user) => sum + user.stats.ncv_sent_count,
        0
      )
      const totalFCVReceived = allUsers.reduce(
        (sum, user) => sum + user.stats.fcv_received_count,
        0
      )
      const totalRCVReceived = allUsers.reduce(
        (sum, user) => sum + user.stats.rcv_received_count,
        0
      )
      const totalNCVReceived = allUsers.reduce(
        (sum, user) => sum + user.stats.ncv_received_count,
        0
      )

      const positiveContributors = allUsers.filter(
        (user) => user.stats.total_gift_difference > 0
      ).length
      const neutralContributors = allUsers.filter(
        (user) => user.stats.total_gift_difference === 0
      ).length
      const negativeContributors = allUsers.filter(
        (user) => user.stats.total_gift_difference < 0
      ).length

      console.log('\n📊 Group Statistics:')
      console.log(
        `  • Total gifts sent: ${totalSent.toFixed(
          1
        )} ($${totalSentValue.toFixed(2)})`
      )
      console.log(
        `  • Total gifts received: ${totalReceived.toFixed(
          1
        )} ($${totalReceivedValue.toFixed(2)})`
      )
      console.log(`  • Net contributors: ${positiveContributors} users`)
      console.log(`  • Neutral: ${neutralContributors} users`)
      console.log(`  • Net receivers: ${negativeContributors} users`)

      console.log(`\n📈 CV-Specific Statistics:`)
      console.log(
        `  • Full CV: ${totalFCVSent} sent, ${totalFCVReceived} received (Difference: ${
          totalFCVSent - totalFCVReceived
        })`
      )
      console.log(
        `  • Reduced CV: ${totalRCVSent} sent, ${totalRCVReceived} received (Difference: ${
          totalRCVSent - totalRCVReceived
        })`
      )
      console.log(
        `  • No CV: ${totalNCVSent} sent, ${totalNCVReceived} received (Difference: ${
          totalNCVSent - totalNCVReceived
        })`
      )

      // Save to file with lastUpdated timestamp
      const userGroupData: UserGroupData = {
        lastUpdated: Date.now(),
        users: allUsers,
      }
      writeFileSync(filename, JSON.stringify(userGroupData, null, 2))
      console.log(`\n💾 Users saved to ${filename}`)
    } else {
      console.log('⚠️  No users found')
    }
  } catch (error) {
    console.error('❌ Failed to fetch users:', error)
    process.exit(1)
  }
}

// Run the script
await main()
