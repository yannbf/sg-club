'use client'

import { useState, useMemo } from 'react'
import { Giveaway, GameData } from '@/types'
import Link from 'next/link'
import Image from 'next/image'
import UserAvatar from '@/components/UserAvatar'
import { LastUpdated } from '@/components/LastUpdated'

interface Props {
  giveaways: Giveaway[]
  gameData: GameData[]
  userAvatars: Map<string, string>
  userNames: Map<string, string>
  lastUpdated: number | null
}

const PLACEHOLDER_IMAGE = 'https://steamplayercount.com/theme/img/placeholder.svg'

function getGameImageUrl(game: GameData): string {
  const src = game.app_id
    ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.app_id}/header.jpg`
    : game.package_id
      ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/subs/${game.package_id}/header.jpg`
      : PLACEHOLDER_IMAGE

  return src
} 

export default function GamesClient({ giveaways, gameData, userAvatars, userNames, lastUpdated }: Props) {
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'giveaways' | 'copies'>('giveaways')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  const gamesWithGiveawayData = useMemo(() => {
    const gameMap = new Map<string | number, {
      game: GameData;
      giveawaysCount: number;
      endedGiveawaysCount: number;
      openGiveawaysCount: number;
      zeroEntriesGiveawaysCount: number;
      copiesCount: number;
      winners: { name: string; winner_username?: string }[]
    }>()

    giveaways.forEach(giveaway => {
      const game_id = giveaway.app_id ?? giveaway.package_id
      let game: GameData | null | undefined = null
      let mapKey: string | number

      if (game_id != null) {
        game = gameData.find(g => g.app_id === game_id || g.package_id === game_id)
        mapKey = game_id
      } else {
        // Giveaways without a Steam app/package ID (e.g. Humble Bundles)
        // Group by name, use name as map key
        mapKey = `name:${giveaway.name}`
        game = { name: giveaway.name, app_id: null, package_id: null } as GameData
      }

      if (game) {
        if (!gameMap.has(mapKey)) {
          gameMap.set(mapKey, { game, giveawaysCount: 0, endedGiveawaysCount: 0, openGiveawaysCount: 0, zeroEntriesGiveawaysCount: 0, copiesCount: 0, winners: [] })
        }
        const gameEntry = gameMap.get(mapKey)!
        gameEntry.giveawaysCount++

        if (giveaway.hasWinners && giveaway.end_timestamp <= Date.now() / 1000) {
          gameEntry.copiesCount += giveaway.copies
        }

        if (!giveaway.hasWinners && giveaway.end_timestamp <= Date.now() / 1000) {
          gameEntry.zeroEntriesGiveawaysCount++
        }

        if (giveaway.end_timestamp > Date.now() / 1000) {
          gameEntry.openGiveawaysCount++
        } else {
          gameEntry.endedGiveawaysCount++
        }

        if (giveaway.winners) {
          gameEntry.winners.push(...giveaway.winners)
        }
      }
    })

    let processedGames = Array.from(gameMap.entries()).map(([key, value]) => ({ ...value, key }))

    processedGames = processedGames.filter(game =>
      game.game.name.toLowerCase().includes(searchTerm.toLowerCase())
    )

    processedGames.sort((a, b) => {
      let comparison = 0
      switch (sortBy) {
        case 'name':
          comparison = a.game.name.localeCompare(b.game.name)
          break
        case 'giveaways':
          comparison = a.giveawaysCount - b.giveawaysCount
          break
        case 'copies':
          comparison = a.copiesCount - b.copiesCount
          break
      }
      return sortDirection === 'asc' ? comparison : -comparison
    })

    return processedGames
  }, [giveaways, gameData, searchTerm, sortBy, sortDirection])

  return (
    <div className="space-y-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Games given</h1>
        {lastUpdated && (
          <LastUpdated lastUpdatedDate={lastUpdated} />
        )}
      </div>
      {/* Filters */}
      <div className="bg-card-background rounded-lg border-card-border border p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Search
            </label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Type a game name..."
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
                onChange={(e) => setSortBy(e.target.value as 'name' | 'giveaways' | 'copies')}
                className="flex-1 px-3 py-2 border border-card-border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="name">Name</option>
                <option value="giveaways">Giveaways</option>
                <option value="copies">Copies</option>
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
        </div>
      </div>

      {/* Games List */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {gamesWithGiveawayData.map(({ key, game, giveawaysCount, copiesCount, endedGiveawaysCount, openGiveawaysCount, winners }) => {
          const hasOpenGiveaways = openGiveawaysCount > 0
          const hasEndedGiveaways = endedGiveawaysCount > 0
          const endedWithNoEntries = hasEndedGiveaways && copiesCount === 0

          const hasGiveaways = giveawaysCount > 0
          return (
            <div key={key} className={`bg-card-background rounded-lg border-card-border border overflow-hidden ${endedWithNoEntries ? 'opacity-60 border-red-500' : ''}`}>
              <Link href={`https://store.steampowered.com/${game.app_id ? 'app' : 'sub'}/${game.app_id || game.package_id}`} target="_blank">
                <Image
                  src={getGameImageUrl(game)}
                  alt={game.name}
                  width={600}
                  height={900}
                  className="w-full h-48 object-cover"
                />
              </Link>
              <div className="p-4">
                <a href={`https://www.steamgifts.com/group/WlYTQ/thegiveawaysclub/search?q=${encodeURIComponent(game.name)}`} target="_blank" className="text-accent hover:underline text-lg font-bold truncate">
                  {game.name}
                </a>
                {endedWithNoEntries ? (
                  <p className="text-sm text-muted-foreground">All giveaways ended with no entries.</p>
                ) :
                  <>
                    {hasGiveaways && <p className="text-sm text-muted-foreground">{giveawaysCount} {giveawaysCount === 1 ? 'Giveaway' : 'Giveaways'} created {hasOpenGiveaways ? `(${openGiveawaysCount} open)` : ''}</p>}
                    {winners.length > 0 && <div className="mt-2">
                      <h3 className="text-sm font-semibold">{winners.length} {winners.length === 1 ? 'Winner' : 'Winners'}:</h3>
                      <div className="flex flex-wrap gap-1 mt-1 max-h-28 overflow-y-auto">
                        {winners.map((winner, index) => {
                          const steamId = winner.name
                          const displayName = winner.winner_username || userNames.get(steamId) || steamId
                          const avatarUrl = userAvatars.get(steamId) || 'https://cdn-icons-png.flaticon.com/512/9287/9287610.png'
                          const isActiveMember = userNames.has(steamId)

                          return isActiveMember ? (
                            <Link
                              key={index}
                              href={`/users/${displayName}`}
                              className="text-xs bg-accent/20 text-accent-foreground px-2 py-1 rounded-full flex items-center"
                            >
                              <UserAvatar src={avatarUrl} username={displayName} />
                              {displayName}
                            </Link>
                          ) : (
                            <a
                              key={index}
                              href={`https://steamgifts.com/user/${displayName}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs bg-accent/20 text-accent-foreground px-2 py-1 rounded-full flex items-center"
                            >
                              <UserAvatar src={avatarUrl} username={displayName} />
                              {displayName} (ex member)
                            </a>
                          )
                        })}
                      </div>
                    </div>}
                  </>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}