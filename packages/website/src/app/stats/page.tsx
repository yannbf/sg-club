import {
  getAllGiveaways,
  getAllUsers,
  getAllUsersAsArray,
  getExMembers,
  getGameData,
  getLastUpdated,
  getPlaytimeSnapshots,
  getSteamIdMap,
  getUserEntries,
} from '@/lib/data'
import { getGiveawayEventMeta, isCountedGiveaway, isValidRatioGiveaway } from '@/lib/events'
import {
  accumulatePlaytimeDeltas,
  buildGameDataIndex,
  combineMonthlySeries,
  findGameData,
  giveawayCvValue,
  giveawayIdFromLink,
  monthKey,
  monthLabel,
  monthlyAggregate,
  withCumulative,
} from '@/lib/chart-data'
import { createCreatorResolver } from '@/lib/creator-resolver'
import { buildWinnerPlayStats, winnerPlayStatsKey } from '@/lib/winner-play-stats'
import { classifyPerson, personBadgeText } from '@/lib/person'
import type { MonthDatum, ContributorDatum } from '@/components/charts/GroupStatsCharts'
import type {
  DrilldownMemberRow,
  DrilldownGameRow,
  DrilldownWinner,
} from '@/components/charts/StatsDrilldownModal'
import type { Giveaway } from '@/types'
import StatsClient from './StatsClient'

