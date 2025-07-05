import { getUser, getAllGiveaways, getAllUsers } from '@/lib/data'
import { formatRelativeTime, formatPlaytime, getCVBadgeColor, getCVLabel } from '@/lib/data'
import { notFound } from 'next/navigation'
import Link from 'next/link'

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
  
  if (!user) {
    notFound()
  }

  const giveaways = await getAllGiveaways()
  
  // Get giveaways created by this user from the main giveaways data
  const userGiveaways = giveaways.filter(g => g.creator.username === user.username)
  
  const getUserTypeIcon = () => {
    if (user.stats.total_gift_difference > 0) {
      return { icon: '📈', label: 'Net Contributor', color: 'text-green-600' }
    } else if (user.stats.total_gift_difference < 0) {
      return { icon: '📉', label: 'Net Receiver', color: 'text-red-600' }
    } else {
      return { icon: '➖', label: 'Neutral', color: 'text-gray-600' }
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

  const getGiveawayStatus = (endTimestamp: number) => {
    const now = Date.now() / 1000
    const isActive = endTimestamp > now
    
    return {
      isActive,
      statusIcon: isActive ? '🟢' : '🔴',
      statusText: isActive ? 'Active' : 'Ended',
      statusColor: isActive ? 'text-green-600' : 'text-red-600',
      borderColor: isActive ? 'border-green-200' : 'border-gray-200',
      backgroundColor: isActive ? 'bg-green-50' : 'bg-white'
    }
  }

  return (
    <div className="px-4 sm:px-0">
      {/* User Header */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex items-center">
          {user.avatar_url && (
            <img
              src={user.avatar_url}
              alt={user.username}
              className="w-16 h-16 rounded-full mr-4"
            />
          )}
          <div className="flex-1">
            <div className="flex items-center">
              <h1 className="text-3xl font-bold text-gray-900">{user.username}</h1>
              <span className="ml-3 text-2xl">{userType.icon}</span>
              {user.steam_id && <span className="ml-2 text-2xl">🎮</span>}
            </div>
            <p className={`text-lg font-medium ${userType.color}`}>
              {userType.label}
            </p>
            {user.steam_profile_url && (
              <a
                href={user.steam_profile_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 text-sm"
              >
                View Steam Profile →
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Statistics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-center">
            <div className="text-3xl font-bold text-blue-600">{user.stats.total_sent_count}</div>
            <div className="text-sm text-gray-600">Gifts Sent</div>
            <div className="text-xs text-gray-500">${user.stats.total_sent_value.toFixed(2)}</div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-center">
            <div className="text-3xl font-bold text-green-600">{user.stats.total_received_count}</div>
            <div className="text-sm text-gray-600">Gifts Received</div>
            <div className="text-xs text-gray-500">${user.stats.total_received_value.toFixed(2)}</div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-center">
            <div className={`text-3xl font-bold ${userType.color}`}>
              {user.stats.total_gift_difference > 0 ? '+' : ''}{user.stats.total_gift_difference}
            </div>
            <div className="text-sm text-gray-600">Gift Difference</div>
            <div className={`text-xs ${userType.color}`}>
              {user.stats.total_value_difference > 0 ? '+' : ''}${user.stats.total_value_difference.toFixed(2)}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-center">
            <div className="text-3xl font-bold text-purple-600">{userGiveaways.length}</div>
            <div className="text-sm text-gray-600">Total Giveaways</div>
            <div className="text-xs text-gray-500">Created</div>
          </div>
        </div>
      </div>

      {/* Steam Statistics */}
      {user.steam_id && user.giveaways_won && user.giveaways_won.some(g => g.steam_play_data) && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">🎮 Steam Activity</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">{getOwnedGames()}</div>
              <div className="text-sm text-gray-600">Games Owned</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{formatPlaytime(getTotalPlaytime())}</div>
              <div className="text-sm text-gray-600">Total Playtime</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-600">{getTotalAchievements()}</div>
              <div className="text-sm text-gray-600">Achievements</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{getNeverPlayedGames()}</div>
              <div className="text-sm text-gray-600">Never Played</div>
            </div>
          </div>
        </div>
      )}

      {/* Games Won */}
      {user.giveaways_won && user.giveaways_won.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            🏆 Games Won ({user.giveaways_won.length})
          </h2>
          <div className="space-y-4">
            {user.giveaways_won.map((game, index) => (
              <div key={index} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900">{game.name}</h3>
                    <div className="flex items-center mt-1 space-x-4">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getCVBadgeColor(game.cv_status)}`}>
                        {getCVLabel(game.cv_status)}
                      </span>
                      <span className="text-sm text-gray-600">
                        Won {formatRelativeTime(game.end_timestamp)}
                      </span>
                      <span className={`text-sm font-medium ${
                        game.status === 'received' ? 'text-green-600' : 'text-orange-600'
                      }`}>
                        {game.status === 'received' ? 'Activated' : 'Not Activated'}
                      </span>
                    </div>
                  </div>
                  <a
                    href={`https://www.steamgifts.com/giveaway/${game.link}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 text-sm"
                  >
                    View →
                  </a>
                </div>
                
                {game.steam_play_data && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">Owned:</span>
                        <span className={`ml-1 font-medium ${game.steam_play_data.owned ? 'text-green-600' : 'text-red-600'}`}>
                          {game.steam_play_data.owned ? 'Yes' : 'No'}
                        </span>
                      </div>
                      {game.steam_play_data.owned && (
                        <>
                          <div>
                            <span className="text-gray-600">Playtime:</span>
                            <span className="ml-1 font-medium">
                              {formatPlaytime(game.steam_play_data.playtime_minutes)}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-600">Achievements:</span>
                            <span className="ml-1 font-medium">
                              {game.steam_play_data.achievements_unlocked}/{game.steam_play_data.achievements_total}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-600">Status:</span>
                            <span className={`ml-1 font-medium ${
                              game.steam_play_data.never_played ? 'text-red-600' : 'text-green-600'
                            }`}>
                              {game.steam_play_data.never_played ? 'Never Played' : 'Played'}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Giveaways Created */}
      {userGiveaways.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            🎁 Giveaways Created ({userGiveaways.length})
          </h2>
          <div className="space-y-4">
            {userGiveaways.map((giveaway) => {
              const status = getGiveawayStatus(giveaway.end_timestamp)
              
              return (
                <div key={giveaway.id} className={`border ${status.borderColor} rounded-lg overflow-hidden ${status.backgroundColor} ${status.isActive ? 'shadow-md' : 'shadow'}`}>
                  <div className="flex">
                    {/* Game Image */}
                    {giveaway.app_id && (
                      <div className="w-32 h-24 bg-gray-200 flex-shrink-0 overflow-hidden">
                        <img
                          src={`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${giveaway.app_id}/header.jpg`}
                          alt={giveaway.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    
                    <div className="p-4 flex-1">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-gray-900">{giveaway.name}</h3>
                            <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${status.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                              {status.statusIcon} {status.statusText}
                            </span>
                          </div>
                          <div className="flex items-center mt-1 space-x-4">
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getCVBadgeColor(giveaway.cv_status || 'FULL_CV')}`}>
                              {getCVLabel(giveaway.cv_status || 'FULL_CV')}
                            </span>
                            <span className="text-sm text-gray-600">
                              {giveaway.points} points
                            </span>
                            <span className="text-sm text-gray-600">
                              {giveaway.copies} {giveaway.copies === 1 ? 'copy' : 'copies'}
                            </span>
                            <span className="text-sm text-gray-600">
                              {giveaway.entry_count} entries
                            </span>
                            <span className={`text-sm font-medium ${status.statusColor}`}>
                              {formatRelativeTime(giveaway.end_timestamp)}
                            </span>
                          </div>
                        </div>
                        <a
                          href={`https://www.steamgifts.com/giveaway/${giveaway.link}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          View →
                        </a>
                      </div>
                    </div>
                  </div>
                
                {giveaway.winners && giveaway.winners.length > 0 && (
                  <div className="px-4 pb-4">
                    <div className="pt-3 border-t border-gray-200">
                      <div className="text-sm">
                        <span className="text-gray-600">Winners:</span>
                        <div className="mt-1">
                          {giveaway.winners.map((winner, index) => (
                            <Link
                              key={index}
                              href={`/users/${winner.name}`}
                              className="text-blue-600 hover:text-blue-800 mr-2"
                            >
                              {winner.name}
                            </Link>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
} 