import { getAllGiveaways, getAllUsers, getExMembers, getGameData, getSteamIdMap, getUserEntries } from '@/lib/data'
import { GameData, Giveaway, User, UserEntry } from '@/types'
import { createCreatorResolver, CreatorResolver } from '@/lib/creator-resolver'
import { getUserRatio } from './users/util'
import DashboardClient, { DashboardStats, InsightData, UserLuckData } from './dashboard-client'

function calculateInsights(
  giveawayList: Giveaway[],
  userList: User[],
  userMap: Map<string, User>,
  allGameData: GameData[],
  resolver: CreatorResolver
): InsightData {
  // Group creator counts by canonical steam_id so a renamed user (or a deleted
  // SG account whose `creator` field is still a username string) collapses to
  // a single row instead of fragmenting across multiple labels.
  const creators = new Map<string, number>()
  giveawayList.forEach(ga => {
    const key = resolver.canonicalSteamId(ga.creator)
    creators.set(key, (creators.get(key) || 0) + 1)
  })

  const winners = new Map<string, number>()
  userList.forEach(user => {
    const winsInPeriod = user.giveaways_won?.filter(win => {
      return giveawayList.some(ga => ga.link === win.link)
    }).length || 0
    if (winsInPeriod > 0) {
      winners.set(user.steam_id, winsInPeriod)
    }
  })

  const gamers = userList.map(user => {
    const playtime = user.giveaways_won
      ?.filter(win => giveawayList.some(ga => ga.link === win.link))
      .reduce((sum, win) => sum + (win.steam_play_data?.playtime_minutes || 0), 0)
    return { user, value: playtime || 0 }
  }).filter(u => u.value > 0).sort((a, b) => b.value - a.value)

  const achievementHunters = userList.map(user => {
    const achievements = user.giveaways_won
      ?.filter(win => giveawayList.some(ga => ga.link === win.link))
      .reduce((sum, win) => sum + (win.steam_play_data?.achievements_unlocked || 0), 0)
    return { user, value: achievements || 0 }
  }).filter(u => u.value > 0).sort((a, b) => b.value - a.value)

  const achievementHuntersByPercentage = userList.map(user => {
    const winsInPeriod = user.giveaways_won?.filter(win =>
      giveawayList.some(ga => ga.link === win.link)
    ) || []

    if (winsInPeriod.length === 0) {
      return { user, value: 0 }
    }

    const stats = winsInPeriod.reduce(
      (acc, g) => {
        if (g.steam_play_data) {
          acc.totalEarned += g.steam_play_data.achievements_unlocked || 0
          acc.totalPossible += g.steam_play_data.achievements_total || 0
        }
        return acc
      },
      { totalEarned: 0, totalPossible: 0 }
    )

    const value = stats.totalPossible > 0 ? (stats.totalEarned / stats.totalPossible) * 100 : 0

    return { user, value }
  }).filter(u => u.value > 0).sort((a, b) => b.value - a.value)

  const mapAndSort = (map: Map<string, number>) => Array.from(map.entries())
    .map(([steamId, value]) => ({ user: userMap.get(steamId)!, value }))
    .filter(u => u.user)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)

  const gameGiveawayCounts = giveawayList.reduce((acc, ga) => {
    const gameId = ga.app_id ?? ga.package_id
    if (gameId) {
      acc.set(gameId, (acc.get(gameId) || 0) + 1)
    }
    return acc
  }, new Map<number, number>())

  return {
    topCreators: mapAndSort(creators),
    topWinners: mapAndSort(winners),
    topGamers: gamers.slice(0, 10).map(g => ({ ...g, value: `${Math.floor(g.value / 60)}h` })),
    topAchievementHunters: achievementHunters.slice(0, 10),
    topAchievementHuntersByPercentage: achievementHuntersByPercentage.slice(0, 10).map(g => ({ ...g, value: `${Math.round(g.value)}%` })),
    topGames: Array.from(gameGiveawayCounts.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([gameId, count]) => {
        const game = allGameData.find(g => {
          return g.app_id === gameId || g.package_id === gameId
        })
        return { game, count }
      })
      .filter(item => item.game) as { game: GameData; count: number }[]
  }
}

