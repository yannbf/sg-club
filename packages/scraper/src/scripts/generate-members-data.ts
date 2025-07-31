import { readFileSync } from 'node:fs'
import {
  groupMemberScraper,
  SteamGiftsUserFetcher,
} from '../scrapers/group-members'
import type { User } from '../types/steamgifts'
import { fileURLToPath } from 'node:url'

// Main execution
export async function generateMembersData(): Promise<void> {
  const filename = '../website/public/data/group_users.json'

  try {
    console.log('🚀 Starting user fetching...')
    const allUsers = await groupMemberScraper.fetchUsers(filename)

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

      // Calculate shared giveaway stats
      const totalSharedSent = allUsers.reduce(
        (sum, user) => sum + user.stats.shared_sent_count,
        0
      )
      const totalSharedReceived = allUsers.reduce(
        (sum, user) => sum + user.stats.shared_received_count,
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
      console.log(
        `  • Shared: ${totalSharedSent} sent, ${totalSharedReceived} received (Difference: ${
          totalSharedSent - totalSharedReceived
        })`
      )
    } else {
      console.log('⚠️  No users found')
    }
  } catch (error) {
    console.error('❌ Failed to fetch users:', error)
    process.exit(1)
  }
}

const DEBUG = false
// @ts-expect-error this is expected
if (DEBUG === true) {
  process.env.DEBUG = 'true'
  const fetcher = new SteamGiftsUserFetcher()
  const userData = readFileSync(
    '../website/public/data/group_users.json',
    'utf8'
  )
  const users = JSON.parse(userData)
  const user = users.users['Patxxv']

  // DEBUGGING FOR REQUIRED PLAY DATA
  // const stats = await fetcher.enrichUsersWithGiveaways(
  //   new Map([[user.username, user]]),
  //   fetcher.loadGiveawayData()
  // )
  // console.log(stats)

  // DEBUGGING FOR GENERATING ALL DATA INCLUDING STEAM PROFILE DATA
  await fetcher.fetchUsers('debug-users.json', [user])
  process.exit(0)
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await generateMembersData()
  }
}
