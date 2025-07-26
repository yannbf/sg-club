'use client'

import { useState, useMemo } from 'react'
import { getCVBadgeColor, getCVLabel } from '@/lib/data'
import { Giveaway, GameData } from '@/types'
import Link from 'next/link'
import Image from 'next/image'
import UserAvatar from '@/components/UserAvatar'
import { LastUpdated } from '@/components/LastUpdated'
import { useGameData } from '@/lib/hooks'
import FormattedDate, { TimeDifference } from '@/components/FormattedDate'

interface Props {
  heading?: string
  giveaways: Giveaway[]
  lastUpdated: string | null
  userAvatars: Map<string, string>
  gameData: GameData[]
  defaultGiveawayStatus?: 'open' | 'ended' | 'all'
}

const PLACEHOLDER_IMAGE = 'https://steamplayercount.com/theme/img/placeholder.svg'

export function getGameImageUrl(giveaway: Giveaway): string {
  if (giveaway.app_id) {
    return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${giveaway.app_id}/header.jpg`
  }
  if (giveaway.package_id) {
    return `https://shared.akamai.steamstatic.com/store_item_assets/steam/subs/${giveaway.package_id}/header.jpg`
  }
  return PLACEHOLDER_IMAGE
}

export function getStatusBadge(giveaway: Giveaway) {
  const now = Date.now() / 1000
  const isEnded = giveaway.end_timestamp < now
  const isFuture = giveaway.start_timestamp > now
  const hasWinners = giveaway.winners && giveaway.winners.length > 0

  if (isFuture) {
    return <span className="px-2 py-1 text-xs font-semibold bg-accent-purple text-white rounded-full">Not started</span>
  }

  if (!isEnded) {
    return <span className="px-2 py-1 text-xs font-semibold bg-info-light text-info-foreground rounded-full">Open</span>
  }

  if (hasWinners) {
    return <span className="px-2 py-1 text-xs font-semibold bg-success-light text-success-foreground rounded-full">Ended</span>
  }

  return <span className="px-2 py-1 text-xs font-semibold bg-error-light text-error-foreground rounded-full">No Winners</span>
}

