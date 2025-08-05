'use client'

import { useState, useMemo } from 'react'
import { formatPlaytime } from '@/lib/data'
import { User } from '@/types'
import Link from 'next/link'
import Image from 'next/image'
import FormattedDate from '@/components/FormattedDate'
import { LastUpdated } from '@/components/LastUpdated'
import { getUnplayedGamesStats, UnplayedGamesStats } from '@/components/UnplayedGamesStats'

interface Props {
  users: User[]
  lastUpdated?: number | null
}

export default function UsersClient({ users, lastUpdated }: Props) {
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'username' | 'sent' | 'received' | 'difference' | 'value' | 'playtime' | 'ratio' | 'last_created' | 'last_won' | 'play_rate'>('difference')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [filterTags, setFilterTags] = useState({
    warnings: false,
    contributors: false,
    receivers: false,
    neutral: false,
  });
  const [showOnlySteam] = useState(false)

  const handleToggleTag = (tag: keyof typeof filterTags) => {
    setFilterTags(prev => ({
      ...prev,
      [tag]: !prev[tag],
    }));
  };

  const getTotalPlaytime = (user: User) => {
    if (!user.giveaways_won) return 0
    return user.giveaways_won.reduce((total, game) => {
      return total + (game.steam_play_data?.playtime_minutes || 0)
    }, 0)
  }

  const filteredAndSortedUsers = useMemo(() => {
    const filtered = users.filter(user => {
      const matchesSearch = user.username.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesSteam = !showOnlySteam || user.steam_id

      const activeFilterKeys = (Object.keys(filterTags) as Array<keyof typeof filterTags>).filter(
        key => filterTags[key]
      );

      if (activeFilterKeys.length === 0) {
        return matchesSearch && matchesSteam;
      }

      const ratio = user.stats.giveaway_ratio ?? 0;
      const userFlags = {
        warnings: (user.warnings?.length ?? 0) > 0,
        contributors: ratio > 0,
        receivers: ratio < -1,
        neutral: ratio <= 0 && ratio >= -1,
      };

      const matchesTags = activeFilterKeys.some(key => userFlags[key]);

      return matchesSearch && matchesSteam && matchesTags
    })

    filtered.sort((a, b) => {
      let comparison = 0
      switch (sortBy) {
        case 'username':
          comparison = a.username.localeCompare(b.username)
          break
        case 'sent':
          comparison = b.stats.real_total_sent_count - a.stats.real_total_sent_count
          break
        case 'received':
          comparison = b.stats.real_total_received_count - a.stats.real_total_received_count
          break
        case 'difference':
          comparison = b.stats.real_total_gift_difference - a.stats.real_total_gift_difference
          break
        case 'value':
          comparison = b.stats.real_total_value_difference - a.stats.real_total_value_difference
          break
        case 'playtime':
          comparison = getTotalPlaytime(b) - getTotalPlaytime(a)
          break
        case 'ratio':
          comparison = (b.stats.giveaway_ratio ?? 0) - (a.stats.giveaway_ratio ?? 0)
          break
        case 'last_created': {
          const timeA = a.stats.last_giveaway_created_at || 0
          const timeB = b.stats.last_giveaway_created_at || 0
          comparison = timeB - timeA
          break
        }
        case 'last_won': {
          const timeA = a.stats.last_giveaway_won_at || 0
          const timeB = b.stats.last_giveaway_won_at || 0
          comparison = timeB - timeA
          break
        }
        case 'play_rate': {
          const statsA = getUnplayedGamesStats(a)
          const statsB = getUnplayedGamesStats(b)
          comparison = statsB.percentage - statsA.percentage
          break
        }
      }
      return sortDirection === 'asc' ? -comparison : comparison
    })

    return filtered
  }, [users, searchTerm, sortBy, filterTags, showOnlySteam, sortDirection])

  const getUserTypeBadge = (user: User) => {
    const ratio = user.stats.giveaway_ratio ?? 0
    if (ratio > 0) {
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-success-light text-success-foreground">Net Contributor</span>
    } else if (ratio < -1) {
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-error-light text-error-foreground">Net Receiver</span>
    } else {
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-info-light text-info-foreground">Neutral</span>
    }
  }

  const getTotalAchievements = (user: User) => {
    if (!user.giveaways_won) return 0
    return user.giveaways_won.reduce((total, game) => {
      return total + (game.steam_play_data?.achievements_unlocked || 0)
    }, 0)
  }

  const getNoEntryGiveaways = (user: User) => {
    if (!user.giveaways_created) return 0
    return user.giveaways_created.filter(g => g.entries === 0 && g.end_timestamp < Date.now() / 1000).length
  }

  const getRecentWins = (user: User) => {
    if (!user.giveaways_won) return 0
    const twoWeeksAgo = Date.now() / 1000 - (14 * 24 * 60 * 60)
    return user.giveaways_won.filter(g => g.end_timestamp > twoWeeksAgo).length
  }

  return (
    <div className="space-y-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Users</h1>
        {lastUpdated && (
          <LastUpdated lastUpdatedDate={lastUpdated} />
        )}
      </div>
      {/* Filter Controls */}
      <div className="bg-card-background rounded-lg border-card-border border p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Search
            </label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search usernames..."
              className="w-full px-3 py-2 border border-card-border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Sort by
            </label>
            <div className="flex gap-2">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'username' | 'sent' | 'received' | 'difference' | 'value' | 'playtime' | 'ratio' | 'last_created' | 'last_won' | 'play_rate')}
                className="w-full px-3 py-2 border border-card-border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="ratio">Giveaway Ratio</option>
                <option value="play_rate">Play Rate</option>
                <option value="difference">Gift Difference</option>
                <option value="value">Value Difference</option>
                <option value="sent">Gifts Sent</option>
                <option value="received">Gifts Received</option>
                <option value="playtime">Total Playtime</option>
                <option value="username">Username</option>
                <option value="last_created">Last GA Created</option>
                <option value="last_won">Last GA Won</option>
              </select>
              <button
                onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
                className="px-3 py-2 border border-card-border rounded-md bg-transparent hover:bg-accent/10 focus:outline-none focus:ring-2 focus:ring-accent"
                title={`Sort ${sortDirection === 'asc' ? 'Ascending' : 'Descending'}`}
              >
                {sortDirection === 'asc' ? '↑' : '↓'}
              </button>
            </div>
          </div>

          <div className="lg:col-span-4 mt-4">
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => handleToggleTag('warnings')}
                className={`px-3 py-2 text-sm rounded-full transition-colors ${filterTags.warnings
                  ? 'bg-error-light text-error-foreground'
                  : 'bg-transparent border border-card-border hover:bg-accent/10'
                  }`}
              >
                ⚠️ Needs attention
              </button>
              <button
                onClick={() => handleToggleTag('contributors')}
                className={`px-3 py-2 text-sm rounded-full transition-colors ${filterTags.contributors
                  ? 'bg-success-light text-success-foreground'
                  : 'bg-transparent border border-card-border hover:bg-accent/10'
                  }`}
              >
                💰 Net Contributor
              </button>
              <button
                onClick={() => handleToggleTag('receivers')}
                className={`px-3 py-2 text-sm rounded-full transition-colors ${filterTags.receivers
                  ? 'bg-error-light text-error-foreground'
                  : 'bg-transparent border border-card-border hover:bg-accent/10'
                  }`}
              >
                💸 Net Receiver
              </button>
              <button
                onClick={() => handleToggleTag('neutral')}
                className={`px-3 py-2 text-sm rounded-full transition-colors ${filterTags.neutral
                  ? 'bg-info-light text-info-foreground'
                  : 'bg-transparent border border-card-border hover:bg-accent/10'
                  }`}
              >
                ⚖️ Neutral
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Results Summary */}
      <div className="text-sm text-muted-foreground">
        Showing {filteredAndSortedUsers.length} of {users.length} members
      </div>
      <div className="text-sm text-muted-foreground italic">
        * The user ratio is based on full CV 1:3 without counting games that had proof of play.
      </div>

      {/* Users Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredAndSortedUsers.map((user) => {
          const borderColor = user.warnings?.length ? 'border-error' : 'border-card-border'
          return (
            <div key={user.username} className={`bg-card-background rounded-lg border-card-border border hover:shadow-lg transition-all duration-200 p-6 ${borderColor}`}>
              <div className="flex items-center mb-4">
                {user.avatar_url ? (
                  <Image
                    src={user.avatar_url}
                    alt={user.username}
                    width={48}
                    height={48}
                    className="rounded-full border-2 border-card-border"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full border-2 border-card-border bg-gradient-to-br from-accent-blue/20 to-accent-purple/20 flex items-center justify-center">
                    <span className="text-xl">👤</span>
                  </div>
                )}
                <div className="ml-4 flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">
                      <Link
                        href={`/users/${user.username}`}
                        className="hover:text-accent transition-colors"
                      >
                        {user.username}
                      </Link>
                    </h3>
                    <div className="flex items-center space-x-2">
                      {user.steam_id && !user.steam_profile_is_private && (
                        <span className="text-lg text-muted-foreground" title="Steam Account Connected">🎮</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-1">
                    {getUserTypeBadge(user)}
                    {user.warnings?.length && (
                      <span className="inline-flex items-center ml-2 px-2.5 py-0.5 rounded-full text-xs font-medium bg-error-light text-error-foreground">Warnings</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-success-foreground">{user.stats.real_total_sent_count}</div>
                    <div className="text-xs text-muted-foreground">Gifts Sent</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-info-foreground">{user.stats.real_total_received_count}</div>
                    <div className="text-xs text-muted-foreground">Gifts Received</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center">
                    <div className={`text-lg font-medium ${user.stats.real_total_gift_difference > 0 ? 'text-success-foreground' :
                      user.stats.real_total_gift_difference < 0 ? 'text-error-foreground' :
                        'text-muted-foreground'
                      }`}>
                      {user.stats.real_total_gift_difference > 0 ? '+' : ''}{user.stats.real_total_gift_difference}
                    </div>
                    <div className="text-xs text-muted-foreground">Gift Difference</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-lg font-medium ${user.stats.real_total_value_difference > 0 ? 'text-success-foreground' :
                      user.stats.real_total_value_difference < 0 ? 'text-error-foreground' :
                        'text-muted-foreground'
                      }`}>
                      {user.stats.real_total_value_difference > 0 ? '+' : ''}${user.stats.real_total_value_difference}
                    </div>
                    <div className="text-xs text-muted-foreground">Value Difference</div>
                  </div>
                </div>

                <div className="pt-3 border-t border-card-border">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center">
                      <div className="text-sm font-medium">
                        {user.stats.last_giveaway_created_at ? <FormattedDate timestamp={user.stats.last_giveaway_created_at} /> : 'Never'}
                      </div>
                      <div className="text-xs text-muted-foreground">Last GA Created</div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-medium">
                        {user.stats.last_giveaway_won_at ? <FormattedDate timestamp={user.stats.last_giveaway_won_at} /> : 'Never'}
                      </div>
                      <div className="text-xs text-muted-foreground">Last GA Won</div>
                    </div>
                  </div>
                </div>

                <div className="text-center pt-3 border-t border-card-border">
                  <div className={`text-lg font-medium ${(user.stats.giveaway_ratio ?? 0) > 0 ? 'text-success-foreground' :
                    (user.stats.giveaway_ratio ?? 0) < -1 ? 'text-error-foreground' :
                      'text-muted-foreground'
                    }`}>
                    {(user.stats.giveaway_ratio ?? 0).toFixed(2)}
                  </div>
                  <div className="text-xs text-muted-foreground">Giveaway Ratio</div>
                </div>

                {user.steam_id && !user.steam_profile_is_private && user.giveaways_won && user.giveaways_won.length > 0 && (
                  <div className="pt-3 border-t border-card-border">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="text-center">
                        <div className="text-sm font-medium text-accent-purple">
                          {getTotalPlaytime(user) === 0 && getTotalAchievements(user) > 0
                            ? 'Unavailable'
                            : formatPlaytime(getTotalPlaytime(user))}
                        </div>
                        <div className="text-xs text-muted-foreground">Total Playtime</div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-medium text-accent-yellow">{getTotalAchievements(user)}</div>
                        <div className="text-xs text-muted-foreground">Achievements</div>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-4">
                      <div className="text-center">
                        <div className="text-sm font-medium text-accent-orange">{getNoEntryGiveaways(user)}</div>
                        <div className="text-xs text-muted-foreground">No-Entry GAs</div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-medium text-accent-green">{getRecentWins(user)}</div>
                        <div className="text-xs text-muted-foreground">Recent Wins</div>
                      </div>
                      <UnplayedGamesStats user={user} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Empty State */}
      {filteredAndSortedUsers.length === 0 && (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">👥</div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No members found</h3>
          <p className="text-gray-600">Try adjusting your search or filter criteria</p>
        </div>
      )}
    </div>
  )
}