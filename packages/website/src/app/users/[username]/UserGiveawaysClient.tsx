'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Giveaway } from '@/types'
import { formatRelativeTime, getCVBadgeColor, getCVLabel } from '@/lib/data'
import GameImage from './GameImage'
import UserAvatar from '@/components/UserAvatar'

interface Props {
  giveaways: Giveaway[]
  userAvatars: Map<string, string>
}

export default function UserGiveawaysClient({ giveaways, userAvatars }: Props) {
  const [sortBy, setSortBy] = useState<'date' | 'entries' | 'points'>('date')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  const getGiveawayStatus = (giveaway: Giveaway) => {
    const now = Date.now() / 1000
    const isActive = giveaway.end_timestamp > now
    const hasNoEntries = !isActive && giveaway.entry_count === 0

    return {
      isActive,
      statusIcon: isActive ? '🟢' : hasNoEntries ? '‼️' : '🔴',
      statusText: isActive ? 'Open' : hasNoEntries ? 'Ended with no entries' : 'Ended',
      statusColor: isActive ? 'text-success-foreground' : 'text-error-foreground',
      borderColor: isActive ? 'border-success' : hasNoEntries ? 'border-error' : 'border-card-border',
      backgroundColor: isActive ? 'bg-success-light/30' : hasNoEntries ? 'bg-error-light/30' : 'bg-card-background'
    }
  }

  const sortedGiveaways = [...giveaways].sort((a, b) => {
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
          🎁 Giveaways Created ({giveaways.length})
        </h2>
        <div className="flex gap-2 items-center">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'date' | 'entries' | 'points')}
            className="px-3 py-2 border border-card-border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-accent"
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

      <div className="space-y-4">
        {sortedGiveaways.map((giveaway) => {
          const status = getGiveawayStatus(giveaway)

          return (
            <div key={giveaway.id} className={`border rounded-lg overflow-hidden ${status.borderColor} ${status.backgroundColor}`}>
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
                        <h3 className="font-semibold">{giveaway.name}</h3>
                        <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${status.isActive ? 'bg-success-light text-success-foreground' : 'bg-muted text-muted-foreground'}`}>
                          {status.statusIcon} {status.statusText}
                        </span>
                      </div>
                      <div className="flex items-center mt-1 space-x-4">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getCVBadgeColor(giveaway.cv_status || 'FULL_CV')}`}>
                          {getCVLabel(giveaway.cv_status || 'FULL_CV')}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {giveaway.points} points
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {giveaway.copies} {giveaway.copies === 1 ? 'copy' : 'copies'}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {giveaway.entry_count} entries
                        </span>
                        <span className={`text-sm font-medium ${status.statusColor}`}>
                          {formatRelativeTime(giveaway.end_timestamp)}
                        </span>
                      </div>

                      {/* New properties */}
                      {(giveaway.required_play || giveaway.is_shared || giveaway.whitelist) && (
                        <div className="flex items-center gap-2 mt-2">
                          {giveaway.required_play && (
                            <span className="text-xs font-medium px-2 py-1 bg-warning-light text-warning-foreground rounded-full">
                              Play Required
                            </span>
                          )}
                          {giveaway.is_shared && (
                            <span className="text-xs font-medium px-2 py-1 bg-info-light text-info-foreground rounded-full">
                              Shared Giveaway
                            </span>
                          )}
                          {giveaway.whitelist && (
                            <span className="text-xs font-medium px-2 py-1 bg-accent-light text-accent-foreground rounded-full">
                              Whitelist
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <a
                      href={`https://www.steamgifts.com/giveaway/${giveaway.link}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline text-sm"
                    >
                      View →
                    </a>
                  </div>
                </div>
              </div>

              {giveaway.winners && giveaway.winners.length > 0 && (
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
    </div>
  )
} 