function calculateLuckRankings(
  users: User[],
  allGiveaways: Giveaway[],
  userEntries: UserEntry
): UserLuckData[] {
  const nowSec = Date.now() / 1000
  const giveawayMap = new Map(allGiveaways.map(ga => [ga.link, ga]))

  const result: UserLuckData[] = []

  for (const user of users) {
    const entries = userEntries[user.steam_id] || []
    if (entries.length === 0) continue

    // ENDED entries — used for both expected and actual wins so the
    // numerator and denominator share the same sample space.
    let expectedWins = 0
    let endedEntriesCount = 0
    let actualWins = 0
    const countedWonLinks = new Set<string>()

    // ACTIVE entries — only feed the "chance to win at least one" stat.
    let chanceToLose = 1
    let activeEntriesCount = 0

    // A win is genuine regardless of whether the gift was eventually
    // received/marked. We strip the previous `status === 'received'`
    // filter so unsent / awaiting wins still count as luck.
    const wonLinks = new Set(
      (user.giveaways_won || []).map(w => w.link),
    )

    for (const entry of entries) {
      const ga = giveawayMap.get(entry.link)
      if (!ga || !ga.entry_count || ga.entry_count <= 0) continue
      const probability = Math.min(ga.copies / ga.entry_count, 1)
      const isEnded = ga.end_timestamp <= nowSec

      if (isEnded) {
        expectedWins += probability
        endedEntriesCount++
        if (wonLinks.has(entry.link)) {
          actualWins++
          countedWonLinks.add(entry.link)
        }
      } else {
        chanceToLose *= 1 - probability
        activeEntriesCount++
      }
    }

    // Wins recorded for ended GAs we know about but where the user's
    // entry list missed the entry (data gap in the scraper). Without
    // this catch, a known win is dropped purely because we can't
    // attribute the entry, biasing luckScore down.
    if (user.giveaways_won) {
      for (const w of user.giveaways_won) {
        if (countedWonLinks.has(w.link)) continue
        const ga = giveawayMap.get(w.link)
        if (!ga) continue
        if (ga.end_timestamp > nowSec) continue
        actualWins++
      }
    }

    if (endedEntriesCount === 0 && activeEntriesCount === 0) continue

    const luckScore = expectedWins > 0 ? actualWins / expectedWins : 0
    const avgWinProbability =
      endedEntriesCount > 0 ? (expectedWins / endedEntriesCount) * 100 : 0
    const chanceToWin =
      activeEntriesCount > 0 ? (1 - chanceToLose) * 100 : 0

    // Last GA won timestamp — prefer the per-user stat (covers wins
    // that may not be in giveawayMap), fall back to giveaways_won.
    let lastWonAt: number | null = user.stats.last_giveaway_won_at ?? null
    if (lastWonAt == null && user.giveaways_won?.length) {
      lastWonAt = user.giveaways_won.reduce(
        (max, w) => Math.max(max, w.end_timestamp),
        0,
      )
      if (!lastWonAt) lastWonAt = null
    }

    result.push({
      steam_id: user.steam_id,
      username: user.username,
      avatar_url: user.avatar_url,
      entries: endedEntriesCount,
      wins: actualWins,
      expectedWins,
      luckScore,
      avgWinProbability,
      activeEntriesCount,
      chanceToWin,
      lastWonAt,
    })
  }

  return result.sort((a, b) => b.luckScore - a.luckScore)
}

