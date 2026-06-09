'use client'

import { useState, useMemo } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Filter,
  Gift,
  Search,
  TrendingDown,
} from 'lucide-react'
import { Giveaway, GameData } from '@/types'
import Link from 'next/link'
import UserAvatar from '@/components/UserAvatar'
import { UserLink } from '@/components/UserLink'
import GameImage from '@/components/GameImage'
import { LastUpdated } from '@/components/LastUpdated'
import { useDebounce } from '@/lib/hooks'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Toolbar } from '@/components/ui/Toolbar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/ToggleGroup'
import { cn } from '@/lib/cn'

interface Props {
  giveaways: Giveaway[]
  gameData: GameData[]
  userAvatars: Map<string, string>
  userNames: Map<string, string>
  lastUpdated: number | null
}

type GameSummary = {
  game: GameData
  key: string | number
  giveawaysCount: number
  endedGiveawaysCount: number
  openGiveawaysCount: number
  zeroEntriesGiveawaysCount: number
  copiesCount: number
  uniqueWinnerCount: number
  winners: { name: string; winner_username?: string }[]
}

type SortKey = 'name' | 'giveaways' | 'copies' | 'winners'
type SortDir = 'asc' | 'desc'
type StateFilter = 'all' | 'has_open' | 'all_ended' | 'no_entries'

