'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Giveaway, GameData } from '@/types'
import { getCVBadgeColor, getCVLabel } from '@/lib/data'
import GameImage from '@/components/GameImage'
import UserAvatar from '@/components/UserAvatar'
import { useGameData, useDebounce } from '@/lib/hooks'
import FormattedDate from '@/components/FormattedDate'
import Tooltip from '@/components/Tooltip'
import { CvStatusIndicator } from '@/components/CvStatusIndicator'

interface Props {
  giveaways: Giveaway[]
  userAvatars: Map<string, string>
  gameData: GameData[]
}

export default function GivenGiveawaysClient({ giveaways, userAvatars, gameData }: Props) {
  const { getGameData } = useGameData(gameData)
  const [sortBy, setSortBy] = useState<'date' | 'entries' | 'points'>('date')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearchTerm = useDebounce(searchTerm, 300)
  const [filterCV, setFilterCV] = useState<'all' | 'FULL_CV' | 'REDUCED_CV' | 'NO_CV' | 'RATIO_VALID'>('all')
  const [filterRegion, setFilterRegion] = useState<boolean>(false)
  const [filterPlayRequired, setFilterPlayRequired] = useState<boolean>(false)
  const [filterShared, setFilterShared] = useState<boolean>(false)
  const [filterDeleted, setFilterDeleted] = useState<boolean>(false)
  const [isCollapsed, setIsCollapsed] = useState(false)

  const getGiveawayStatus = (giveaway: Giveaway) => {
    const now = Date.now() / 1000
    const isActive = giveaway.end_timestamp > now
    const hasNoEntries = !isActive && giveaway.entry_count === 0
    const isAwaitingFeedback = !isActive && giveaway.winners?.some((winner) => !winner.name)
    const isDeleted = giveaway.deleted

    if (isDeleted) {
      return {
        isActive: false,
        statusIcon: '🗑️',
        statusText: 'Deleted',
        statusColor: 'text-error-foreground',
        badgeColor: 'bg-error-foreground text-white',
        borderColor: 'border-error',
        backgroundColor: 'bg-error-light/30'
      }
    }

    let borderColor = isActive ? 'border-success' : hasNoEntries ? 'border-gray-400' : 'border-card-border'
    if (isAwaitingFeedback) {
      borderColor = 'border-warning'
    }

    return {
      isActive,
      statusIcon: isActive ? '🟢' : hasNoEntries ? '‼️' : '🔴',
      statusText: isActive ? 'Open' : hasNoEntries ? 'Ended with no entries' : 'Ended',
      statusColor: isActive ? 'text-success-foreground' : 'text-error-foreground',
      badgeColor: isActive ? 'bg-success-light text-success-foreground' : 'bg-muted text-white',
      borderColor,
      backgroundColor: isActive ? 'bg-success-light/30' : hasNoEntries ? 'bg-gray-100/50 dark:bg-gray-800/50' : 'bg-card-background'
    }
  }

  const filteredAndSortedGiveaways = [...giveaways].filter(giveaway => {
    const searchTermLower = debouncedSearchTerm.toLowerCase()
    const matchesSearch = giveaway.name.toLowerCase().includes(searchTermLower)

    let matchesCVAndLabels
    if (filterCV === 'RATIO_VALID') {
      matchesCVAndLabels =
        giveaway.cv_status === 'FULL_CV' &&
        !giveaway.is_shared &&
        !giveaway.whitelist &&
        (!filterRegion || giveaway.region_restricted) &&
        (!filterPlayRequired || (giveaway.required_play || giveaway.required_play_meta)) &&
        (!filterDeleted || giveaway.deleted)
    } else {
      matchesCVAndLabels =
        (filterCV === 'all' || giveaway.cv_status === filterCV) &&
        (!filterRegion || giveaway.region_restricted) &&
        (!filterPlayRequired || (giveaway.required_play || giveaway.required_play_meta)) &&
        (!filterShared || giveaway.is_shared) &&
        (!filterDeleted || giveaway.deleted)
    }

    return matchesSearch && matchesCVAndLabels
  }).sort((a, b) => {
    const now = Date.now() / 1000
    const aIsEnded = a.end_timestamp < now
    const bIsEnded = b.end_timestamp < now
    
    // Group active giveaways first
    if (aIsEnded !== bIsEnded) {
      return aIsEnded ? 1 : -1
    }

    let comparison = 0
    switch (sortBy) {
      case 'date':
        // For ended giveaways, show most recently ended first
        if (aIsEnded && bIsEnded) {
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

  return (
    <div className="bg-card-background rounded-lg border-card-border border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">
          🎁 Giveaways Created ({filteredAndSortedGiveaways.length})
        </h2>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="text-accent hover:text-accent-hover transition-colors text-sm font-medium"
        >
          {isCollapsed ? 'Show' : 'Hide'} {isCollapsed ? '↓' : '↑'}
        </button>
      </div>

      {!isCollapsed && (
        <>
          {/* Filter and Sort Controls */}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4 p-4 bg-background/50 rounded-lg">
            <div className="flex flex-wrap items-center gap-4 flex-grow">
              {/* Search Input */}
              <div className="flex-grow md:flex-grow-0">
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full md:w-48 px-3 py-2 border border-card-border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-accent text-sm"
                />
              </div>

              {/* CV Filter */}
              <div className="flex items-center gap-2">
                <label htmlFor="cv-filter" className="text-sm font-medium">CV:</label>
                <select
                  id="cv-filter"
                  value={filterCV}
                  onChange={(e) => setFilterCV(e.target.value as 'all' | 'FULL_CV' | 'REDUCED_CV' | 'NO_CV' | 'RATIO_VALID')}
                  className="px-3 py-2 border border-card-border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-accent text-sm"
                >
                  <option value="all">All</option>
                  <option value="RATIO_VALID">Ratio Valid</option>
                  <option value="FULL_CV">Full</option>
                  <option value="REDUCED_CV">Reduced</option>
                  <option value="NO_CV">No CV</option>
                </select>
              </div>

              {/* Sort Controls */}
              <div className="flex items-center gap-2">
                <label htmlFor="sort-by" className="text-sm font-medium">Sort by:</label>
                <select
                  id="sort-by"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'date' | 'entries' | 'points')}
                  className="px-3 py-2 border border-card-border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-accent text-sm"
                >
                  <option value="date">End Date</option>
                  <option value="entries">Entries</option>
                  <option value="points">Points</option>
                </select>
                <button
                  onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
                  className="px-3 py-2 border border-card-border rounded-md bg-transparent hover:bg-accent/10 focus:outline-none focus:ring-2 focus:ring-accent"
                  title={`Sort ${sortDirection === 'asc' ? 'Descending' : 'Ascending'}`}
                >
                  {sortDirection === 'asc' ? '↑' : '↓'}
                </button>
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              Showing {filteredAndSortedGiveaways.length} of {giveaways.length}
            </div>
          </div>

          {/* Label Filters */}
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => setFilterRegion(!filterRegion)}
              className={`px-3 py-1 text-sm rounded-full border transition-colors ${filterRegion ? 'bg-info-light text-info-foreground border-info' : 'bg-transparent border-card-border'}`}
            >
              🌍 Restricted
            </button>
            <button
              onClick={() => setFilterPlayRequired(!filterPlayRequired)}
              className={`px-3 py-1 text-sm rounded-full border transition-colors ${filterPlayRequired ? 'bg-warning-light text-warning-foreground border-warning' : 'bg-transparent border-card-border'}`}
            >
              🎮 Play Required
            </button>
            <button
              onClick={() => setFilterShared(!filterShared)}
              disabled={filterCV === 'RATIO_VALID'}
              className={`px-3 py-1 text-sm rounded-full border transition-colors ${filterShared ? 'bg-purple-light text-purple-foreground border-purple' : 'bg-transparent border-card-border'} ${filterCV === 'RATIO_VALID' ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              👥 Shared
            </button>
            <button
              onClick={() => setFilterDeleted(!filterDeleted)}
              className={`px-3 py-1 text-sm rounded-full border transition-colors ${filterDeleted ? 'bg-gray-500 text-white border-gray-500' : 'bg-transparent border-card-border'}`}
            >
              🗑️ Deleted
            </button>
          </div>

          <div className="space-y-4">
            {filteredAndSortedGiveaways.map((giveaway) => {
              const status = getGiveawayStatus(giveaway)
              const gameData = getGameData(giveaway.app_id ?? giveaway.package_id)

              return (
                <div key={giveaway.id ?? giveaway.package_id} className={`border rounded-lg overflow-hidden ${status.borderColor} ${status.backgroundColor}`}>
                  <div className="flex">
                    <GameImage
                      appId={giveaway.app_id?.toString()}
                      packageId={giveaway.package_id?.toString()}
                      name={giveaway.name}
                    />

                    <div className="p-4 flex-1">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold">
                              <a
                                href={`https://www.steamgifts.com/giveaway/${giveaway.link}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent hover:underline text-sm"
                              >{giveaway.name} ({giveaway.points}P) <CvStatusIndicator giveaway={giveaway} /></a></h3>
                            <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${status.badgeColor}`}>
                              {status.statusIcon} {status.statusText}
                            </span>
                          </div>
                          <div className="flex items-center mt-1 space-x-4">
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getCVBadgeColor(giveaway.cv_status || 'FULL_CV', !!giveaway.decreased_ratio_info)}`}>
                              {getCVLabel(giveaway.cv_status || 'FULL_CV', !!giveaway.decreased_ratio_info)}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {giveaway.copies} {giveaway.copies === 1 ? 'copy' : 'copies'}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {giveaway.entry_count} entries
                            </span>
                            <span className={`text-sm font-medium ${status.statusColor}`}>
                              <FormattedDate timestamp={giveaway.end_timestamp} />
                            </span>
                            {gameData && 'hltb_main_story_hours' in gameData && (<div>
                              <span className="text-muted-foreground">⏱️ HLTB:</span>
                              <span className="ml-1 font-medium">
                                <span className="text-sm text-muted-foreground">
                                  {gameData?.hltb_main_story_hours === null ? 'N/A' : `${gameData?.hltb_main_story_hours} hours`}
                                </span>
                              </span>
                            </div>)}
                          </div>

                          {/* New properties */}
                          <div className="flex items-center gap-2 mt-2">
                            {giveaway.region_restricted && (
                              <span className="text-xs font-medium px-2 py-1 bg-info-light text-info-foreground rounded-full">
                                🌍 Restricted
                              </span>
                            )}
                            {(giveaway.required_play || giveaway.required_play_meta) && (
                              <Tooltip content={giveaway.required_play_meta?.additional_notes || 'No additional notes for required play'}>
                                <span className="text-xs font-medium px-2 py-1 bg-warning-light text-warning-foreground rounded-full">
                                  🎮 Play Required
                                </span>
                              </Tooltip>
                            )}
                            {giveaway.is_shared && (
                              <span className="text-xs font-medium px-2 py-1 bg-info-light text-info-foreground rounded-full">
                                👥 Shared
                              </span>
                            )}
                            {giveaway.whitelist && (
                              <span className="text-xs font-medium px-2 py-1 bg-gray-200 text-gray-800 rounded-full dark:bg-gray-700 dark:text-gray-300">
                                🩵 Whitelist
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {!giveaway.deleted && giveaway.winners && giveaway.winners.length > 0 && (
                    <div className="px-4 pb-4">
                      <div className="pt-3 border-t border-card-border">
                        <div className="text-sm">
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
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
} 