export default async function StatsPage() {
  const [
    allGiveaways,
    users,
    exMembersData,
    gameData,
    lastUpdated,
    allUsersGroup,
    steamIdMap,
    playtimeSnapshots,
    userEntries,
  ] = await Promise.all([
    getAllGiveaways(),
    getAllUsersAsArray(),
    getExMembers(),
    getGameData(),
    getLastUpdated(),
    getAllUsers(),
    getSteamIdMap(),
    getPlaytimeSnapshots(),
    getUserEntries(),
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
  // "Group exclusive only" toggle on the stats page: the same two series
  // restricted to giveaways passing isValidRatioGiveaway (not shared, not
  // whitelist, FULL_CV, no decreased-ratio info).
  const exclusiveGiveaways = giveaways.filter((g) => isValidRatioGiveaway(g))
  const exclusiveEndedGiveaways = endedGiveaways.filter((g) => isValidRatioGiveaway(g))
  const giveawaysPerMonthExclusiveMap = monthlyAggregate(
    exclusiveGiveaways,
    (g) => g.created_timestamp,
  )
  const avgEntriesPerMonthExclusiveMap = monthlyAggregate(
    exclusiveEndedGiveaways,
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

  // Months in which each monthly giveaway event was active, from the
  // event_type tags on counted giveaways (bucketed by creation month, same
  // axis as the giveaways-created chart). The client merges these with the
  // date-windowed special events for the "show event data" overlay.
  const giveawayEventNamesByMonth: Record<string, string[]> = {}
  {
    const seen = new Set<string>()
    for (const g of giveaways) {
      if (!g.event_type) continue
      const name = getGiveawayEventMeta(g.event_type).name
      const label = monthLabel(monthKey(g.created_timestamp))
      const key = `${label}::${name}`
      if (seen.has(key)) continue
      seen.add(key)
      const arr = giveawayEventNamesByMonth[label]
      if (arr) arr.push(name)
      else giveawayEventNamesByMonth[label] = [name]
    }
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
  const giveawaysPerMonthExclusive: MonthDatum[] = combineMonthlySeries({
    count: giveawaysPerMonthExclusiveMap,
  })
  const avgEntriesPerMonthExclusive: MonthDatum[] = combineMonthlySeries({
    avgEntries: avgEntriesPerMonthExclusiveMap,
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
  const currentMemberIds = new Set(Object.keys(allUsersGroup?.users ?? {}))
  const knownExMemberIds = new Set(Object.keys(exMembersData?.users ?? {}))

  // "Active members per month": distinct members who entered, created, or won
  // a giveaway that month. Per-steam-id action counts are tallied alongside
  // the distinct-member sets so the drill-down can show what each member did
  // ("14 entered · 1 created · 2 won") without a second pass over the data.
  interface ActivityCounts {
    entered: number
    created: number
    won: number
  }
  const activityByMonth = new Map<string, Map<string, ActivityCounts>>()
  const bumpActivity = (monthKeyStr: string, steamId: string, field: keyof ActivityCounts) => {
    if (!steamId) return
    let monthMap = activityByMonth.get(monthKeyStr)
    if (!monthMap) {
      monthMap = new Map()
      activityByMonth.set(monthKeyStr, monthMap)
    }
    let counts = monthMap.get(steamId)
    if (!counts) {
      counts = { entered: 0, created: 0, won: 0 }
      monthMap.set(steamId, counts)
    }
    counts[field] += 1
  }

  for (const [steamId, entries] of Object.entries(userEntries ?? {})) {
    for (const entry of entries) {
      bumpActivity(monthKey(entry.joined_at), steamId, 'entered')
    }
  }
  for (const g of giveaways) {
    bumpActivity(monthKey(g.created_timestamp), resolver.canonicalSteamId(g.creator), 'created')
  }
  // Shared/whitelist giveaways can be won by non-group-members outside this
  // audience entirely, so "won" only counts a winner as active here for
  // giveaways where the whole group could actually enter — mirrors
  // isValidRatioGiveaway's audience rule.
  for (const g of endedGiveaways) {
    if (g.is_shared || g.whitelist) continue
    for (const w of g.winners ?? []) {
      if (!w.name) continue
      bumpActivity(monthKey(g.end_timestamp), resolver.canonicalSteamId(w.name), 'won')
    }
  }

  const activeMembersPerMonthMap = new Map<string, number>()
  for (const [monthKeyStr, monthMap] of activityByMonth) {
    activeMembersPerMonthMap.set(monthKeyStr, monthMap.size)
  }
  const activeMembersPerMonth: MonthDatum[] = combineMonthlySeries({
    count: activeMembersPerMonthMap,
  })

  const activeMembersByMonth: Record<string, DrilldownMemberRow[]> = {}
  for (const [monthKeyStr, monthMap] of activityByMonth) {
    const rows: DrilldownMemberRow[] = Array.from(monthMap.entries())
      .map(([steamId, counts]) => {
        const parts: string[] = []
        if (counts.entered > 0) parts.push(`${counts.entered} entered`)
        if (counts.created > 0) parts.push(`${counts.created} created`)
        if (counts.won > 0) parts.push(`${counts.won} won`)
        // Shared/whitelist winners are already excluded from this chart (see
        // the bumpActivity loop above), so an untracked id here is always an
        // ex-member — someone who left before ex-member tracking began.
        const isCurrentMember = currentMemberIds.has(steamId)
        return {
          steamId,
          total: counts.entered + counts.created + counts.won,
          row: {
            username: userNames.get(steamId) || steamId,
            avatarUrl: userAvatars.get(steamId),
            isExMember: !isCurrentMember,
            detail: parts.join(' · '),
          } as DrilldownMemberRow,
        }
      })
      .sort((a, b) => b.total - a.total)
      .map((entry) => entry.row)
    activeMembersByMonth[monthLabel(monthKeyStr)] = rows
  }

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
    const isSharedOrWhitelist = Boolean(g.is_shared || g.whitelist)
    return winners.map((w): DrilldownWinner => {
      const steamId = resolver.canonicalSteamId(w.name)
      const kind = classifyPerson({
        isCurrentMember: currentMemberIds.has(steamId),
        isExMember: knownExMemberIds.has(steamId),
        isSharedOrWhitelist,
      })
      return {
        steamId: w.name,
        displayName: userNames.get(steamId) || w.winner_username || w.name,
        avatarUrl: userAvatars.get(steamId),
        badgeText: personBadgeText(kind),
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

  // "Hours played per month" chart: per-game playtime/achievement deltas
  // between consecutive start-of-month snapshots, summed across every member
  // (current + ex), same delta walk the per-user page runs for one member.
  // The final (current) month compares the latest snapshot to each member's
  // live steam_play_data instead of a following snapshot, since that month
  // hasn't finished yet.
  const giveawayByLink = new Map(giveaways.map((g) => [g.link, g]))
  const wonByGaId = new Map<string, { link: string; name: string }>()
  for (const group of [allUsersGroup, exMembersData]) {
    for (const u of Object.values(group?.users ?? {})) {
      for (const win of u.giveaways_won ?? []) {
        wonByGaId.set(giveawayIdFromLink(win.link), { link: win.link, name: win.name })
      }
    }
  }

  const hoursGamesByMonth: Record<string, DrilldownGameRow[]> = {}
  const pushHoursRow = (monthKeyStr: string, row: DrilldownGameRow) =>
    pushRow(hoursGamesByMonth, monthLabel(monthKeyStr), row)

  const memberRowFor = (
    steamId: string,
    displayName: string,
    avatarUrl: string | undefined,
    isGroupMember: boolean,
    gaId: string,
    minutesGained: number,
    achievementsGained: number,
  ): DrilldownGameRow => {
    const won = wonByGaId.get(gaId)
    const link = won?.link ?? gaId
    const ga = won ? giveawayByLink.get(won.link) : undefined
    return {
      link,
      name: won?.name ?? gaId,
      timestamp: ga?.end_timestamp ?? 0,
      appId: ga?.app_id,
      packageId: ga?.package_id,
      giveaway: ga,
      fallbackUrl: fallbackUrlFor(ga),
      minutesGained,
      achievementsGained: achievementsGained > 0 ? achievementsGained : undefined,
      // Always a known member or ex-member (never an unknown/non-member id),
      // so the badge is a plain current/ex-member check.
      winners: [{ steamId, displayName, avatarUrl, badgeText: isGroupMember ? undefined : 'ex member' }],
    }
  }

  const hoursPerMonthMinutes = new Map<string, number>()
  const achievementsPerMonthMap = new Map<string, number>()

  for (let i = 0; i < playtimeSnapshots.length - 1; i++) {
    const beforeSnap = playtimeSnapshots[i].members
    const afterSnap = playtimeSnapshots[i + 1].members
    const monthKeyStr = playtimeSnapshots[i].month
    const steamIds = new Set([...Object.keys(beforeSnap), ...Object.keys(afterSnap)])
    let monthMinutes = 0
    let monthAchievements = 0
    for (const steamId of steamIds) {
      const before = beforeSnap[steamId] ?? {}
      const after = afterSnap[steamId] ?? {}
      const member = userNames.get(steamId)
        ? { displayName: userNames.get(steamId)!, avatarUrl: userAvatars.get(steamId) }
        : undefined
      monthMinutes += accumulatePlaytimeDeltas(before, after, (gaId, minutesGained, achievementsGained) => {
        monthAchievements += achievementsGained
        pushHoursRow(
          monthKeyStr,
          memberRowFor(
            steamId,
            member?.displayName ?? steamId,
            member?.avatarUrl,
            Boolean(allUsersGroup?.users?.[steamId]),
            gaId,
            minutesGained,
            achievementsGained,
          ),
        )
      })
    }
    hoursPerMonthMinutes.set(monthKeyStr, monthMinutes)
    achievementsPerMonthMap.set(monthKeyStr, monthAchievements)
  }

  if (playtimeSnapshots.length > 0) {
    const latest = playtimeSnapshots[playtimeSnapshots.length - 1]
    let monthMinutes = 0
    let monthAchievements = 0
    for (const [group, isGroupMember] of [
      [allUsersGroup, true],
      [exMembersData, false],
    ] as const) {
      for (const u of Object.values(group?.users ?? {})) {
        const before = latest.members[u.steam_id] ?? {}
        const after: Record<string, [number, number]> = {}
        for (const g of u.giveaways_won ?? []) {
          if (!g.steam_play_data) continue
          after[giveawayIdFromLink(g.link)] = [
            g.steam_play_data.playtime_minutes,
            g.steam_play_data.achievements_unlocked,
          ]
        }
        monthMinutes += accumulatePlaytimeDeltas(before, after, (gaId, minutesGained, achievementsGained) => {
          monthAchievements += achievementsGained
          pushHoursRow(
            latest.month,
            memberRowFor(
              u.steam_id,
              u.username,
              u.avatar_url,
              isGroupMember,
              gaId,
              minutesGained,
              achievementsGained,
            ),
          )
        })
      }
    }
    hoursPerMonthMinutes.set(latest.month, monthMinutes)
    achievementsPerMonthMap.set(latest.month, monthAchievements)
  }

  // Sort each month's rows by hours gained, highest first, and cap at the
  // top 50 — mostly 0h/privacy-noise entries beyond that, and the full lists
  // would add roughly a megabyte to this static page. The pre-cap row count
  // is kept alongside so the drill-down modal can say how many were cut.
  const DRILLDOWN_ROW_CAP = 50
  const hoursByMonth: Record<string, DrilldownGameRow[]> = {}
  const hoursByMonthCount: Record<string, number> = {}
  for (const [label, rows] of Object.entries(hoursGamesByMonth)) {
    rows.sort((a, b) => (b.minutesGained ?? 0) - (a.minutesGained ?? 0))
    hoursByMonthCount[label] = rows.length
    hoursByMonth[label] = rows.slice(0, DRILLDOWN_ROW_CAP)
  }

  const hoursPerMonthMap = new Map<string, number>()
  for (const [monthKeyStr, minutes] of hoursPerMonthMinutes) {
    hoursPerMonthMap.set(monthKeyStr, minutes / 60)
  }
  const hoursPerMonth: MonthDatum[] = combineMonthlySeries({ hours: hoursPerMonthMap })

  // "Achievements per month" chart: same per-game delta rows as the hours
  // chart above, filtered to the ones that gained an achievement and
  // re-sorted highest-first, so no second snapshot walk is needed.
  const achievementsByMonth: Record<string, DrilldownGameRow[]> = {}
  const achievementsByMonthCount: Record<string, number> = {}
  for (const [label, rows] of Object.entries(hoursGamesByMonth)) {
    const achRows = rows.filter((r) => (r.achievementsGained ?? 0) > 0)
    if (achRows.length === 0) continue
    achRows.sort((a, b) => (b.achievementsGained ?? 0) - (a.achievementsGained ?? 0))
    achievementsByMonthCount[label] = achRows.length
    achievementsByMonth[label] = achRows.slice(0, DRILLDOWN_ROW_CAP)
  }
  const achievementsPerMonth: MonthDatum[] = combineMonthlySeries({
    achievements: achievementsPerMonthMap,
  })

  return (
    <StatsClient
      totalGiveaways={totalGiveaways}
      totalCvSent={totalCvSent}
      totalMembers={totalMembers}
      totalEntries={totalEntries}
      giveawaysPerMonth={giveawaysPerMonth}
      giveawaysPerMonthExclusive={giveawaysPerMonthExclusive}
      cvPerMonth={cvPerMonth}
      avgEntriesPerMonth={avgEntriesPerMonth}
      avgEntriesPerMonthExclusive={avgEntriesPerMonthExclusive}
      membersPerMonth={membersPerMonth}
      membersJoinedByMonth={membersJoinedByMonth}
      membersLeftByMonth={membersLeftByMonth}
      topContributors={topContributors}
      giveawaysCreatedByMonth={giveawaysCreatedByMonth}
      giveawayEventNamesByMonth={giveawayEventNamesByMonth}
      cvSentByMonth={cvSentByMonth}
      contributorGiveaways={contributorGiveaways}
      hoursPerMonth={hoursPerMonth}
      hoursByMonth={hoursByMonth}
      hoursByMonthCount={hoursByMonthCount}
      activeMembersPerMonth={activeMembersPerMonth}
      activeMembersByMonth={activeMembersByMonth}
      achievementsPerMonth={achievementsPerMonth}
      achievementsByMonth={achievementsByMonth}
      achievementsByMonthCount={achievementsByMonthCount}
      lastUpdated={lastUpdated}
    />
  )
}
