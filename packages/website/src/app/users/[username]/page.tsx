// page.tsx
import { getUser, getAllGiveaways, getAllUsers, getExMembers, getGameData, getUserEntries, getSteamIdMap, getPlaytimeSnapshots } from '@/lib/data'
import { createCreatorResolver } from '@/lib/creator-resolver'
import { buildWinnerPlayStats } from '@/lib/winner-play-stats'
import { notFound } from 'next/navigation'
import UserDetailPageClient from './UserDetailPageClient'
import { ProfileGate } from '@/components/ProfileGate'
import leaversData from '@/../investigation/giveaway_leavers.json';
import { GiveawayLeaver } from '@/types/stats';
import { Giveaway } from '@/types';
import { accumulatePlaytimeDeltas, giveawayIdFromLink, monthLabel } from '@/lib/chart-data'
import type { MonthDatum } from '@/components/charts/GroupStatsCharts'
import type { DrilldownGameRow } from '@/components/charts/StatsDrilldownModal'
// import { Metadata } from 'next'

export async function generateStaticParams() {
  const [userData, exData, steamIdMap] = await Promise.all([
    getAllUsers(),
    getExMembers(),
    getSteamIdMap(),
  ])
  const usernames = new Set<string>()

  if (userData) {
    for (const user of Object.values(userData.users)) {
      usernames.add(user.username)
    }
  }
  if (exData) {
    for (const user of Object.values(exData.users)) {
      usernames.add(user.username)
    }
  }
  // Also generate pages for previous usernames so old links still work
  for (const entry of Object.values(steamIdMap)) {
    for (const prev of entry.previous) {
      usernames.add(prev.username)
    }
  }

  return Array.from(usernames).map((username) => ({ username }))
}

// export async function generateMetadata({ params }: { params: { username: string } }): Promise<Metadata> {
//   const paramsData = await params
//   const username = decodeURIComponent(paramsData.username)
//   const user = await getUser(username)

//   if (!user) {
//     return {
//       title: 'User not found',
//       description: 'This user does not exist.',
//     }
//   }

//   const description = `Ratio ${user.stats.giveaway_ratio} | Created ${user.giveaways_created?.length ?? 0} GAs | Received ${user.stats.real_total_received_count} | Sent ${user.stats.total_sent_count} | Received ${user.stats.total_received_count}`

//   return {
//     title: `TGC - ${user.username}`,
//     description,
//     openGraph: {
//       title: `TGC - ${user.username}`,
//       description,
//     },
//   }
// }

type Leaver = {
  joined_at_timestamp: string;
  ga_link: string;
  leave_detected_at: number;
  time_difference_hours: number;
};

const leavers: Record<string, Leaver[]> = leaversData;

