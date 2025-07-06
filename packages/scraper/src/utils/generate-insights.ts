import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import type { UserGroupData, User, Giveaway } from '../types/steamgifts.js'
import { formatPlaytime } from './common.js'

interface InsightData {
  totalUsers: number
  lastUpdated: Date

  // Gift statistics
  totalGiveawaysCreated: number
  totalGiveawaysWon: number
  totalGiveawaysWithNoEntries: number
  totalValueSent: number
  totalValueReceived: number

  // Historical giveaway data
  allGiveaways: {
    total: number
    fromActiveMembers: number
    fromFormerMembers: number
    formerMembersList: Array<{ username: string; giveawayCount: number }>
  }

  // User categorization
  netContributors: User[]
  neutralUsers: User[]
  netReceivers: User[]

  // Steam integration
  usersWithSteam: User[]
  usersWithoutSteam: User[]

  // CV statistics
  cvStats: {
    fullCV: { sent: number; received: number }
    reducedCV: { sent: number; received: number }
    noCV: { sent: number; received: number }
  }

  // Steam engagement
  steamStats: {
    totalGamesOwned: number
    totalPlaytime: number
    totalAchievements: number
    averagePlaytimePerGame: number
    gamesNeverPlayed: number
  }
}

class GroupInsightsGenerator {
  private loadUserData(filename: string): UserGroupData | null {
    if (!existsSync(filename)) {
      console.error(`❌ File not found: ${filename}`)
      return null
    }

    try {
      const data = readFileSync(filename, 'utf-8')
      const userData = JSON.parse(data) as UserGroupData

      // Handle old format
      if (Array.isArray(userData)) {
        return {
          lastUpdated: Date.now(),
          users: userData,
        }
      }

      return userData
    } catch (error) {
      console.error(`❌ Error reading user data: ${error}`)
      return null
    }
  }

  private loadAllGiveaways(
    filename: string = '../website/public/data/giveaways.json'
  ): Giveaway[] {
    if (!existsSync(filename)) {
      console.error(`❌ File not found: ${filename}`)
      return []
    }

    try {
      const data = readFileSync(filename, 'utf-8')
      const parsed = JSON.parse(data)
      const giveaways = parsed.giveaways || []
      return giveaways
    } catch (error) {
      console.error(`❌ Error reading giveaways data: ${error}`)
      return []
    }
  }

