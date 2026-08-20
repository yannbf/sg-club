import {
  getAllGiveaways,
  getAllUsers,
  getAllUsersAsArray,
  getExMembers,
  getGameData,
  getLastUpdated,
  getSteamIdMap,
} from '@/lib/data'
import { isCountedGiveaway } from '@/lib/events'
import {
  buildGameDataIndex,
  combineMonthlySeries,
  findGameData,
  giveawayCvValue,
  monthKey,
  monthLabel,
  monthlyAggregate,
  withCumulative,
} from '@/lib/chart-data'
import { createCreatorResolver } from '@/lib/creator-resolver'
import { buildWinnerPlayStats, winnerPlayStatsKey } from '@/lib/winner-play-stats'
import { isConfirmedPlayed } from '@/lib/play-status'
import type { MonthDatum, ContributorDatum } from '@/components/charts/GroupStatsCharts'
import type {
  DrilldownMemberRow,
  DrilldownGameRow,
  DrilldownWinner,
} from '@/components/charts/StatsDrilldownModal'
import type { Giveaway } from '@/types'
import StatsClient from './StatsClient'
import { AdminGate } from '@/components/AdminGate'

export default async function StatsPage() {
  const [allGiveaways, users, exMembersData, gameData, lastUpdated, allUsersGroup, steamIdMap] =
    await Promise.all([
      getAllGiveaways(),
      getAllUsersAsArray(),
      getExMembers(),
      getGameData(),
      getLastUpdated(),
      getAllUsers(),
      getSteamIdMap(),
    ])
  const exMembers = exMembersData ? Object.values(exMembersData.users) : []

  // Deleted and ended-with-zero-entries giveaways are kept in the data for
  // inspection but must not feed any aggregate on this page.
  const giveaways = allGiveaways.filter((g) => isCountedGiveaway(g))
  const gameDataIndex = buildGameDataIndex(gameData)

  // Still-open giveaways carry an end_timestamp in the future (and entry
  // counts that are still accruing), so any aggregate bucketed by end month
  // must exclude them or it renders a misleading not-yet-real future bucket.
  const nowSec = Date.now() / 1000
  const endedGiveaways = giveaways.filter((g) => g.end_timestamp < nowSec)

  const giveawaysPerMonthMap = monthlyAggregate(
    giveaways,
    (g) => g.created_timestamp,
  )
  const cvPerMonthMap = monthlyAggregate(
    giveaways,
    (g) => g.created_timestamp,
    (g) => giveawayCvValue(g, gameDataIndex),
  )
  const avgEntriesPerMonthMap = monthlyAggregate(
    endedGiveaways,
    (g) => g.end_timestamp,
    (g) => g.entry_count ?? 0,
    'avg',
  )
  // "Members joined per month" counts every join, current members and
  // ex-members alike — someone who has since left the group still joined it
  // in some month. Ex-members without a first_seen_at (no evidence of when
  // they joined) can't be bucketed and are excluded, same as current members.
  const usersWithJoinDate = users.filter((u) => u.stats.first_seen_at != null)
  const exWithJoinDate = exMembers.filter((u) => u.stats.first_seen_at != null)
  const allJoiners = [...usersWithJoinDate, ...exWithJoinDate]
  const membersJoinedMap = monthlyAggregate(
    allJoiners,
    (u) => u.stats.first_seen_at,
  )

  // Leaves, bucketed the same way. left_at_timestamp is stored in
  // milliseconds (unlike every other timestamp here), so it's divided down
  // to seconds before bucketing. Only ex-members that also have a
  // first_seen_at are counted here, so every leave has a matching join and
  // the net cumulative line below stays truthful.
  const exLeavers = exWithJoinDate.filter((u) => u.left_at_timestamp != null)
  const membersLeftMap = monthlyAggregate(
    exLeavers,
    (u) => (u.left_at_timestamp as number) / 1000,
  )

  // Per-month rosters behind the "Members joined per month" chart's
  // drill-down modal, keyed by the same "Mon YY" label the chart's x-axis
  // renders.
  const exUsernames = new Set(exMembers.map((u) => u.username))
  const membersJoinedByMonth: Record<string, DrilldownMemberRow[]> = {}
  for (const u of [...allJoiners].sort(
    (a, b) => (a.stats.first_seen_at ?? 0) - (b.stats.first_seen_at ?? 0),
  )) {
    const label = monthLabel(monthKey(u.stats.first_seen_at as number))
    const row: DrilldownMemberRow = {
      username: u.username,
      avatarUrl: u.avatar_url,
      isExMember: exUsernames.has(u.username),
    }
    const arr = membersJoinedByMonth[label]
    if (arr) arr.push(row)
    else membersJoinedByMonth[label] = [row]
  }

  const membersLeftByMonth: Record<string, DrilldownMemberRow[]> = {}
  for (const u of [...exLeavers].sort(
    (a, b) => (a.left_at_timestamp as number) - (b.left_at_timestamp as number),
  )) {
    const label = monthLabel(monthKey((u.left_at_timestamp as number) / 1000))
    const row: DrilldownMemberRow = {
      username: u.username,
      avatarUrl: u.avatar_url,
      isExMember: true,
    }
    const arr = membersLeftByMonth[label]
    if (arr) arr.push(row)
    else membersLeftByMonth[label] = [row]
  }

  const giveawaysPerMonth: MonthDatum[] = combineMonthlySeries({
    count: giveawaysPerMonthMap,
  })
  const cvPerMonth: MonthDatum[] = combineMonthlySeries({
    cv: cvPerMonthMap,
  })
  const avgEntriesPerMonth: MonthDatum[] = combineMonthlySeries({
    avgEntries: avgEntriesPerMonthMap,
  })
  // Net membership: cumulative joins (current + ex) minus cumulative leaves,
  // so the line stays truthful and lands on the current member count instead
  // of just counting up every join that ever happened.
  const membersPerMonth: MonthDatum[] = withCumulative(
    combineMonthlySeries({ joined: membersJoinedMap, left: membersLeftMap }),
    ['joined', 'left'],
  ).map((row) => ({
    ...row,
    net: Number(row.joined_cumulative) - Number(row.left_cumulative),
  }))

  const topContributorUsers = [...users]
    .sort((a, b) => b.stats.real_total_sent_value - a.stats.real_total_sent_value)
    .slice(0, 10)
  const topContributors: ContributorDatum[] = topContributorUsers.map((u) => ({
    username: u.username,
    value: u.stats.real_total_sent_value,
  }))

  const totalGiveaways = giveaways.length
  const totalCvSent = giveaways.reduce(
    (sum, g) => sum + giveawayCvValue(g, gameDataIndex),
    0,
  )
  const totalMembers = users.length
  const totalEntries = giveaways.reduce((sum, g) => sum + (g.entry_count ?? 0), 0)

  // --- Drill-down row builders shared by the "giveaways created", "CV
  // sent", "top contributors", and "hours played" charts below. Identity is
  // resolved once, server-side, so the client only ever receives the small
  // per-month/per-contributor row lists these charts actually render — never
  // the full user/steam-id-map data those lookups are built from.
  const resolver = createCreatorResolver(steamIdMap)
  const playStatsByWin = buildWinnerPlayStats(giveaways, [allUsersGroup, exMembersData], resolver)
  const userAvatars = new Map<string, string>()
  for (const u of Object.values(allUsersGroup?.users ?? {})) userAvatars.set(u.steam_id, u.avatar_url)
  for (const u of Object.values(exMembersData?.users ?? {})) {
    if (!userAvatars.has(u.steam_id)) userAvatars.set(u.steam_id, u.avatar_url)
  }
  const userNames = new Map<string, string>()
  for (const [steamId, entry] of Object.entries(steamIdMap)) userNames.set(steamId, entry.current)

  const fallbackUrlFor = (ga: Pick<Giveaway, 'app_id' | 'package_id'> | undefined) =>
    findGameData(ga?.app_id, ga?.package_id, gameDataIndex)?.header_image_url

  const creatorInfoFor = (g: Giveaway): DrilldownGameRow['creator'] => {
    const steamId = resolver.canonicalSteamId(g.creator)
    return {
      displayName: userNames.get(steamId) || g.creator_username || g.creator,
      avatarUrl: userAvatars.get(steamId),
    }
  }

  const winnersFor = (g: Giveaway): DrilldownWinner[] | undefined => {
    const winners = g.winners?.filter((w) => w.name)
    if (!winners || winners.length === 0) return undefined
    return winners.map((w): DrilldownWinner => {
      const steamId = resolver.canonicalSteamId(w.name)
      const avatarUrl = userAvatars.get(steamId)
      return {
        steamId: w.name,
        displayName: userNames.get(steamId) || w.winner_username || w.name,
        avatarUrl,
        isGroupMember: Boolean(avatarUrl),
        playStats: playStatsByWin[winnerPlayStatsKey(w.name, g.link)],
      }
    })
  }

  const pushRow = (map: Record<string, DrilldownGameRow[]>, key: string, row: DrilldownGameRow) => {
    const arr = map[key]
    if (arr) arr.push(row)
    else map[key] = [row]
  }

  // "Giveaways created per month" drill-down: every counted giveaway, newest
  // first within its month.
  const giveawaysCreatedByMonth: Record<string, DrilldownGameRow[]> = {}
  for (const g of giveaways) {
    pushRow(giveawaysCreatedByMonth, monthLabel(monthKey(g.created_timestamp)), {
      link: g.link,
      name: g.name,
      timestamp: g.created_timestamp,
      appId: g.app_id,
      packageId: g.package_id,
      giveaway: g,
      fallbackUrl: fallbackUrlFor(g),
      creator: creatorInfoFor(g),
      winners: winnersFor(g),
    })
  }
  for (const rows of Object.values(giveawaysCreatedByMonth)) {
    rows.sort((a, b) => b.timestamp - a.timestamp)
  }

  // "CV sent per month" drill-down: every counted giveaway, highest CV value
  // first within its month.
  const cvSentByMonth: Record<string, DrilldownGameRow[]> = {}
  for (const g of giveaways) {
    pushRow(cvSentByMonth, monthLabel(monthKey(g.created_timestamp)), {
      link: g.link,
      name: g.name,
      timestamp: g.created_timestamp,
      appId: g.app_id,
      packageId: g.package_id,
      giveaway: g,
      fallbackUrl: fallbackUrlFor(g),
      cvValue: giveawayCvValue(g, gameDataIndex),
      creator: creatorInfoFor(g),
    })
  }
  for (const rows of Object.values(cvSentByMonth)) {
    rows.sort((a, b) => (b.cvValue ?? 0) - (a.cvValue ?? 0))
  }

  // "Top 10 contributors" drill-down: each contributor's own counted
  // giveaways, newest first.
  const contributorGiveaways: Record<string, DrilldownGameRow[]> = {}
  for (const u of topContributorUsers) {
    const rows = giveaways
      .filter((g) => resolver.canonicalSteamId(g.creator) === u.steam_id)
      .map(
        (g): DrilldownGameRow => ({
          link: g.link,
          name: g.name,
          timestamp: g.created_timestamp,
          appId: g.app_id,
          packageId: g.package_id,
          giveaway: g,
          fallbackUrl: fallbackUrlFor(g),
          winners: winnersFor(g),
        }),
      )
      .sort((a, b) => b.timestamp - a.timestamp)
    contributorGiveaways[u.username] = rows
  }

  // "Hours played on won games" chart: every counted won giveaway across all
  // members (current + ex) with Steam play data, bucketed by the win's END
  // month. Playtime snapshots are current-state, not historical, so this
  // reflects hours logged as of the last data refresh, grouped by when the
  // game was won.
  const giveawayByLink = new Map(giveaways.map((g) => [g.link, g]))
  const hoursByMonth: Record<string, DrilldownGameRow[]> = {}
  const hoursRecords: { end_timestamp: number; minutes: number }[] = []
  for (const [group, isGroupMember] of [
    [allUsersGroup, true],
    [exMembersData, false],
  ] as const) {
    for (const u of Object.values(group?.users ?? {})) {
      for (const win of u.giveaways_won ?? []) {
        if (win.deleted || !win.steam_play_data || win.steam_play_data.has_no_available_stats) continue
        const ga = giveawayByLink.get(win.link)
        const minutes = win.steam_play_data.playtime_minutes
        hoursRecords.push({ end_timestamp: win.end_timestamp, minutes })
        pushRow(hoursByMonth, monthLabel(monthKey(win.end_timestamp)), {
          link: win.link,
          name: win.name,
          timestamp: win.end_timestamp,
          appId: ga?.app_id,
          packageId: ga?.package_id,
          giveaway: ga,
          fallbackUrl: fallbackUrlFor(ga),
          playtimeMinutes: minutes,
          achievementsUnlocked: win.steam_play_data.achievements_unlocked,
          achievementsTotal: win.steam_play_data.achievements_total,
          confirmedPlayed: isConfirmedPlayed(win),
          winners: [
            {
              steamId: u.steam_id,
              displayName: u.username,
              avatarUrl: u.avatar_url,
              isGroupMember,
            },
          ],
        })
      }
    }
  }
  for (const rows of Object.values(hoursByMonth)) {
    rows.sort((a, b) => (b.playtimeMinutes ?? 0) - (a.playtimeMinutes ?? 0))
  }
  const hoursPerMonthMap = monthlyAggregate(
    hoursRecords,
    (r) => r.end_timestamp,
    (r) => r.minutes / 60,
  )
  const hoursPerMonth: MonthDatum[] = combineMonthlySeries({ hours: hoursPerMonthMap })

  return (
    <AdminGate>
      <StatsClient
      totalGiveaways={totalGiveaways}
      totalCvSent={totalCvSent}
      totalMembers={totalMembers}
      totalEntries={totalEntries}
      giveawaysPerMonth={giveawaysPerMonth}
      cvPerMonth={cvPerMonth}
      avgEntriesPerMonth={avgEntriesPerMonth}
      membersPerMonth={membersPerMonth}
      membersJoinedByMonth={membersJoinedByMonth}
      membersLeftByMonth={membersLeftByMonth}
      topContributors={topContributors}
      giveawaysCreatedByMonth={giveawaysCreatedByMonth}
      cvSentByMonth={cvSentByMonth}
      contributorGiveaways={contributorGiveaways}
      hoursPerMonth={hoursPerMonth}
      hoursByMonth={hoursByMonth}
      lastUpdated={lastUpdated}
      />
    </AdminGate>
  )
}
