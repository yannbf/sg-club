import {
  getAllGiveaways,
  getAllUsersAsArray,
  getExMembers,
  getGameData,
  getLastUpdated,
} from '@/lib/data'
import { isCountedGiveaway } from '@/lib/events'
import {
  buildGameDataIndex,
  combineMonthlySeries,
  giveawayCvValue,
  monthKey,
  monthLabel,
  monthlyAggregate,
  withCumulative,
} from '@/lib/chart-data'
import type { MonthDatum, ContributorDatum } from '@/components/charts/GroupStatsCharts'
import type { DrilldownMemberRow } from '@/components/charts/StatsDrilldownModal'
import StatsClient from './StatsClient'
import { AdminGate } from '@/components/AdminGate'

export default async function StatsPage() {
  const [allGiveaways, users, exMembersData, gameData, lastUpdated] = await Promise.all([
    getAllGiveaways(),
    getAllUsersAsArray(),
    getExMembers(),
    getGameData(),
    getLastUpdated(),
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

  const topContributors: ContributorDatum[] = [...users]
    .sort((a, b) => b.stats.real_total_sent_value - a.stats.real_total_sent_value)
    .slice(0, 10)
    .map((u) => ({ username: u.username, value: u.stats.real_total_sent_value }))

  const totalGiveaways = giveaways.length
  const totalCvSent = giveaways.reduce(
    (sum, g) => sum + giveawayCvValue(g, gameDataIndex),
    0,
  )
  const totalMembers = users.length
  const totalEntries = giveaways.reduce((sum, g) => sum + (g.entry_count ?? 0), 0)

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
      lastUpdated={lastUpdated}
      />
    </AdminGate>
  )
}
