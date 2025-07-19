'use client'

import { useState, useMemo } from 'react'
import { Giveaway, GameData } from '@/types'
import Link from 'next/link'
import Image from 'next/image'
import UserAvatar from '@/components/UserAvatar'

interface Props {
  giveaways: Giveaway[]
  gameData: GameData[]
  userAvatars: Map<string, string>
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

export default function GamesClient({ giveaways, gameData, userAvatars }: Props) {
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'giveaways' | 'copies'>('name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  const gamesWithGiveawayData = useMemo(() => {
    const gameMap = new Map<number, { game: GameData; giveawaysCount: number; copiesCount: number; winners: { name: string }[] }>()

    giveaways.forEach(giveaway => {
      if (giveaway.winners && giveaway.winners.length > 0 && giveaway.end_timestamp <= Date.now() / 1000) {
        const game_id = giveaway.app_id ?? giveaway.package_id
        const game = gameData.find(g => g.app_id === game_id || g.package_id === game_id)
        if (game) {
          if (!gameMap.has(game_id)) {
            gameMap.set(game_id, { game, giveawaysCount: 0, copiesCount: 0, winners: [] })
          }
          const gameEntry = gameMap.get(game_id)!
          gameEntry.giveawaysCount++
          gameEntry.copiesCount += giveaway.copies
          if (giveaway.winners) {
            gameEntry.winners.push(...giveaway.winners)
          }
        }
      }
    })

    let processedGames = Array.from(gameMap.values())

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
      <h1 className="text-3xl font-bold">Games given</h1>
      <p>
        Below you will find a list of all the games given in the group since its creation, alongside the amount of copies and giveaways.
      </p>
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
              placeholder="Search games..."
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
        {gamesWithGiveawayData.map(({ game, giveawaysCount, copiesCount, winners }) => (
          <div key={game.app_id ?? game.package_id} className="bg-card-background rounded-lg border-card-border border overflow-hidden">
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
              <p className="text-sm text-muted-foreground">{giveawaysCount} {giveawaysCount === 1 ? 'Giveaway' : 'Giveaways'}</p>
              <p className="text-sm text-muted-foreground">{copiesCount} {copiesCount === 1 ? 'Copy' : 'Copies'}</p>
              <div className="mt-2">
                <h3 className="text-sm font-semibold">Winners:</h3>
                <div className="flex flex-wrap gap-1 mt-1">
                  {winners.slice(0, 5).map((winner, index) => (
                    userAvatars.get(winner.name) ? (
                      <Link
                        key={index}
                        href={`/users/${winner.name}`}
                        className="text-xs bg-accent/20 text-accent-foreground px-2 py-1 rounded-full flex"
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
                        className="text-xs bg-accent/20 text-accent-foreground px-2 py-1 rounded-full flex"
                      >
                        <UserAvatar
                          src={'https://cdn-icons-png.flaticon.com/512/9287/9287610.png'}
                          username={winner.name}
                        />
                        {winner.name} (ex member)
                      </a>
                    )
                  ))}
                  {winners.length > 5 && (
                    <span className="text-xs text-muted-foreground">+ {winners.length - 5} more</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}