  private analyzeData(userData: UserGroupData): InsightData {
    const users = userData.users

    // Count actual giveaways from giveaways_created arrays
    let totalGiveawaysCreated = 0
    let totalGiveawaysWithNoEntries = 0

    for (const user of users) {
      if (user.giveaways_created) {
        totalGiveawaysCreated += user.giveaways_created.length
        // Count giveaways that ended with no entries
        totalGiveawaysWithNoEntries += user.giveaways_created.filter(
          (giveaway) => !giveaway.had_winners
        ).length
      }
    }

    // Load and analyze all giveaways to get historical data
    const allGiveaways = this.loadAllGiveaways()
    const currentUsernames = new Set(users.map((user) => user.username))

    // Count giveaways by creator status
    const giveawaysByCreator = new Map<string, number>()
    let giveawaysFromActiveMembers = 0
    let giveawaysFromFormerMembers = 0

    for (const giveaway of allGiveaways) {
      const creator = giveaway.creator.username
      giveawaysByCreator.set(
        creator,
        (giveawaysByCreator.get(creator) || 0) + 1
      )

      if (currentUsernames.has(creator)) {
        giveawaysFromActiveMembers++
      } else {
        giveawaysFromFormerMembers++
      }
    }

    // Get list of former members with their giveaway counts
    const formerMembersList = Array.from(giveawaysByCreator.entries())
      .filter(([username]) => !currentUsernames.has(username))
      .map(([username, giveawayCount]) => ({ username, giveawayCount }))
      .sort((a, b) => b.giveawayCount - a.giveawayCount)

    const historicalGiveawayData = {
      total: allGiveaways.length,
      fromActiveMembers: giveawaysFromActiveMembers,
      fromFormerMembers: giveawaysFromFormerMembers,
      formerMembersList,
    }

    // Count won giveaways
    const totalGiveawaysWon = users.reduce(
      (sum, user) => sum + user.stats.total_received_count,
      0
    )
    const totalValueSent = users.reduce(
      (sum, user) => sum + user.stats.total_sent_value,
      0
    )
    const totalValueReceived = users.reduce(
      (sum, user) => sum + user.stats.total_received_value,
      0
    )

    // User categorization
    const netContributors = users
      .filter((user) => user.stats.total_gift_difference > 0)
      .sort(
        (a, b) =>
          b.stats.total_value_difference - a.stats.total_value_difference
      )
    const neutralUsers = users.filter(
      (user) => user.stats.total_gift_difference === 0
    )
    const netReceivers = users
      .filter((user) => user.stats.total_gift_difference < 0)
      .sort(
        (a, b) => a.stats.total_gift_difference - b.stats.total_gift_difference
      )

    // Steam integration
    const usersWithSteam = users.filter((user) => user.steam_id)
    const usersWithoutSteam = users.filter((user) => !user.steam_id)

    // CV statistics
    const cvStats = {
      fullCV: {
        sent: users.reduce((sum, user) => sum + user.stats.fcv_sent_count, 0),
        received: users.reduce(
          (sum, user) => sum + user.stats.fcv_received_count,
          0
        ),
      },
      reducedCV: {
        sent: users.reduce((sum, user) => sum + user.stats.rcv_sent_count, 0),
        received: users.reduce(
          (sum, user) => sum + user.stats.rcv_received_count,
          0
        ),
      },
      noCV: {
        sent: users.reduce((sum, user) => sum + user.stats.ncv_sent_count, 0),
        received: users.reduce(
          (sum, user) => sum + user.stats.ncv_received_count,
          0
        ),
      },
    }

    // Steam engagement statistics
    let totalGamesOwned = 0
    let totalPlaytime = 0
    let totalAchievements = 0
    let gamesNeverPlayed = 0
    let gamesWithData = 0

    for (const user of users) {
      if (user.giveaways_won) {
        for (const game of user.giveaways_won) {
          if (game.steam_play_data) {
            gamesWithData++
            if (game.steam_play_data.owned) {
              totalGamesOwned++
              totalPlaytime += game.steam_play_data.playtime_minutes
              totalAchievements += game.steam_play_data.achievements_unlocked
              if (game.steam_play_data.never_played) {
                gamesNeverPlayed++
              }
            }
          }
        }
      }
    }

    const steamStats = {
      totalGamesOwned,
      totalPlaytime,
      totalAchievements,
      averagePlaytimePerGame:
        totalGamesOwned > 0 ? totalPlaytime / totalGamesOwned : 0,
      gamesNeverPlayed,
    }

    return {
      totalUsers: users.length,
      lastUpdated: new Date(userData.lastUpdated),
      totalGiveawaysCreated,
      totalGiveawaysWon,
      totalGiveawaysWithNoEntries,
      totalValueSent,
      totalValueReceived,
      allGiveaways: historicalGiveawayData,
      netContributors,
      neutralUsers,
      netReceivers,
      usersWithSteam,
      usersWithoutSteam,
      cvStats,
      steamStats,
    }
  }

