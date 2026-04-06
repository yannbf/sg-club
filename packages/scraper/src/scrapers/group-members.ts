import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { load } from 'cheerio'
import type {
  User,
  UserStats,
  Giveaway,
  UserGroupData,
  GamePrice,
  UserGiveawaysStats,
  SteamIdMap,
  SteamIdMapEntry,
} from '../types/steamgifts.js'
import { steamChecker, type GamePlayData } from '../api/fetch-steam-data.js'
import { delay } from '../utils/common.js'
import { logError } from '../utils/log-error.js'
import { GiveawayPointsManager } from '../api/fetch-proof-of-play.js'
import type { GiveawayData } from '../api/fetch-proof-of-play.js'

const debug = (...args: any[]) => {
  if (process.env.DEBUG) {
    console.log(...args)
  }
}

const GAME_DATA = JSON.parse(
  readFileSync('../website/public/data/game_data.json', 'utf-8'),
) as GamePrice[]
let GIVEAWAY_DATA: Giveaway[] = []
try {
  GIVEAWAY_DATA = JSON.parse(
    readFileSync('../website/public/data/giveaways.json', 'utf-8'),
  ).giveaways as Giveaway[]
} catch (error) {
  console.warn(`⚠️  Could not load giveaway file: ${error}`)
}

// Raw format: { "ga_link": [{ steam_id, joined_at }] }
// Pivoted to: { "steam_id": [{ link, joined_at }] }
const RAW_USER_ENTRIES = JSON.parse(
  readFileSync('../website/public/data/user_entries.json', 'utf-8'),
) as Record<string, { steam_id: string; joined_at: string }[]>

const USER_ENTRIES: Record<string, { link: string; joined_at: number }[]> = {}
for (const [gaLink, entries] of Object.entries(RAW_USER_ENTRIES)) {
  for (const entry of entries) {
    if (!USER_ENTRIES[entry.steam_id]) USER_ENTRIES[entry.steam_id] = []
    USER_ENTRIES[entry.steam_id].push({ link: gaLink, joined_at: Number(entry.joined_at) })
  }
}

const IDLE_GAMES_WHITELIST = [
  251150, // The Legend of Heroes: Trails in the Sky
  1174180, // Red Dead Redemption 2
  1901370, // Ib
]

// getGameInfo receives a giveaway link, then finds the HLTB data for the game
// and returns the game data
const getGameInfo = (link: string) => {
  const giveawayData = GIVEAWAY_DATA.find((g) => g.link === link)
  const gameData = GAME_DATA.find(
    (g) =>
      (g.app_id && g.app_id === giveawayData?.app_id) ||
      (g.package_id && g.package_id === giveawayData?.package_id),
  )
  return gameData
}

function calculateAchievementPercentages(giveaways: User['giveaways_won']) {
  const games = (giveaways || []).filter(
    (g) =>
      g.steam_play_data?.achievements_percentage !== undefined &&
      g.steam_play_data?.achievements_percentage !== null &&
      g.steam_play_data?.achievements_unlocked !== undefined &&
      g.steam_play_data?.achievements_total !== undefined,
  )

  if (games.length === 0) {
    return { averagePercentage: 0, totalPercentage: 0 }
  }

  // Average percentage per game
  const sumPercentages = games.reduce(
    (acc, g) => acc + (g.steam_play_data?.achievements_percentage || 0),
    0,
  )
  const averagePercentage = sumPercentages / games.length

  // True total percentage (weighted by achievements)
  const { totalEarned, totalPossible } = games.reduce(
    (acc, g) => {
      acc.totalEarned += g.steam_play_data?.achievements_unlocked || 0
      acc.totalPossible += g.steam_play_data?.achievements_total || 0
      return acc
    },
    { totalEarned: 0, totalPossible: 0 },
  )
  const totalPercentage =
    totalPossible > 0 ? (totalEarned / totalPossible) * 100 : 0

  // Return both, rounded to 2 decimals
  return {
    averagePercentage: Number(averagePercentage.toFixed(2)),
    totalPercentage: Number(totalPercentage.toFixed(2)),
  }
}

export class SteamGiftsUserFetcher {
  private readonly baseUrl = 'https://www.steamgifts.com'
  private readonly startUrl = '/group/WlYTQ/thegiveawaysclub/users'

  private buildSteamGiftsHeaders(): Record<string, string> {
    const cookie = process.env.SG_COOKIE
    const accessToken = process.env.SG_TOKEN

    return {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(accessToken ? { 'X-Access-Token': accessToken } : {}),
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    }
  }

