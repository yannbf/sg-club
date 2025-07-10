import { getUser, getAllGiveaways, getAllUsers, getGameData } from '@/lib/data'
import { formatPlaytime, formatRelativeTime, getCVBadgeColor, getCVLabel } from '@/lib/data'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import GameImage from './GameImage'
import UserGiveawaysClient from './UserGiveawaysClient'
import WonGiveawaysClient from './WonGiveawaysClient'

export async function generateStaticParams() {
  const userData = await getAllUsers()
  if (!userData) return []

  return userData.users.map((user) => ({
    username: user.username,
  }))
}

interface Props {
  params: Promise<{ username: string }>
}

export default async function UserDetailPage({ params }: Props) {
  const { username } = await params
  const user = await getUser(decodeURIComponent(username))
  const allUsers = await getAllUsers()
  const gameData = await getGameData()

  if (!user) {
    notFound()
  }

  const giveaways = await getAllGiveaways()

  // Get giveaways created by this user from the main giveaways data
  const userGiveaways = giveaways.filter(g => g.creator.username === user.username)

  // Create a map of usernames to avatar URLs
  const userAvatars = new Map(allUsers?.users.map(user => [user.username, user.avatar_url]))

  const getUserTypeIcon = () => {
    if (user.stats.total_gift_difference > 0) {
      return { icon: '📈', label: 'Net Contributor', color: 'text-success-foreground' }
    } else if (user.stats.total_gift_difference < 0) {
      return { icon: '📉', label: 'Net Receiver', color: 'text-error-foreground' }
    } else {
      return { icon: '➖', label: 'Neutral', color: 'text-muted-foreground' }
    }
  }

  const userType = getUserTypeIcon()

  const getTotalPlaytime = () => {
    if (!user.giveaways_won) return 0
    return user.giveaways_won.reduce((total, game) => {
      return total + (game.steam_play_data?.playtime_minutes || 0)
    }, 0)
  }

  const getTotalAchievements = () => {
    if (!user.giveaways_won) return 0
    return user.giveaways_won.reduce((total, game) => {
      return total + (game.steam_play_data?.achievements_unlocked || 0)
    }, 0)
  }

  const getOwnedGames = () => {
    if (!user.giveaways_won) return 0
    return user.giveaways_won.filter(game => game.steam_play_data?.owned).length
  }

  const getNeverPlayedGames = () => {
    if (!user.giveaways_won) return 0
    return user.giveaways_won.filter(game => game.steam_play_data?.never_played).length
  }

  return (
    <div className="space-y-8">
      {/* User Header */}
      <div className="bg-card-background rounded-lg border-card-border border p-6 mb-6">
        <div className="flex items-center">
          {user.avatar_url && (
            <a href={`https://www.steamgifts.com/user/${user.username}`} target="_blank" rel="noopener noreferrer">
              <Image
                src={user.avatar_url}
                alt={user.username}
                width={64}
                height={64}
                className="rounded-full mr-4 border-2 border-card-border"
              />
            </a>
          )}
          <div className="flex-1">
            <div className="flex items-center">
              <h1 className="text-3xl font-bold">{user.username}</h1>
              <span className="ml-3 text-2xl" title={userType.label}>{userType.icon}</span>
              {user.steam_id && !user.steam_profile_is_private && <span className="ml-2 text-2xl text-muted-foreground" title="Steam Account Linked">🎮</span>}
            </div>
            <p className={`text-lg font-medium ${userType.color}`}>
              {userType.label}
            </p>
            {user.profile_url && (
              <a
                href={`https://www.steamgifts.com/user/${user.username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline text-sm"
              >
                View SG Profile →
              </a>
            )}
            <br />
            {user.steam_profile_url && (
              <a
                href={user.steam_profile_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline text-sm"
              >
                View Steam Profile →
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Statistics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <div className="bg-card-background rounded-lg border-card-border border p-6">
          <div className="text-center">
            <div className="text-3xl font-bold text-info-foreground">{user.stats.total_sent_count}</div>
            <div className="text-sm text-muted-foreground">Gifts Sent</div>
            <div className="text-xs text-muted-foreground">${user.stats.total_sent_value.toFixed(2)}</div>
          </div>
        </div>

        <div className="bg-card-background rounded-lg border-card-border border p-6">
          <div className="text-center">
            <div className="text-3xl font-bold text-success-foreground">{user.stats.total_received_count}</div>
            <div className="text-sm text-muted-foreground">Gifts Received</div>
            <div className="text-xs text-muted-foreground">${user.stats.total_received_value.toFixed(2)}</div>
          </div>
        </div>

        <div className="bg-card-background rounded-lg border-card-border border p-6">
          <div className="text-center">
            <div className={`text-3xl font-bold ${userType.color}`}>
              {user.stats.total_gift_difference > 0 ? '+' : ''}{user.stats.total_gift_difference}
            </div>
            <div className="text-sm text-muted-foreground">Gift Difference</div>
            <div className={`text-xs ${userType.color}`}>
              {user.stats.total_value_difference > 0 ? '+' : ''}${user.stats.total_value_difference.toFixed(2)}
            </div>
          </div>
        </div>

        <div className="bg-card-background rounded-lg border-card-border border p-6">
          <div className="text-center">
            <div className="text-3xl font-bold text-accent-purple">{userGiveaways.length}</div>
            <div className="text-sm text-muted-foreground">Total Giveaways</div>
            <div className="text-xs text-muted-foreground">Created</div>
          </div>
        </div>
      </div>

      {/* Steam Statistics */}
      {user.steam_id && !user.steam_profile_is_private && user.giveaways_won && user.giveaways_won.some(g => g.steam_play_data) && (
        <div className="bg-card-background rounded-lg border-card-border border p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">🎮 Steam Activity</h2>
          <p className="text-sm text-muted-foreground mb-4">Activity related only to the games won in the group</p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-accent-orange">{getOwnedGames()}</div>
              <div className="text-sm text-muted-foreground">Activated Games</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-accent-blue">
                {getTotalPlaytime() === 0 && getTotalAchievements() > 0
                  ? 'Unavailable'
                  : formatPlaytime(getTotalPlaytime())}
              </div>
              <div className="text-sm text-muted-foreground">Total Playtime</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-accent-yellow">{getTotalAchievements()}</div>
              <div className="text-sm text-muted-foreground">Total Achievements</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-error-foreground">{getNeverPlayedGames()}</div>
              <div className="text-sm text-muted-foreground">Never Played</div>
            </div>
          </div>
        </div>
      )}

      {/* Games Won */}
      {user.giveaways_won && user.giveaways_won.length > 0 && (
        <WonGiveawaysClient
          giveaways={giveaways}
          wonGiveaways={user.giveaways_won}
          gameData={gameData}
        />
      )}

      {/* Giveaways Created */}
      <UserGiveawaysClient
        giveaways={userGiveaways}
        userAvatars={userAvatars}
        gameData={gameData}
      />
    </div>
  )
} 