  private generateInsights(data: InsightData): string {
    const insights: string[] = []

    // Header
    insights.push('='.repeat(80))
    insights.push('STEAMGIFTS GROUP INSIGHTS REPORT')
    insights.push('='.repeat(80))
    insights.push(
      `Generated: ${new Date().toLocaleString('en-GB', {
        timeZone: 'UTC',
      })} UTC`
    )
    insights.push(
      `Data Last Updated: ${data.lastUpdated.toLocaleString('en-GB', {
        timeZone: 'UTC',
      })} UTC`
    )
    insights.push('')

    // Executive Summary
    insights.push('EXECUTIVE SUMMARY')
    insights.push('-'.repeat(40))
    insights.push(`Total Active Members: ${data.totalUsers}`)
    insights.push('')
    insights.push('GIVEAWAY STATISTICS (All Time)')
    insights.push(
      `Total Giveaways Since Group Start: ${data.allGiveaways.total}`
    )
    insights.push(
      `  • From Active Members: ${data.allGiveaways.fromActiveMembers}`
    )
    insights.push(
      `  • From Former Members: ${data.allGiveaways.fromFormerMembers}`
    )
    insights.push('')
    insights.push('CURRENT ACTIVITY')
    insights.push(`Total Giveaways Won: ${data.totalGiveawaysWon.toFixed(0)}`)
    insights.push(
      `Total Giveaways with No Entries: ${data.totalGiveawaysWithNoEntries.toFixed(
        0
      )}`
    )
    insights.push('')

    // Giveaways with No Entries Analysis
    if (data.totalGiveawaysWithNoEntries > 0) {
      insights.push('GIVEAWAYS WITH NO ENTRIES')
      insights.push('-'.repeat(40))
      const noEntriesPercentage = (
        (data.totalGiveawaysWithNoEntries / data.totalGiveawaysCreated) *
        100
      ).toFixed(1)
      insights.push(
        `${data.totalGiveawaysWithNoEntries} giveaways (${noEntriesPercentage}% of all giveaways) ended with no entries.`
      )
      insights.push(
        'This could indicate games that were not attractive to the community or'
      )
      insights.push(
        'giveaways that were not well-promoted or had restrictive requirements.'
      )

      if (parseFloat(noEntriesPercentage) > 10) {
        insights.push(
          '❌ HIGH: Consider reviewing giveaway appeal and promotion'
        )
      } else if (parseFloat(noEntriesPercentage) > 5) {
        insights.push('⚠️  MODERATE: Some giveaways may need better promotion')
      } else {
        insights.push('✅ LOW: Most giveaways are attractive to the community')
      }
      insights.push('')
    }

    // Former Members Analysis
    if (data.allGiveaways.formerMembersList.length > 0) {
      insights.push('FORMER MEMBERS WHO LEFT THE GROUP')
      insights.push('-'.repeat(40))
      insights.push(
        `${data.allGiveaways.formerMembersList.length} former members created ${data.allGiveaways.fromFormerMembers} giveaways before leaving:`
      )
      insights.push('')

      data.allGiveaways.formerMembersList.forEach((member, index) => {
        const giveawayText =
          member.giveawayCount === 1 ? 'giveaway' : 'giveaways'
        insights.push(
          `${(index + 1).toString().padStart(2)}. ${member.username} - ${
            member.giveawayCount
          } ${giveawayText}`
        )
      })
      insights.push('')
    }

    // Community Health
    insights.push('COMMUNITY HEALTH METRICS')
    insights.push('-'.repeat(40))
    insights.push(
      'These metrics show the balance between giving and receiving in the community.'
    )
    insights.push(
      'A healthy community has a good mix of contributors and receivers.'
    )
    insights.push('')

    const contributorPercentage = (
      (data.netContributors.length / data.totalUsers) *
      100
    ).toFixed(1)
    const receiverPercentage = (
      (data.netReceivers.length / data.totalUsers) *
      100
    ).toFixed(1)
    const neutralPercentage = (
      (data.neutralUsers.length / data.totalUsers) *
      100
    ).toFixed(1)

    insights.push(
      `Net Contributors: ${data.netContributors.length} users (${contributorPercentage}%)`
    )
    insights.push(
      '  - Users who have given more giveaways than they have received'
    )
    insights.push('')
    insights.push(
      `Net Receivers: ${data.netReceivers.length} users (${receiverPercentage}%)`
    )
    insights.push(
      '  - Users who have received more giveaways than they have given'
    )
    insights.push('')
    insights.push(
      `Neutral Users: ${data.neutralUsers.length} users (${neutralPercentage}%)`
    )
    insights.push(
      '  - Users who have given and received the same number of giveaways'
    )
    insights.push('')

    if (parseFloat(contributorPercentage) > 40) {
      insights.push('✅ HEALTHY: Strong contributor base')
    } else if (parseFloat(contributorPercentage) > 25) {
      insights.push('⚠️  MODERATE: Adequate contributor base')
    } else {
      insights.push('❌ CONCERN: Low contributor percentage')
    }
    insights.push('')

    // Top Contributors
    insights.push('TOP 10 CONTRIBUTORS (by giveaway count)')
    insights.push('-'.repeat(40))
    data.netContributors.slice(0, 10).forEach((user, index) => {
      const steamIcon = user.steam_id ? '🎮' : '  '
      insights.push(
        `${(index + 1).toString().padStart(2)}. ${
          user.username
        } ${steamIcon} - ${user.stats.total_gift_difference.toFixed(
          0
        )} giveaways`
      )
    })
    insights.push('')

    // Top Net Receivers by Low-Playtime Games
    insights.push('TOP 5 NET RECEIVERS (giveaways with <4h playtime)')
    insights.push('-'.repeat(40))
    const receiversByLowPlaytime = data.netReceivers
      .map((user) => {
        const lowPlaytimeGames =
          user.giveaways_won?.filter(
            (giveaway) =>
              giveaway.steam_play_data &&
              giveaway.steam_play_data.playtime_minutes < 240 // 4 hours in minutes
          ).length || 0
        return {
          ...user,
          lowPlaytimeGames,
        }
      })
      .filter((user) => user.lowPlaytimeGames > 0)
      .sort((a, b) => b.lowPlaytimeGames - a.lowPlaytimeGames)
      .slice(0, 5)

    receiversByLowPlaytime.forEach((user, index) => {
      const steamIcon = user.steam_id ? '🎮' : '  '
      insights.push(
        `${(index + 1).toString().padStart(2)}. ${
          user.username
        } ${steamIcon} - ${user.lowPlaytimeGames} low-playtime games`
      )
    })
    insights.push('')

    // CV Status Analysis
    insights.push('COMMUNITY VALUE (CV) ANALYSIS')
    insights.push('-'.repeat(40))
    const totalCVSent =
      data.cvStats.fullCV.sent +
      data.cvStats.reducedCV.sent +
      data.cvStats.noCV.sent
    const totalCVReceived =
      data.cvStats.fullCV.received +
      data.cvStats.reducedCV.received +
      data.cvStats.noCV.received

    if (totalCVSent > 0) {
      const fullCVPercentage = (
        (data.cvStats.fullCV.sent / totalCVSent) *
        100
      ).toFixed(1)
      const reducedCVPercentage = (
        (data.cvStats.reducedCV.sent / totalCVSent) *
        100
      ).toFixed(1)
      const noCVPercentage = (
        (data.cvStats.noCV.sent / totalCVSent) *
        100
      ).toFixed(1)

      insights.push(
        `Full CV Gifts: ${data.cvStats.fullCV.sent} sent, ${data.cvStats.fullCV.received} received (${fullCVPercentage}% of total)`
      )
      insights.push(
        `Reduced CV Gifts: ${data.cvStats.reducedCV.sent} sent, ${data.cvStats.reducedCV.received} received (${reducedCVPercentage}% of total)`
      )
      insights.push(
        `No CV Gifts: ${data.cvStats.noCV.sent} sent, ${data.cvStats.noCV.received} received (${noCVPercentage}% of total)`
      )

      if (parseFloat(fullCVPercentage) > 80) {
        insights.push('✅ EXCELLENT: Community prioritizes high-value games')
      } else if (parseFloat(fullCVPercentage) > 60) {
        insights.push('✅ GOOD: Majority are high-value games')
      } else {
        insights.push('⚠️  NOTE: Consider focusing on higher CV games')
      }
    }
    insights.push('')

    // Engagement Patterns
    insights.push('ENGAGEMENT PATTERNS')
    insights.push('-'.repeat(40))

    // Most active players (by playtime)
    const activeGamers = data.usersWithSteam
      .map((user) => ({
        username: user.username,
        totalPlaytime:
          user.giveaways_won?.reduce(
            (sum, game) => sum + (game.steam_play_data?.playtime_minutes || 0),
            0
          ) || 0,
        gamesOwned:
          user.giveaways_won?.filter((game) => game.steam_play_data?.owned)
            .length || 0,
      }))
      .filter((user) => user.totalPlaytime > 0)
      .sort((a, b) => b.totalPlaytime - a.totalPlaytime)
      .slice(0, 5)

    if (activeGamers.length > 0) {
      insights.push('Most Active Gamers (by playtime):')
      activeGamers.forEach((user, index) => {
        const hours = Math.floor(user.totalPlaytime / 60)
        insights.push(
          `  ${index + 1}. ${user.username} - ${hours}h across ${
            user.gamesOwned
          } games`
        )
      })
    }
    insights.push('')

    // Achievement hunters
    const achievementHunters = data.usersWithSteam
      .map((user) => ({
        username: user.username,
        totalAchievements:
          user.giveaways_won?.reduce(
            (sum, game) =>
              sum + (game.steam_play_data?.achievements_unlocked || 0),
            0
          ) || 0,
        gamesWithAchievements:
          user.giveaways_won?.filter(
            (game) =>
              game.steam_play_data?.achievements_unlocked &&
              game.steam_play_data.achievements_unlocked > 0
          ).length || 0,
      }))
      .filter((user) => user.totalAchievements > 0)
      .sort((a, b) => b.totalAchievements - a.totalAchievements)
      .slice(0, 5)

    if (achievementHunters.length > 0) {
      insights.push('Top Achievement Hunters:')
      achievementHunters.forEach((user, index) => {
        insights.push(
          `  ${index + 1}. ${user.username} - ${
            user.totalAchievements
          } achievements across ${user.gamesWithAchievements} games`
        )
      })
    }
    insights.push('')

    // Group Recommendations
    insights.push('RECOMMENDATIONS')
    insights.push('-'.repeat(40))

    const recommendations: string[] = []

    if (parseFloat(contributorPercentage) < 30) {
      recommendations.push(
        '• Encourage more users to create giveaways to balance the community'
      )
    }

    if (
      data.steamStats.gamesNeverPlayed / data.steamStats.totalGamesOwned >
      0.4
    ) {
      recommendations.push('• Consider promoting game activation among winners')
    }

    const avgValuePerGift = data.totalValueSent / data.totalGiveawaysCreated
    if (avgValuePerGift < 15) {
      recommendations.push('• Consider encouraging higher-value giveaways')
    } else if (avgValuePerGift > 40) {
      recommendations.push(
        '• Excellent average gift value - community values quality'
      )
    }

    if (data.cvStats.noCV.sent / totalCVSent > 0.1) {
      recommendations.push('• Consider focusing on games with community value')
    }

    if (recommendations.length === 0) {
      recommendations.push(
        '• Community appears healthy with good engagement patterns'
      )
      recommendations.push(
        '• Continue current practices to maintain community balance'
      )
    }

    recommendations.forEach((rec) => insights.push(rec))
    insights.push('')

    // Footer
    insights.push('='.repeat(80))
    insights.push('End of Report')
    insights.push('='.repeat(80))

    return insights.join('\n')
  }

  public generateReport(
    inputFile: string = '../website/public/data/group_users.json',
    outputFile: string = '../scraper/data/group_insights.txt'
  ): void {
    console.log('📊 Generating group insights report...', process.cwd())

    const userData = this.loadUserData(inputFile)
    if (!userData) {
      return
    }

    console.log(`📁 Loaded data for ${userData.users.length} users`)

    const insights = this.analyzeData(userData)
    const report = this.generateInsights(insights)

    try {
      writeFileSync(outputFile, report, 'utf-8')
      console.log(`✅ Insights report generated: ${outputFile}`)
      console.log(
        `📈 Analyzed ${insights.totalUsers} users with ${insights.steamStats.totalGamesOwned} Steam games`
      )
    } catch (error) {
      console.error(`❌ Error writing report: ${error}`)
    }
  }
}

async function main(): Promise<void> {
  const generator = new GroupInsightsGenerator()
  generator.generateReport()
}

// Run the script
await main()
