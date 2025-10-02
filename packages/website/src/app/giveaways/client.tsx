'use client'

import { useState, useMemo, useEffect } from 'react'
import DatePicker from 'react-datepicker'
import { startOfMonth, endOfMonth } from 'date-fns'
import { getCVBadgeColor, getCVLabel } from '@/lib/data'
import { Giveaway, GameData } from '@/types'
import Link from 'next/link'
import Image from 'next/image'
import UserAvatar from '@/components/UserAvatar'
import { LastUpdated } from '@/components/LastUpdated'
import { useGameData, useDebounce } from '@/lib/hooks'
import FormattedDate, { TimeDifference } from '@/components/FormattedDate'
import { CvStatusIndicator } from '@/components/CvStatusIndicator'
import dynamic from 'next/dynamic'
const Masonry = dynamic<import('masonic').MasonryProps<Giveaway>>(
  () => import('masonic').then(m => m.Masonry),
  { ssr: false }
)

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
  const debouncedSearchTerm = useDebounce(searchTerm, 300)
  const [sortBy, setSortBy] = useState<'date' | 'author' | 'name' | 'cv' | 'points' | 'entries'>('date')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [filterCV, setFilterCV] = useState<'all' | 'FULL_CV' | 'REDUCED_CV' | 'NO_CV'>('all')
  const [giveawayStatus, setGiveawayStatus] = useState<'open' | 'ended' | 'all'>(defaultGiveawayStatus)
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set())

  // Add new state variables for label filters
  const [filterRegion, setFilterRegion] = useState<boolean>(false)
  const [filterPlayRequired, setFilterPlayRequired] = useState<boolean>(false)
  const [filterShared, setFilterShared] = useState<boolean>(false)
  const [filterWhitelist, setFilterWhitelist] = useState<boolean>(false)
  const [filterEvent, setFilterEvent] = useState<boolean>(false)

  // Date filter state
  const [dateFilterMode, setDateFilterMode] = useState<'none' | 'range' | 'month'>('none')
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null])
  const [selectedMonth, setSelectedMonth] = useState<Date | null>(null)
  const [startDate, endDate] = dateRange

  // Latest giveaway end date to cap calendars
  const maxEndDate = useMemo(() => {
    if (!giveaways || giveaways.length === 0) return null
    const maxTs = giveaways.reduce((max, g) => Math.max(max, g.end_timestamp), 0)
    return new Date(maxTs * 1000)
  }, [giveaways])

  // Compact view
  const [compactView, setCompactView] = useState<boolean>(false)

  // Persist compact view preference
  useEffect(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('giveawaysView') : null
      if (saved === 'compact') {
        setCompactView(true)
      }
    } catch {}
  }, [])
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('giveawaysView', compactView ? 'compact' : 'expanded')
      }
    } catch {}
  }, [compactView])

  // Export modal state
  type ExportFieldKey = 'creator' | 'name' | 'link' | 'event' | 'cv' | 'points' | 'required_play' | 'shared' | 'restricted' | 'entries' | 'winner'
  const [isExportModalOpen, setIsExportModalOpen] = useState(false)
  const DEFAULT_EXPORT_FIELDS: ExportFieldKey[] = ['creator', 'name', 'link', 'event']
  const [selectedExportFields, setSelectedExportFields] = useState<ExportFieldKey[]>(DEFAULT_EXPORT_FIELDS)

  const EXPORT_FIELDS = useMemo(() => ([
    { key: 'creator' as const, label: 'Created by', get: (g: Giveaway) => g.creator || '' },
    { key: 'name' as const, label: 'Giveaway', get: (g: Giveaway) => g.name || '' },
    { key: 'link' as const, label: 'Link', get: (g: Giveaway) => `https://www.steamgifts.com/giveaway/${g.link}` },
    { key: 'event' as const, label: 'Event', get: (g: Giveaway) => (g.event_type as string) || '' },
    { key: 'cv' as const, label: 'CV type', get: (g: Giveaway) => getCVLabel(g.cv_status || 'FULL_CV') },
    { key: 'points' as const, label: 'Points', get: (g: Giveaway) => String(g.points ?? '') },
    { key: 'required_play' as const, label: 'Play required', get: (g: Giveaway) => (g.required_play ? 'Yes' : 'No') },
    { key: 'shared' as const, label: 'Shared', get: (g: Giveaway) => (g.is_shared ? 'Yes' : 'No') },
    { key: 'restricted' as const, label: 'Restricted', get: (g: Giveaway) => (g.region_restricted ? 'Yes' : 'No') },
    { key: 'entries' as const, label: 'Entries', get: (g: Giveaway) => String(g.entry_count ?? '') },
    { key: 'winner' as const, label: 'Winner', get: (g: Giveaway) => (g.winners && g.winners.length ? g.winners.map(w => w.name || '').filter(Boolean).join('; ') : '') },
  ]), [])

  const filteredAndSortedGiveaways = useMemo(() => {
    const filtered = giveaways.filter(giveaway => {
      const searchTermLower = debouncedSearchTerm.toLowerCase()
      const isExactIdMatch = (debouncedSearchTerm.length === 5 && giveaway.link.split('/')[0] === debouncedSearchTerm)
      const matchesSearch = giveaway.name.toLowerCase().includes(searchTermLower) ||
        giveaway.creator.toLowerCase().includes(searchTermLower)

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
        (!filterWhitelist || giveaway.whitelist) &&
        (!filterEvent || giveaway.event_type)
      )

      // Date filters: we filter by end date window
      let matchesDate = true
      const endTimestamp = giveaway.end_timestamp

      if (dateFilterMode === 'range') {
        const startSec = startDate ? Math.floor(startDate.getTime() / 1000) : null
        const endSec = endDate ? Math.floor((endDate.getTime() + 24 * 60 * 60 * 1000 - 1) / 1000) : null
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

      return isExactIdMatch || (matchesSearch && matchesCV && matchesStatus && matchesLabels && matchesDate)
    })

    filtered.sort((a, b) => {
      const now = Date.now() / 1000
      const aIsEnded = a.end_timestamp < now
      const bIsEnded = b.end_timestamp < now

      // When showing all giveaways, group open first then ended
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
          comparison = a.creator.localeCompare(b.creator)
          break
        case 'name':
          comparison = a.name.localeCompare(b.name)
          break
        case 'cv':
          comparison = getCVLabel(a.cv_status || 'FULL_CV').localeCompare(getCVLabel(b.cv_status || 'FULL_CV'))
          break
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
  }, [giveaways, debouncedSearchTerm, sortBy, sortDirection, filterCV, giveawayStatus,
    filterRegion, filterPlayRequired, filterShared, filterWhitelist, filterEvent,
    dateFilterMode, startDate, endDate, selectedMonth])

  // Unique users in the currently filtered giveaways
  const uniqueUsersCount = useMemo(() => {
    const creators = new Set<string>()
    for (const g of filteredAndSortedGiveaways) {
      creators.add(g.creator)
    }
    return creators.size
  }, [filteredAndSortedGiveaways])

  // Build and download CSV from selected fields
  const handleExportConfirm = () => {
    try {
      const escapeCsv = (val: string) => {
        if (val == null) return ''
        const needsQuote = /[",\n]/.test(val)
        const escaped = val.replace(/"/g, '""')
        return needsQuote ? `"${escaped}"` : escaped
      }

      // Map for quick lookup
      const fieldMap = EXPORT_FIELDS.reduce<Record<ExportFieldKey, { label: string; get: (g: Giveaway) => string }>>((acc, f) => {
        acc[f.key] = { label: f.label, get: f.get }
        return acc
      }, {} as Record<ExportFieldKey, { label: string; get: (g: Giveaway) => string }>)

      // Use current on-screen order
      const sorted = filteredAndSortedGiveaways

      const headers = selectedExportFields.map(k => fieldMap[k].label)
      const csvLines: string[] = []
      csvLines.push(headers.join(','))
      for (const g of sorted) {
        const line = selectedExportFields.map(k => escapeCsv(fieldMap[k].get(g)))
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
                onChange={(e) => setSortBy(e.target.value as 'date' | 'author' | 'name' | 'cv' | 'points' | 'entries')}
                className="flex-1 px-3 py-2 border border-card-border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="date">End Date</option>
                <option value="author">Author (A–Z)</option>
                <option value="name">Giveaway (A–Z)</option>
                <option value="cv">CV Type</option>
                <option value="points">Points</option>
                <option value="entries">Entries</option>
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
              Date Filter
            </label>
            <div className="flex items-center gap-2">
              <span role="img" aria-label="Calendar" title="Date Filter" className="text-muted-foreground">📅</span>
              <select
                value={dateFilterMode}
                onChange={(e) => setDateFilterMode(e.target.value as 'none' | 'range' | 'month')}
                className="flex-1 px-3 py-2 border border-card-border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="none">All Dates</option>
                <option value="range">Between Dates</option>
                <option value="month">By Month</option>
              </select>
            </div>
            {dateFilterMode === 'range' && (
              <div className="mt-2">
                <DatePicker
                  selectsRange
                  startDate={startDate}
                  endDate={endDate}
                  onChange={(update) => setDateRange(update as [Date | null, Date | null])}
                  isClearable
                  placeholderText="Select date range"
                  maxDate={maxEndDate ?? undefined}
                  className="w-full px-3 py-2 border border-card-border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            )}
            {dateFilterMode === 'month' && (
              <div className="mt-2">
                <DatePicker
                  selected={selectedMonth}
                  onChange={(date) => setSelectedMonth(date)}
                  dateFormat="MMMM yyyy"
                  showMonthYearPicker
                  isClearable
                  placeholderText="Select month"
                  maxDate={maxEndDate ?? undefined}
                  className="w-full px-3 py-2 border border-card-border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            )}
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
          <div className="flex flex-wrap gap-3 items-center">
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
              onClick={() => setFilterEvent(prev => !prev)}
              className={`px-3 py-2 text-sm rounded-full transition-colors ${filterEvent
                ? 'bg-warning-light text-warning-foreground'
                : 'bg-transparent border border-card-border hover:bg-accent/10'
                }`}
            >
              🔥 Group Event
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

            {/* Compact view toggle moved to results summary */}
          </div>
        </div>
      </div>

      {/* Giveaways List */}

      {/* Results Summary */}
      <div className="text-sm text-muted-foreground flex items-center justify-between">
        <div>
          Showing {filteredAndSortedGiveaways.length} of {giveaways.length} giveaways by {uniqueUsersCount} users
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsExportModalOpen(true)}
            className="px-2 py-1 border border-card-border rounded-md bg-transparent hover:bg-accent/10 focus:outline-none focus:ring-2 focus:ring-accent"
            title="Export CSV"
          >
            📩 Export
          </button>
          <div className="inline-flex items-center border border-card-border rounded-md overflow-hidden" title="Toggle view">
          <button
            aria-label="Compact view"
            onClick={() => setCompactView(true)}
            className={`px-2 py-1 ${compactView ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/10'}`}
          >
            ▦
          </button>
          <div className="h-6 w-px bg-card-border" />
          <button
            aria-label="Expanded view"
            onClick={() => setCompactView(false)}
            className={`px-2 py-1 ${!compactView ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/10'}`}
          >
            ▭
          </button>
          </div>
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
          filterRegion ? 1 : 0,
          filterPlayRequired ? 1 : 0,
          filterShared ? 1 : 0,
          filterWhitelist ? 1 : 0,
          filterEvent ? 1 : 0,
          compactView ? 1 : 0,
        ].join('-')}
        items={filteredAndSortedGiveaways}
        columnGutter={24}
        columnWidth={360}
        overscanBy={3}
        itemKey={(g, i) => (g && (g as Giveaway).id) || `item-${i}`}
        render={({ data: giveaway }) => {
          const isEnded = giveaway.end_timestamp < Date.now() / 1000;
          const imageUrl = failedImages.has(giveaway.id) ? PLACEHOLDER_IMAGE : getGameImageUrl(giveaway);
          const isFuture = giveaway.start_timestamp > Date.now() / 1000;
          const borderColor = isEnded ? 'border-card-border' : isFuture ? 'border-accent-purple' : 'border-success';
          const gameData = getGameData(giveaway.app_id ?? giveaway.package_id)

          if (compactView) {
            return (
              <div className={`w-full bg-card-background rounded-lg border-2 ${borderColor} p-4 flex items-start gap-4`}>
                <div className="flex-shrink-0">
                  <a href={`https://store.steampowered.com/${giveaway.app_id ? `app/${giveaway.app_id}` : `sub/${giveaway.package_id}`}`} target="_blank" rel="noopener noreferrer">
                    <Image
                      src={imageUrl}
                      alt={giveaway.name || 'Game giveaway image'}
                      width={96}
                      height={54}
                      className="object-cover rounded"
                      onError={() => {
                        setFailedImages(prev => new Set([...prev, giveaway.id]))
                      }}
                    />
                  </a>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex items-center gap-2">
                      <a
                        href={`https://www.steamgifts.com/giveaway/${giveaway.link}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline font-semibold line-clamp-1"
                      >{giveaway.name} ({giveaway.points}P)</a>
                      <CvStatusIndicator giveaway={giveaway} />
                    </div>
                    <div className="flex-shrink-0 ml-2">{getStatusBadge(giveaway)}</div>
                  </div>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2 min-w-0">
                      <UserAvatar
                        src={userAvatars.get(giveaway.creator) || 'https://cdn-icons-png.flaticon.com/512/9287/9287610.png'}
                        username={giveaway.creator}
                      />
                      <Link href={`/users/${giveaway.creator}`} className="hover:underline text-foreground truncate">{giveaway.creator}</Link>
                    </div>
                    <div className="flex items-center justify-start gap-1 text-foreground"><FormattedDate timestamp={giveaway.end_timestamp} /></div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {giveaway.region_restricted && (
                      <span className="text-[10px] font-medium px-2 py-0.5 bg-info-light text-info-foreground rounded-full">🌍 Restricted</span>
                    )}
                    {giveaway.required_play && (
                      <span className="text-[10px] font-medium px-2 py-0.5 bg-warning-light text-warning-foreground rounded-full">🎮 Play Required</span>
                    )}
                    {giveaway.event_type && (
                      <span className="text-[10px] font-medium px-2 py-0.5 bg-accent-purple text-white rounded-full">🔥 Group Event</span>
                    )}
                    {giveaway.is_shared && (
                      <span className="text-[10px] font-medium px-2 py-0.5 bg-info-light text-info-foreground rounded-full">👥 Shared</span>
                    )}
                    {giveaway.whitelist && (
                      <span className="text-[10px] font-medium px-2 py-0.5 bg-info-light text-info-foreground rounded-full">🩵 Whitelist</span>
                    )}
                  </div>
                </div>
              </div>
            )
          }

          return (
            <div className={`w-full bg-card-background rounded-lg shadow-md hover:shadow-lg transition-shadow overflow-hidden border-2 ${borderColor}`}>
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
                  >{giveaway.name} ({giveaway.points}P) <CvStatusIndicator giveaway={giveaway} /></a>
                  <div className="ml-2 flex-shrink-0">
                    {getStatusBadge(giveaway)}
                  </div>
                </div>

                <div className="space-y-2 mb-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Creator:</span>
                    <div className="flex items-center">
                      <UserAvatar
                        src={userAvatars.get(giveaway.creator) || 'https://cdn-icons-png.flaticon.com/512/9287/9287610.png'}
                        username={giveaway.creator}
                      />
                      <Link href={`/users/${giveaway.creator}`} className="text-accent hover:underline mr-2 inline-flex items-center">
                        {giveaway.creator}
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
                    {giveaway.event_type && (
                      <span className="text-xs font-medium px-2 py-1 bg-accent-purple text-white rounded-full">
                        🔥 Group Event
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
        }}
      />
      {/* Export Modal */}
      {isExportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setIsExportModalOpen(false)} />
          <div className="relative bg-card-background border border-card-border rounded-lg shadow-xl w-full max-w-lg mx-4 p-6">
            <h2 className="text-lg font-semibold mb-4">What would you like to export?</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
              {EXPORT_FIELDS.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedExportFields.includes(f.key)}
                    onChange={(e) => {
                      setSelectedExportFields(prev => {
                        if (e.target.checked) {
                          return Array.from(new Set([...prev, f.key])) as ExportFieldKey[]
                        }
                          return prev.filter(k => k !== f.key)
                      })
                    }}
                  />
                  <span>{f.label}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-2 border border-card-border rounded-md hover:bg-accent/10"
                onClick={() => {
                  setSelectedExportFields(DEFAULT_EXPORT_FIELDS)
                }}
              >
                Reset to defaults
              </button>
              <button
                className="px-3 py-2 border border-card-border rounded-md hover:bg-accent/10"
                onClick={() => setIsExportModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-2 bg-accent text-accent-foreground rounded-md"
                onClick={() => {
                  handleExportConfirm()
                  setIsExportModalOpen(false)
                }}
              >
                Export CSV
              </button>
            </div>
          </div>
        </div>
      )}
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