export default function GiveawaysClient({ heading = 'All Giveaways', giveaways, lastUpdated, userAvatars, gameData, defaultGiveawayStatus = 'open' }: Props) {
  const { getGameData } = useGameData(gameData)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'date' | 'entries' | 'points'>('date')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [filterCV, setFilterCV] = useState<'all' | 'FULL_CV' | 'REDUCED_CV' | 'NO_CV'>('all')
  const [giveawayStatus, setGiveawayStatus] = useState<'open' | 'ended' | 'all'>(defaultGiveawayStatus)
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set())

  // Add new state variables for label filters
  const [filterRegion, setFilterRegion] = useState<boolean>(false)
  const [filterPlayRequired, setFilterPlayRequired] = useState<boolean>(false)
  const [filterShared, setFilterShared] = useState<boolean>(false)
  const [filterWhitelist, setFilterWhitelist] = useState<boolean>(false)

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

      // Add new label filters
      const matchesLabels = (
        (!filterRegion || giveaway.region_restricted) &&
        (!filterPlayRequired || giveaway.required_play) &&
        (!filterShared || giveaway.is_shared) &&
        (!filterWhitelist || giveaway.whitelist)
      )

      return matchesSearch && matchesCV && matchesStatus && matchesLabels
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
          const aStartInFuture = a.start_timestamp > now
          const bStartInFuture = b.start_timestamp > now

          // First compare if either start date is in the future
          if (sortDirection === 'asc' && aStartInFuture !== bStartInFuture) {
            return aStartInFuture ? -1 : 1
          }

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
  }, [giveaways, searchTerm, sortBy, sortDirection, filterCV, giveawayStatus,
    filterRegion, filterPlayRequired, filterShared, filterWhitelist])

  return (
    <div className="space-y-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">{heading}</h1>
        {lastUpdated && (
          <LastUpdated lastUpdatedDate={lastUpdated} />
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

        {/* Add new row for label filters */}
        <div className="lg:col-span-4 mt-4">
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setFilterRegion(prev => !prev)}
              className={`px-3 py-2 text-sm rounded-full transition-colors ${filterRegion
                ? 'bg-info-light text-info-foreground'
                : 'bg-transparent border border-card-border hover:bg-accent/10'
                }`}
            >
              🌍 Restricted
            </button>
            <button
              onClick={() => setFilterPlayRequired(prev => !prev)}
              className={`px-3 py-2 text-sm rounded-full transition-colors ${filterPlayRequired
                ? 'bg-warning-light text-warning-foreground'
                : 'bg-transparent border border-card-border hover:bg-accent/10'
                }`}
            >
              🎮 Play Required
            </button>
            <button
              onClick={() => setFilterShared(prev => !prev)}
              className={`px-3 py-2 text-sm rounded-full transition-colors ${filterShared
                ? 'bg-info-light text-info-foreground'
                : 'bg-transparent border border-card-border hover:bg-accent/10'
                }`}
            >
              👥 Shared
            </button>
            <button
              onClick={() => setFilterWhitelist(prev => !prev)}
              className={`px-3 py-2 text-sm rounded-full transition-colors ${filterWhitelist
                ? 'bg-info-light text-info-foreground'
                : 'bg-transparent border border-card-border hover:bg-accent/10'
                }`}
            >
              🩵 Whitelist
            </button>
          </div>
        </div>
      </div>

      {/* Giveaways List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredAndSortedGiveaways.map((giveaway) => {
          const isEnded = giveaway.end_timestamp < Date.now() / 1000;
          const imageUrl = failedImages.has(giveaway.id) ? PLACEHOLDER_IMAGE : getGameImageUrl(giveaway);
          const isFuture = giveaway.start_timestamp > Date.now() / 1000;
          const borderColor = isEnded ? 'border-card-border' : isFuture ? 'border-accent-purple' : 'border-success';
          const gameData = getGameData(giveaway.app_id ?? giveaway.package_id)

          return (
            <div key={giveaway.id} className={`bg-card-background rounded-lg shadow-md hover:shadow-lg transition-shadow overflow-hidden border-2 ${borderColor}`}>
              {/* Game Image */}
              <div className="w-full h-48 bg-muted overflow-hidden relative hover:shadow">
                <a href={`https://store.steampowered.com/${giveaway.app_id ? `app/${giveaway.app_id}` : `sub/${giveaway.package_id}`}`} target="_blank" rel="noopener noreferrer">
                  <Image
                    src={imageUrl}
                    alt={giveaway.name || 'Game giveaway image'}
                    fill
                    className="object-cover cursor-pointer"
                    onError={() => {
                      setFailedImages(prev => new Set([...prev, giveaway.id]))
                    }}
                  />
                </a>
              </div>

              <div className="p-6">
                <div className="flex items-start justify-between mb-3">
                  <a
                    href={`https://www.steamgifts.com/giveaway/${giveaway.link}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline text-lg font-semibold line-clamp-2 flex-1"
                  >{giveaway.name} ({giveaway.points}P)</a>
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
                      <Link href={`/users/${giveaway.creator.username}`} className="text-accent hover:underline mr-2 inline-flex items-center">
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
                    <span className="text-muted-foreground">Start date:</span>
                    <FormattedDate timestamp={giveaway.start_timestamp} className="font-medium" />
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">End date:</span>
                    <FormattedDate timestamp={giveaway.end_timestamp} className="font-medium" />
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">GA duration:</span>
                    <TimeDifference startTimestamp={giveaway.start_timestamp} endTimestamp={giveaway.end_timestamp} className="font-medium" />
                  </div>

                  {gameData && 'hltb_main_story_hours' in gameData && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">How long to beat:</span>
                      <span className="font-medium">{gameData?.hltb_main_story_hours === null ? 'N/A' : `${gameData?.hltb_main_story_hours} hours`}</span>
                    </div>
                  )}

                  {/* New properties */}
                  {(giveaway.required_play || giveaway.is_shared || giveaway.whitelist || giveaway.region_restricted) && (
                    <div className="flex items-center gap-2 mt-2">
                      {giveaway.region_restricted && (
                        <span className="text-xs font-medium px-2 py-1 bg-info-light text-info-foreground rounded-full">
                          🌍 Restricted
                        </span>
                      )}
                      {giveaway.required_play && (
                        <span className="text-xs font-medium px-2 py-1 bg-warning-light text-warning-foreground rounded-full">
                          🎮 Play Required
                        </span>
                      )}
                      {giveaway.is_shared && (
                        <span className="text-xs font-medium px-2 py-1 bg-info-light text-info-foreground rounded-full">
                          👥 Shared
                        </span>
                      )}
                      {giveaway.whitelist && (
                        <span className="text-xs font-medium px-2 py-1 bg-info-light text-info-foreground rounded-full">
                          🩵 Whitelist
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs font-bold px-2 py-1 rounded-full ${getCVBadgeColor(giveaway.cv_status || 'FULL_CV')}`}
                  >
                    {getCVLabel(giveaway.cv_status || 'FULL_CV')}
                  </span>
                </div>
                {giveaway.winners && giveaway.winners.length > 0 && (
                  <div className="mt-2 border-t border-card-border">
                    <div className="text-sm mt-2">
                      <span className="text-muted-foreground">Winners:</span>
                      <div className="mt-1">
                        {giveaway.winners.map((winner, index) => (
                          !winner.name ? <p key={index}>Awaiting feedback</p> : userAvatars.get(winner.name) ? (
                            <Link
                              key={index}
                              href={`/users/${winner.name}`}
                              className="text-accent hover:underline mr-2 inline-flex items-center"
                            >
                              <UserAvatar
                                src={userAvatars.get(winner.name) || 'https://cdn-icons-png.flaticon.com/512/9287/9287610.png'}
                                username={winner.name}
                              />
                              {winner.name}
                            </Link>
                          ) : (
                            <a
                              key={index}
                              href={`http://steamgifts.com/user/${winner.name}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted-foreground hover:text-foreground mr-2 inline-flex items-center"
                            >
                              <UserAvatar
                                src={'https://cdn-icons-png.flaticon.com/512/9287/9287610.png'}
                                username={winner.name}
                              />
                              {winner.name} (ex member)
                            </a>
                          )
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {
        filteredAndSortedGiveaways.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg">No giveaways found matching your filters.</p>
          </div>
        )
      }
    </div >
  )
}
