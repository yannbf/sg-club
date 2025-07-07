'use client'

import { useState, useMemo } from 'react'
import { formatRelativeTime, getCVBadgeColor, getCVLabel, formatLastUpdated } from '@/lib/data'
import { Giveaway } from '@/types'
import Link from 'next/link'
import Image from 'next/image'
import UserAvatar from '@/components/UserAvatar'

interface Props {
  giveaways: Giveaway[]
  lastUpdated: string | null
  userAvatars: Map<string, string>
}

const PLACEHOLDER_IMAGE = 'https://steamplayercount.com/theme/img/placeholder.svg'

function getGameImageUrl(giveaway: Giveaway): string {
  if (giveaway.app_id) {
    return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${giveaway.app_id}/header.jpg`
  }
  if (giveaway.package_id) {
    return `https://shared.akamai.steamstatic.com/store_item_assets/steam/subs/${giveaway.package_id}/header.jpg`
  }
  return PLACEHOLDER_IMAGE
}

export default function GiveawaysClient({ giveaways, lastUpdated, userAvatars }: Props) {
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'date' | 'entries' | 'points'>('date')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [filterCV, setFilterCV] = useState<'all' | 'FULL_CV' | 'REDUCED_CV' | 'NO_CV'>('all')
  const [giveawayStatus, setGiveawayStatus] = useState<'open' | 'ended' | 'all'>('open')
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set())

  const filteredAndSortedGiveaways = useMemo(() => {
    const filtered = giveaways.filter(giveaway => {
      const matchesSearch = giveaway.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           giveaway.creator.username.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesCV = filterCV === 'all' || giveaway.cv_status === filterCV
      const now = Date.now() / 1000
      const isEnded = giveaway.end_timestamp < now
      const matchesStatus = giveawayStatus === 'all' || 
                          (giveawayStatus === 'open' && !isEnded) ||
                          (giveawayStatus === 'ended' && isEnded)
      
      return matchesSearch && matchesCV && matchesStatus
    })

    filtered.sort((a, b) => {
      const now = Date.now() / 1000
      const aIsEnded = a.end_timestamp < now
      const bIsEnded = b.end_timestamp < now

      // When showing all giveaways, group open first then ended
      if (giveawayStatus === 'all' && aIsEnded !== bIsEnded) {
        return aIsEnded ? 1 : -1
      }

      let comparison = 0
      switch (sortBy) {
        case 'date':
          // For ended giveaways, reverse the comparison to show most recently ended first
          if (giveawayStatus === 'all' && aIsEnded && bIsEnded) {
            comparison = b.end_timestamp - a.end_timestamp
          } else {
            comparison = a.end_timestamp - b.end_timestamp
          }
          break
        case 'entries':
          comparison = a.entry_count - b.entry_count
          break
        case 'points':
          comparison = a.points - b.points
          break
      }
      return sortDirection === 'asc' ? comparison : -comparison
    })

    return filtered
  }, [giveaways, searchTerm, sortBy, sortDirection, filterCV, giveawayStatus])

  const getStatusBadge = (giveaway: Giveaway) => {
    const now = Date.now() / 1000
    const isEnded = giveaway.end_timestamp < now
    const hasWinners = giveaway.winners && giveaway.winners.length > 0
    
    if (!isEnded) {
      return <span className="px-2 py-1 text-xs font-semibold bg-info-light text-info-foreground rounded-full">Active</span>
    }
    
    if (hasWinners) {
      return <span className="px-2 py-1 text-xs font-semibold bg-success-light text-success-foreground rounded-full">Completed</span>
    }
    
    return <span className="px-2 py-1 text-xs font-semibold bg-error-light text-error-foreground rounded-full">No Winners</span>
  }

  return (
    <div className="space-y-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">All Giveaways</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {giveaways.length} total giveaways • {filteredAndSortedGiveaways.length} shown
        </p>
        {lastUpdated && (
          <p className="mt-1 text-sm text-muted-foreground">
            Last updated: {formatLastUpdated(lastUpdated)}
          </p>
        )}
      </div>

      {/* Filters */}
      <div className="bg-card-background rounded-lg border-card-border border p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Search
            </label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search games or creators..."
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
                onChange={(e) => setSortBy(e.target.value as 'date' | 'entries' | 'points')}
                className="flex-1 px-3 py-2 border border-card-border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="date">End Date</option>
                <option value="entries">Entry Count</option>
                <option value="points">Points</option>
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
          
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              CV Status
            </label>
            <select
              value={filterCV}
              onChange={(e) => setFilterCV(e.target.value as 'all' | 'FULL_CV' | 'REDUCED_CV' | 'NO_CV')}
              className="w-full px-3 py-2 border border-card-border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="all">All CV Types</option>
              <option value="FULL_CV">Full CV</option>
              <option value="REDUCED_CV">Reduced CV</option>
              <option value="NO_CV">No CV</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Filter
            </label>
            <select
              value={giveawayStatus}
              onChange={(e) => setGiveawayStatus(e.target.value as 'open' | 'ended' | 'all')}
              className="w-full px-3 py-2 border border-card-border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="all">All Giveaways</option>
              <option value="open">Open Giveaways</option>
              <option value="ended">Ended Giveaways</option>
            </select>
          </div>
        </div>
      </div>

      {/* Giveaways List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredAndSortedGiveaways.map((giveaway) => {
          const isEnded = giveaway.end_timestamp < Date.now() / 1000;
          const imageUrl = failedImages.has(giveaway.id) ? PLACEHOLDER_IMAGE : getGameImageUrl(giveaway);
          const borderColor = isEnded ? 'border-card-border' : 'border-success';

          return (
            <div key={giveaway.id} className={`bg-card-background rounded-lg shadow-md hover:shadow-lg transition-shadow overflow-hidden border-2 ${borderColor}`}>
              {/* Game Image */}
              <div className="w-full h-48 bg-muted overflow-hidden relative">
                <Image
                  src={imageUrl}
                  alt={giveaway.name || 'Game giveaway image'}
                  fill
                  className="object-cover"
                  onError={() => {
                    setFailedImages(prev => new Set([...prev, giveaway.id]))
                  }}
                />
              </div>
              
              <div className="p-6">
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-lg font-semibold line-clamp-2 flex-1">
                    {giveaway.name}
                  </h3>
                  <div className="ml-2 flex-shrink-0">
                    {getStatusBadge(giveaway)}
                  </div>
                </div>
                
                <div className="space-y-2 mb-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Creator:</span>
                    <div className="flex items-center">
                      <UserAvatar
                        src={userAvatars.get(giveaway.creator.username) || 'https://cdn-icons-png.flaticon.com/512/9287/9287610.png'}
                        username={giveaway.creator.username}
                      />
                      <Link href={`/users/${giveaway.creator.username}`} className="text-sm text-muted-foreground hover:text-foreground">
                        {giveaway.creator.username}
                      </Link>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Points:</span>
                    <span className="font-medium">{giveaway.points}</span>
                  </div>
                  
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Copies:</span>
                    <span className="font-medium">{giveaway.copies}</span>
                  </div>
                  
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Entries:</span>
                    <span className="font-medium">{giveaway.entry_count}</span>
                  </div>
                  
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">End date:</span>
                    <span className="font-medium">{formatRelativeTime(giveaway.end_timestamp)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs font-bold px-2 py-1 rounded-full ${getCVBadgeColor(giveaway.cv_status || 'FULL_CV')}`}
                  >
                    {getCVLabel(giveaway.cv_status || 'FULL_CV')}
                  </span>
                  <a
                    href={`https://www.steamgifts.com/giveaway/${giveaway.link}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    View on SteamGifts
                  </a>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      
      {filteredAndSortedGiveaways.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">No giveaways found matching your filters.</p>
        </div>
      )}
    </div>
  )
} 