'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Filter,
  Heart,
  Search,
  Sparkles,
  Users as UsersIcon,
  X,
} from 'lucide-react'
import { WishlistEntry } from '@/types'
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
import GameImage from '@/components/GameImage'
import { cn } from '@/lib/cn'

export interface GiveawayStats {
  giveawayCount: number
  averageEntries: number | null
}

interface Props {
  entries: WishlistEntry[]
  lastUpdated: string | null
  /** Two views of giveaway stats:
   *  - exclusive: only group-exclusive giveaways (no shared, no whitelist)
   *  - all: every giveaway including shared/whitelist
   *  The UI toggle defaults to `exclusive` because shared/whitelist
   *  giveaways aren't really representative of how *this* group has
   *  distributed a game. */
  giveawayStats: {
    exclusive: Record<string, GiveawayStats>
    all: Record<string, GiveawayStats>
  }
}

type SortKey = 'wishes' | 'name' | 'giveaways' | 'avg_entries'
type SortDir = 'asc' | 'desc'
type GivenFilter = 'all' | 'never_given' | 'given'

const PAGE_SIZE = 60

function getStatsKey(entry: WishlistEntry): string {
  if (entry.app_id != null) return `app:${entry.app_id}`
  if (entry.package_id != null) return `sub:${entry.package_id}`
  return `name:${entry.name.toLowerCase()}`
}

interface RowData {
  entry: WishlistEntry
  rank: number
  giveawayCount: number
  averageEntries: number | null
}