export default function GamesClient({
  giveaways,
  gameData,
  userAvatars,
  userNames,
  lastUpdated,
}: Props) {
  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearch = useDebounce(searchTerm, 200)
  const [sortBy, setSortBy] = useState<SortKey>('giveaways')
  const [sortDirection, setSortDirection] = useState<SortDir>('desc')
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')

  const summaries = useMemo<GameSummary[]>(() => {
    const gameMap = new Map<string | number, GameSummary>()
    const now = Date.now() / 1000

    giveaways.forEach((giveaway) => {
      const gameId = giveaway.app_id ?? giveaway.package_id
      let game: GameData | null | undefined = null
      let mapKey: string | number

      if (gameId != null) {
        game = gameData.find(
          (g) => g.app_id === gameId || g.package_id === gameId,
        )
        mapKey = gameId
      } else {
        mapKey = `name:${giveaway.name}`
        game = {
          name: giveaway.name,
          app_id: null,
          package_id: null,
        } as GameData
      }

      if (!game) return
      if (!gameMap.has(mapKey)) {
        gameMap.set(mapKey, {
          game,
          key: mapKey,
          giveawaysCount: 0,
          endedGiveawaysCount: 0,
          openGiveawaysCount: 0,
          zeroEntriesGiveawaysCount: 0,
          copiesCount: 0,
          uniqueWinnerCount: 0,
          winners: [],
        })
      }
      const entry = gameMap.get(mapKey)!
      entry.giveawaysCount++

      const isEnded = giveaway.end_timestamp <= now

      if (giveaway.hasWinners && isEnded) {
        entry.copiesCount += giveaway.copies
      }
      if (!giveaway.hasWinners && isEnded) {
        entry.zeroEntriesGiveawaysCount++
      }
      if (!isEnded) {
        entry.openGiveawaysCount++
      } else {
        entry.endedGiveawaysCount++
      }
      if (giveaway.winners) {
        entry.winners.push(...giveaway.winners)
      }
    })

    for (const entry of gameMap.values()) {
      entry.uniqueWinnerCount = new Set(entry.winners.map((w) => w.name)).size
    }

    return Array.from(gameMap.values())
  }, [giveaways, gameData])

  const filtered = useMemo(() => {
    const term = debouncedSearch.toLowerCase()
    let list = summaries.filter((g) =>
      g.game.name.toLowerCase().includes(term),
    )

    if (stateFilter === 'has_open') {
      list = list.filter((g) => g.openGiveawaysCount > 0)
    } else if (stateFilter === 'all_ended') {
      list = list.filter((g) => g.openGiveawaysCount === 0)
    } else if (stateFilter === 'no_entries') {
      list = list.filter(
        (g) =>
          g.endedGiveawaysCount > 0 &&
          g.copiesCount === 0 &&
          g.zeroEntriesGiveawaysCount > 0,
      )
    }

    list.sort((a, b) => {
      let cmp = 0
      switch (sortBy) {
        case 'name':
          cmp = a.game.name.localeCompare(b.game.name)
          break
        case 'giveaways':
          cmp = a.giveawaysCount - b.giveawaysCount
          break
        case 'copies':
          cmp = a.copiesCount - b.copiesCount
          break
        case 'winners':
          cmp = a.uniqueWinnerCount - b.uniqueWinnerCount
          break
      }
      return sortDirection === 'asc' ? cmp : -cmp
    })

    return list
  }, [summaries, debouncedSearch, stateFilter, sortBy, sortDirection])

  const resetFilters = () => {
    setSearchTerm('')
    setSortBy('giveaways')
    setSortDirection('desc')
    setStateFilter('all')
  }

  const activeFilters =
    (debouncedSearch ? 1 : 0) + (stateFilter !== 'all' ? 1 : 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Games given
        </h1>
        {lastUpdated && (
          <div className="mt-1 text-sm text-muted-foreground">
            <LastUpdated lastUpdatedDate={lastUpdated} />
          </div>
        )}
      </div>

      <Toolbar>
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search a game..."
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={sortBy}
            onValueChange={(v) => setSortBy(v as SortKey)}
          >
            <SelectTrigger className="w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="giveaways">Giveaways</SelectItem>
              <SelectItem value="copies">Copies given</SelectItem>
              <SelectItem value="winners">Unique winners</SelectItem>
              <SelectItem value="name">Name</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            aria-label="Toggle sort direction"
            onClick={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
          >
            {sortDirection === 'asc' ? (
              <ArrowUp className="h-4 w-4" />
            ) : (
              <ArrowDown className="h-4 w-4" />
            )}
          </Button>
          <ToggleGroup
            type="single"
            value={stateFilter}
            onValueChange={(v) => v && setStateFilter(v as StateFilter)}
            size="sm"
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="has_open">Open giveaway</ToggleGroupItem>
            <ToggleGroupItem value="all_ended">All ended</ToggleGroupItem>
            <ToggleGroupItem value="no_entries">No entries</ToggleGroupItem>
          </ToggleGroup>
          {activeFilters > 0 && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              Reset
            </Button>
          )}
        </div>
      </Toolbar>

      <p className="text-sm text-muted-foreground">
        Showing{' '}
        <span className="font-medium text-foreground tabular-nums-strict">
          {filtered.length.toLocaleString()}
        </span>{' '}
        of{' '}
        <span className="font-medium text-foreground tabular-nums-strict">
          {summaries.length.toLocaleString()}
        </span>{' '}
        games
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {filtered.map((row) => {
          const {
            key,
            game,
            giveawaysCount,
            copiesCount,
            endedGiveawaysCount,
            openGiveawaysCount,
            uniqueWinnerCount,
            winners,
          } = row
          const hasOpen = openGiveawaysCount > 0
          const hasEnded = endedGiveawaysCount > 0
          const endedWithNoEntries = hasEnded && copiesCount === 0
          const accentClass = endedWithNoEntries
            ? 'before:bg-[var(--error)]'
            : hasOpen
              ? 'before:bg-[var(--success)]'
              : 'before:bg-[var(--card-border-strong)]'

          return (
            <Card
              key={key}
              className={cn(
                'relative flex flex-col overflow-hidden p-0 transition-all hover:border-card-border-strong hover:shadow-md',
                'before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:z-20',
                accentClass,
                endedWithNoEntries && 'opacity-80',
              )}
            >
              <GameImage
                appId={game.app_id ?? undefined}
                packageId={game.package_id ?? undefined}
                name={game.name}
                fillWidth
              />
              <div className="flex flex-1 flex-col gap-2 p-4">
                <a
                  href={`https://www.steamgifts.com/group/WlYTQ/thegiveawaysclub/search?q=${encodeURIComponent(game.name)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="line-clamp-2 text-sm font-semibold text-foreground hover:text-accent hover:underline"
                  title={game.name}
                >
                  {game.name}
                </a>

                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <Badge variant="primary" size="sm">
                    <Gift className="h-3 w-3" />
                    {giveawaysCount} {giveawaysCount === 1 ? 'GA' : 'GAs'}
                  </Badge>
                  {hasOpen && (
                    <Badge variant="info" size="sm">
                      {openGiveawaysCount} open
                    </Badge>
                  )}
                  {endedWithNoEntries && (
                    <Badge variant="error" size="sm">
                      <TrendingDown className="h-3 w-3" />
                      No entries
                    </Badge>
                  )}
                  {copiesCount > 0 && (
                    <Badge variant="outline" size="sm">
                      {copiesCount} {copiesCount === 1 ? 'copy' : 'copies'} given
                    </Badge>
                  )}
                </div>

                {winners.length > 0 && (
                  <div className="border-t border-card-border pt-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                      {uniqueWinnerCount}{' '}
                      {uniqueWinnerCount === 1 ? 'winner' : 'winners'}
                    </p>
                    <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                      {winners.slice(0, 12).map((winner, index) => {
                        const steamId = winner.name
                        const displayName =
                          winner.winner_username ||
                          userNames.get(steamId) ||
                          steamId
                        const avatarUrl =
                          userAvatars.get(steamId) ||
                          'https://images.icon-icons.com/2550/PNG/512/question_mark_circle_icon_152550.png'
                        const isActive = userNames.has(steamId)
                        return isActive ? (
                          <UserLink
                            key={index}
                            username={displayName}
                            className="inline-flex items-center gap-1 rounded-full border border-card-border bg-card-background-hover px-1.5 py-0.5 text-[10px] hover:border-card-border-strong"
                          >
                            <UserAvatar
                              src={avatarUrl}
                              username={displayName}
                            />
                            <span className="truncate max-w-[80px]">
                              {displayName}
                            </span>
                          </UserLink>
                        ) : (
                          <a
                            key={index}
                            href={`https://steamgifts.com/user/${displayName}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-full border border-card-border bg-card-background-hover px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            <UserAvatar
                              src={avatarUrl}
                              username={displayName}
                            />
                            <span className="truncate max-w-[80px]">
                              {displayName}
                            </span>
                            <span className="text-subtle">(ex)</span>
                          </a>
                        )
                      })}
                      {winners.length > 12 && (
                        <span className="text-[10px] text-muted-foreground self-center">
                          +{winners.length - 12} more
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {(game.app_id || game.package_id) && (
                  <a
                    href={`https://store.steampowered.com/${game.app_id ? 'app' : 'sub'}/${game.app_id || game.package_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground self-start"
                  >
                    Open on Steam
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </Card>
          )
        })}
      </div>

      {filtered.length === 0 && (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <Filter className="h-8 w-8 text-subtle" />
          <p className="text-sm text-muted-foreground">
            No games match the current filters.
          </p>
          <Button variant="primary" size="sm" onClick={resetFilters}>
            Clear filters
          </Button>
        </Card>
      )}
    </div>
  )
}
