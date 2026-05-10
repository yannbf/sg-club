'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { WishlistEntry } from '@/types'
import { LastUpdated } from '@/components/LastUpdated'
import { useDebounce } from '@/lib/hooks'

export interface GiveawayStats {
  giveawayCount: number
  averageEntries: number | null
}

interface Props {
  entries: WishlistEntry[]
  lastUpdated: string | null
  giveawayStats: Record<string, GiveawayStats>
}

type SortKey = 'wishes' | 'name' | 'giveaways' | 'avg_entries'
type SortDir = 'asc' | 'desc'
type GivenFilter = 'all' | 'never_given' | 'given'

const PLACEHOLDER_IMAGE =
  'https://steamplayercount.com/theme/img/placeholder.svg'
const PAGE_SIZE = 60

function getStatsKey(entry: WishlistEntry): string {
  if (entry.app_id != null) return `app:${entry.app_id}`
  if (entry.package_id != null) return `sub:${entry.package_id}`
  return `name:${entry.name.toLowerCase()}`
}

function getEntryKey(entry: WishlistEntry): string {
  return getStatsKey(entry)
}

function getHeaderImage(entry: WishlistEntry): string {
  if (entry.app_id) {
    return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${entry.app_id}/header.jpg`
  }
  if (entry.package_id) {
    return `https://shared.akamai.steamstatic.com/store_item_assets/steam/subs/${entry.package_id}/header.jpg`
  }
  return entry.image_url || PLACEHOLDER_IMAGE
}