export default function WishlistClient({
  entries,
  lastUpdated,
  giveawayStats,
}: Props) {
  // Dedupe defensively (data may already be deduped by scraper)
  const uniqueEntries = useMemo(() => {
    const seen = new Map<string, WishlistEntry>()
    for (const e of entries) {
      const key = getStatsKey(e)
      const existing = seen.get(key)
      if (!existing || e.wishlist_count > existing.wishlist_count) {
        seen.set(key, e)
      }
    }
    return Array.from(seen.values())
  }, [entries])

  const maxWishes = useMemo(
    () => uniqueEntries.reduce((m, e) => Math.max(m, e.wishlist_count), 1),
    [uniqueEntries],
  )

  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearch = useDebounce(searchTerm, 200)
  // `minCount` is the applied numeric filter; `minCountText` is the raw input
  // string so the user can edit freely (clear it, type multiple digits) without
  // mid-keystroke clamping corrupting what they typed. The numeric value is
  // clamped for filtering; the text is normalized on blur.
  const [minCount, setMinCount] = useState(1)
  const [minCountText, setMinCountText] = useState('1')

  const applyMinCount = (text: string) => {
    setMinCountText(text)
    if (text.trim() === '') {
      setMinCount(1)
      return
    }
    const raw = parseInt(text, 10)
    if (Number.isNaN(raw)) return
    setMinCount(Math.max(1, Math.min(maxWishes, raw)))
  }
  const [sortKey, setSortKey] = useState<SortKey>('wishes')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [givenFilter, setGivenFilter] = useState<GivenFilter>('all')
  /** Default ON: hide shared/whitelist giveaways from the per-game
   *  stats (count + avg entries). Click the toggle to include them. */
  const [excludeShared, setExcludeShared] = useState(true)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [debouncedSearch, minCount, sortKey, sortDir, givenFilter, excludeShared])

  const activeStats = excludeShared
    ? giveawayStats.exclusive
    : giveawayStats.all

  const ranked = useMemo<RowData[]>(() => {
    const sortedByWishes = [...uniqueEntries].sort(
      (a, b) => b.wishlist_count - a.wishlist_count,
    )
    return sortedByWishes.map((entry, i) => {
      const stats = activeStats[getStatsKey(entry)]
      return {
        entry,
        rank: i + 1,
        giveawayCount: stats?.giveawayCount ?? 0,
        averageEntries: stats?.averageEntries ?? null,
      }
    })
  }, [uniqueEntries, activeStats])

  const filteredSorted = useMemo<RowData[]>(() => {
    const term = debouncedSearch.toLowerCase().trim()
    const filtered = ranked.filter((row) => {
      if (row.entry.wishlist_count < minCount) return false
      if (term && !row.entry.name.toLowerCase().includes(term)) return false
      if (givenFilter === 'never_given' && row.giveawayCount > 0) return false
      if (givenFilter === 'given' && row.giveawayCount === 0) return false
      return true
    })

    const dir = sortDir === 'asc' ? 1 : -1
    filtered.sort((a, b) => {
      switch (sortKey) {
        case 'wishes':
          return (a.entry.wishlist_count - b.entry.wishlist_count) * dir
        case 'name':
          return a.entry.name.localeCompare(b.entry.name) * dir
        case 'giveaways':
          return (a.giveawayCount - b.giveawayCount) * dir
        case 'avg_entries': {
          const aVal = a.averageEntries
          const bVal = b.averageEntries
          if (aVal === null && bVal === null) return 0
          if (aVal === null) return 1
          if (bVal === null) return -1
          return (aVal - bVal) * dir
        }
      }
    })
    return filtered
  }, [ranked, debouncedSearch, minCount, givenFilter, sortKey, sortDir])

  const visible = useMemo(
    () => filteredSorted.slice(0, visibleCount),
    [filteredSorted, visibleCount],
  )

  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = sentinelRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) =>
            Math.min(c + PAGE_SIZE, filteredSorted.length),
          )
        }
      },
      { rootMargin: '600px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [filteredSorted.length])

  const totalWishes = useMemo(
    () => uniqueEntries.reduce((sum, e) => sum + e.wishlist_count, 0),
    [uniqueEntries],
  )

  const activeFilters =
    (debouncedSearch ? 1 : 0) +
    (minCount > 1 ? 1 : 0) +
    (givenFilter !== 'all' ? 1 : 0)

  const resetFilters = () => {
    setSearchTerm('')
    setMinCount(1)
    setMinCountText('1')
    setSortKey('wishes')
    setSortDir('desc')
    setGivenFilter('all')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            Group wishlist
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline" className="font-mono tabular-nums-strict">
              {uniqueEntries.length.toLocaleString()} titles
            </Badge>
            <Badge variant="outline" className="font-mono tabular-nums-strict">
              {totalWishes.toLocaleString()} wishes
            </Badge>
            {lastUpdated && <LastUpdated lastUpdatedDate={lastUpdated} />}
          </div>
        </div>
      </div>

      <Toolbar>
        <div className="flex flex-1 items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search a game..."
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={sortKey}
            onValueChange={(v) => setSortKey(v as SortKey)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="wishes">Most wishers</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="giveaways">Giveaways in group</SelectItem>
              <SelectItem value="avg_entries">Avg entries</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            aria-label={`Sort ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
          >
            {sortDir === 'asc' ? (
              <ArrowUp className="h-4 w-4" />
            ) : (
              <ArrowDown className="h-4 w-4" />
            )}
          </Button>

          <ToggleGroup
            type="single"
            value={givenFilter}
            onValueChange={(v) => v && setGivenFilter(v as GivenFilter)}
            size="sm"
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="never_given">Never given</ToggleGroupItem>
            <ToggleGroupItem value="given">Already given</ToggleGroupItem>
          </ToggleGroup>

          <div className="flex items-center gap-1.5 rounded-md border border-card-border bg-background-elevated px-2 h-9">
            <Heart className="h-4 w-4 text-subtle" />
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              Min wishers
            </span>
            <Input
              type="number"
              min={1}
              max={maxWishes}
              step={1}
              value={minCountText}
              onChange={(e) => applyMinCount(e.target.value)}
              onBlur={() => setMinCountText(String(minCount))}
              className="h-7 w-16 border-0 bg-transparent px-2 focus-visible:ring-0 focus-visible:ring-offset-0 tabular-nums-strict"
            />
          </div>

          {activeFilters > 0 && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              <X className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}
        </div>
      </Toolbar>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted-foreground">
          Showing{' '}
          <span className="font-medium text-foreground tabular-nums-strict">
            {visible.length.toLocaleString()}
          </span>{' '}
          of{' '}
          <span className="font-medium text-foreground tabular-nums-strict">
            {filteredSorted.length.toLocaleString()}
          </span>{' '}
          matching games
          {filteredSorted.length !== uniqueEntries.length && (
            <>
              {' '}
              (out of {uniqueEntries.length.toLocaleString()})
            </>
          )}
        </p>
        <div className="inline-flex items-center gap-3 text-xs">
          <label
            className="inline-flex cursor-pointer select-none items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
            title="When on, shared and whitelist giveaways are ignored when counting how often each game has been given in the group."
          >
            <input
              type="checkbox"
              checked={excludeShared}
              onChange={(e) => setExcludeShared(e.target.checked)}
              className="h-3.5 w-3.5 cursor-pointer rounded border-card-border-strong bg-background accent-primary"
            />
            <UsersIcon className="h-3 w-3" />
            <span>Group-exclusive only</span>
          </label>
          {activeFilters > 0 && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Filter className="h-3 w-3" />
              {activeFilters} active filter{activeFilters > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {visible.map((row) => {
          const { entry, rank, giveawayCount, averageEntries } = row
          const searchUrl = `https://www.steamgifts.com/group/WlYTQ/thegiveawaysclub/search?q=${encodeURIComponent(entry.name)}`
          const neverGiven = giveawayCount === 0

          return (
            <Card
              key={getStatsKey(entry)}
              className="group relative flex flex-col overflow-hidden p-0 transition-all hover:border-card-border-strong hover:shadow-md"
            >
              <div className="relative">
                <a
                  href={entry.steam_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${entry.name} on Steam`}
                  className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <GameImage
                    appId={entry.app_id ?? undefined}
                    packageId={entry.package_id ?? undefined}
                    fallbackUrl={entry.image_url}
                    name={entry.name}
                    fillWidth
                    link={false}
                  />
                </a>

                <div className="absolute top-2 right-2 flex items-center gap-1">
                  <span className="inline-flex items-center justify-center rounded-md bg-[#0b0b14] px-2 py-1 font-mono text-xs font-bold text-white ring-1 ring-white/20 shadow-md tabular-nums-strict">
                    #{rank}
                  </span>
                </div>
                {neverGiven && (
                  <div className="absolute top-2 left-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-rose)] px-2 py-0.5 text-[10px] font-semibold text-white shadow-md ring-1 ring-white/20">
                      Never given
                    </span>
                  </div>
                )}
                <div
                  className={cn(
                    'absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card-background to-transparent',
                    'pointer-events-none',
                  )}
                />
              </div>

              <div className="flex flex-1 flex-col gap-2 p-4">
                <a
                  href={entry.steam_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="line-clamp-2 text-sm font-semibold text-foreground transition-colors hover:text-accent"
                >
                  {entry.name}
                </a>

                <div className="flex items-center gap-1.5 text-xs">
                  <Heart className="h-3 w-3 text-accent-rose" />
                  <span className="font-semibold text-foreground tabular-nums-strict">
                    {entry.wishlist_count}
                  </span>
                  <span className="text-muted-foreground">
                    {entry.wishlist_count === 1 ? 'wisher' : 'wishers'}
                  </span>
                </div>

                {giveawayCount > 0 ? (
                  <a
                    href={searchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span className="font-semibold text-foreground tabular-nums-strict">
                      {giveawayCount}
                    </span>
                    {giveawayCount === 1 ? 'giveaway' : 'giveaways'} in group
                    {averageEntries != null && (
                      <>
                        <span className="text-subtle">·</span>
                        <span className="tabular-nums-strict">
                          {averageEntries} avg entries
                        </span>
                      </>
                    )}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <p className="inline-flex items-center gap-1.5 text-xs text-accent-rose/90">
                    <Sparkles className="h-3 w-3" />
                    Never given in the group
                  </p>
                )}
              </div>
            </Card>
          )
        })}
      </div>

      {visibleCount < filteredSorted.length && (
        <div ref={sentinelRef} className="flex justify-center py-8">
          <Button
            variant="outline"
            onClick={() =>
              setVisibleCount((c) =>
                Math.min(c + PAGE_SIZE, filteredSorted.length),
              )
            }
          >
            Load more ({filteredSorted.length - visibleCount} remaining)
          </Button>
        </div>
      )}

      {filteredSorted.length === 0 && (
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