function computeStats(
  users: User[],
  allGiveaways: Giveaway[],
  giveaways: Giveaway[],
  userMap: Map<string, User>,
  allGameData: GameData[],
  memberLabel: string,
  userEntries: UserEntry,
  resolver: CreatorResolver
): DashboardStats {
  const memberCount = users.length

  // Exclude deleted giveaways from every count — they're not visible anywhere
  // else on the dashboard and SG itself drops them from group totals.
  const liveGiveaways = allGiveaways.filter(ga => !ga.deleted)
  const totalGiveawaysCount = liveGiveaways.length

  const usersWithWarnings = users.filter(user => (user.warnings?.length || 0) > 0)
  const usersWithWarningsCount = usersWithWarnings.length
  const usersWithWarningsPercentage = memberCount > 0 ? (usersWithWarningsCount / memberCount) * 100 : 0

  const totalGiveawaysCreated = totalGiveawaysCount
  const totalGiveawaysCreatedFullCV = liveGiveaways.filter(ga => ga.cv_status === 'FULL_CV').length

  // Delivered keys — counted from per-giveaway winners.
  const totalGiveawaysWon = liveGiveaways.reduce((sum, giveaway) => {
    return sum + (giveaway.winners?.filter(w => w.status === 'received').length || 0)
  }, 0)

  const totalGiveawaysWonFullCV = liveGiveaways.filter(ga => ga.cv_status === 'FULL_CV' && ga.winners?.filter(w => w.status === 'received').length).length

  const totalValueSent = users.reduce((sum, user) => sum + user.stats.total_sent_value, 0)
  const totalValueReceived = users.reduce((sum, user) => sum + user.stats.total_received_value, 0)

  const netContributors = users.filter(user => getUserRatio(user.stats.giveaway_ratio) === 'contributor').length
  const neutralUsers = users.filter(user => getUserRatio(user.stats.giveaway_ratio) === 'neutral').length
  const netReceivers = users.filter(user => getUserRatio(user.stats.giveaway_ratio) === 'receiver').length

  // Insight periods
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
  const recentGiveaways = giveaways.filter(ga => ga.created_timestamp * 1000 > thirtyDaysAgo)

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const last7DaysGiveaways = giveaways.filter(ga => ga.end_timestamp * 1000 > sevenDaysAgo)

  return {
    memberCount,
    memberLabel,
    totalGiveawaysCount,
    totalValueSent,
    totalGiveawaysCreated,
    totalGiveawaysWon,
    totalGiveawaysCreatedFullCV,
    totalGiveawaysWonFullCV,
    totalValueReceived,
    netContributors,
    neutralUsers,
    netReceivers,
    usersWithWarningsCount,
    usersWithWarningsPercentage,
    allTimeInsights: calculateInsights(giveaways, users, userMap, allGameData, resolver),
    last30DaysInsights: calculateInsights(recentGiveaways, users, userMap, allGameData, resolver),
    last7DaysInsights: calculateInsights(last7DaysGiveaways, users, userMap, allGameData, resolver),
    luckRankings: calculateLuckRankings(users, allGiveaways, userEntries),
  }
}

export default async function Home() {
  const allGiveaways = await getAllGiveaways()
  const giveaways = allGiveaways.filter(ga => ga.cv_status === 'FULL_CV' && !ga.is_shared && !ga.whitelist)
  const userData = await getAllUsers()
  const exMembersData = await getExMembers()
  const allGameData = await getGameData()
  const userEntries = await getUserEntries()
  const steamIdMap = await getSteamIdMap()

  if (!userData) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Unable to load data</p>
      </div>
    )
  }

  const activeUsers = Object.values(userData.users)
  const exMembers = exMembersData ? Object.values(exMembersData.users) : []
  const allUsers = [...activeUsers, ...exMembers]

  const activeUserMap = new Map(activeUsers.map(u => [u.steam_id, u]))
  const allUserMap = new Map(allUsers.map(u => [u.steam_id, u]))

  const entries = userEntries || {}
  const resolver = createCreatorResolver(steamIdMap)

  const activeStats = computeStats(activeUsers, allGiveaways, giveaways, activeUserMap, allGameData, 'Active Members', entries, resolver)
  const allStats = computeStats(allUsers, allGiveaways, giveaways, allUserMap, allGameData, 'Total Members', entries, resolver)

  const lastUpdated = userData.lastUpdated ? new Date(userData.lastUpdated).toISOString() : null

  return <DashboardClient activeStats={activeStats} allStats={allStats} lastUpdated={lastUpdated} />
}
