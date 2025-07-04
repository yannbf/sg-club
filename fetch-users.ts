import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { load } from 'cheerio'

interface User {
  username: string
  profile_url: string
  avatar_url: string
  sent_count: number
  sent_value: number
  received_count: number
  received_value: number
  gift_difference: number
  value_difference: number
  steam_id?: string | null
  steam_profile_url?: string | null
}

interface UserStats {
  totalUsers: number
  newUsers: number
  updatedUsers: number
  pagesFetched: number
}

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
          const sent_count = sentMatch ? parseFloat(sentMatch[1]) : 0
          const sent_value = sentMatch
            ? parseFloat(sentMatch[2].replace(/,/g, ''))
            : 0

          // Parse received data (e.g., "0.0 ($0.00)")
          const receivedText = $columns.eq(1).text().trim()
          const receivedMatch = receivedText.match(
            /([0-9.]+)\s*\(\$([0-9.,]+)\)/
          )
          const received_count = receivedMatch
            ? parseFloat(receivedMatch[1])
            : 0
          const received_value = receivedMatch
            ? parseFloat(receivedMatch[2].replace(/,/g, ''))
            : 0

          // Parse gift difference (e.g., "+5.0")
          const giftDiffText = $columns.eq(2).text().trim()
          const gift_difference =
            parseFloat(giftDiffText.replace(/[+$,]/g, '')) || 0

          // Parse value difference (e.g., "+$279.95")
          const valueDiffText = $columns.eq(3).text().trim()
          const value_difference =
            parseFloat(valueDiffText.replace(/[+$,]/g, '')) || 0

          users.push({
            username,
            profile_url,
            avatar_url,
            sent_count,
            sent_value,
            received_count,
            received_value,
            gift_difference,
            value_difference,
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

  private loadExistingUsers(filename: string): Map<string, User> {
    const userMap = new Map<string, User>()

    if (existsSync(filename)) {
      try {
        const data = readFileSync(filename, 'utf-8')
        const existingUsers: User[] = JSON.parse(data)

        for (const user of existingUsers) {
          userMap.set(user.username, user)
        }

        console.log(`📁 Loaded ${existingUsers.length} existing users`)
      } catch (error) {
        console.warn(`⚠️  Could not load existing file: ${error}`)
      }
    } else {
      console.log('📄 No existing file found, starting fresh')
    }

    return userMap
  }

  public async fetchUsers(
    filename: string = 'group_users.json'
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

            // Merge existing Steam info with new data
            const existingUser = existingUsers.get(user.username)!
            const updatedUser = {
              ...user,
              steam_id: existingUser.steam_id,
              steam_profile_url: existingUser.steam_profile_url,
            }
            existingUsers.set(user.username, updatedUser)
          }
        }

        // Get next page
        currentPath = this.getNextPage(html)

        if (currentPath) {
          // Add delay to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 3000))
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

      // Augment users with Steam info if they don't have it
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
            await new Promise((resolve) => setTimeout(resolve, 1000))
          } catch (error) {
            console.warn(`⚠️  Error processing ${user.username}:`, error)
          }
        }
      } else {
        console.log(`✅ All users already have Steam info or no Steam profiles`)
      }

      // Convert map back to array and sort by value difference (highest first)
      const allUsers = Array.from(existingUsers.values())
      allUsers.sort((a, b) => b.value_difference - a.value_difference)

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
  const filename = 'group_users.json'

  try {
    console.log('🚀 Starting user fetching...')
    const allUsers = await fetcher.fetchUsers(filename)

    if (allUsers.length > 0) {
      console.log('\n=== TOP 10 CONTRIBUTORS BY VALUE ===')
      allUsers.slice(0, 10).forEach((user: User, index: number) => {
        const giftIcon =
          user.gift_difference > 0
            ? '📈'
            : user.gift_difference < 0
            ? '📉'
            : '➖'
        const valueIcon =
          user.value_difference > 0
            ? '💰'
            : user.value_difference < 0
            ? '💸'
            : '💱'
        const steamIcon = user.steam_id ? '🎮' : ''

        console.log(
          `${index + 1}. ${user.username} ${steamIcon} - ${giftIcon} ${
            user.gift_difference > 0 ? '+' : ''
          }${user.gift_difference.toFixed(1)} gifts, ${valueIcon} ${
            user.value_difference > 0 ? '+' : ''
          }$${user.value_difference.toFixed(2)}`
        )
        console.log(
          `   Sent: ${user.sent_count.toFixed(1)} ($${user.sent_value.toFixed(
            2
          )}) | Received: ${user.received_count.toFixed(
            1
          )} ($${user.received_value.toFixed(2)})`
        )

        if (user.steam_id) {
          console.log(`   Steam ID: ${user.steam_id}`)
        }
      })

      // Calculate and display summary statistics
      const totalSent = allUsers.reduce((sum, user) => sum + user.sent_count, 0)
      const totalSentValue = allUsers.reduce(
        (sum, user) => sum + user.sent_value,
        0
      )
      const totalReceived = allUsers.reduce(
        (sum, user) => sum + user.received_count,
        0
      )
      const totalReceivedValue = allUsers.reduce(
        (sum, user) => sum + user.received_value,
        0
      )

      const positiveContributors = allUsers.filter(
        (user) => user.gift_difference > 0
      ).length
      const neutralContributors = allUsers.filter(
        (user) => user.gift_difference === 0
      ).length
      const negativeContributors = allUsers.filter(
        (user) => user.gift_difference < 0
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

      // Save to file
      writeFileSync(filename, JSON.stringify(allUsers, null, 2))
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