export default async function UserDetailPage(
  props: {
    params: Promise<{ username: string }>
  }
) {
  const params = await props.params;
  const { username } = params
  const [userResult, allUsers, exMembersData, giveaways, userEntries, gameDataObj, steamIdMap, playtimeSnapshots] = await Promise.all([
    getUser(decodeURIComponent(username)),
    getAllUsers(),
    getExMembers(),
    getAllGiveaways(),
    getUserEntries(),
    getGameData(),
    getSteamIdMap(),
    getPlaytimeSnapshots(),
  ])
  const lastUpdated = allUsers?.lastUpdated ?? null

  if (!userResult) {
    notFound()
  }

  const { user, isExMember } = userResult

  // The full user_entries.json is large (every entry, every user) — this page
  // only ever needs one user's slice of it, so scope it down before it
  // crosses the server/client boundary.
  const userEntriesForUser = userEntries?.[user.steam_id] ?? []

  // Leavers are keyed by steam_id
  const userLeavers = leavers[user.steam_id] || [];
  const userLeaversWithGaData: GiveawayLeaver[] = userLeavers.map((leaver) => {
    const gaId = leaver.ga_link.split('/')[0];
    const giveaway = giveaways.find((ga) => ga.id === gaId);
    return {
      ...leaver,
      giveaway: giveaway
        ? {
          ...(giveaway as unknown as Giveaway),
          game: {
            image_url: `https://cdn.akamai.steamstatic.com/steam/apps/${giveaway.app_id}/header.jpg`,
            name: giveaway.name,
            app_id: giveaway.app_id,
          },
        }
        : undefined,
    };
  }).filter(id => !!id.giveaway);

  // Convert gameData from object to array
  const gameData = Object.entries(gameDataObj).map(([, data]) => data)

  // Playtime/achievements each winner has on the games this user gave away.
  // Scoped to their own giveaways so the map stays small on every user page.
  const resolver = createCreatorResolver(steamIdMap)
  const createdGiveaways = giveaways.filter(
    (giveaway) => resolver.canonicalSteamId(giveaway.creator) === user.steam_id,
  )
  const playStatsByWin = buildWinnerPlayStats(
    createdGiveaways,
    [allUsers, exMembersData],
    resolver,
  )

  // "Hours played per month": per-game playtime/achievement deltas between
  // consecutive start-of-month snapshots, summed per month, for this user's
  // own won games. The final (current) month compares the latest snapshot to
  // this user's live steam_play_data instead of a following snapshot, since
  // that month hasn't finished yet.
  const giveawayByLinkForHours = new Map(giveaways.map((g) => [g.link, g]))
  const wonByGaId = new Map(
    (user.giveaways_won ?? []).map((g) => [giveawayIdFromLink(g.link), g]),
  )
  const pushHoursRow = (map: Map<string, DrilldownGameRow[]>, key: string, row: DrilldownGameRow) => {
    const arr = map.get(key)
    if (arr) arr.push(row)
    else map.set(key, [row])
  }
  const hoursGamesByMonth = new Map<string, DrilldownGameRow[]>()
  // Walks the shared per-pair delta algorithm for this user into
  // `monthKeyStr`'s bucket.
  const accumulateDelta = (
    before: Record<string, [number, number]>,
    after: Record<string, [number, number]>,
    monthKeyStr: string,
  ): number =>
    accumulatePlaytimeDeltas(before, after, (gaId, minutesGained, achievementsGained) => {
      const won = wonByGaId.get(gaId)
      const link = won?.link ?? gaId
      const ga = won ? giveawayByLinkForHours.get(won.link) : undefined
      pushHoursRow(hoursGamesByMonth, monthLabel(monthKeyStr), {
        link,
        name: won?.name ?? gaId,
        timestamp: ga?.end_timestamp ?? won?.end_timestamp ?? 0,
        appId: ga?.app_id,
        packageId: ga?.package_id,
        giveaway: ga,
        minutesGained,
        achievementsGained: achievementsGained > 0 ? achievementsGained : undefined,
      })
    })

  const hoursMonthRows: MonthDatum[] = []
  for (let i = 0; i < playtimeSnapshots.length - 1; i++) {
    const before = playtimeSnapshots[i].members[user.steam_id] ?? {}
    const after = playtimeSnapshots[i + 1].members[user.steam_id] ?? {}
    const monthKeyStr = playtimeSnapshots[i].month
    const minutes = accumulateDelta(before, after, monthKeyStr)
    hoursMonthRows.push({ month: monthKeyStr, label: monthLabel(monthKeyStr), hours: minutes / 60 })
  }
  if (playtimeSnapshots.length > 0) {
    const latest = playtimeSnapshots[playtimeSnapshots.length - 1]
    const before = latest.members[user.steam_id] ?? {}
    const after: Record<string, [number, number]> = {}
    for (const g of user.giveaways_won ?? []) {
      if (!g.steam_play_data) continue
      after[giveawayIdFromLink(g.link)] = [
        g.steam_play_data.playtime_minutes,
        g.steam_play_data.achievements_unlocked,
      ]
    }
    const minutes = accumulateDelta(before, after, latest.month)
    hoursMonthRows.push({ month: latest.month, label: monthLabel(latest.month), hours: minutes / 60 })
  }
  for (const rows of hoursGamesByMonth.values()) {
    rows.sort((a, b) => (b.minutesGained ?? 0) - (a.minutesGained ?? 0))
  }
  // Skip leading months with no playtime gained, so the axis starts at this
  // member's first activity instead of a long flat run of empty months.
  const firstActiveIdx = hoursMonthRows.findIndex((r) => Number(r.hours) > 0)
  const hoursPerMonth = firstActiveIdx >= 0 ? hoursMonthRows.slice(firstActiveIdx) : []
  const hoursByMonth = Object.fromEntries(hoursGamesByMonth)

  return (
    <ProfileGate ownerSteamId={user.steam_id} ownerUsername={user.username}>
      <UserDetailPageClient
        user={user}
        allUsers={allUsers}
        giveaways={giveaways}
        gameData={gameData}
        userEntries={userEntriesForUser}
        lastUpdated={lastUpdated}
        leavers={userLeaversWithGaData}
        steamIdMap={steamIdMap}
        isExMember={isExMember}
        exMemberIds={Object.keys(exMembersData?.users ?? {})}
        playStatsByWin={playStatsByWin}
        hoursPerMonth={hoursPerMonth}
        hoursByMonth={hoursByMonth}
      />
    </ProfileGate>
  )
} 