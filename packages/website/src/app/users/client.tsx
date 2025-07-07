'use client'

import { useState, useMemo } from 'react'
import { formatPlaytime } from '@/lib/data'
import { User } from '@/types'
import Link from 'next/link'
import Image from 'next/image'

interface Props {
  users: User[]
}

export default function UsersClient({ users }: Props) {
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'username' | 'sent' | 'received' | 'difference' | 'value' | 'playtime'>('difference')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [filterType, setFilterType] = useState<'all' | 'contributors' | 'receivers' | 'neutral'>('all')
  const [showOnlySteam] = useState(false)

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
      
      let matchesType = true
      switch (filterType) {
        case 'contributors':
          matchesType = user.stats.total_gift_difference > 0
          break
        case 'receivers':
          matchesType = user.stats.total_gift_difference < 0
          break
        case 'neutral':
          matchesType = user.stats.total_gift_difference === 0
          break
      }
      
      return matchesSearch && matchesSteam && matchesType
    })

    filtered.sort((a, b) => {
      let comparison = 0
      switch (sortBy) {
        case 'username':
          comparison = a.username.localeCompare(b.username)
          break
        case 'sent':
          comparison = b.stats.total_sent_count - a.stats.total_sent_count
          break
        case 'received':
          comparison = b.stats.total_received_count - a.stats.total_received_count
          break
        case 'difference':
          comparison = b.stats.total_gift_difference - a.stats.total_gift_difference
          break
        case 'value':
          comparison = b.stats.total_value_difference - a.stats.total_value_difference
          break
        case 'playtime':
          comparison = getTotalPlaytime(b) - getTotalPlaytime(a)
          break
      }
      return sortDirection === 'asc' ? -comparison : comparison
    })

    return filtered
  }, [users, searchTerm, sortBy, filterType, showOnlySteam, sortDirection])

  const getUserTypeBadge = (user: User) => {
    if (user.stats.total_gift_difference > 0) {
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Net Contributor</span>
    } else if (user.stats.total_gift_difference < 0) {
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Net Receiver</span>
    } else {
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">Neutral</span>
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
      {/* Filter Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Search
          </label>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search usernames..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Sort by
          </label>
          <div className="flex gap-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'username' | 'sent' | 'received' | 'difference' | 'value' | 'playtime')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="difference">Gift Difference</option>
              <option value="value">Value Difference</option>
              <option value="sent">Gifts Sent</option>
              <option value="received">Gifts Received</option>
              <option value="playtime">Total Playtime</option>
              <option value="username">Username</option>
            </select>
            <button
              onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
              className="px-3 py-2 border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              title={`Sort ${sortDirection === 'asc' ? 'Ascending' : 'Descending'}`}
            >
              {sortDirection === 'asc' ? '↑' : '↓'}
            </button>
          </div>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            User Type
          </label>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as 'all' | 'contributors' | 'receivers' | 'neutral')}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="all">All Users</option>
            <option value="contributors">Net Contributors</option>
            <option value="receivers">Net Receivers</option>
            <option value="neutral">Neutral Users</option>
          </select>
        </div>
      </div>

      {/* Results Summary */}
      <div className="text-sm text-gray-600">
        Showing {filteredAndSortedUsers.length} of {users.length} members
      </div>

      {/* Users Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredAndSortedUsers.map((user) => (
          <div key={user.username} className="bg-white rounded-lg shadow-md hover:shadow-lg transition-all duration-200 p-6">
            <div className="flex items-center mb-4">
              {user.avatar_url ? (
                <Image
                  src={user.avatar_url}
                  alt={user.username}
                  width={48}
                  height={48}
                  className="rounded-full border-2 border-gray-200"
                />
              ) : (
                <div className="w-12 h-12 rounded-full border-2 border-gray-200 bg-gradient-to-br from-blue-100 to-purple-100 flex items-center justify-center">
                  <span className="text-xl">👤</span>
                </div>
              )}
              <div className="ml-4 flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">
                    <Link
                      href={`/users/${user.username}`}
                      className="hover:text-blue-600 transition-colors"
                    >
                      {user.username}
                    </Link>
                  </h3>
                  <div className="flex items-center space-x-2">
                    {user.steam_id && (
                      <span className="text-lg" title="Steam Account Connected">🎮</span>
                    )}
                  </div>
                </div>
                <div className="mt-1">
                  {getUserTypeBadge(user)}
                </div>
              </div>
            </div>
            
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{user.stats.total_sent_count}</div>
                  <div className="text-xs text-gray-500">Gifts Sent</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{user.stats.total_received_count}</div>
                  <div className="text-xs text-gray-500">Gifts Received</div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <div className={`text-lg font-medium ${
                    user.stats.total_gift_difference > 0 ? 'text-green-600' : 
                    user.stats.total_gift_difference < 0 ? 'text-red-600' : 
                    'text-gray-600'
                  }`}>
                    {user.stats.total_gift_difference > 0 ? '+' : ''}{user.stats.total_gift_difference}
                  </div>
                  <div className="text-xs text-gray-500">Gift Difference</div>
                </div>
                <div className="text-center">
                  <div className={`text-lg font-medium ${
                    user.stats.total_value_difference > 0 ? 'text-green-600' : 
                    user.stats.total_value_difference < 0 ? 'text-red-600' : 
                    'text-gray-600'
                  }`}>
                    {user.stats.total_value_difference > 0 ? '+' : ''}${user.stats.total_value_difference}
                  </div>
                  <div className="text-xs text-gray-500">Value Difference</div>
                </div>
              </div>

              {user.steam_id && (
                <div className="pt-3 border-t border-gray-200">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center">
                      <div className="text-sm font-medium text-purple-600">
                        {formatPlaytime(getTotalPlaytime(user))}
                      </div>
                      <div className="text-xs text-gray-500">Total Playtime</div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-medium text-orange-600">
                        {getTotalAchievements(user)}
                      </div>
                      <div className="text-xs text-gray-500">Achievements</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Quick Stats */}
              <div className="pt-3 border-t border-gray-200">
                <div className="flex flex-col space-y-2">
                  <div className="flex justify-between items-center">
                    <div className="text-xs text-gray-500">
                      {user.giveaways_won?.length || 0} games won ({getRecentWins(user)} last 14 days)
                    </div>
                    <Link
                      href={`/users/${user.username}`}
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                    >
                      View Details →
                    </Link>
                  </div>
                  <div className="text-xs text-gray-500">
                    {user.giveaways_created?.length || 0} giveaways created
                    {getNoEntryGiveaways(user) > 0 && ` (${getNoEntryGiveaways(user)} with no entries)`}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
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