'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import Image from 'next/image'
import DatePicker from 'react-datepicker'
import { startOfMonth, endOfMonth } from 'date-fns'
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  Download,
  Filter,
  Gamepad2,
  Globe2,
  LayoutGrid,
  List,
  Search,
  Sparkles,
  Trash2,
  UserCheck,
  Users as UsersIcon,
  X,
} from 'lucide-react'
import { getCVBadgeColor, getCVLabel } from '@/lib/data'
import { Giveaway, GameData } from '@/types'
import UserAvatar from '@/components/UserAvatar'
import { LastUpdated } from '@/components/LastUpdated'
import { useGameData, useDebounce } from '@/lib/hooks'
import FormattedDate, { TimeDifference } from '@/components/FormattedDate'
import { CvStatusIndicator } from '@/components/CvStatusIndicator'
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

const Masonry = dynamic<import('masonic').MasonryProps<Giveaway>>(
  () => import('masonic').then((m) => m.Masonry),
  { ssr: false },
)

interface Props {
  heading?: string
  giveaways: Giveaway[]
  lastUpdated: string | null
  userAvatars: Map<string, string>
  /** Map of steam_id to username for display */
  userNames?: Map<string, string>
  gameData: GameData[]
  defaultGiveawayStatus?: 'open' | 'ended' | 'all'
}

const PLACEHOLDER_IMAGE =
  'https://steamplayercount.com/theme/img/placeholder.svg'

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

  if (giveaway.deleted) {
    return (
      <Badge variant="error" size="sm">
        Deleted
      </Badge>
    )
  }
  if (isFuture) {
    return (
      <Badge variant="purple" size="sm">
        Not started
      </Badge>
    )
  }
  if (!isEnded) {
    return (
      <Badge variant="info" size="sm">
        Open
      </Badge>
    )
  }
  if (hasWinners) {
    return (
      <Badge variant="success" size="sm">
        Ended
      </Badge>
    )
  }
  return (
    <Badge variant="warning" size="sm">
      No winners
    </Badge>
  )
}

function getCardAccent(g: Giveaway): string {
  const now = Date.now() / 1000
  const isEnded = g.end_timestamp < now
  const isFuture = g.start_timestamp > now
  const hasWinners = g.winners && g.winners.length > 0
  if (g.deleted) return 'before:bg-[var(--error)]'
  if (isFuture) return 'before:bg-[var(--accent-purple)]'
  if (!isEnded) return 'before:bg-[var(--info)]'
  if (hasWinners) return 'before:bg-[var(--success)]'
  return 'before:bg-[var(--warning)]'
}

