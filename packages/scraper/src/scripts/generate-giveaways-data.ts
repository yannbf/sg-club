import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { groupGiveawaysScraper } from '../scrapers/group-giveaways'
import { delay } from '../utils/common'
import type { Giveaway } from '../types/steamgifts'
import { logError } from '../utils/log-error'
import { GiveawayPointsManager } from '../api/fetch-proof-of-play'
import { fileURLToPath } from 'node:url'

export async function generateGiveawaysData(): Promise<void> {
  const filename = '../website/public/data/giveaways.json'
  const entriesFilename = '../website/public/data/user_entries.json'
  const investigationFilename = '../website/investigation/giveaway_leavers.json'

  try {
    console.log('🚀 Starting giveaway scraping...')
    // turn this to true if you want to debug the postprocessing code
    const SKIP_FETCHING_GIVEAWAYS = false
    const allGiveaways = SKIP_FETCHING_GIVEAWAYS
      ? (JSON.parse(readFileSync(filename, 'utf-8')).giveaways as Giveaway[])
      : await groupGiveawaysScraper.scrapeGiveaways(filename)

    if (allGiveaways.length > 0) {
      let existingEntries: Record<
        string,
        { username: string; joined_at: string }[]
      > = {}
      if (existsSync(entriesFilename)) {
        existingEntries = JSON.parse(readFileSync(entriesFilename, 'utf-8'))
      } else {
        console.log('📄 No existing entries file found, starting fresh')
      }

      let giveawayLeavers: Record<
        string,
        {
          joined_at_timestamp: string
          ga_link: string
          leave_detected_at: number
          time_difference_hours: number
        }[]
      > = {}
      if (existsSync(investigationFilename)) {
        try {
          giveawayLeavers = JSON.parse(
            readFileSync(investigationFilename, 'utf-8')
          )
        } catch (e) {
          console.error('Error parsing giveaway_leavers.json', e)
        }
      }

      console.log('🔍 Fetching play requirements data...')
      const pointsManager = GiveawayPointsManager.getInstance()
      const allPointsData = await pointsManager.getAllGiveaways()
      const pointsMap = new Map(allPointsData.map((p) => [p.id, p]))

      let giveawaysWithUpdatedEntries = 0
      let hasNewLeavers = false
      for (const giveaway of allGiveaways) {
        const pointsData = pointsMap.get(giveaway.id)
        if (pointsData) {
          giveaway.required_play =
            giveaway.required_play || !!pointsData.playRequirements
        }
        // if giveaway has finished and is not in existingEntries or if it's currently ongoing
        const hasFinishedAndNotRegistered =
          giveaway.end_timestamp < Date.now() / 1000 &&
          !existingEntries[giveaway.link]
        const isOpenGiveaway = giveaway.end_timestamp > Date.now() / 1000

        if (
          (giveaway.entry_count > 0 && hasFinishedAndNotRegistered) ||
          (giveaway.entry_count > 0 && isOpenGiveaway)
        ) {
          console.log(`🔍 Fetching entries for: ${giveaway.name}`)
          const entries = await groupGiveawaysScraper.fetchDetailedEntries(
            giveaway.link
          )

          const oldEntriesForGiveaway = existingEntries[giveaway.link] ?? []
          if (oldEntriesForGiveaway.length > 0) {
            const newEntryUsernames = new Set(entries.map((e) => e.username))
            const oldEntryUsernames = new Set(
              oldEntriesForGiveaway.map((e) => e.username)
            )

            const leavers = oldEntriesForGiveaway.filter(
              (oldEntry) => !newEntryUsernames.has(oldEntry.username)
            )

            if (leavers.length > 0) {
              hasNewLeavers = true
              console.log(
                `🏃‍♂️ Detected ${leavers.length} leavers for: ${giveaway.name}`
              )
              const leave_detected_at = Math.floor(Date.now() / 1000)
              const time_difference_hours = Math.round(
                (giveaway.end_timestamp - leave_detected_at) / (60 * 60)
              )
              for (const leaver of leavers) {
                if (!giveawayLeavers[leaver.username]) {
                  giveawayLeavers[leaver.username] = []
                }
                const alreadyExists = giveawayLeavers[leaver.username].some(
                  (l) =>
                    l.ga_link === giveaway.link &&
                    l.joined_at_timestamp === leaver.joined_at
                )
                if (!alreadyExists) {
                  giveawayLeavers[leaver.username].push({
                    joined_at_timestamp: leaver.joined_at,
                    ga_link: giveaway.link,
                    leave_detected_at,
                    time_difference_hours,
                  })
                }
              }
            }

            const reJoiners = entries.filter(
              (newEntry) =>
                !oldEntryUsernames.has(newEntry.username) &&
                giveawayLeavers[newEntry.username]
            )

            if (reJoiners.length > 0) {
              for (const reJoiner of reJoiners) {
                const leaverRecords = giveawayLeavers[reJoiner.username]
                if (leaverRecords) {
                  const initialCount = leaverRecords.length
                  giveawayLeavers[reJoiner.username] = leaverRecords.filter(
                    (l) => l.ga_link !== giveaway.link
                  )

                  if (
                    giveawayLeavers[reJoiner.username].length < initialCount
                  ) {
                    hasNewLeavers = true
                    console.log(
                      `👍 Detected re-joiner ${reJoiner.username} for: ${giveaway.name}. Removing from leavers list.`
                    )
                  }

                  if (giveawayLeavers[reJoiner.username].length === 0) {
                    delete giveawayLeavers[reJoiner.username]
                  }
                }
              }
            }
          }

          console.log(
            `🔍 Fetched ${entries.length} entries for: ${giveaway.name}`
          )
          existingEntries[giveaway.link] = entries
          giveawaysWithUpdatedEntries++
          await delay(1000)
        }
      }

      if (giveawaysWithUpdatedEntries > 0) {
        writeFileSync(entriesFilename, JSON.stringify(existingEntries, null, 2))
        console.log(`🔍 Updated ${giveawaysWithUpdatedEntries} entries`)
      }

      if (hasNewLeavers) {
        mkdirSync(dirname(investigationFilename), { recursive: true })
        writeFileSync(
          investigationFilename,
          JSON.stringify(giveawayLeavers, null, 2)
        )
        console.log(
          `💾 Giveaway leavers data saved to ${investigationFilename}`
        )
      }

      console.log('🔍 Updating CV status for all giveaways...')
      // Update CV status for all giveaways
      const updatedGiveaways = await groupGiveawaysScraper.updateCVStatus(
        allGiveaways
      )
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
    const errorMessage = 'Failed to scrape giveaways'
    console.error(`❌ ${errorMessage}:`, error)
    logError(error, errorMessage)
    process.exit(1)
  }
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await generateGiveawaysData()
  }
}
