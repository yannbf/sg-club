import { getUser, getAllGiveaways, getAllUsers } from '@/lib/data'
import { formatPlaytime, formatRelativeTime, getCVBadgeColor, getCVLabel } from '@/lib/data'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import GameImage from './GameImage'
import UserGiveawaysClient from './UserGiveawaysClient'

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
            <Image
              src={user.avatar_url}
              alt={user.username}
              width={64}
              height={64}
              className="rounded-full mr-4 border-2 border-card-border"
            />
          )}
          <div className="flex-1">
            <div className="flex items-center">
              <h1 className="text-3xl font-bold">{user.username}</h1>
              <span className="ml-3 text-2xl" title={userType.label}>{userType.icon}</span>
              {user.steam_id && <span className="ml-2 text-2xl text-muted-foreground" title="Steam Account Linked">🎮</span>}
            </div>
            <p className={`text-lg font-medium ${userType.color}`}>
              {userType.label}
            </p>
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
      {user.steam_id && user.giveaways_won && user.giveaways_won.some(g => g.steam_play_data) && (
        <div className="bg-card-background rounded-lg border-card-border border p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">🎮 Steam Activity</h2>
          <p className="text-sm text-muted-foreground mb-4">Activity related only to the games won in the group</p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-accent-orange">{getOwnedGames()}</div>
              <div className="text-sm text-muted-foreground">Activated Games</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-accent-blue">{formatPlaytime(getTotalPlaytime())}</div>
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
        <div className="bg-card-background rounded-lg border-card-border border p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">
            🏆 Games Won ({user.giveaways_won.length})
          </h2>
          <div className="space-y-4">
            {user.giveaways_won.map((game, index) => {
              const matchingGiveaway = giveaways.find(g => g.link === game.link)

              return (
                <div key={index} className="border border-card-border rounded-lg overflow-hidden">
                  <div className="flex">
                    {/* Game Image */}
                    <GameImage
                      appId={matchingGiveaway?.app_id?.toString()}
                      packageId={matchingGiveaway?.package_id?.toString()}
                      name={game.name}
                    />

                    <div className="p-4 flex-1">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="font-semibold">{game.name}</h3>
                          <div className="flex items-center mt-1 space-x-4">
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getCVBadgeColor(game.cv_status)}`}>
                              {getCVLabel(game.cv_status)}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              Won {formatRelativeTime(game.end_timestamp)}
                            </span>
                            <span className={`text-sm font-medium ${game.status === 'received' ? 'text-success-foreground' : 'text-warning-foreground'}`}>
                              {game.status === 'received' ? 'Activated' : 'Not Activated'}
                            </span>
                          </div>
                        </div>
                        <a
                          href={`https://www.steamgifts.com/giveaway/${game.link}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline text-sm"
                        >
                          View →
                        </a>
                      </div>
                    </div>
                  </div>

                  {game.steam_play_data && (
                    <div className="bg-background/50 p-4">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Owned:</span>
                          <span className={`ml-1 font-medium ${game.steam_play_data.owned ? 'text-success-foreground' : 'text-error-foreground'}`}>
                            {game.steam_play_data.owned ? 'Yes' : 'No'}
                          </span>
                        </div>
                        {game.steam_play_data.owned && (
                          <>
                            <div>
                              <span className="text-muted-foreground">Playtime:</span>
                              <span className="ml-1 font-medium">
                                {formatPlaytime(game.steam_play_data.playtime_minutes)}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Achievements:</span>
                              <span className="ml-1 font-medium">
                                {game.steam_play_data.achievements_unlocked}/{game.steam_play_data.achievements_total}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Status:</span>
                              <span className={`ml-1 font-medium ${game.steam_play_data.never_played ? 'text-error-foreground' : 'text-success-foreground'}`}>
                                {game.steam_play_data.never_played ? 'Never Played' : 'Played'}
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Giveaways Created */}
      <UserGiveawaysClient 
        giveaways={userGiveaways}
        userAvatars={userAvatars}
      />
    </div>
  )
} 