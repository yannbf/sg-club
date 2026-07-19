'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Filter,
  Heart,
  Info,
  Search,
  Sparkles,
  Tag,
  Users as UsersIcon,
  X,
} from 'lucide-react'
import { GameData, GameInsightsData, WishlistEntry } from '@/types'
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
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/Popover'
import GameImage from '@/components/GameImage'
import { UserLink } from '@/components/UserLink'
import { cn } from '@/lib/cn'

export interface GiveawayStats {
  giveawayCount: number
  averageEntries: number | null
}

/** steam_id → display info, for resolving owners/wanters in the insights popover. */
export type UserLookup = Record<string, { username: string; avatar_url: string }>

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
  /** Steam review/price/ownership rollups, keyed by app_id. Null when the
   *  sibling data pipeline hasn't produced game_insights.json yet. */
  insights: GameInsightsData | null
  /** Game price/metadata, keyed by app_id (as a string). */
  gameDataByAppId: Record<string, GameData>
  /** steam_id → display info, for resolving owners/wanters. */
  users: UserLookup
}

/** A price of 0 means "no price data" (unreleased, delisted, or a fetch
 *  gap) — never render it as "Free". */
function formatPriceCents(cents: number | null | undefined): string | null {
  if (cents == null || cents === 0) return null
  return `$${(cents / 100).toFixed(2)}`
}

/** Maps a Steam review_score_desc (e.g. "Very Positive") to a text color class
 *  matching Steam's own store palette. Falls back to muted for unknown/absent
 *  values (including the literal "No user reviews"). */
function reviewToneClass(desc: string | null | undefined): string {
  if (!desc) return 'text-muted-foreground'
  if (desc.includes('Positive')) return 'text-[#66c0f4]'
  if (desc.includes('Mixed')) return 'text-[#b9a06a]'
  if (desc.includes('Negative')) return 'text-[#a34c25]'
  return 'text-muted-foreground'
}

/** Renders a wrapped, comma-separated list of member usernames, or a muted fallback when empty. */
function MemberList({
  steamIds,
  users,
  emptyLabel,
}: {
  steamIds: string[]
  users: UserLookup
  emptyLabel: string
}) {
  const resolved = steamIds
    .map((id) => users[id])
    .filter((u): u is UserLookup[string] => Boolean(u))
    .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }))

  if (resolved.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>
  }

  return (
    <div className="flex flex-wrap gap-x-1 gap-y-1 text-xs">
      {resolved.map((user, index) => (
        <span key={user.username}>
          <UserLink
            username={user.username}
            className="text-foreground hover:text-accent hover:underline"
          >
            {user.username}
          </UserLink>
          {index < resolved.length - 1 && (
            <span className="text-subtle">,</span>
          )}
        </span>
      ))}
    </div>
  )
}

interface GameInsightsPopoverProps {
  entry: WishlistEntry
  insights: GameInsightsData | null
  gameDataByAppId: Record<string, GameData>
  users: UserLookup
}