export default function GiveawaysClient({
  heading = 'All Giveaways',
  giveaways,
  lastUpdated,
  userAvatars,
  userNames,
  gameData,
  defaultGiveawayStatus = 'open',
}: Props) {
  const getDisplayName = (steamIdOrUsername: string) =>
    userNames?.get(steamIdOrUsername) || steamIdOrUsername
  const { getGameData } = useGameData(gameData)

  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearchTerm = useDebounce(searchTerm, 300)
  const [sortBy, setSortBy] = useState<
    'date' | 'author' | 'name' | 'cv' | 'points' | 'entries'
  >('date')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [filterCV, setFilterCV] = useState<
    'all' | 'FULL_CV' | 'REDUCED_CV' | 'NO_CV' | 'DECREASED_RATIO'
  >('all')
  const [giveawayStatus, setGiveawayStatus] = useState<
    'open' | 'ended' | 'all'
  >(defaultGiveawayStatus)
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set())

  // Chip filters via ToggleGroup multiple
  const [chipFilters, setChipFilters] = useState<string[]>([])
  const has = (k: string) => chipFilters.includes(k)

  // Date filter
  const [dateFilterMode, setDateFilterMode] = useState<
    'none' | 'range' | 'month'
  >('none')
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([
    null,
    null,
  ])
  const [selectedMonth, setSelectedMonth] = useState<Date | null>(null)
  const [startDate, endDate] = dateRange

  const maxEndDate = useMemo(() => {
    if (!giveaways || giveaways.length === 0) return null
    const maxTs = giveaways.reduce((max, g) => Math.max(max, g.end_timestamp), 0)
    return new Date(maxTs * 1000)
  }, [giveaways])

  const [compactView, setCompactView] = useState<boolean>(false)
  useEffect(() => {
    try {
      const saved =
        typeof window !== 'undefined'
          ? localStorage.getItem('giveawaysView')
          : null
      if (saved === 'compact') setCompactView(true)
    } catch {}
  }, [])
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(
          'giveawaysView',
          compactView ? 'compact' : 'expanded',
        )
      }
    } catch {}
  }, [compactView])

  // Export modal state
  type ExportFieldKey =
    | 'creator'
    | 'name'
    | 'link'
    | 'event'
    | 'cv'
    | 'points'
    | 'required_play'
    | 'shared'
    | 'restricted'
    | 'entries'
    | 'winner'
    | 'deleted'
    | 'deleted_reason'
  const [isExportModalOpen, setIsExportModalOpen] = useState(false)
  const DEFAULT_EXPORT_FIELDS: ExportFieldKey[] = [
    'creator',
    'name',
    'link',
    'event',
  ]
  const [selectedExportFields, setSelectedExportFields] =
    useState<ExportFieldKey[]>(DEFAULT_EXPORT_FIELDS)

  const EXPORT_FIELDS = useMemo(
    () => [
      {
        key: 'creator' as const,
        label: 'Created by',
        get: (g: Giveaway) => getDisplayName(g.creator) || '',
      },
      {
        key: 'name' as const,
        label: 'Giveaway',
        get: (g: Giveaway) => g.name || '',
      },
      {
        key: 'link' as const,
        label: 'Link',
        get: (g: Giveaway) => `https://www.steamgifts.com/giveaway/${g.link}`,
      },
      {
        key: 'event' as const,
        label: 'Event',
        get: (g: Giveaway) => (g.event_type as string) || '',
      },
      {
        key: 'cv' as const,
        label: 'CV type',
        get: (g: Giveaway) =>
          getCVLabel(g.cv_status || 'FULL_CV', !!g.decreased_ratio_info),
      },
      {
        key: 'points' as const,
        label: 'Points',
        get: (g: Giveaway) => String(g.points ?? ''),
      },
      {
        key: 'required_play' as const,
        label: 'Play required',
        get: (g: Giveaway) => (g.required_play ? 'Yes' : 'No'),
      },
      {
        key: 'shared' as const,
        label: 'Shared',
        get: (g: Giveaway) => (g.is_shared ? 'Yes' : 'No'),
      },
      {
        key: 'restricted' as const,
        label: 'Restricted',
        get: (g: Giveaway) => (g.region_restricted ? 'Yes' : 'No'),
      },
      {
        key: 'entries' as const,
        label: 'Entries',
        get: (g: Giveaway) => String(g.entry_count ?? ''),
      },
      {
        key: 'winner' as const,
        label: 'Winner',
        get: (g: Giveaway) =>
          g.winners && g.winners.length
            ? g.winners
                .map((w) => w.name || '')
                .filter(Boolean)
                .join('; ')
            : '',
      },
      {
        key: 'deleted' as const,
        label: 'Deleted',
        get: (g: Giveaway) => (g.deleted ? 'Yes' : 'No'),
      },
      {
        key: 'deleted_reason' as const,
        label: 'Deleted reason',
        get: (g: Giveaway) => g.deleted_reason || '',
      },
    ],
    [getDisplayName],
  )

  const filteredAndSortedGiveaways = useMemo(() => {
    const filtered = giveaways.filter((giveaway) => {
      const searchTermLower = debouncedSearchTerm.toLowerCase()
      const isExactIdMatch =
        debouncedSearchTerm.length === 5 &&
        giveaway.link.split('/')[0] === debouncedSearchTerm
      const matchesSearch =
        giveaway.name.toLowerCase().includes(searchTermLower) ||
        getDisplayName(giveaway.creator).toLowerCase().includes(searchTermLower)

      const matchesCV =
        filterCV === 'all' ||
        (filterCV === 'DECREASED_RATIO'
          ? !!giveaway.decreased_ratio_info
          : giveaway.cv_status === filterCV)
      const now = Date.now() / 1000
      const isEnded = giveaway.end_timestamp < now
      const matchesStatus = has('deleted')
        ? true
        : giveawayStatus === 'all' ||
          (giveawayStatus === 'open' && !isEnded && !giveaway.deleted) ||
          (giveawayStatus === 'ended' && (isEnded || giveaway.deleted))

      const matchesLabels =
        (!has('region') || giveaway.region_restricted) &&
        (!has('play') || giveaway.required_play) &&
        (!has('shared') || giveaway.is_shared) &&
        (!has('whitelist') || giveaway.whitelist) &&
        (!has('event') || giveaway.event_type) &&
        (!has('deleted') || giveaway.deleted)

      let matchesDate = true
      const endTimestamp = giveaway.end_timestamp
      if (dateFilterMode === 'range') {
        const startSec = startDate
          ? Math.floor(startDate.getTime() / 1000)
          : null
        const endSec = endDate
          ? Math.floor((endDate.getTime() + 24 * 60 * 60 * 1000 - 1) / 1000)
          : null
        if (startSec !== null && endSec !== null) {
          matchesDate = endTimestamp >= startSec && endTimestamp <= endSec
        } else if (startSec !== null) {
          matchesDate = endTimestamp >= startSec
        } else if (endSec !== null) {
          matchesDate = endTimestamp <= endSec
        }
      } else if (dateFilterMode === 'month' && selectedMonth) {
        const start = Math.floor(startOfMonth(selectedMonth).getTime() / 1000)
        const end = Math.floor(endOfMonth(selectedMonth).getTime() / 1000)
        matchesDate = endTimestamp >= start && endTimestamp <= end
      }

      return (
        isExactIdMatch ||
        (matchesSearch && matchesCV && matchesStatus && matchesLabels && matchesDate)
      )
    })

    filtered.sort((a, b) => {
      const now = Date.now() / 1000
      const aIsEnded = a.end_timestamp < now
      const bIsEnded = b.end_timestamp < now

      if (sortBy === 'date' && giveawayStatus === 'all' && aIsEnded !== bIsEnded) {
        return aIsEnded ? 1 : -1
      }

      let comparison = 0
      switch (sortBy) {
        case 'date': {
          const aStartInFuture = a.start_timestamp > now
          const bStartInFuture = b.start_timestamp > now
          if (sortDirection === 'asc' && aStartInFuture !== bStartInFuture) {
            return aStartInFuture ? -1 : 1
          }
          if (giveawayStatus === 'all' && aIsEnded && bIsEnded) {
            comparison = b.end_timestamp - a.end_timestamp
          } else {
            comparison = a.end_timestamp - b.end_timestamp
          }
          break
        }
        case 'author':
          comparison = getDisplayName(a.creator).localeCompare(
            getDisplayName(b.creator),
          )
          break
        case 'name':
          comparison = a.name.localeCompare(b.name)
          break
        case 'cv': {
          const lab = (g: Giveaway) =>
            g.decreased_ratio_info
              ? 'Decreased Ratio'
              : getCVLabel(g.cv_status || 'FULL_CV')
          comparison = lab(a).localeCompare(lab(b))
          break
        }
        case 'points':
          comparison = a.points - b.points
          break
        case 'entries':
          comparison = a.entry_count - b.entry_count
          break
      }
      return sortDirection === 'asc' ? comparison : -comparison
    })

    return filtered
  }, [
    giveaways,
    debouncedSearchTerm,
    sortBy,
    sortDirection,
    filterCV,
    giveawayStatus,
    chipFilters,
    dateFilterMode,
    startDate,
    endDate,
    selectedMonth,
    getDisplayName,
  ])

  const uniqueUsersCount = useMemo(() => {
    const creators = new Set<string>()
    for (const g of filteredAndSortedGiveaways) {
      creators.add(g.creator)
    }
    return creators.size
  }, [filteredAndSortedGiveaways])

  const handleExportConfirm = () => {
    try {
      const escapeCsv = (val: string) => {
        if (val == null) return ''
        const needsQuote = /[",\n]/.test(val)
        const escaped = val.replace(/"/g, '""')
        return needsQuote ? `"${escaped}"` : escaped
      }
      const fieldMap = EXPORT_FIELDS.reduce<
        Record<ExportFieldKey, { label: string; get: (g: Giveaway) => string }>
      >(
        (acc, f) => {
          acc[f.key] = { label: f.label, get: f.get }
          return acc
        },
        {} as Record<
          ExportFieldKey,
          { label: string; get: (g: Giveaway) => string }
        >,
      )

      const sorted = filteredAndSortedGiveaways
      const headers = selectedExportFields.map((k) => fieldMap[k].label)
      const csvLines: string[] = []
      csvLines.push(headers.join(','))
      for (const g of sorted) {
        const line = selectedExportFields.map((k) => escapeCsv(fieldMap[k].get(g)))
        csvLines.push(line.join(','))
      }
      const csvContent = csvLines.join('\n')
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const timestamp = new Date().toISOString().slice(0, 10)
      a.download = `giveaways_export_${timestamp}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {}
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            {heading}
          </h1>
          {lastUpdated && (
            <div className="mt-1 text-sm text-muted-foreground">
              <LastUpdated lastUpdatedDate={lastUpdated} />
            </div>
          )}
        </div>
      </div>

      <Toolbar>
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search games or creators..."
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={sortBy}
            onValueChange={(v) =>
              setSortBy(v as 'date' | 'author' | 'name' | 'cv' | 'points' | 'entries')
            }
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">End date</SelectItem>
              <SelectItem value="author">Author (A–Z)</SelectItem>
              <SelectItem value="name">Name (A–Z)</SelectItem>
              <SelectItem value="cv">CV type</SelectItem>
              <SelectItem value="points">Points</SelectItem>
              <SelectItem value="entries">Entries</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            aria-label={`Sort ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
            onClick={() =>
              setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
            }
          >
            {sortDirection === 'asc' ? (
              <ArrowUp className="h-4 w-4" />
            ) : (
              <ArrowDown className="h-4 w-4" />
            )}
          </Button>
          <Select value={filterCV} onValueChange={(v) => setFilterCV(v as typeof filterCV)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="CV status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All CV types</SelectItem>
              <SelectItem value="FULL_CV">Full CV</SelectItem>
              <SelectItem value="REDUCED_CV">Reduced CV</SelectItem>
              <SelectItem value="NO_CV">No CV</SelectItem>
              <SelectItem value="DECREASED_RATIO">Decreased Ratio</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={giveawayStatus}
            onValueChange={(v) =>
              setGiveawayStatus(v as 'open' | 'ended' | 'all')
            }
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All giveaways</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="ended">Ended</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={dateFilterMode}
            onValueChange={(v) =>
              setDateFilterMode(v as 'none' | 'range' | 'month')
            }
          >
            <SelectTrigger className="w-[140px]">
              <Calendar className="h-3.5 w-3.5 text-subtle mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Any date</SelectItem>
              <SelectItem value="range">Between dates</SelectItem>
              <SelectItem value="month">By month</SelectItem>
            </SelectContent>
          </Select>
          {dateFilterMode === 'range' && (
            <DatePicker
              selectsRange
              startDate={startDate}
              endDate={endDate}
              onChange={(update) =>
                setDateRange(update as [Date | null, Date | null])
              }
              isClearable
              placeholderText="Pick a range"
              maxDate={maxEndDate ?? undefined}
              className="h-9 rounded-md border border-card-border bg-background-elevated px-3 text-sm"
            />
          )}
          {dateFilterMode === 'month' && (
            <DatePicker
              selected={selectedMonth}
              onChange={(date) => setSelectedMonth(date)}
              dateFormat="MMMM yyyy"
              showMonthYearPicker
              isClearable
              placeholderText="Pick a month"
              maxDate={maxEndDate ?? undefined}
              className="h-9 rounded-md border border-card-border bg-background-elevated px-3 text-sm"
            />
          )}
        </div>
      </Toolbar>

      <ToggleGroup
        type="multiple"
        value={chipFilters}
        onValueChange={(v) => setChipFilters(v ?? [])}
        size="sm"
        className="flex-wrap"
      >
        <ToggleGroupItem value="region" aria-label="Region restricted">
          <Globe2 className="h-3.5 w-3.5" /> Restricted
        </ToggleGroupItem>
        <ToggleGroupItem value="play" aria-label="Play required">
          <Gamepad2 className="h-3.5 w-3.5" /> Play required
        </ToggleGroupItem>
        <ToggleGroupItem value="event" aria-label="Group event">
          <Sparkles className="h-3.5 w-3.5" /> Group event
        </ToggleGroupItem>
        <ToggleGroupItem value="shared" aria-label="Shared">
          <UsersIcon className="h-3.5 w-3.5" /> Shared
        </ToggleGroupItem>
        <ToggleGroupItem value="whitelist" aria-label="Whitelist">
          <UserCheck className="h-3.5 w-3.5" /> Whitelist
        </ToggleGroupItem>
        <ToggleGroupItem value="deleted" aria-label="Deleted">
          <Trash2 className="h-3.5 w-3.5" /> Deleted
        </ToggleGroupItem>
        {chipFilters.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setChipFilters([])}
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </ToggleGroup>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted-foreground">
          Showing{' '}
          <span className="font-medium text-foreground tabular-nums-strict">
            {filteredAndSortedGiveaways.length.toLocaleString()}
          </span>{' '}
          of{' '}
          <span className="font-medium text-foreground tabular-nums-strict">
            {giveaways.length.toLocaleString()}
          </span>{' '}
          giveaways by{' '}
          <span className="font-medium text-foreground tabular-nums-strict">
            {uniqueUsersCount}
          </span>{' '}
          users
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsExportModalOpen(true)}
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
          <ToggleGroup
            type="single"
            value={compactView ? 'compact' : 'expanded'}
            onValueChange={(v) =>
              v && setCompactView(v === 'compact')
            }
            size="sm"
          >
            <ToggleGroupItem value="expanded" aria-label="Expanded view">
              <LayoutGrid className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="compact" aria-label="Compact view">
              <List className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      <Masonry
        key={[
          filteredAndSortedGiveaways.length,
          sortBy,
          sortDirection,
          giveawayStatus,
          filterCV,
          dateFilterMode,
          startDate?.getTime() ?? 0,
          endDate?.getTime() ?? 0,
          selectedMonth?.getTime() ?? 0,
          chipFilters.join(','),
          compactView ? 1 : 0,
        ].join('-')}
        items={filteredAndSortedGiveaways}
        columnGutter={20}
        columnWidth={compactView ? 480 : 360}
        overscanBy={3}
        itemKey={(g, i) => (g && (g as Giveaway).id) || `item-${i}`}
        render={({ data: giveaway }) => {
          const isEnded = giveaway.end_timestamp < Date.now() / 1000
          const isFuture = giveaway.start_timestamp > Date.now() / 1000
          const imageUrl = failedImages.has(giveaway.id)
            ? PLACEHOLDER_IMAGE
            : getGameImageUrl(giveaway)
          const accent = getCardAccent(giveaway)
          const game = getGameData(giveaway.app_id ?? giveaway.package_id)

          if (compactView) {
            return (
              <Card
                className={cn(
                  'relative w-full overflow-hidden p-4',
                  'before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:z-10',
                  accent,
                  giveaway.deleted && 'opacity-60',
                )}
              >
                <div className="flex items-start gap-4">
                  <a
                    href={`https://store.steampowered.com/${giveaway.app_id ? `app/${giveaway.app_id}` : `sub/${giveaway.package_id}`}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative aspect-[460/215] w-32 flex-shrink-0 overflow-hidden rounded-md bg-card-background-hover"
                  >
                    <Image
                      src={imageUrl}
                      alt={giveaway.name || 'Game'}
                      width={460}
                      height={215}
                      className="h-full w-full object-cover"
                      unoptimized
                      onError={() =>
                        setFailedImages((prev) => new Set([...prev, giveaway.id]))
                      }
                    />
                  </a>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex items-center gap-2">
                        <a
                          href={`https://www.steamgifts.com/giveaway/${giveaway.link}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="line-clamp-1 text-sm font-semibold text-foreground hover:text-accent hover:underline"
                        >
                          {giveaway.name}{' '}
                          <span className="font-mono text-xs text-muted-foreground">
                            ({giveaway.points}P)
                          </span>
                        </a>
                        <CvStatusIndicator giveaway={giveaway} />
                      </div>
                      <div className="flex-shrink-0">
                        {getStatusBadge(giveaway)}
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <UserAvatar
                          src={
                            userAvatars.get(giveaway.creator) ||
                            'https://cdn-icons-png.flaticon.com/512/9287/9287610.png'
                          }
                          username={getDisplayName(giveaway.creator)}
                        />
                        <Link
                          href={`/users/${getDisplayName(giveaway.creator)}`}
                          className="truncate text-foreground hover:text-accent hover:underline"
                        >
                          {getDisplayName(giveaway.creator)}
                        </Link>
                      </div>
                      <div className="text-muted-foreground">
                        <FormattedDate timestamp={giveaway.end_timestamp} />
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {giveaway.deleted && (
                        <Badge variant="error" size="sm">
                          <Trash2 className="h-3 w-3" /> Deleted
                        </Badge>
                      )}
                      {giveaway.region_restricted && (
                        <Badge variant="info" size="sm">
                          <Globe2 className="h-3 w-3" /> Restricted
                        </Badge>
                      )}
                      {giveaway.required_play && (
                        <Badge variant="warning" size="sm">
                          <Gamepad2 className="h-3 w-3" /> Play required
                        </Badge>
                      )}
                      {giveaway.event_type && (
                        <Badge variant="purple" size="sm">
                          <Sparkles className="h-3 w-3" /> Event
                        </Badge>
                      )}
                      {giveaway.is_shared && (
                        <Badge variant="info" size="sm">
                          <UsersIcon className="h-3 w-3" /> Shared
                        </Badge>
                      )}
                      {giveaway.whitelist && (
                        <Badge variant="info" size="sm">
                          <UserCheck className="h-3 w-3" /> Whitelist
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            )
          }

          return (
            <Card
              className={cn(
                'group relative w-full overflow-hidden p-0 transition-all hover:border-card-border-strong hover:shadow-md',
                'before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:z-20 before:rounded-r-full',
                accent,
                giveaway.deleted && 'opacity-60',
              )}
            >
              <a
                href={`https://store.steampowered.com/${giveaway.app_id ? `app/${giveaway.app_id}` : `sub/${giveaway.package_id}`}`}
                target="_blank"
                rel="noopener noreferrer"
                className="relative block aspect-[460/215] bg-card-background-hover"
              >
                <Image
                  src={imageUrl}
                  alt={giveaway.name || 'Game'}
                  fill
                  unoptimized
                  className="object-cover"
                  onError={() =>
                    setFailedImages((prev) => new Set([...prev, giveaway.id]))
                  }
                />
                <div className="absolute top-2 right-2">
                  {getStatusBadge(giveaway)}
                </div>
              </a>

              <div className="space-y-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <a
                    href={`https://www.steamgifts.com/giveaway/${giveaway.link}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="line-clamp-2 text-base font-semibold text-foreground hover:text-accent hover:underline"
                  >
                    {giveaway.name}{' '}
                    <span className="font-mono text-sm text-muted-foreground">
                      ({giveaway.points}P)
                    </span>
                    <span className="ml-1.5 inline-flex">
                      <CvStatusIndicator giveaway={giveaway} />
                    </span>
                  </a>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-muted-foreground">Creator</dt>
                  <dd className="flex items-center gap-1.5 justify-end">
                    <UserAvatar
                      src={
                        userAvatars.get(giveaway.creator) ||
                        'https://cdn-icons-png.flaticon.com/512/9287/9287610.png'
                      }
                      username={getDisplayName(giveaway.creator)}
                    />
                    <Link
                      href={`/users/${getDisplayName(giveaway.creator)}`}
                      className="truncate text-foreground hover:text-accent hover:underline"
                    >
                      {getDisplayName(giveaway.creator)}
                    </Link>
                  </dd>

                  <dt className="text-muted-foreground">Copies</dt>
                  <dd className="text-right tabular-nums-strict">
                    {giveaway.copies}
                  </dd>

                  <dt className="text-muted-foreground">Entries</dt>
                  <dd className="text-right tabular-nums-strict">
                    {giveaway.entry_count}
                  </dd>

                  <dt className="text-muted-foreground">
                    {isFuture ? 'Starts' : 'Started'}
                  </dt>
                  <dd className="text-right text-muted-foreground">
                    <FormattedDate timestamp={giveaway.start_timestamp} />
                  </dd>

                  <dt className="text-muted-foreground">
                    {isEnded ? 'Ended' : 'Ends'}
                  </dt>
                  <dd className="text-right text-foreground font-medium">
                    <FormattedDate timestamp={giveaway.end_timestamp} />
                  </dd>

                  <dt className="text-muted-foreground">Duration</dt>
                  <dd className="text-right text-muted-foreground">
                    <TimeDifference
                      startTimestamp={giveaway.start_timestamp}
                      endTimestamp={giveaway.end_timestamp}
                    />
                  </dd>

                  {game && 'hltb_main_story_hours' in game && (
                    <>
                      <dt className="text-muted-foreground">How long to beat</dt>
                      <dd className="text-right text-muted-foreground">
                        {game?.hltb_main_story_hours == null
                          ? 'N/A'
                          : `${game?.hltb_main_story_hours}h`}
                      </dd>
                    </>
                  )}
                </dl>

                {(giveaway.deleted ||
                  giveaway.region_restricted ||
                  giveaway.required_play ||
                  giveaway.event_type ||
                  giveaway.is_shared ||
                  giveaway.whitelist) && (
                  <div className="flex flex-wrap gap-1.5 pt-2">
                    {giveaway.deleted && (
                      <Badge variant="error" size="sm">
                        <Trash2 className="h-3 w-3" /> Deleted
                      </Badge>
                    )}
                    {giveaway.region_restricted && (
                      <Badge variant="info" size="sm">
                        <Globe2 className="h-3 w-3" /> Restricted
                      </Badge>
                    )}
                    {giveaway.required_play && (
                      <Badge variant="warning" size="sm">
                        <Gamepad2 className="h-3 w-3" /> Play required
                      </Badge>
                    )}
                    {giveaway.event_type && (
                      <Badge variant="purple" size="sm">
                        <Sparkles className="h-3 w-3" /> Event
                      </Badge>
                    )}
                    {giveaway.is_shared && (
                      <Badge variant="info" size="sm">
                        <UsersIcon className="h-3 w-3" /> Shared
                      </Badge>
                    )}
                    {giveaway.whitelist && (
                      <Badge variant="info" size="sm">
                        <UserCheck className="h-3 w-3" /> Whitelist
                      </Badge>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <span
                    className={cn(
                      'text-xs font-bold px-2 py-1 rounded-full',
                      getCVBadgeColor(
                        giveaway.cv_status || 'FULL_CV',
                        !!giveaway.decreased_ratio_info,
                      ),
                    )}
                  >
                    {getCVLabel(
                      giveaway.cv_status || 'FULL_CV',
                      !!giveaway.decreased_ratio_info,
                    )}
                  </span>
                </div>

                {giveaway.winners && giveaway.winners.length > 0 && (
                  <div className="border-t border-card-border pt-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                      Winners
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {giveaway.winners.map((winner, index) => {
                        const winnerDisplayName = winner.name
                          ? getDisplayName(winner.name)
                          : null
                        if (!winner.name) {
                          return (
                            <Badge key={index} variant="warning" size="sm">
                              Awaiting feedback
                            </Badge>
                          )
                        }
                        return userAvatars.get(winner.name) ? (
                          <Link
                            key={index}
                            href={`/users/${winnerDisplayName}`}
                            className="inline-flex items-center gap-1.5 rounded-full border border-card-border bg-card-background-hover px-2 py-0.5 text-xs hover:border-card-border-strong"
                          >
                            <UserAvatar
                              src={
                                userAvatars.get(winner.name) ||
                                'https://cdn-icons-png.flaticon.com/512/9287/9287610.png'
                              }
                              username={winnerDisplayName!}
                            />
                            <span>{winnerDisplayName}</span>
                          </Link>
                        ) : (
                          <a
                            key={index}
                            href={`http://steamgifts.com/user/${winnerDisplayName}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-full border border-card-border bg-card-background-hover px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:border-card-border-strong"
                          >
                            <UserAvatar
                              src={
                                'https://cdn-icons-png.flaticon.com/512/9287/9287610.png'
                              }
                              username={winnerDisplayName!}
                            />
                            <span>{winnerDisplayName}</span>
                            <span className="text-subtle">(ex)</span>
                          </a>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )
        }}
      />

      {filteredAndSortedGiveaways.length === 0 && (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <Filter className="h-8 w-8 text-subtle" />
          <p className="text-sm text-muted-foreground">
            No giveaways match the current filters.
          </p>
        </Card>
      )}

      {isExportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsExportModalOpen(false)}
          />
          <Card className="relative mx-4 w-full max-w-lg p-6 shadow-2xl">
            <h2 className="text-lg font-semibold">Export to CSV</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick the columns to include in the export.
            </p>
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {EXPORT_FIELDS.map((f) => (
                <label
                  key={f.key}
                  className="flex items-center gap-2 rounded-md border border-card-border bg-background-elevated px-3 py-2 text-sm cursor-pointer hover:bg-card-background-hover"
                >
                  <input
                    type="checkbox"
                    checked={selectedExportFields.includes(f.key)}
                    onChange={(e) => {
                      setSelectedExportFields((prev) => {
                        if (e.target.checked) {
                          return Array.from(
                            new Set([...prev, f.key]),
                          ) as ExportFieldKey[]
                        }
                        return prev.filter((k) => k !== f.key)
                      })
                    }}
                    className="rounded border-card-border accent-primary"
                  />
                  <span>{f.label}</span>
                </label>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setSelectedExportFields(DEFAULT_EXPORT_FIELDS)}
              >
                Reset to defaults
              </Button>
              <Button
                variant="outline"
                onClick={() => setIsExportModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  handleExportConfirm()
                  setIsExportModalOpen(false)
                }}
              >
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
