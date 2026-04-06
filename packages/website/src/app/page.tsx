import { getAllGiveaways, getAllUsers, getExMembers, getGameData } from '@/lib/data'
import { GameData, Giveaway, User } from '@/types'
import { getUserRatio } from './users/util'
import DashboardClient, { DashboardStats, InsightData } from './dashboard-client'

function calculateInsights(
  giveawayList: Giveaway[],
  userList: User[],
  userMap: Map<string, User>,
  allGameData: GameData[]
): InsightData {
  const creators = new Map<string, number>()
  giveawayList.forEach(ga => {
    creators.set(ga.creator, (creators.get(ga.creator) || 0) + 1)
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

function computeStats(
  users: User[],
  allGiveaways: Giveaway[],
  giveaways: Giveaway[],
  userMap: Map<string, User>,
  allGameData: GameData[],
  memberLabel: string
): DashboardStats {
  const memberCount = users.length
  const totalGiveawaysCount = allGiveaways.length

  const usersWithWarnings = users.filter(user => (user.warnings?.length || 0) > 0)
  const usersWithWarningsCount = usersWithWarnings.length
  const usersWithWarningsPercentage = memberCount > 0 ? (usersWithWarningsCount / memberCount) * 100 : 0

  const totalGiveawaysCreated = totalGiveawaysCount
  const totalGiveawaysCreatedFullCV = allGiveaways.filter(ga => ga.cv_status === 'FULL_CV').length

  const totalGiveawaysWon = allGiveaways.reduce((sum, giveaway) => {
    return sum + (giveaway.winners?.filter(w => w.status === 'received').length || 0)
  }, 0)

  const totalGiveawaysWonFullCV = allGiveaways.filter(ga => ga.cv_status === 'FULL_CV' && ga.winners?.filter(w => w.status === 'received').length).length

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
    allTimeInsights: calculateInsights(giveaways, users, userMap, allGameData),
    last30DaysInsights: calculateInsights(recentGiveaways, users, userMap, allGameData),
    last7DaysInsights: calculateInsights(last7DaysGiveaways, users, userMap, allGameData),
  }
}

export default async function Home() {
  const allGiveaways = await getAllGiveaways()
  const giveaways = allGiveaways.filter(ga => ga.cv_status === 'FULL_CV' && !ga.is_shared && !ga.whitelist)
  const userData = await getAllUsers()
  const exMembersData = await getExMembers()
  const allGameData = await getGameData()

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

  // User map includes all users so insight lookups work for both modes
  const userMap = new Map(allUsers.map(u => [u.steam_id, u]))

  const activeStats = computeStats(activeUsers, allGiveaways, giveaways, userMap, allGameData, 'Active Members')
  const allStats = computeStats(allUsers, allGiveaways, giveaways, userMap, allGameData, 'Total Members')

  const lastUpdated = userData.lastUpdated ? new Date(userData.lastUpdated).toISOString() : null

  return <DashboardClient activeStats={activeStats} allStats={allStats} lastUpdated={lastUpdated} />
}
