import { getAllGiveaways, getAllUsers, getGameData } from '@/lib/data'
import Link from 'next/link'
import Image from 'next/image'
import { LastUpdated } from '@/components/LastUpdated'
import UserAvatar from '@/components/UserAvatar'
import { GameData, Giveaway, User } from '@/types'
import GameImage from '@/components/GameImage'

const PLACEHOLDER_IMAGE = 'https://steamplayercount.com/theme/img/placeholder.svg'

function getGameImageUrl(game: GameData): string {
  const src = game.app_id
    ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.app_id}/header.jpg`
    : game.package_id
      ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/subs/${game.package_id}/header.jpg`
      : PLACEHOLDER_IMAGE

  return src
}

interface UserRankingProps {
  title: React.ReactNode
  users: {
    user: User
    value: string | number
  }[]
}

function UserRanking({ title, users }: UserRankingProps) {
  return (
    <div>
      <h4 className="text-md font-semibold mb-3">{title}</h4>
      <div className="space-y-3">
        {users.map(({ user, value }, index) => (
          <div key={user.username} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground w-6 text-center">{index + 1}</span>
              <UserAvatar src={user.avatar_url} username={user.username} />
              <Link href={`/users/${user.username}`} className="text-sm font-medium hover:underline">
                {user.username}
              </Link>
            </div>
            <span className="text-sm font-semibold">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface InsightSectionProps {
  title: string
  data: {
    topCreators: { user: User; value: number }[]
    topWinners: { user: User; value: number }[]
    topGamers: { user: User; value: string }[]
    topAchievementHunters: { user: User; value: number }[]
    topGames: { game: GameData; count: number }[]
  }
}

function InsightSection({ title, data }: InsightSectionProps) {
  return (
    <>
      <h3 className="text-xl font-bold mb-6">🕒 {title}</h3>
      <div className="bg-card-background rounded-lg border-card-border border p-6">
        <p className="text-sm text-red-500 mb-3">
          * Only full CV giveaways are taken into account in the calculation
        </p>
        <h4 className="text-md font-semibold mb-3">Top 5 Most Created Giveaway Games</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6 mb-6">
          {data.topGames.map(({ game, count }) => (
            <div key={game.app_id ?? game.package_id} className="bg-card-background rounded-lg border-card-border border overflow-hidden">
              <GameImage
                appId={game.app_id?.toString()}
                packageId={game.package_id?.toString()}
                name={game.name}
                fillWidth={true}
              />
              <div className="p-4">
                <a href={`https://www.steamgifts.com/group/WlYTQ/thegiveawaysclub/search?q=${encodeURIComponent(game.name)}`} target="_blank" className="text-accent hover:underline text-lg font-bold truncate block">
                  {game.name}
                </a>
                <p className="text-sm text-muted-foreground">{count} {count === 1 ? 'Giveaway' : 'Giveaways'}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <div>
            <UserRanking title="🎁 Top creators" users={data.topCreators} />
          </div>
          <div className="md:border-l md:pl-4">
            <UserRanking title="🏅 Top winners" users={data.topWinners} />
          </div>
          <div className="lg:border-l lg:pl-4">
            <UserRanking title="🎮 Top gamers (playtime)" users={data.topGamers} />
          </div>
          <div className="lg:border-l lg:pl-4">
            <UserRanking title="🏆 Top achievement hunters" users={data.topAchievementHunters} />
          </div>
        </div>
      </div>
    </>
  )
}

export default async function Home() {
  const allGiveaways = await getAllGiveaways()
  const giveaways = allGiveaways.filter(ga => ga.cv_status === 'FULL_CV')
  const userData = await getAllUsers()
  const allGameData = await getGameData()

  if (!userData) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Unable to load data</p>
      </div>
    )
  }

  const users = Object.values(userData.users)
  const activeMembers = users.length
  const totalGiveawaysCount = allGiveaways.length

  const usersWithWarnings = users.filter(user => (user.warnings?.length || 0) > 0)
  const usersWithWarningsCount = usersWithWarnings.length
  const usersWithWarningsPercentage = (usersWithWarningsCount / activeMembers) * 100

  // Calculate statistics
  const totalGiveawaysCreated = totalGiveawaysCount

  const totalGiveawaysCreatedFullCV = allGiveaways.filter(ga => ga.cv_status === 'FULL_CV').length

  const totalGiveawaysWon = allGiveaways.reduce((sum, giveaway) => {
    return sum + (giveaway.winners?.filter(w => w.status === 'received').length || 0)
  }, 0)

  const totalGiveawaysWonFullCV = allGiveaways.filter(ga => ga.cv_status === 'FULL_CV' && ga.winners?.filter(w => w.status === 'received').length).length

  const totalValueSent = users.reduce((sum, user) => sum + user.stats.total_sent_value, 0)
  const totalValueReceived = users.reduce((sum, user) => sum + user.stats.total_received_value, 0)

  const netContributors = users.filter(user => (user.stats.giveaway_ratio ?? 0) > 0).length
  const neutralUsers = users.filter(user => (user.stats.giveaway_ratio ?? 0) <= 0 && (user.stats.giveaway_ratio ?? 0) >= -1).length
  const netReceivers = users.filter(user => (user.stats.giveaway_ratio ?? 0) < -1).length

  const userMap = new Map(users.map(u => [u.username, u]))

  // --- Insight Calculations ---
  const calculateInsights = (giveawayList: Giveaway[], userList: User[]) => {
    const creators = new Map<string, number>()
    giveawayList.forEach(ga => {
      creators.set(ga.creator, (creators.get(ga.creator) || 0) + 1)
    })

    const winners = new Map<string, number>()
    userList.forEach(user => {
      const winsInPeriod = user.giveaways_won?.filter(win =>
        giveawayList.some(ga => ga.link === win.link)
      ).length || 0
      if (winsInPeriod > 0) {
        winners.set(user.username, winsInPeriod)
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

    const mapAndSort = (map: Map<string, number>) => Array.from(map.entries())
      .map(([username, value]) => ({ user: userMap.get(username)!, value }))
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

    console.log({
      bla: Array.from(gameGiveawayCounts.entries())
        .sort(([, a], [, b]) => b - a).slice(0, 5)
    })

    return {
      topCreators: mapAndSort(creators),
      topWinners: mapAndSort(winners),
      topGamers: gamers.slice(0, 10).map(g => ({ ...g, value: `${Math.floor(g.value / 60)}h` })),
      topAchievementHunters: achievementHunters.slice(0, 10),
      topGames: Array.from(gameGiveawayCounts.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([gameId, count]) => {
          const game = allGameData.find(g => {
            return g.app_id === gameId || g.package_id === gameId
          })
          const giveaway = giveawayList.find(g => g.app_id === gameId || g.package_id === gameId)
          console.log({ game, giveaway })
          return { game, count }
        })
        .filter(item => item.game) as { game: GameData; count: number }[]
    }
  }

  // All-Time Insights
  const allTimeInsights = calculateInsights(giveaways, users)

  // Last 30 Days Insights
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
  const recentGiveaways = giveaways.filter(ga => ga.created_timestamp * 1000 > thirtyDaysAgo)
  const last30DaysInsights = calculateInsights(recentGiveaways, users)

  // Last 7 Days Insights
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const last7DaysGiveaways = giveaways.filter(ga => ga.created_timestamp * 1000 > sevenDaysAgo)
  // console.log({last7DaysGiveaways})
  const last7DaysInsights = calculateInsights(last7DaysGiveaways, users)

  return (
    <div className="space-y-8">
      <div className="mb-4">
        <h1 className="text-3xl font-bold">Group Analytics Overview</h1>
        {userData.lastUpdated ? <LastUpdated lastUpdatedDate={new Date(userData.lastUpdated).toISOString()} /> : <p className="mt-2 text-sm text-muted-foreground">Last updated: Unknown</p>}
      </div>


      {/* Key Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-card-background rounded-lg border-card-border border p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-accent-blue rounded-full flex items-center justify-center">
                <span className="text-white font-semibold">👥</span>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted-foreground">Active Members</p>
              <p className="text-2xl font-semibold">{activeMembers}</p>
            </div>
          </div>
        </div>

        <div className="bg-card-background rounded-lg border-card-border border p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-accent-green rounded-full flex items-center justify-center">
                <span className="text-white font-semibold">🎁</span>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted-foreground">Total Giveaways</p>
              <p className="text-2xl font-semibold">{totalGiveawaysCount}</p>
            </div>
          </div>
        </div>

        <div className="bg-card-background rounded-lg border-card-border border p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-accent-purple rounded-full flex items-center justify-center">
                <span className="text-white font-semibold">💰</span>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted-foreground">Total Value Sent</p>
              <p className="text-2xl font-semibold">${totalValueSent.toFixed(0)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Community Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-card-background rounded-lg border-card-border border p-6">
          <h3 className="text-lg font-semibold mb-4">Community Health</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Net Contributors</span>
              <span className="text-sm font-semibold text-success-foreground">
                {netContributors} ({((netContributors / activeMembers) * 100).toFixed(1)}%)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Neutral Users</span>
              <span className="text-sm font-semibold text-muted-foreground">
                {neutralUsers} ({((neutralUsers / activeMembers) * 100).toFixed(1)}%)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Net Receivers</span>
              <span className="text-sm font-semibold text-error-foreground">
                {netReceivers} ({((netReceivers / activeMembers) * 100).toFixed(1)}%)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Users with warnings</span>
              <span className="text-sm font-semibold text-error-foreground">
                {usersWithWarningsCount} ({usersWithWarningsPercentage.toFixed(1)}%)
              </span>
            </div>
          </div>
        </div>

        <div className="bg-card-background rounded-lg border-card-border border p-6">
          <h3 className="text-lg font-semibold mb-4">Activity Summary</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Giveaways Created</span>
              <span className="text-sm font-semibold text-info-foreground">{totalGiveawaysCreated}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Giveaways Successfully Sent</span>
              <span className="text-sm font-semibold text-success-foreground">{totalGiveawaysWon}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground"><strong>Full CV</strong> Giveaways Created</span>
              <span className="text-sm font-semibold text-info-foreground">{totalGiveawaysCreatedFullCV}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground"><strong>Full CV</strong> Giveaways Successfully Sent</span>
              <span className="text-sm font-semibold text-success-foreground">{totalGiveawaysWonFullCV}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Total Value Received</span>
              <span className="text-sm font-semibold text-accent-purple">${totalValueReceived.toFixed(0)}</span>
            </div>
          </div>
        </div>
      </div>

      <InsightSection title="Last 7 Days Insights" data={last7DaysInsights} />
      <InsightSection title="Last 30 Days Insights" data={last30DaysInsights} />
      <InsightSection title="All-Time Insights" data={allTimeInsights} />
    </div>
  )
}
