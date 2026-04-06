import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { groupGiveawaysScraper } from '../scrapers/group-giveaways'
import { delay } from '../utils/common'
import type { Giveaway, SteamIdMap } from '../types/steamgifts'
import { logError } from '../utils/log-error'
import { GiveawayPointsManager } from '../api/fetch-proof-of-play'
import { fileURLToPath } from 'node:url'

export async function generateGiveawaysData(): Promise<void> {
  const filename = '../website/public/data/giveaways.json'
  const entriesFilename = '../website/public/data/user_entries.json'
  const investigationFilename = '../website/investigation/giveaway_leavers.json'
  const groupUsersFilename = '../website/public/data/group_users.json'

  try {
    console.log('🚀 Starting giveaway scraping...')
    // turn this to true if you want to debug the postprocessing code
    const SKIP_FETCHING_GIVEAWAYS = false
    // for debugging purposes if you want to use a smaller set of giveaways
    // const allGiveaways = [
    //   {
    //     id: 'b3iNO',
    //     name: 'Hogwarts Legacy',
    //     points: 50,
    //     copies: 1,
    //     app_id: 990080,
    //     package_id: null,
    //     link: 'b3iNO/hogwarts-legacy',
    //     created_timestamp: 1753996498,
    //     start_timestamp: 1753996498,
    //     end_timestamp: 1755291420,
    //     region_restricted: true,
    //     group: true,
    //     comment_count: 0,
    //     entry_count: 17,
    //     creator: 'Shughes91',
    //     event_type: 'rpg_august',
    //     cv_status: 'FULL_CV',
    //   },
    // ]
    const allGiveaways = SKIP_FETCHING_GIVEAWAYS
      ? (JSON.parse(readFileSync(filename, 'utf-8')).giveaways as Giveaway[])
      : await groupGiveawaysScraper.scrapeGiveaways(filename)

    if (allGiveaways.length > 0) {
      const groupUsersData = JSON.parse(
        readFileSync(groupUsersFilename, 'utf-8')
      )
      const groupMemberUsernames = new Set(
        Object.values(groupUsersData.users).map((user: any) => user.username)
      )

      // Load steam_id → username history lookup map
      const steamIdMapFilename = '../website/public/data/steam_id_map.json'
      const steamIdMapData: SteamIdMap = existsSync(steamIdMapFilename)
        ? JSON.parse(readFileSync(steamIdMapFilename, 'utf-8'))
        : {}
      // Build username → steam_id from the map (all known usernames resolve to steam_id)
      const usernameToSteamId = new Map<string, string>()
      for (const [steamId, entry] of Object.entries(steamIdMapData)) {
        usernameToSteamId.set(entry.current, steamId)
        for (const prev of entry.previous) {
          usernameToSteamId.set(prev.username, steamId)
        }
      }

      let existingEntries: Record<
        string,
        { steam_id: string; joined_at: string }[]
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

      console.log('🔍 Fetching decreased ratio data...')
      const decreasedRatioMap = new Map<
        string,
        import('../api/fetch-proof-of-play').DecreasedRatioData[]
      >()
      for (const giveaway of allGiveaways) {
        const decreasedRatios = await pointsManager.getDecreasedRatioById(
          giveaway.id
        )
        if (decreasedRatios && decreasedRatios.length > 0) {
          decreasedRatioMap.set(giveaway.id, decreasedRatios)
        }
      }

      let giveawaysWithUpdatedEntries = 0
      let hasNewLeavers = false
      for (const giveaway of allGiveaways) {
        const pointsData = pointsMap.get(giveaway.id)
        if (pointsData) {
          giveaway.required_play =
            giveaway.required_play || !!pointsData.playRequirements
        }

        // Add decreased ratio information
        const decreasedRatios = decreasedRatioMap.get(giveaway.id)
        if (decreasedRatios && decreasedRatios.length > 0) {
          // Get all unique notes from the decreased ratio entries for this giveaway
          const notes = [
            ...new Set(decreasedRatios.map((r) => r.notes).filter(Boolean)),
          ]
          if (notes.length > 0) {
            giveaway.decreased_ratio_info = {
              notes: notes.join('; '),
            }
          } else {
            giveaway.decreased_ratio_info = {}
          }
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
          const memberEntries = entries.filter((entry) =>
            groupMemberUsernames.has(entry.username)
          )

          // Resolve current scraped entries to steam_ids
          const currentSteamIds = new Set(
            memberEntries.map((e) => {
              const steamId = usernameToSteamId.get(e.username)
              if (!steamId) {
                console.warn(`⚠️  No steam_id mapping for entry username: ${e.username}`)
              }
              return steamId || e.username
            })
          )

          // Build steam_id → username map for display in logs
          const steamIdToUsername = new Map<string, string>(
            Object.entries(steamIdMapData).map(([steamId, entry]) => [steamId, entry.current])
          )

          // Old entries are already keyed by steam_id
          const oldEntriesForGiveaway = existingEntries[giveaway.link] ?? []
          const oldEntrySteamIds = new Set(
            oldEntriesForGiveaway.map((e) => e.steam_id)
          )

          // Find previous leavers for this giveaway (keyed by steam_id)
          const previousLeaverSteamIds = Object.keys(
            giveawayLeavers
          ).filter((steamId) =>
            giveawayLeavers[steamId].some((l) => l.ga_link === giveaway.link)
          )

          // All users who were in the giveaway previously (all steam_ids)
          const allPreviousEntrants = new Set([
            ...oldEntrySteamIds,
            ...previousLeaverSteamIds,
          ])

          // --- Leaver Detection ---
          const leaverSteamIds = [...allPreviousEntrants].filter(
            (steamId) => !currentSteamIds.has(steamId)
          )

          if (leaverSteamIds.length > 0) {
            const leaverNames = leaverSteamIds.map(
              (id) => steamIdToUsername.get(id) || id
            )
            console.log(
              `🏃‍♂️ Detected ${leaverSteamIds.length} leavers for: ${
                giveaway.link
              }\n - ${leaverNames.join(', ')}`
            )
            const leave_detected_at = Math.floor(Date.now() / 1000)
            const time_difference_hours = Math.round(
              (giveaway.end_timestamp - leave_detected_at) / (60 * 60)
            )

            for (const leaverSteamId of leaverSteamIds) {
              if (!giveawayLeavers[leaverSteamId]) {
                giveawayLeavers[leaverSteamId] = []
              }

              const leaverAlreadyRecorded = giveawayLeavers[
                leaverSteamId
              ].some((l) => l.ga_link === giveaway.link)

              if (!leaverAlreadyRecorded) {
                const oldEntry = oldEntriesForGiveaway.find(
                  (e) => e.steam_id === leaverSteamId
                )

                if (oldEntry) {
                  hasNewLeavers = true
                  giveawayLeavers[leaverSteamId].push({
                    joined_at_timestamp: oldEntry.joined_at,
                    ga_link: giveaway.link,
                    leave_detected_at,
                    time_difference_hours,
                  })
                } else {
                  const displayName = steamIdToUsername.get(leaverSteamId) || leaverSteamId
                  console.log(
                    `- Could not find old entry for leaver ${displayName} in ${giveaway.name}, cannot add to leavers list.`
                  )
                }
              }
            }
          }

          // --- Re-joiner Detection ---
          const reJoinerSteamIds = previousLeaverSteamIds.filter((steamId) =>
            currentSteamIds.has(steamId)
          )

          if (reJoinerSteamIds.length > 0) {
            for (const reJoinerSteamId of reJoinerSteamIds) {
              const initialCount = giveawayLeavers[reJoinerSteamId].length
              giveawayLeavers[reJoinerSteamId] = giveawayLeavers[reJoinerSteamId].filter(
                (l) => l.ga_link !== giveaway.link
              )

              if (giveawayLeavers[reJoinerSteamId].length < initialCount) {
                hasNewLeavers = true
                const displayName = steamIdToUsername.get(reJoinerSteamId) || reJoinerSteamId
                console.log(
                  `👍 Detected re-joiner ${displayName} for: ${giveaway.name}. Removing from leavers list.`
                )
              }

              if (giveawayLeavers[reJoinerSteamId].length === 0) {
                delete giveawayLeavers[reJoinerSteamId]
              }
            }
          }

          // Save entries with steam_id only (no username — use steam_id_map for display)
          const entriesWithSteamId = memberEntries
            .map((e: any) => {
              const steamId = usernameToSteamId.get(e.username)
              if (!steamId) {
                console.warn(`⚠️  Skipping entry for ${e.username}: no steam_id mapping`)
                return null
              }
              return { steam_id: steamId, joined_at: e.joined_at }
            })
            .filter((e): e is { steam_id: string; joined_at: string } => e !== null)

          console.log(
            `🔍 Fetched ${memberEntries.length} entries for: ${giveaway.name}`
          )
          existingEntries[giveaway.link] = entriesWithSteamId
          giveawaysWithUpdatedEntries++
          await delay(1000)
        }
      }

      if (giveawaysWithUpdatedEntries > 0) {
        writeFileSync(entriesFilename, JSON.stringify(existingEntries, null, 2))
        console.log(`🔍 Updated ${giveawaysWithUpdatedEntries} entries`)
      }

      if (hasNewLeavers) {
        // // Temporary code to filter out non-group members from the leavers list
        // const allLeaverUsernames = Object.keys(giveawayLeavers)
        // let nonMembersRemovedCount = 0
        // for (const username of allLeaverUsernames) {
        //   if (!groupMemberUsernames.has(username)) {
        //     delete giveawayLeavers[username]
        //     nonMembersRemovedCount++
        //   }
        // }
        // if (nonMembersRemovedCount > 0) {
        //   console.log(
        //     `🧹 Removed ${nonMembersRemovedCount} non-group members from the leavers list.`
        //   )
        // }
        // // End of temporary code

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

      // Resolve creator/winner usernames to steam_ids
      // Guard: only resolve if the value looks like a username (not already a steam_id)
      const looksLikeSteamId = (val: string) => /^\d{17}$/.test(val) || val.startsWith('username:')
      console.log('🔄 Resolving creator/winner usernames to steam_ids...')
      for (const giveaway of updatedGiveaways) {
        // Resolve creator: store original username, replace with steam_id
        if (!giveaway.creator_username && !looksLikeSteamId(giveaway.creator)) {
          giveaway.creator_username = giveaway.creator
        }
        if (giveaway.creator_username) {
          const creatorSteamId = usernameToSteamId.get(giveaway.creator_username)
          if (creatorSteamId) {
            giveaway.creator = creatorSteamId
          }
        }

        // Resolve winners
        if (giveaway.winners) {
          for (const winner of giveaway.winners) {
            if (winner.name) {
              if (!winner.winner_username && !looksLikeSteamId(winner.name)) {
                winner.winner_username = winner.name
              }
              if (winner.winner_username) {
                const winnerSteamId = usernameToSteamId.get(winner.winner_username)
                if (winnerSteamId) {
                  winner.name = winnerSteamId
                }
              }
            }
          }
        }
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