  private async fetchPage(
    path: string,
    retryCount: number = 0,
  ): Promise<string> {
    const url = this.baseUrl + path
    console.log(`📄 Fetching: ${url}`)

    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildSteamGiftsHeaders(),
    })

    if (!response.ok) {
      const errorMessage = `Failed to fetch ${url}: ${response.statusText}`

      if (
        response.status === 429 ||
        response.statusText.includes('Too Many Requests')
      ) {
        console.log(`⚠️  Rate limit exceeded, retrying: ${url}`)
        if (retryCount < 3) {
          await delay(10000)
          return await this.fetchPage(path, retryCount + 1)
        }
      }

      const error = new Error(errorMessage)
      logError(error, errorMessage)
      throw error
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
            /([0-9.]+)\s*\(\$([0-9.,]+)\)/,
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
            steam_id: '', // Populated later by fetchUserSteamInfo or synthetic key
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
    user: User,
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

  public async calculateStats(
    user: User,
    giveaways: Giveaway[],
  ): Promise<UserGiveawaysStats> {
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

    // Build game price lookup from module-level GAME_DATA (loaded once at startup)
    const gamePriceMap = new Map<string, GamePrice>()
    for (const game of GAME_DATA) {
      if (game.app_id) {
        gamePriceMap.set(`app/${game.app_id}`, game)
      }
      if (game.package_id) {
        gamePriceMap.set(`sub/${game.package_id}`, game)
      }
    }
    const giveawayMap = new Map(giveaways.map((g) => [g.link, g]))

    const pointsManager = GiveawayPointsManager.getInstance()
    const decreasedRatioCache = new Map<
      string,
      import('../api/fetch-proof-of-play').DecreasedRatioData[]
    >()
    const getDecreasedRatiosForGiveaway = async (
      id: string,
    ): Promise<import('../api/fetch-proof-of-play').DecreasedRatioData[]> => {
      if (decreasedRatioCache.has(id)) return decreasedRatioCache.get(id) || []
      const rows = (await pointsManager.getDecreasedRatioById(id)) || []
      decreasedRatioCache.set(id, rows)
      return rows
    }

    // Count sent giveaways by CV status and calculate real values
    if (user.giveaways_created) {
      const giveawaysWithNoEntriesCount = user.giveaways_created.filter(
        (giveaway) => 'had_winners' in giveaway && !giveaway.had_winners,
      ).length

      userStats.giveaways_created = user.giveaways_created.length ?? 0
      userStats.giveaways_with_no_entries = giveawaysWithNoEntriesCount ?? 0

      for (const createdGiveaway of user.giveaways_created) {
        if (!createdGiveaway.had_winners) {
          continue
        }

        // Track shared giveaways
        if (createdGiveaway.is_shared) {
          userStats.shared_sent_count +=
            createdGiveaway.winners?.filter((w) => w.activated).length ?? 0
          continue
        }

        const fullGiveaway = giveawayMap.get(createdGiveaway.link)
        if (!fullGiveaway) {
          continue
        }

        const giveawayId = createdGiveaway.link.split('/')[0]
        const decreasedRatios = await getDecreasedRatiosForGiveaway(giveawayId)

        createdGiveaway.winners?.forEach((winner) => {
          if (!winner.activated) return

          let gamePrice: GamePrice | undefined
          if (fullGiveaway.app_id) {
            gamePrice = gamePriceMap.get(`app/${fullGiveaway.app_id}`)
          } else if (fullGiveaway.package_id) {
            gamePrice = gamePriceMap.get(`sub/${fullGiveaway.package_id}`)
          }

          const decreasedRatioMatch = winner.name
            ? decreasedRatios.find(
                (r) =>
                  r.winner.toLowerCase().trim() ===
                  winner.name!.toLowerCase().trim(),
              )
            : undefined

          if (decreasedRatioMatch) {
            console.log(
              `⚠️  Freebie ratio match found for ${createdGiveaway.name} and winner ${winner.name}: giftWeight: ${decreasedRatioMatch.giftWeight} winWeight: ${decreasedRatioMatch.winWeight}`,
            )
          }

          const weight = Math.min(1, decreasedRatioMatch?.giftWeight || 1)

          switch (createdGiveaway.cv_status) {
            case 'FULL_CV':
              userStats.fcv_sent_count += weight
              userStats.real_total_sent_count += weight
              if (gamePrice) {
                const finalValue = (gamePrice.price_usd_full / 100) * weight
                debug(
                  `Adding Full CV value for ${createdGiveaway.name}: ${finalValue}`,
                )
                userStats.real_total_sent_value += Number(finalValue.toFixed(2))
              }
              break
            case 'REDUCED_CV':
              userStats.rcv_sent_count += weight
              if (gamePrice) {
                userStats.real_total_sent_value += Number(
                  ((gamePrice.price_usd_reduced / 100) * weight).toFixed(2),
                ) // Convert cents to dollars and round to 2 decimals
              }
              break
            case 'NO_CV':
              userStats.ncv_sent_count += weight
              // No value added for NO_CV games
              break
          }
        })
      }

      debug(`Total sent value: ${userStats.real_total_sent_value}`)
    }

    // Count received giveaways by CV status and calculate real values
    if (user.giveaways_won) {
      let fcvWonWithoutIPlayedBroWeighted = 0
      for (const wonGiveaway of user.giveaways_won) {
        // Track shared giveaways
        if (wonGiveaway.is_shared) {
          userStats.shared_received_count++
          continue
        }

        const fullGiveaway = giveawayMap.get(wonGiveaway.link)
        if (!fullGiveaway) {
          continue
        }

        let gamePrice: GamePrice | undefined
        if (fullGiveaway.app_id) {
          gamePrice = gamePriceMap.get(`app/${fullGiveaway.app_id}`)
        } else if (fullGiveaway.package_id) {
          gamePrice = gamePriceMap.get(`sub/${fullGiveaway.package_id}`)
        }

        const giveawayId = wonGiveaway.link.split('/')[0]
        const decreasedRatios = await getDecreasedRatiosForGiveaway(giveawayId)
        const weightEntry = decreasedRatios.find(
          (r) =>
            r.winner.toLowerCase().trim() ===
            user.username.toLowerCase().trim(),
        )
        const weight = Math.min(1, weightEntry?.winWeight || 1)

        switch (wonGiveaway.cv_status) {
          case 'FULL_CV':
            userStats.real_total_received_count += weight
            userStats.fcv_received_count += weight
            if (gamePrice) {
              userStats.real_total_received_value += Number(
                ((gamePrice.price_usd_full / 100) * weight).toFixed(2),
              ) // Convert cents to dollars and round to 2 decimals
            }
            if (!wonGiveaway.i_played_bro) {
              fcvWonWithoutIPlayedBroWeighted += weight
            }
            break
          case 'REDUCED_CV':
            userStats.rcv_received_count += weight
            if (gamePrice) {
              userStats.real_total_received_value += Number(
                ((gamePrice.price_usd_reduced / 100) * weight).toFixed(2),
              ) // Convert cents to dollars and round to 2 decimals
            }
            break
          case 'NO_CV':
            userStats.ncv_received_count += weight
            // No value added for NO_CV games
            break
        }
      }
      userStats.fcv_gift_difference =
        userStats.fcv_sent_count - userStats.fcv_received_count

      userStats.giveaway_ratio =
        userStats.fcv_sent_count - fcvWonWithoutIPlayedBroWeighted / 3
    }

    // Calculate real value differences
    userStats.real_total_value_difference = Number(
      (
        userStats.real_total_sent_value - userStats.real_total_received_value
      ).toFixed(2),
    )
    userStats.real_total_gift_difference = Number(
      (
        userStats.real_total_sent_count - userStats.real_total_received_count
      ).toFixed(2),
    )

    // Round weighted stats to 2 decimals where applicable
    const round2 = (n: number) => Number(n.toFixed(2))
    userStats.fcv_sent_count = round2(userStats.fcv_sent_count)
    userStats.rcv_sent_count = round2(userStats.rcv_sent_count)
    userStats.ncv_sent_count = round2(userStats.ncv_sent_count)
    userStats.fcv_received_count = round2(userStats.fcv_received_count)
    userStats.rcv_received_count = round2(userStats.rcv_received_count)
    userStats.ncv_received_count = round2(userStats.ncv_received_count)
    userStats.real_total_sent_count = round2(userStats.real_total_sent_count)
    userStats.real_total_received_count = round2(
      userStats.real_total_received_count,
    )
    userStats.fcv_gift_difference = round2(userStats.fcv_gift_difference)
    userStats.real_total_sent_value = round2(userStats.real_total_sent_value)
    userStats.real_total_received_value = round2(
      userStats.real_total_received_value,
    )
    userStats.real_total_value_difference = round2(
      userStats.real_total_value_difference,
    )
    userStats.real_total_gift_difference = round2(
      userStats.real_total_gift_difference,
    )
    userStats.giveaway_ratio = round2(userStats.giveaway_ratio ?? 0)

    // Calculate achievement percentages
    const wonGiveawaysWithAchievements =
      user.giveaways_won?.filter(
        (g) =>
          g.steam_play_data?.achievements_percentage !== undefined &&
          g.steam_play_data?.achievements_percentage !== null,
      ) || []

    if (wonGiveawaysWithAchievements.length > 0) {
      const allAchievementsData = calculateAchievementPercentages(
        wonGiveawaysWithAchievements,
      )
      userStats.total_achievements_percentage = Math.round(
        allAchievementsData.totalPercentage,
      )
      userStats.average_achievements_percentage = Math.round(
        allAchievementsData.averagePercentage,
      )

      const realWonGiveawaysWithAchievements =
        wonGiveawaysWithAchievements.filter(
          (g) => !g.is_shared && g.cv_status === 'FULL_CV',
        )

      const realAchievementsData = calculateAchievementPercentages(
        realWonGiveawaysWithAchievements,
      )

      userStats.real_total_achievements_percentage = Math.round(
        realAchievementsData.totalPercentage,
      )
      userStats.real_average_achievements_percentage = Math.round(
        realAchievementsData.averagePercentage,
      )

      const hasMissingAchievementsData = wonGiveawaysWithAchievements.some(
        (g) => g.steam_play_data?.has_no_available_stats,
      )

      userStats.has_missing_achievements_data = hasMissingAchievementsData
    }

    return userStats as UserGiveawaysStats
  }

  public async updateSteamPlayData(
    users: Map<string, User>,
    giveaways: Giveaway[],
  ): Promise<void> {
    console.log(`🎮 Updating Steam play data for won games...`)

    let steamCheckedCount = 0
    let steamErrorCount = 0
    let steamSkippedCount = 0
    let noStatsAvailableCount = 0

    // Calculate timestamp for 5 months ago (150 days)
    const fiveMonthsAgo = Date.now() / 1000 - 5 * 30 * 24 * 60 * 60

    const usersToUpdate = Array.from(users.values()).filter(
      (u) => u.steam_id && !u.steam_id.startsWith('username:'),
    )
    const totalUsers = usersToUpdate.length
    let processedUsers = 0

    // Build a giveaway lookup map for O(1) access instead of .find() per game
    const giveawayByLink = new Map(giveaways.map((g) => [g.link, g]))

    for (const user of usersToUpdate) {
      processedUsers++
      const username = user.username
      console.log(
        `[${processedUsers}/${totalUsers}] 🎮 Checking Steam data for ${username}`,
      )

      // Check Steam profile visibility first
      try {
        const visibility = await steamChecker.checkProfileVisibility(
          user.steam_id,
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
          `🙈 Skipping Steam data for ${username} (profile is private)`,
        )
        users.set(username, user) // Make sure to save the updated private flag
        continue
      }

      if (!user.giveaways_won) continue

      let userUpdated = false
      // Create a copy of the user's won games to preserve existing data
      const updatedGiveawaysWon = [...user.giveaways_won]

      for (let i = 0; i < updatedGiveawaysWon.length; i++) {
        const wonGame = updatedGiveawaysWon[i]
        // Find the giveaway to get the app_id
        const giveaway = giveawayByLink.get(wonGame.link)
        if (!giveaway?.app_id && !giveaway?.package_id) continue

        // Skip old giveaways unless FETCH_ALL_STEAM_DATA is set
        if (
          process.env.FETCH_ALL_STEAM_DATA !== 'true' &&
          wonGame.end_timestamp < fiveMonthsAgo
        ) {
          steamSkippedCount++
          console.log(
            `⏭️  Skipping ${username}: ${wonGame.name} (ended ${Math.floor(
              (Date.now() / 1000 - wonGame.end_timestamp) / (24 * 60 * 60),
            )} days ago)`,
          )
          continue
        }

        try {
          // Skip if the game has no stats available and was checked within the last 2 days
          if (
            wonGame.steam_play_data?.has_no_available_stats &&
            wonGame.steam_play_data?.last_checked &&
            Date.now() - wonGame.steam_play_data.last_checked <
              2 * 24 * 60 * 60 * 1000
          ) {
            console.log(
              `⚠️  Skipping ${username}: ${wonGame.name} (no stats available and checked within the last 2 days)`,
            )
            noStatsAvailableCount++
            continue
          }

          debug(`Checking Steam data for ${username}: ${wonGame.name}`)
          const gamePlayData = await steamChecker.getGamePlayData(
            user.steam_id,
            giveaway.app_id ?? giveaway.package_id!,
            giveaway.package_id ? 'sub' : 'app',
          )
          debug(`Got Steam data: ${JSON.stringify(gamePlayData)}`)

          // Only update if we got valid data
          if (gamePlayData) {
            let isPotentiallyIdling =
              wonGame.steam_play_data?.is_potentially_idling

            const isWhitelisted = IDLE_GAMES_WHITELIST.includes(
              giveaway.app_id ?? giveaway.package_id!,
            )

            // If previously marked idling but now whitelisted, remove idling flag
            if (isPotentiallyIdling && isWhitelisted) {
              isPotentiallyIdling = undefined
            } else if (gamePlayData.achievements_total === 0) {
              isPotentiallyIdling = undefined
            } else if (
              !isWhitelisted &&
              !isPotentiallyIdling &&
              gamePlayData.achievements_total > 0 &&
              gamePlayData.achievements_unlocked === 0 &&
              gamePlayData.playtime_minutes > 180
            ) {
              isPotentiallyIdling = true
            }

            // If previously marked as idling, but user unlocked achievements, remove idling flag
            if (
              isPotentiallyIdling &&
              gamePlayData.achievements_total > 0 &&
              gamePlayData.achievements_unlocked > 0
            ) {
              isPotentiallyIdling = false
            }

            updatedGiveawaysWon[i] = {
              ...wonGame,
              steam_play_data: {
                ...gamePlayData,
                last_checked: Date.now(),
                ...(isPotentiallyIdling !== undefined && {
                  is_potentially_idling: isPotentiallyIdling,
                }),
              },
            }
            userUpdated = true
            steamCheckedCount++
          } else {
            console.log(
              `⚠️  No valid Steam data returned for ${username}: ${wonGame.name}`,
            )
            steamErrorCount++
          }

          // Rate limiting - 1000ms between Steam API calls
          await delay(1000)
        } catch (error) {
          const errorMessage = `Error checking Steam data for ${username}/${wonGame.name}`
          console.warn(`⚠️  ${errorMessage}:`, error)
          logError(error, errorMessage)
          steamErrorCount++

          // Rate limiting even on errors
          await delay(1000)
        }
      }

      if (userUpdated) {
        users.set(username, {
          ...user,
          giveaways_won: updatedGiveawaysWon,
        })
      }
    }

    console.log(`🎮 Steam data update complete:`)
    console.log(`  • Checked: ${steamCheckedCount}`)
    console.log(`  • Skipped (>5 months old): ${steamSkippedCount}`)
    console.log(`  • No stats available: ${noStatsAvailableCount}`)
    console.log(`  • Errors: ${steamErrorCount}`)
  }

  public async enrichUsersWithGiveaways(
    existingUsers: Map<string, User>,
    giveaways: Giveaway[],
  ): Promise<void> {
    console.log(`\n🎁 Enriching users with giveaway data...`)

    const pointsManager = GiveawayPointsManager.getInstance()
    const allPointsData = await pointsManager.getAllGiveaways()
    // Create a map of arrays to store multiple entries per giveaway ID
    const pointsMap = new Map<string, GiveawayData[]>()
    allPointsData.forEach((pointData) => {
      const entries = pointsMap.get(pointData.id) || []
      entries.push(pointData)
      pointsMap.set(pointData.id, entries)
    })

    // Load steam_id_map for previous username lookups (points data uses usernames)
    const steamIdMapPath = '../website/public/data/steam_id_map.json'
    const steamIdMapForEnrich: SteamIdMap = existsSync(steamIdMapPath)
      ? JSON.parse(readFileSync(steamIdMapPath, 'utf-8'))
      : {}

    let enrichedCount = 0
    const now = Date.now() / 1000 // Current timestamp in seconds
    const totalUsers = existingUsers.size

    // Pre-build lookup maps for O(1) access instead of O(giveaways) per user
    const giveawaysByCreator = new Map<string, Giveaway[]>()
    const giveawaysByWinner = new Map<string, Giveaway[]>()
    for (const giveaway of giveaways) {
      // Creator map
      const creatorGiveaways = giveawaysByCreator.get(giveaway.creator) || []
      creatorGiveaways.push(giveaway)
      giveawaysByCreator.set(giveaway.creator, creatorGiveaways)

      // Winner map (keyed by winner steam_id)
      if (giveaway.winners) {
        for (const winner of giveaway.winners) {
          if (winner.name && winner.status === 'received') {
            const winnerGiveaways = giveawaysByWinner.get(winner.name) || []
            winnerGiveaways.push(giveaway)
            giveawaysByWinner.set(winner.name, winnerGiveaways)
          }
        }
      }
    }

    // Process each user
    for (const [username, user] of existingUsers) {
      enrichedCount++
      // Get all giveaways created by this user (creator is now steam_id)
      const userGiveaways = giveawaysByCreator.get(user.steam_id) || []

      const giveawaysWon: NonNullable<User['giveaways_won']> = []
      const giveawaysCreated: NonNullable<User['giveaways_created']> = []

      // Create a map of existing won games to preserve Steam data
      const existingWonGames = new Map(
        user.giveaways_won?.map((game) => [game.link, game]) || [],
      )

      // Find giveaways won by this user via pre-built winner map (O(1) lookup)
      const wonGiveawaysList = giveawaysByWinner.get(user.steam_id) || []
      for (const giveaway of wonGiveawaysList) {
        const winner = giveaway.winners!.find(w => w.name === user.steam_id && w.status === 'received')
        if (winner) {
              const giveawayId = giveaway.link.split('/')[0]
              const pointsDataEntries = pointsMap.get(giveawayId) || []
              // Find the specific entry for this winner (points data uses usernames)
              // Try current username first, then previous usernames
              const usernames = [username]
              const mapEntry = steamIdMapForEnrich[user.steam_id]
              if (mapEntry) {
                for (const prev of mapEntry.previous) {
                  usernames.push(prev.username)
                }
              }
              const pointsData = pointsDataEntries.find((entry) => {
                const entryWinner = entry.winner?.toLowerCase().trim()
                return usernames.some((n) => n.toLowerCase().trim() === entryWinner)
              })

              // using this to debug, running via generate-members-data script
              if (process.env.DEBUG === 'true') {
                debug(`Points data for ${giveaway.name}:`, pointsData)
              }

              // Get existing game data to preserve Steam data
              const existingGame = existingWonGames.get(giveaway.link)

              const giveawayData: NonNullable<User['giveaways_won']>[0] = {
                name: giveaway.name,
                link: giveaway.link,
                cv_status: giveaway.cv_status || 'FULL_CV',
                status: winner.status,
                end_timestamp: giveaway.end_timestamp,
                required_play: giveaway.required_play || false,
                is_shared: giveaway.is_shared || false,
                // Preserve existing Steam data if it exists
                steam_play_data: existingGame?.steam_play_data,
              }

              if (pointsData) {
                if (pointsData.completedIplayBro) {
                  giveawayData.i_played_bro =
                    pointsData.completedIplayBro ?? false
                }

                if (
                  pointsData.playRequirements &&
                  !pointsData.playRequirements.ignoreRequirements
                ) {
                  giveawayData.required_play = true
                  giveawayData.required_play_meta = {
                    requirements_met:
                      pointsData.playRequirements.playRequirementsMet ?? false,
                    deadline_in_months:
                      pointsData.playRequirements.deadlineInMonths,
                    ...(pointsData.playRequirements.deadline && {
                      deadline: pointsData.playRequirements.deadline,
                    }),
                    ...(pointsData.playRequirements.additionalNotes && {
                      additional_notes:
                        pointsData.playRequirements.additionalNotes,
                    }),
                  }
                } else if (
                  pointsData.playRequirements &&
                  pointsData.playRequirements.ignoreRequirements
                ) {
                  // requirements are ignored if "PLAY REQUIREMENTS MET" in the sheet contains "NA"
                  giveawayData.required_play = false
                }
              }

              giveawaysWon.push(giveawayData)
        }
      }

      // Find giveaways created by this user via pre-built creator map (O(1) lookup)
      for (const giveaway of userGiveaways) {
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

          const giveawayId = giveaway.link.split('/')[0]
          const pointsDataEntries = pointsMap.get(giveawayId) || []

          // For created giveaways, check if any winner has completed the requirements
          const anyWinnerCompletedIPlayBro = pointsDataEntries.some(
            (entry) => entry.completedIplayBro,
          )
          const anyWinnerMetRequirements = pointsDataEntries.some(
            (entry) => entry.playRequirements?.playRequirementsMet,
          )

          if (pointsDataEntries.length > 0) {
            // Take the first entry for deadline info since it should be the same for all winners
            const firstEntry = pointsDataEntries[0]

            if (firstEntry.completedIplayBro !== undefined) {
              giveawayCreated.i_played_bro = anyWinnerCompletedIPlayBro
            }

            if (firstEntry.playRequirements) {
              giveawayCreated.required_play_meta = {
                requirements_met: anyWinnerMetRequirements,
                deadline: firstEntry.playRequirements.deadline,
                deadline_in_months:
                  firstEntry.playRequirements.deadlineInMonths,
                additional_notes: firstEntry.playRequirements.additionalNotes,
              }
            }
          }

          // Only set had_winners if the giveaway has ended
          if (giveaway.end_timestamp < now) {
            giveawayCreated.had_winners = giveaway.hasWinners || false
          }

          // Add winner details if there are winners
          if (giveaway.winners && giveaway.winners.length > 0) {
            giveawayCreated.winners = giveaway.winners.map((winner) => ({
              name: winner.name,
              winner_username: winner.winner_username,
              status: winner.status,
              activated: winner.name !== null && winner.status === 'received',
            }))
          }

          giveawaysCreated.push(giveawayCreated)
      }

      // Update user with giveaway information
      const updatedUser: User = {
        ...user,
        giveaways_won: giveawaysWon.length > 0 ? giveawaysWon : undefined,
        giveaways_created:
          giveawaysCreated.length > 0 ? giveawaysCreated : undefined,
        // Preserve Steam-related data
        steam_id: user.steam_id,
        steam_profile_url: user.steam_profile_url,
        steam_profile_is_private: user.steam_profile_is_private,
        country_code: user.country_code,
      }

      // Calculate user stats
      const userStats = await this.calculateStats(updatedUser, giveaways)
      updatedUser.stats = {
        ...updatedUser.stats,
        ...userStats,
      }

      existingUsers.set(username, updatedUser)

      const wonCount = giveawaysWon.length
      const createdCount = giveawaysCreated.length
      console.log(
        `[${enrichedCount}/${totalUsers}] ✅ ${username}: ${wonCount} won, ${createdCount} created`,
      )
    }

    console.log(`📊 Enriched ${enrichedCount} users with giveaway data`)
  }

  /**
   * Loads existing users from file (keyed by steam_id) and returns a Map keyed by username
   * for internal processing (matching against HTML-scraped data which uses usernames).
   */
  private loadExistingUsers(filename: string): Map<string, User> {
    const userMap = new Map<string, User>()

    if (existsSync(filename)) {
      try {
        const data = readFileSync(filename, 'utf-8')
        const existingData: UserGroupData = JSON.parse(data)

        // File is keyed by steam_id, but we build Map by username for merging
        const userList = Object.values(existingData.users)

        for (const user of userList) {
          userMap.set(user.username, user)
        }

        console.log(`📁 Loaded ${userList.length} existing users`)
        if (existingData.lastUpdated) {
          console.log(
            `📅 Last updated: ${new Date(
              existingData.lastUpdated,
            ).toLocaleString()}`,
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
        console.warn(
          `⚠️  Failed to fetch page: ${this.baseUrl}${currentPath}:`,
          error,
        )
        break
      }

      const usersOnPage = this.parseUsers(html)
      if (usersOnPage.length === 0) {
        console.log('📭 No more users found.')
        break
      }

      allScrapedUsers.push(...usersOnPage)
      console.log(
        `   ... found ${usersOnPage.length} users on page ${pagesFetched}. Total: ${allScrapedUsers.length}`,
      )

      // Get next page
      currentPath = this.getNextPage(html)

      if (currentPath) {
        // Add delay to avoid rate limiting
        await delay(1000)
      }
    }
    console.log(
      `✅ Fetched a total of ${allScrapedUsers.length} users from ${pagesFetched} pages this run.`,
    )
    return allScrapedUsers
  }

  public calculateUserWarnings(user: User, giveaways: Giveaway[]): string[] {
    let warnings: string[] = []
    const unplayedRequiredPlayGiveaways =
      user.giveaways_won?.filter(
        (g) => g.required_play && !g.required_play_meta?.requirements_met,
      ) ?? []
    if (unplayedRequiredPlayGiveaways.length >= 2) {
      warnings.push('unplayed_required_play_giveaways')

      const enteredGiveawayData = USER_ENTRIES?.[user.steam_id] || []

      if (unplayedRequiredPlayGiveaways.length === 2) {
        const enteredGiveawaysWithPlayRequired = enteredGiveawayData
          .map((g) => giveaways.find((ga) => ga.link === g.link))
          .filter((g) => g !== undefined && g.required_play)

        if (enteredGiveawaysWithPlayRequired.length > 0) {
          warnings.push('illegal_entered_required_play_giveaways')
        }
      } else if (
        unplayedRequiredPlayGiveaways.length >= 3 &&
        enteredGiveawayData.length > 0
      ) {
        warnings.push('illegal_entered_any_giveaways')
      }
    }

    const gamesThatNeedRequirePlayReview = user.giveaways_won?.filter((g) => {
      const gameData = getGameInfo(g.link)

      const hasHalfAchievements =
        g.steam_play_data?.achievements_percentage &&
        g.steam_play_data?.achievements_percentage >= 50
      const hasPotentiallyCompletedMainStory =
        g.steam_play_data?.playtime_minutes &&
        g.steam_play_data?.playtime_minutes >=
          (gameData?.hltb_main_story_hours || 0) * 0.9 * 60

      // console.log({
      //   playData: g.steam_play_data,
      //   gameData,
      //   hltbCalculated: (gameData?.hltb_main_story_hours || 0) * 0.9 * 60,
      // })
      const hasOver15HoursPlaytime =
        g.steam_play_data?.playtime_minutes &&
        g.steam_play_data?.playtime_minutes >= 15 * 60

      const shouldReview =
        hasHalfAchievements ||
        hasPotentiallyCompletedMainStory ||
        hasOver15HoursPlaytime

      return (
        g.required_play &&
        !g.required_play_meta?.requirements_met &&
        shouldReview
      )
    })

    if (
      gamesThatNeedRequirePlayReview?.length &&
      gamesThatNeedRequirePlayReview.length > 0
    ) {
      warnings.push('required_plays_need_review')
    }

    // Add warning for play required wins with less than 15 days remaining
    const oneDayMs = 24 * 60 * 60 * 1000
    const getDeadlineDate = (
      endTimestamp: number,
      meta?: { deadline?: string; deadline_in_months?: number },
    ): Date => {
      if (meta?.deadline) {
        // Expected format: dd.MM.yyyy
        const parts = meta.deadline.split('.')
        if (parts.length === 3) {
          const day = parseInt(parts[0], 10)
          const month = parseInt(parts[1], 10)
          const year = parseInt(parts[2], 10)
          if (
            !Number.isNaN(day) &&
            !Number.isNaN(month) &&
            !Number.isNaN(year)
          ) {
            return new Date(year, month - 1, day, 23, 59, 59, 999)
          }
        }
      }

      const months = meta?.deadline_in_months ?? 2
      const effectiveMonths = months === 0 ? 2 : months
      const base = new Date(endTimestamp * 1000)
      const deadline = new Date(base.getTime())
      deadline.setMonth(deadline.getMonth() + effectiveMonths)
      return deadline
    }

    const hasSoonExpiringRequiredPlays = (user.giveaways_won || []).some(
      (g) => {
        if (!g.required_play || g.required_play_meta?.requirements_met)
          return false
        const deadlineDate = getDeadlineDate(
          g.end_timestamp,
          g.required_play_meta,
        )
        const daysRemaining = Math.floor(
          (deadlineDate.getTime() - Date.now()) / oneDayMs,
        )
        return daysRemaining >= 0 && daysRemaining < 15
      },
    )

    if (hasSoonExpiringRequiredPlays) {
      warnings.push('required_play_deadline_within_15_days')
    }

    // TODO: Maybe bring this back.
    // const isPotentiallyIdlingGames = user.giveaways_won?.some(
    //   (g) =>
    //     g.steam_play_data?.is_potentially_idling &&
    //     g.steam_play_data?.is_potentially_idling === true
    // )
    // if (isPotentiallyIdlingGames) {
    //   warnings.push('potentially_idling_games')
    // }

    return warnings
  }

  public async fetchUsers(
    filename: string = '../website/public/data/group_users.json',
    usersList?: User[],
  ): Promise<User[]> {
    try {
      // Load existing users
      const existingUsers = this.loadExistingUsers(filename)

      console.log('🚀 Fetching group users...')

      let allScrapedUsers: User[] = usersList ?? []
      if (!usersList) {
        allScrapedUsers = await this._fetchAllUsersFromPages()
      }

      let newUsersCount = 0
      let updatedUsersCount = 0
      let steamInfoFetched = 0

      // Build a lookup from username → steam_id using existing data AND
      // the steam_id_map (which tracks previous usernames) so we can match
      // scraped users even if they changed their name
      const usernameToSteamId = new Map<string, string>()
      for (const [, user] of existingUsers) {
        usernameToSteamId.set(user.username, user.steam_id)
      }
      // Also load previous usernames from steam_id_map so renamed users can be matched
      const steamIdMapPath = '../website/public/data/steam_id_map.json'
      if (existsSync(steamIdMapPath)) {
        try {
          const steamIdMap: SteamIdMap = JSON.parse(readFileSync(steamIdMapPath, 'utf-8'))
          for (const [steamId, entry] of Object.entries(steamIdMap)) {
            // Map the current name (in case existing data is stale)
            if (!usernameToSteamId.has(entry.current)) {
              usernameToSteamId.set(entry.current, steamId)
            }
            // Map all previous names
            for (const prev of entry.previous) {
              if (!usernameToSteamId.has(prev.username)) {
                usernameToSteamId.set(prev.username, steamId)
              }
            }
          }
        } catch {}
      }

      // Track current group members by steam_id to identify removed users
      const currentGroupSteamIds = new Set<string>()

      // Build a reverse lookup: steam_id → old username in existingUsers
      const steamIdToOldUsername = new Map<string, string>()
      for (const [username, user] of existingUsers) {
        steamIdToOldUsername.set(user.steam_id, username)
      }

      // Helper to merge scraped user with existing data
      const mergeWithExisting = (user: User, existingUser: User): User => ({
        ...user,
        steam_id: existingUser.steam_id,
        steam_profile_url: existingUser.steam_profile_url,
        steam_profile_is_private: existingUser.steam_profile_is_private,
        country_code: existingUser.country_code,
        giveaways_won: existingUser.giveaways_won?.map((game) => ({
          ...game,
          steam_play_data: game.steam_play_data,
        })),
        giveaways_created: existingUser.giveaways_created,
        stats: {
          ...user.stats,
          fcv_sent_count: existingUser.stats?.fcv_sent_count || 0,
          rcv_sent_count: existingUser.stats?.rcv_sent_count || 0,
          ncv_sent_count: existingUser.stats?.ncv_sent_count || 0,
          fcv_received_count: existingUser.stats?.fcv_received_count || 0,
          rcv_received_count: existingUser.stats?.rcv_received_count || 0,
          ncv_received_count: existingUser.stats?.ncv_received_count || 0,
          fcv_gift_difference: existingUser.stats?.fcv_gift_difference || 0,
          giveaway_ratio: existingUser.stats?.giveaway_ratio || 0,
        },
      })

      for (const user of allScrapedUsers) {
        // Look up existing steam_id for this username, or generate a synthetic one
        const steamId = usernameToSteamId.get(user.username) || `username:${user.username}`
        if (!user.steam_id) {
          (user as any).steam_id = steamId
        }
        currentGroupSteamIds.add(steamId)

        if (existingUsers.has(user.username)) {
          // Known user — same username as before
          updatedUsersCount++
          console.log(`🔄 Updated: ${user.username}`)
          const existingUser = existingUsers.get(user.username)!
          existingUsers.set(user.username, mergeWithExisting(user, existingUser))
        } else {
          // Username not found — check if this is a renamed user by steam_id
          const oldUsername = steamId.startsWith('username:')
            ? undefined
            : steamIdToOldUsername.get(steamId)

          if (oldUsername && existingUsers.has(oldUsername)) {
            // Renamed user — transfer all data from old entry
            const existingUser = existingUsers.get(oldUsername)!
            console.log(`🔀 Renamed: ${oldUsername} → ${user.username}`)
            existingUsers.delete(oldUsername)
            existingUsers.set(user.username, mergeWithExisting(user, existingUser))
            // Also update the currentGroupSteamIds with the real steam_id
            currentGroupSteamIds.add(existingUser.steam_id)
            updatedUsersCount++
          } else {
            // Genuinely new user
            newUsersCount++
            console.log(`➕ New: ${user.username}`)
            existingUsers.set(user.username, user)
          }
        }
      }

      // Temporarily track removed users — we'll reconcile after Steam info fetch
      // in case any "removed" user is actually a rename we couldn't detect yet
      let removedUsers: User[] = []
      for (const [username, user] of existingUsers) {
        if (!currentGroupSteamIds.has(user.steam_id)) {
          const userWithTimestamp = {
            ...user,
            left_at_timestamp: Date.now(),
          }
          existingUsers.delete(username)
          removedUsers.push(userWithTimestamp)
        }
      }

      if (removedUsers.length > 0) {
        console.log(
          `🗑️  Tentatively removed ${removedUsers.length} users: ${removedUsers
            .map((u) => u.username)
            .join(', ')}`,
        )
      }

      // Augment users with Steam info if they don't have it (skip if env flag is set)
      const skipSteamApi = process.env.SKIP_STEAM_API === 'true'

      if (skipSteamApi) {
        console.log(
          `\n🚫 Skipping Steam profile fetching (SKIP_STEAM_API=true)`,
        )
      } else {
        console.log(`\n🔍 Checking for missing Steam information...`)
        const usersNeedingSteamInfo = Array.from(existingUsers.values()).filter(
          (user) =>
            (!user.steam_id || user.steam_id.startsWith('username:')) &&
            !user.steam_profile_url,
        )

        if (usersNeedingSteamInfo.length > 0) {
          console.log(
            `📋 Found ${usersNeedingSteamInfo.length} users without Steam info`,
          )

          let steamInfoCounter = 0
          for (const user of usersNeedingSteamInfo) {
            steamInfoCounter++
            try {
              console.log(
                `[${steamInfoCounter}/${usersNeedingSteamInfo.length}] 🔍 Fetching Steam info for: ${user.username}`,
              )
              const steamInfo = await this.fetchUserSteamInfo(user)

              if (steamInfo.steam_id || steamInfo.steam_profile_url) {
                const updatedUser = {
                  ...user,
                  steam_id: steamInfo.steam_id || user.steam_id,
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
            `✅ All users already have Steam info or no Steam profiles`,
          )
        }

        const usersNeedingCountryCodeInfo = Array.from(
          existingUsers.values(),
        ).filter((user) => user.country_code === undefined)

        if (usersNeedingCountryCodeInfo.length > 0) {
          console.log(
            `📋 Found ${usersNeedingCountryCodeInfo.length} users without country code info`,
          )
          for (const user of usersNeedingCountryCodeInfo) {
            if (user.steam_id) {
              const countryCode = await steamChecker.getPlayerCountryCode(
                user.steam_id,
              )
              existingUsers.set(user.username, {
                ...user,
                country_code: countryCode,
              })
              console.log(`✅ ${user.username} -> Country code: ${countryCode}`)
              await delay(400)
            } else {
              console.log(
                `❌ ${user.username} -> No Steam ID. Skipping fetching country code`,
              )
            }
          }
        }
      }

      // After Steam info fetch, reconcile: check if any "removed" user is
      // actually a renamed user whose steam_id now matches a current member
      if (removedUsers.length > 0) {
        const currentSteamIds = new Map<string, string>()
        for (const [username, user] of existingUsers) {
          if (user.steam_id && !user.steam_id.startsWith('username:')) {
            currentSteamIds.set(user.steam_id, username)
          }
        }

        const reconciledUsers: User[] = []
        const stillRemoved: User[] = []

        for (const removed of removedUsers) {
          const matchingCurrentUsername = currentSteamIds.get(removed.steam_id)
          if (matchingCurrentUsername) {
            // This "removed" user is actually a rename — merge their data
            const currentUser = existingUsers.get(matchingCurrentUsername)!
            console.log(`🔀 Late rename detected: ${removed.username} → ${matchingCurrentUsername}`)
            existingUsers.set(matchingCurrentUsername, mergeWithExisting(currentUser, removed))
            reconciledUsers.push(removed)
          } else {
            stillRemoved.push(removed)
          }
        }

        if (reconciledUsers.length > 0) {
          console.log(`✅ Reconciled ${reconciledUsers.length} renamed user(s)`)
        }
        removedUsers = stillRemoved
      }

      // Now save ex-members with final accurate removed list
      const exMembersFilename = '../website/public/data/ex_members.json'
      let exMembersRecord: Record<string, User> = {}
      if (existsSync(exMembersFilename)) {
        try {
          const data = readFileSync(exMembersFilename, 'utf-8')
          exMembersRecord = JSON.parse(data).users || {}
        } catch (error) {
          console.warn(`⚠️  Could not load ex-members file: ${error}`)
        }
      }

      // Remove any ex-members who have rejoined (by real steam_id or username for synthetic IDs)
      let rejoinedCount = 0
      const allCurrentSteamIds = new Set(
        Array.from(existingUsers.values()).map((u) => u.steam_id),
      )
      const allCurrentUsernames = new Set(
        Array.from(existingUsers.values()).map((u) => u.username.toLowerCase()),
      )
      for (const steamId of Object.keys(exMembersRecord)) {
        const isRejoinedBySteamId = allCurrentSteamIds.has(steamId)
        const isRejoinedByUsername =
          steamId.startsWith('username:') &&
          allCurrentUsernames.has(exMembersRecord[steamId].username.toLowerCase())
        if (isRejoinedBySteamId || isRejoinedByUsername) {
          console.log(`🔄 Rejoined: ${exMembersRecord[steamId].username}`)
          delete exMembersRecord[steamId]
          rejoinedCount++
        }
      }
      if (rejoinedCount > 0) {
        console.log(`✅ Removed ${rejoinedCount} rejoined users from ex-members`)
      }

      const reliableRemoved = removedUsers.filter((u) => {
        if (u.steam_id.startsWith('username:')) {
          console.log(`⚠️  Skipping ex-member with synthetic ID: ${u.username} (no real steam_id)`)
          return false
        }
        return true
      })

      if (reliableRemoved.length > 0) {
        console.log(
          `🗑️  Confirmed ${reliableRemoved.length} users left the group: ${reliableRemoved
            .map((u) => u.username)
            .join(', ')}`,
        )
        for (const user of reliableRemoved) {
          exMembersRecord[user.steam_id] = user
        }
      }

      if (reliableRemoved.length > 0 || rejoinedCount > 0) {
        writeFileSync(
          exMembersFilename,
          JSON.stringify(
            {
              lastUpdated: Date.now(),
              users: exMembersRecord,
            },
            null,
            2,
          ),
        )
        console.log(`💾 Ex-members saved to ${exMembersFilename}`)
      }

      // Reload giveaway data in case it was updated by an earlier pipeline step
      try {
        GIVEAWAY_DATA = JSON.parse(
          readFileSync('../website/public/data/giveaways.json', 'utf-8'),
        ).giveaways as Giveaway[]
        console.log(`📁 Loaded ${GIVEAWAY_DATA.length} giveaways for user enrichment`)
      } catch (error) {
        console.warn(`⚠️  Could not reload giveaway file: ${error}`)
      }

      const giveaways = GIVEAWAY_DATA
      if (giveaways.length > 0) {
        await this.enrichUsersWithGiveaways(existingUsers, giveaways)

        // Update Steam play data for won games (skip if env flag is set)
        const skipSteamApi = process.env.SKIP_STEAM_API === 'true'
        const skipSteamPlaytime = process.env.SKIP_STEAM_PLAYTIME === 'true'
        if (skipSteamApi) {
          console.log('🚫 Skipping Steam API calls (SKIP_STEAM_API=true)')
        } else if (skipSteamPlaytime) {
          console.log(
            '🚫 Skipping Steam playtime update (SKIP_STEAM_PLAYTIME=true)',
          )
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

      // Convert user array to a record keyed by steam_id for saving
      const usersRecord: Record<string, User> = {}
      for (const user of allUsers) {
        const warnings = this.calculateUserWarnings(user, giveaways)

        if (warnings.length > 0) {
          console.log(
            `🔍 ${user.username} has warnings: ${warnings.join(', ')}`,
          )
          user.warnings = warnings
        } else if (user.warnings) {
          user.warnings = undefined
        }

        usersRecord[user.steam_id] = user
      }

      // Save to file with lastUpdated timestamp
      const userGroupData: UserGroupData = {
        lastUpdated: Date.now(),
        users: usersRecord,
      }
      writeFileSync(filename, JSON.stringify(userGroupData, null, 2))
      console.log(`\n💾 Users saved to ${filename}`)

      // Generate steam_id → username history lookup map (includes ex-members)
      const steamIdMapFilename = '../website/public/data/steam_id_map.json'
      let steamIdMap: SteamIdMap = {}
      if (existsSync(steamIdMapFilename)) {
        try {
          steamIdMap = JSON.parse(readFileSync(steamIdMapFilename, 'utf-8'))
        } catch {}
      }

      const updateSteamIdMap = (map: SteamIdMap, steamId: string, username: string) => {
        if (!map[steamId]) {
          map[steamId] = { current: username, previous: [] }
        } else if (map[steamId].current !== username) {
          map[steamId].previous.push({ username: map[steamId].current, changed_at: new Date().toISOString() })
          map[steamId].current = username
        }
      }

      for (const user of allUsers) {
        updateSteamIdMap(steamIdMap, user.steam_id, user.username)
      }
      // For ex-members, only add them if they don't already exist in the map.
      // Never update `current` from ex-member data — active members are the
      // source of truth for the current username.
      const exMembersPath = '../website/public/data/ex_members.json'
      if (existsSync(exMembersPath)) {
        try {
          const exData = JSON.parse(readFileSync(exMembersPath, 'utf-8'))
          for (const user of Object.values(exData.users || {}) as User[]) {
            if (user.steam_id && !steamIdMap[user.steam_id]) {
              steamIdMap[user.steam_id] = { current: user.username, previous: [] }
            }
          }
        } catch {}
      }
      writeFileSync(steamIdMapFilename, JSON.stringify(steamIdMap, null, 2))
      console.log(`💾 Steam ID map saved to ${steamIdMapFilename}`)

      return allUsers
    } catch (error) {
      console.error('❌ Error fetching users:', error)
      throw error
    }
  }

  private displayStats(
    stats: UserStats,
    steamInfoFetched: number = 0,
    removedUsers: number = 0,
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
