'use client'

import { useState, useMemo } from 'react'
import { formatDate, getCVBadgeColor, getCVLabel } from '@/lib/data'
import { Giveaway } from '@/types'
import Link from 'next/link'

interface Props {
  giveaways: Giveaway[]
}

export default function GiveawaysClient({ giveaways }: Props) {
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'date' | 'entries' | 'points'>('date')
  const [filterCV, setFilterCV] = useState<'all' | 'FULL_CV' | 'REDUCED_CV' | 'NO_CV'>('all')
  const [showOnlyEnded, setShowOnlyEnded] = useState(false)

  const filteredAndSortedGiveaways = useMemo(() => {
    const filtered = giveaways.filter(giveaway => {
      const matchesSearch = giveaway.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           giveaway.creator.username.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesCV = filterCV === 'all' || giveaway.cv_status === filterCV
      const matchesEnded = !showOnlyEnded || giveaway.end_timestamp < Date.now() / 1000
      
      return matchesSearch && matchesCV && matchesEnded
    })

    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'date':
          return b.end_timestamp - a.end_timestamp
        case 'entries':
          return b.entry_count - a.entry_count
        case 'points':
          return b.points - a.points
        default:
          return 0
      }
    })

    return filtered
  }, [giveaways, searchTerm, sortBy, filterCV, showOnlyEnded])

  const getStatusBadge = (giveaway: Giveaway) => {
    const now = Date.now() / 1000
    const isEnded = giveaway.end_timestamp < now
    const hasWinners = giveaway.winners && giveaway.winners.length > 0
    
    if (!isEnded) {
      return <span className="px-2 py-1 text-xs font-semibold bg-blue-100 text-blue-800 rounded-full">Active</span>
    }
    
    if (hasWinners) {
      return <span className="px-2 py-1 text-xs font-semibold bg-green-100 text-green-800 rounded-full">Completed</span>
    }
    
    return <span className="px-2 py-1 text-xs font-semibold bg-red-100 text-red-800 rounded-full">No Winners</span>
  }

  return (
    <div className="px-4 sm:px-0">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">All Giveaways</h1>
        <p className="mt-2 text-sm text-gray-600">
          {giveaways.length} total giveaways • {filteredAndSortedGiveaways.length} shown
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
              placeholder="Search games or creators..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Sort by
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'date' | 'entries' | 'points')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="date">End Date</option>
              <option value="entries">Entry Count</option>
              <option value="points">Points</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              CV Status
            </label>
            <select
              value={filterCV}
              onChange={(e) => setFilterCV(e.target.value as 'all' | 'FULL_CV' | 'REDUCED_CV' | 'NO_CV')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All CV Types</option>
              <option value="FULL_CV">Full CV</option>
              <option value="REDUCED_CV">Reduced CV</option>
              <option value="NO_CV">No CV</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Filter
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={showOnlyEnded}
                onChange={(e) => setShowOnlyEnded(e.target.checked)}
                className="mr-2"
              />
              <span className="text-sm text-gray-700">Only ended giveaways</span>
            </label>
          </div>
        </div>
      </div>

      {/* Giveaways List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredAndSortedGiveaways.map((giveaway) => (
          <div key={giveaway.id} className="bg-white rounded-lg shadow hover:shadow-md transition-shadow">
            <div className="p-6">
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-lg font-semibold text-gray-900 line-clamp-2 flex-1">
                  {giveaway.name}
                </h3>
                <div className="ml-2 flex-shrink-0">
                  {getStatusBadge(giveaway)}
                </div>
              </div>
              
              <div className="space-y-2 mb-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Creator:</span>
                  <Link
                    href={`/users/${giveaway.creator.username}`}
                    className="text-blue-600 hover:text-blue-800 font-medium"
                  >
                    {giveaway.creator.username}
                  </Link>
                </div>
                
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Points:</span>
                  <span className="font-medium">{giveaway.points}</span>
                </div>
                
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Entries:</span>
                  <span className="font-medium">{giveaway.entry_count}</span>
                </div>
                
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">End Date:</span>
                  <span className="font-medium">{formatDate(giveaway.end_timestamp)}</span>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getCVBadgeColor(giveaway.cv_status || 'FULL_CV')}`}>
                  {getCVLabel(giveaway.cv_status || 'FULL_CV')}
                </span>
                
                <a
                  href={`https://www.steamgifts.com/giveaway/${giveaway.link}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                >
                  View on SG →
                </a>
              </div>
              
              {giveaway.winners && giveaway.winners.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="text-sm text-gray-600">
                    <span className="font-medium">Winners:</span>
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
              )}
            </div>
          </div>
        ))}
      </div>
      
      {filteredAndSortedGiveaways.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">No giveaways found matching your filters.</p>
        </div>
      )}
    </div>
  )
} 