function getFallbackImage(entry: WishlistEntry): string {
  return entry.image_url || PLACEHOLDER_IMAGE
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
    () =>
      uniqueEntries.reduce((m, e) => Math.max(m, e.wishlist_count), 2),
    [uniqueEntries],
  )

  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearch = useDebounce(searchTerm, 200)
  const [minCount, setMinCount] = useState(2)
  const [sortKey, setSortKey] = useState<SortKey>('wishes')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [givenFilter, setGivenFilter] = useState<GivenFilter>('all')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set())

  // Reset pagination whenever filters change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [debouncedSearch, minCount, sortKey, sortDir, givenFilter])

  // Pre-rank by wishlist_count (stable display rank shown on cards)
  const ranked = useMemo<RowData[]>(() => {
    const sortedByWishes = [...uniqueEntries].sort(
      (a, b) => b.wishlist_count - a.wishlist_count,
    )
    return sortedByWishes.map((entry, i) => {
      const stats = giveawayStats[getStatsKey(entry)]
      return {
        entry,
        rank: i + 1,
        giveawayCount: stats?.giveawayCount ?? 0,
        averageEntries: stats?.averageEntries ?? null,
      }
    })
  }, [uniqueEntries, giveawayStats])

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
          // Push nulls to the bottom regardless of direction
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

  // IntersectionObserver-based infinite scroll
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

  const resetFilters = () => {
    setSearchTerm('')
    setMinCount(2)
    setSortKey('wishes')
    setSortDir('desc')
    setGivenFilter('all')
  }

  return (
    <div className="space-y-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Group wishlist</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The most wished-for games across {uniqueEntries.length.toLocaleString()}{' '}
          titles ({totalWishes.toLocaleString()} total wishes from group
          members).
        </p>
        {lastUpdated && <LastUpdated lastUpdatedDate={lastUpdated} />}
      </div>

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
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="flex-1 px-3 py-2 border border-card-border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="wishes">Wishers</option>
                <option value="name">Name</option>
                <option value="giveaways">Giveaways in group</option>
                <option value="avg_entries">Avg entries</option>
              </select>
              <button
                onClick={() =>
                  setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                }
                className="px-3 py-2 border border-card-border rounded-md bg-transparent hover:bg-accent/10 focus:outline-none focus:ring-2 focus:ring-accent"
                title={`Sort ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
              >
                {sortDir === 'asc' ? '↑' : '↓'}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Group history
            </label>
            <select
              value={givenFilter}
              onChange={(e) => setGivenFilter(e.target.value as GivenFilter)}
              className="w-full px-3 py-2 border border-card-border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="all">All games</option>
              <option value="never_given">Never given in group</option>
              <option value="given">Already given in group</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Minimum wishers
            </label>
            <input
              type="number"
              min={2}
              max={maxWishes}
              step={1}
              value={minCount}
              onChange={(e) => {
                const raw = parseInt(e.target.value, 10)
                if (Number.isNaN(raw)) {
                  setMinCount(2)
                } else {
                  setMinCount(Math.max(2, Math.min(maxWishes, raw)))
                }
              }}
              className="w-full px-3 py-2 border border-card-border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {visible.length.toLocaleString()} of{' '}
            {filteredSorted.length.toLocaleString()} matching games
            {filteredSorted.length !== uniqueEntries.length && (
              <> (out of {uniqueEntries.length.toLocaleString()})</>
            )}
          </span>
          <button
            onClick={resetFilters}
            className="px-3 py-1 border border-card-border rounded-md hover:bg-accent/10 focus:outline-none focus:ring-2 focus:ring-accent"
          >
            Reset filters
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {visible.map((row) => {
          const { entry, rank, giveawayCount, averageEntries } = row
          const searchUrl = `https://www.steamgifts.com/group/WlYTQ/thegiveawaysclub/search?q=${encodeURIComponent(entry.name)}`
          const neverGiven = giveawayCount === 0
          const entryKey = getEntryKey(entry)
          const imageUrl = failedImages.has(entryKey)
            ? getFallbackImage(entry)
            : getHeaderImage(entry)

          return (
            <div
              key={entryKey}
              className="bg-card-background rounded-lg border-card-border border overflow-hidden flex flex-col"
            >
              <a
                href={entry.steam_url}
                target="_blank"
                rel="noopener noreferrer"
                className="relative block aspect-[460/215] bg-muted"
              >
                <Image
                  src={imageUrl}
                  alt={entry.name}
                  width={460}
                  height={215}
                  loading="lazy"
                  className="w-full h-full object-cover"
                  unoptimized
                  onError={() => {
                    setFailedImages((prev) => {
                      if (prev.has(entryKey)) return prev
                      const next = new Set(prev)
                      next.add(entryKey)
                      return next
                    })
                  }}
                />
                <div className="absolute top-2 right-2 bg-accent text-accent-foreground text-xs font-bold px-2 py-1 rounded-full">
                  #{rank}
                </div>
                {neverGiven && (
                  <div className="absolute top-2 left-2 bg-accent-yellow/90 text-black text-[10px] font-semibold px-2 py-1 rounded-full">
                    Never given
                  </div>
                )}
              </a>
              <div className="p-4 flex-1 flex flex-col justify-between gap-2">
                <a
                  href={entry.steam_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline text-base font-bold line-clamp-2"
                >
                  {entry.name}
                </a>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {entry.wishlist_count}
                    </span>{' '}
                    {entry.wishlist_count === 1
                      ? 'member wants'
                      : 'members want'}{' '}
                    this
                  </p>
                  {giveawayCount > 0 ? (
                    <p className="text-sm text-muted-foreground">
                      <a
                        href={searchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        <span className="font-semibold text-foreground">
                          {giveawayCount}
                        </span>{' '}
                        {giveawayCount === 1 ? 'giveaway' : 'giveaways'} in
                        group
                      </a>
                      {averageEntries != null && (
                        <>
                          {' '}
                          ·{' '}
                          <span className="font-semibold text-foreground">
                            {averageEntries}
                          </span>{' '}
                          avg entries
                        </>
                      )}
                    </p>
                  ) : (
                    <p className="text-sm text-accent-yellow/80">
                      Never given in the group
                    </p>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {visibleCount < filteredSorted.length && (
        <div ref={sentinelRef} className="flex justify-center py-8">
          <button
            onClick={() =>
              setVisibleCount((c) =>
                Math.min(c + PAGE_SIZE, filteredSorted.length),
              )
            }
            className="px-4 py-2 border border-card-border rounded-md hover:bg-accent/10 focus:outline-none focus:ring-2 focus:ring-accent"
          >
            Load more ({filteredSorted.length - visibleCount} remaining)
          </button>
        </div>
      )}

      {filteredSorted.length === 0 && (
        <div className="text-center text-muted-foreground py-12">
          No games match the current filters.
        </div>
      )}
    </div>
  )
}
