'use client'

import { useState, useMemo } from 'react'
import { formatPlaytime } from '@/lib/data'
import { User } from '@/types'
import Link from 'next/link'

interface Props {
  users: User[]
}

export default function UsersClient({ users }: Props) {
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'username' | 'sent' | 'received' | 'difference' | 'value'>('difference')
  const [filterType, setFilterType] = useState<'all' | 'contributors' | 'receivers' | 'neutral'>('all')
  const [showOnlySteam, setShowOnlySteam] = useState(false)

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
      switch (sortBy) {
        case 'username':
          return a.username.localeCompare(b.username)
        case 'sent':
          return b.stats.total_sent_count - a.stats.total_sent_count
        case 'received':
          return b.stats.total_received_count - a.stats.total_received_count
        case 'difference':
          return b.stats.total_gift_difference - a.stats.total_gift_difference
        case 'value':
          return b.stats.total_value_difference - a.stats.total_value_difference
        default:
          return 0
      }
    })

    return filtered
  }, [users, searchTerm, sortBy, filterType, showOnlySteam])

  const getUserTypeIcon = (user: User) => {
    if (user.stats.total_gift_difference > 0) {
      return '📈' // Net contributor
    } else if (user.stats.total_gift_difference < 0) {
      return '📉' // Net receiver
    } else {
      return '➖' // Neutral
    }
  }

  const getTotalPlaytime = (user: User) => {
    if (!user.giveaways_won) return 0
    return user.giveaways_won.reduce((total, game) => {
      return total + (game.steam_play_data?.playtime_minutes || 0)
    }, 0)
  }

  const getTotalAchievements = (user: User) => {
    if (!user.giveaways_won) return 0
    return user.giveaways_won.reduce((total, game) => {
      return total + (game.steam_play_data?.achievements_unlocked || 0)
    }, 0)
  }

  return (
    <div className="px-4 sm:px-0">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">All Users</h1>
        <p className="mt-2 text-sm text-gray-600">
          {users.length} total members • {filteredAndSortedUsers.length} shown
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
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
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Sort by
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'username' | 'sent' | 'received' | 'difference' | 'value')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="difference">Gift Difference</option>
              <option value="value">Value Difference</option>
              <option value="sent">Gifts Sent</option>
              <option value="received">Gifts Received</option>
              <option value="username">Username</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              User Type
            </label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as 'all' | 'contributors' | 'receivers' | 'neutral')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Users</option>
              <option value="contributors">Net Contributors</option>
              <option value="receivers">Net Receivers</option>
              <option value="neutral">Neutral Users</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Filter
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={showOnlySteam}
                onChange={(e) => setShowOnlySteam(e.target.checked)}
                className="mr-2"
              />
              <span className="text-sm text-gray-700">Only Steam users</span>
            </label>
          </div>
        </div>
      </div>

      {/* Users List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredAndSortedUsers.map((user) => (
          <div key={user.username} className="bg-white rounded-lg shadow hover:shadow-md transition-shadow">
            <div className="p-6">
              <div className="flex items-center mb-4">
                {user.avatar_url && (
                  <img
                    src={user.avatar_url}
                    alt={user.username}
                    className="w-12 h-12 rounded-full mr-3"
                  />
                )}
                <div className="flex-1">
                  <div className="flex items-center">
                    <h3 className="text-lg font-semibold text-gray-900">
                      <Link
                        href={`/users/${user.username}`}
                        className="hover:text-blue-600"
                      >
                        {user.username}
                      </Link>
                    </h3>
                    <span className="ml-2 text-lg">{getUserTypeIcon(user)}</span>
                    {user.steam_id && <span className="ml-1 text-lg">🎮</span>}
                  </div>
                </div>
              </div>
              
              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Gifts Sent:</span>
                  <span className="font-medium">{user.stats.total_sent_count}</span>
                </div>
                
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Gifts Received:</span>
                  <span className="font-medium">{user.stats.total_received_count}</span>
                </div>
                
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Gift Difference:</span>
                  <span className={`font-medium ${
                    user.stats.total_gift_difference > 0 ? 'text-green-600' :
                    user.stats.total_gift_difference < 0 ? 'text-red-600' : 'text-gray-600'
                  }`}>
                    {user.stats.total_gift_difference > 0 ? '+' : ''}{user.stats.total_gift_difference}
                  </span>
                </div>
                
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Value Difference:</span>
                  <span className={`font-medium ${
                    user.stats.total_value_difference > 0 ? 'text-green-600' :
                    user.stats.total_value_difference < 0 ? 'text-red-600' : 'text-gray-600'
                  }`}>
                    {user.stats.total_value_difference > 0 ? '+' : ''}${user.stats.total_value_difference.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Giveaway Activity */}
              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Giveaways Created:</span>
                  <span className="font-medium">{user.giveaways_created?.length || 0}</span>
                </div>
                
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Giveaways Won:</span>
                  <span className="font-medium">{user.giveaways_won?.length || 0}</span>
                </div>
              </div>

              {/* Steam Activity */}
              {user.steam_id && user.giveaways_won && user.giveaways_won.some(g => g.steam_play_data) && (
                <div className="pt-4 border-t border-gray-200">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Steam Activity</h4>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total Playtime:</span>
                      <span className="font-medium">{formatPlaytime(getTotalPlaytime(user))}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Achievements:</span>
                      <span className="font-medium">{getTotalAchievements(user)}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-gray-200">
                <Link
                  href={`/users/${user.username}`}
                  className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                >
                  View Details →
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {filteredAndSortedUsers.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">No users found matching your filters.</p>
        </div>
      )}
    </div>
  )
} 