function GameInsightsPopover({
  entry,
  insights,
  gameDataByAppId,
  users,
}: GameInsightsPopoverProps) {
  const appKey = entry.app_id != null ? String(entry.app_id) : null
  const insight = appKey ? insights?.games[appKey] : undefined
  const gameData = appKey ? gameDataByAppId[appKey] : undefined
  const totalMembers = insights?.total_members ?? null
  // Honest denominators: owners/wanters can only be detected for members
  // whose Steam library/wishlist is public.
  const ownsTotal = insights?.members_with_library_data ?? totalMembers
  const wantsTotal = insights?.members_with_wishlist_data ?? totalMembers

  const priceText = formatPriceCents(gameData?.price_usd_full)
  const hasReview =
    gameData != null &&
    (gameData.rating_percent != null ||
      gameData.review_count != null ||
      gameData.review_score_desc != null)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Game insights"
          className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-card-border bg-card-background-hover text-muted-foreground transition-colors hover:border-card-border-strong hover:text-foreground"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="flex items-start justify-between gap-2">
          <a
            href={entry.steam_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-foreground hover:text-accent hover:underline"
          >
            {entry.name}
          </a>
          <PopoverClose
            aria-label="Close"
            className="flex-shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-card-background-hover hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </PopoverClose>
        </div>
        {entry.app_id != null && (
          <p className="mt-0.5 text-xs text-subtle">appid {entry.app_id}</p>
        )}

        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
          {hasReview ? (
            <p>
              <span className="font-semibold text-foreground">Rating:</span>{' '}
              <span className={reviewToneClass(gameData?.review_score_desc)}>
                {gameData?.review_score_desc ?? 'Unknown'}
                {gameData?.rating_percent != null && (
                  <> · {gameData.rating_percent}%</>
                )}
              </span>
              {gameData?.review_count != null && (
                <> · {gameData.review_count.toLocaleString()} reviews</>
              )}
            </p>
          ) : (
            <p>No review data yet</p>
          )}

          {priceText != null ? (
            <p>
              <span className="font-semibold text-foreground">Price:</span>{' '}
              {priceText}
              {insight?.bundled != null && (
                <>
                  {' · '}
                  <span className="font-semibold text-foreground">
                    Bundled:
                  </span>{' '}
                  {insight.bundled ? 'Yes' : 'No'}
                </>
              )}
            </p>
          ) : (
            insight?.bundled != null && (
              <p>
                <span className="font-semibold text-foreground">
                  Bundled:
                </span>{' '}
                {insight.bundled ? 'Yes' : 'No'}
              </p>
            )
          )}
        </div>

        {insight ? (
          <div className="mt-3 space-y-3">
            <div>
              <h4 className="text-xs font-semibold text-accent-green">
                OWNS ({insight.owners.length}
                {ownsTotal != null ? `/${ownsTotal}` : ''})
              </h4>
              <div className="mt-1 max-h-72 overflow-y-auto">
                <MemberList
                  steamIds={insight.owners}
                  users={users}
                  emptyLabel="Nobody owns this yet"
                />
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-accent-green">
                WANTS ({insight.wanters.length}
                {wantsTotal != null ? `/${wantsTotal}` : ''})
              </h4>
              <div className="mt-1 max-h-72 overflow-y-auto">
                <MemberList
                  steamIds={insight.wanters}
                  users={users}
                  emptyLabel="Nobody wants this yet"
                />
              </div>
            </div>
            {totalMembers != null && (
              <p className="text-[10px] leading-snug text-subtle">
                Based on public Steam data: {ownsTotal}/{totalMembers} members
                share their library, {wantsTotal}/{totalMembers} their
                wishlist. Wishers ({'❤'}) counts SteamGifts wishlists
                instead, which all members have.
              </p>
            )}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            No member data for this game
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}

type SortKey =
  | 'wishes'
  | 'name'
  | 'giveaways'
  | 'avg_entries'
  | 'price'
  | 'rating'
  | 'most_wanted'
  | 'most_owned'
type SortDir = 'asc' | 'desc'
type GivenFilter = 'all' | 'never_given' | 'given'

const PAGE_SIZE = 60

function getStatsKey(entry: WishlistEntry): string {
  if (entry.app_id != null) return `app:${entry.app_id}`
  if (entry.package_id != null) return `sub:${entry.package_id}`
  return `name:${entry.name.toLowerCase()}`
}

/** Looks up a wishlist entry's GameData by app_id, or undefined if unmapped
 *  (no app_id, or no matching entry in the price/review dataset). */
function getGameDataForEntry(
  entry: WishlistEntry,
  gameDataByAppId: Record<string, GameData>,
): GameData | undefined {
  return entry.app_id != null ? gameDataByAppId[String(entry.app_id)] : undefined
}

/** Looks up a wishlist entry's GameInsight by app_id, or undefined if
 *  unmapped (no app_id, no insights data yet, or no matching entry). */
function getInsightForEntry(
  entry: WishlistEntry,
  insights: GameInsightsData | null,
) {
  return entry.app_id != null
    ? insights?.games[String(entry.app_id)]
    : undefined
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
  insights,
  gameDataByAppId,
  users,
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
        case 'price': {
          const aGame = getGameDataForEntry(a.entry, gameDataByAppId)
          const bGame = getGameDataForEntry(b.entry, gameDataByAppId)
          const aVal = aGame?.price_usd_full ?? null
          const bVal = bGame?.price_usd_full ?? null
          if (aVal == null && bVal == null) return 0
          if (aVal == null) return 1
          if (bVal == null) return -1
          return (aVal - bVal) * dir
        }
        case 'rating': {
          const aGame = getGameDataForEntry(a.entry, gameDataByAppId)
          const bGame = getGameDataForEntry(b.entry, gameDataByAppId)
          const aVal = aGame?.rating_percent ?? null
          const bVal = bGame?.rating_percent ?? null
          if (aVal == null && bVal == null) return 0
          if (aVal == null) return 1
          if (bVal == null) return -1
          if (aVal !== bVal) return (aVal - bVal) * dir
          // Tie-break by review_count desc, independent of sort direction.
          const aCount = aGame?.review_count ?? 0
          const bCount = bGame?.review_count ?? 0
          return bCount - aCount
        }
        case 'most_wanted': {
          const aVal = getInsightForEntry(a.entry, insights)?.wanters.length ?? 0
          const bVal = getInsightForEntry(b.entry, insights)?.wanters.length ?? 0
          return (aVal - bVal) * dir
        }
        case 'most_owned': {
          const aVal = getInsightForEntry(a.entry, insights)?.owners.length ?? 0
          const bVal = getInsightForEntry(b.entry, insights)?.owners.length ?? 0
          return (aVal - bVal) * dir
        }
      }
    })
    return filtered
  }, [
    ranked,
    debouncedSearch,
    minCount,
    givenFilter,
    sortKey,
    sortDir,
    gameDataByAppId,
    insights,
  ])

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
            {lastUpdated && (
              <LastUpdated lastUpdatedDate={lastUpdated} updateIntervalDays={14} />
            )}
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
              <SelectItem value="price">Price</SelectItem>
              <SelectItem value="rating">Rating</SelectItem>
              <SelectItem value="most_wanted">Most wanted</SelectItem>
              <SelectItem value="most_owned">Most owned</SelectItem>
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
          const cardGameData = getGameDataForEntry(entry, gameDataByAppId)
          const cardInsight = getInsightForEntry(entry, insights)
          const cardPriceText = formatPriceCents(cardGameData?.price_usd_full)
          const cardHasRating =
            cardGameData?.review_score_desc != null ||
            cardGameData?.rating_percent != null

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

                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 text-xs">
                    <Heart className="h-3 w-3 text-accent-rose" />
                    <span className="font-semibold text-foreground tabular-nums-strict">
                      {entry.wishlist_count}
                    </span>
                    <span className="text-muted-foreground">
                      {entry.wishlist_count === 1 ? 'wisher' : 'wishers'}
                    </span>
                  </div>
                  <GameInsightsPopover
                    entry={entry}
                    insights={insights}
                    gameDataByAppId={gameDataByAppId}
                    users={users}
                  />
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

                {(cardPriceText || cardHasRating) && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {cardPriceText && (
                      <span className="font-medium text-foreground">
                        {cardPriceText}
                      </span>
                    )}
                    {cardPriceText && cardHasRating && (
                      <span className="text-subtle">·</span>
                    )}
                    {cardHasRating && (
                      <span className={reviewToneClass(cardGameData?.review_score_desc)}>
                        {cardGameData?.review_score_desc}
                        {cardGameData?.review_score_desc &&
                          cardGameData?.rating_percent != null &&
                          ' · '}
                        {cardGameData?.rating_percent != null &&
                          `${cardGameData.rating_percent}%`}
                      </span>
                    )}
                  </p>
                )}

                <div className="mt-auto flex items-end justify-between gap-2">
                  {cardInsight ? (
                    <p
                      className="text-xs text-muted-foreground"
                      title="Based on members' public Steam libraries"
                    >
                      <span className="font-medium text-foreground tabular-nums-strict">
                        {cardInsight.owners.length}
                      </span>{' '}
                      already own
                    </p>
                  ) : (
                    <span />
                  )}
                  <a
                    href={`https://gg.deals/search/?${new URLSearchParams({ title: entry.name })}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex flex-shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Tag className="h-3 w-3" />
                    Find deals
                  </a>
                </div>
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
