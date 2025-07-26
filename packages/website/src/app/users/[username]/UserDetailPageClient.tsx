'use client'

import { formatPlaytime } from '@/lib/data'
import Image from 'next/image'
import UserGiveawaysClient from './UserGiveawaysClient'
import WonGiveawaysClient from './WonGiveawaysClient'
import { useState } from 'react'
import type { User, UserGroupData, UserEntry } from '@/types'
import type { Giveaway, GameData } from '@/types'
import FormattedDate from '@/components/FormattedDate'
import GiveawaysClient from '@/app/giveaways/client'
import CountryFlag from '@/components/CountryFlag'

interface Props {
  user: User
  allUsers: UserGroupData | null
  giveaways: Giveaway[]
  gameData: GameData[]
  userEntries: UserEntry | null
}

export default function UserDetailPageClient({ user, allUsers, giveaways, gameData, userEntries }: Props) {
  const [showDetailedStats, setShowDetailedStats] = useState(false)

  // Get giveaways created by this user from the main giveaways data
  const userGiveaways = giveaways.filter(g => g.creator.username === user.username)
  const enteredGiveawayData = userEntries?.[user.username] || []
  const enteredGiveaways = enteredGiveawayData.map(g => giveaways.find(ga => ga.link === g.link)).filter(g => g !== undefined)
  const lastEnteredGiveaway = enteredGiveawayData.sort((a, b) => b.joined_at - a.joined_at)[0]

  // Create a map of usernames to avatar URLs
  const userAvatars = new Map(
    Object.values(allUsers?.users || {}).map((user) => [
      user.username,
      user.avatar_url,
    ])
  )

  const getUserTypeIcon = () => {
    const ratio = user.stats.giveaway_ratio ?? 0
    if (ratio > 0) {
      return { icon: '📈', label: 'Net Contributor', color: 'text-success-foreground' }
    } else if (ratio < -1) {
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

  const createdGiveaways = user.giveaways_created ? Object.values(user.giveaways_created).length : 0
  const ongoingGiveaways = user.giveaways_created ? Object.values(user.giveaways_created).filter(ga => ga.end_timestamp > Date.now() / 1000).length : 0

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
              <a
                href={`https://www.steamgifts.com/user/${user.username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-3xl font-bold text-accent hover:underline text-sm"
              >
                <h1 className="text-3xl font-bold">
                  {user.username}
                </h1>
              </a>
              <CountryFlag countryCode={user.country_code} />
            </div>
            <p className={`text-lg font-medium ${userType.color}`}>
              {userType.label} ({user.stats.giveaway_ratio ? user.stats.giveaway_ratio.toFixed(2) : 0})
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
            <div className="mt-4 text-sm text-muted-foreground space-y-1">
              {user.stats.last_giveaway_created_at && (
                <div>Last giveaway created: <span className="text-foreground">
                  <FormattedDate timestamp={user.stats.last_giveaway_created_at} />
                </span></div>
              )}
              {user.stats.last_giveaway_won_at && (
                <div>Last giveaway won: <span className="text-foreground">
                  <FormattedDate timestamp={user.stats.last_giveaway_won_at} />
                </span></div>
              )}
              {lastEnteredGiveaway && (
                <div>Last giveaway entered: <span className="text-foreground">
                  <span className="font-bold">{giveaways.find(g => g.link === lastEnteredGiveaway.link)?.name}</span> <FormattedDate timestamp={lastEnteredGiveaway.joined_at} />
                </span></div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Statistics Grid */}
      <div className="space-y-4 mb-6">
        {/* Real Totals */}
        <div className="bg-card-background rounded-lg border-card-border border p-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold">Real Totals</h3>
            <button
              onClick={() => setShowDetailedStats(!showDetailedStats)}
              className="text-xs text-accent hover:text-accent-hover transition-colors"
            >
              {showDetailedStats ? 'Show Less' : 'Show Breakdown'} {showDetailedStats ? '↑' : '↓'}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center">
              <div className="text-xl font-bold text-info-foreground">{user.stats.real_total_sent_count}</div>
              <div className="text-xs text-muted-foreground">Sent</div>
              <div className="text-xs text-muted-foreground">${user.stats.real_total_sent_value.toFixed(2)}</div>
            </div>

            <div className="text-center">
              <div className="text-xl font-bold text-success-foreground">{user.stats.real_total_received_count}</div>
              <div className="text-xs text-muted-foreground">Received</div>
              <div className="text-xs text-muted-foreground">${user.stats.real_total_received_value.toFixed(2)}</div>
            </div>

            <div className="text-center">
              <div className={`text-xl font-bold ${userType.color}`}>
                {user.stats.real_total_gift_difference > 0 ? '+' : ''}{user.stats.real_total_gift_difference}
              </div>
              <div className="text-xs text-muted-foreground">Difference</div>
              <div className={`text-xs ${userType.color}`}>
                {user.stats.real_total_value_difference > 0 ? '+' : ''}${user.stats.real_total_value_difference.toFixed(2)}
              </div>
            </div>
          </div>
        </div>

        {/* Detailed Stats (conditionally rendered) */}
        {showDetailedStats && (
          <>
            {/* Original SteamGifts Stats */}
            <div className="bg-card-background rounded-lg border-card-border border p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center">
                <span>Original Stats</span>
                <span className="text-xs text-muted-foreground ml-2">(including  reduced, shared, etc.)</span>
              </h3>
              <div className="grid grid-cols-4 gap-2">
                <div className="text-center col-span-1">
                  <div className="text-xl font-bold text-accent-blue">
                    {createdGiveaways}
                  </div>
                  <div className="text-xs text-muted-foreground">Created GAs</div>
                  <div className="text-xs text-muted-foreground">{ongoingGiveaways} ongoing</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-info-foreground">{user.stats.total_sent_count}</div>
                  <div className="text-xs text-muted-foreground">Sent</div>
                  <div className="text-xs text-muted-foreground">${user.stats.total_sent_value.toFixed(2)}</div>
                </div>

                <div className="text-center">
                  <div className="text-xl font-bold text-success-foreground">{user.stats.total_received_count}</div>
                  <div className="text-xs text-muted-foreground">Received</div>
                  <div className="text-xs text-muted-foreground">${user.stats.total_received_value.toFixed(2)}</div>
                </div>

                <div className="text-center">
                  <div className={`text-xl font-bold ${userType.color}`}>
                    {user.stats.total_gift_difference > 0 ? '+' : ''}{user.stats.total_gift_difference}
                  </div>
                  <div className="text-xs text-muted-foreground">Difference</div>
                  <div className={`text-xs ${userType.color}`}>
                    {user.stats.total_value_difference > 0 ? '+' : ''}${user.stats.total_value_difference.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>

            {/* CV Breakdown and Shared Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Full CV */}
              <div className="bg-card-background rounded-lg border-card-border border p-4">
                <h3 className="text-sm font-semibold mb-3 text-accent-green">Full CV</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-xs text-muted-foreground">Sent:</span>
                    <span className="text-sm font-medium">{user.stats.fcv_sent_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-muted-foreground">Received:</span>
                    <span className="text-sm font-medium">{user.stats.fcv_received_count}</span>
                  </div>
                </div>
              </div>

              {/* Reduced CV */}
              <div className="bg-card-background rounded-lg border-card-border border p-4">
                <h3 className="text-sm font-semibold mb-3 text-accent-yellow">Reduced CV</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-xs text-muted-foreground">Sent:</span>
                    <span className="text-sm font-medium">{user.stats.rcv_sent_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-muted-foreground">Received:</span>
                    <span className="text-sm font-medium">{user.stats.rcv_received_count}</span>
                  </div>
                </div>
              </div>

              {/* No CV */}
              <div className="bg-card-background rounded-lg border-card-border border p-4">
                <h3 className="text-sm font-semibold mb-3 text-accent-orange">No CV</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-xs text-muted-foreground">Sent:</span>
                    <span className="text-sm font-medium">{user.stats.ncv_sent_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-muted-foreground">Received:</span>
                    <span className="text-sm font-medium">{user.stats.ncv_received_count}</span>
                  </div>
                </div>
              </div>

              {/* Shared */}
              <div className="bg-card-background rounded-lg border-card-border border p-4">
                <h3 className="text-sm font-semibold mb-3 text-accent-purple">Shared</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-xs text-muted-foreground">Created:</span>
                    <span className="text-sm font-medium">{user.stats.shared_sent_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-muted-foreground">Won:</span>
                    <span className="text-sm font-medium">{user.stats.shared_received_count}</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
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

      <GiveawaysClient
        heading="🎟️ Giveaways Entered"
        giveaways={enteredGiveaways}
        userAvatars={userAvatars}
        gameData={gameData}
        lastUpdated={null}
        defaultGiveawayStatus="all"
      />
    </div>
  )
}