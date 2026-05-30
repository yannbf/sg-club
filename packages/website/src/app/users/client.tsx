'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Coins,
  Filter,
  Gamepad2,
  Scale,
  Search,
  TrendingDown,
  Trophy,
  X,
} from 'lucide-react'
import { formatPlaytime } from '@/lib/data'
import { User } from '@/types'
import FormattedDate from '@/components/FormattedDate'
import { LastUpdated } from '@/components/LastUpdated'
import {
  getUnplayedGamesStats,
  UnplayedGamesStats,
} from '@/components/UnplayedGamesStats'
import { getWarningsSeverity } from './[username]/UserDetailPageClient'
import Tooltip from '@/components/Tooltip'
import { getUserRatio } from './util'
import { useIsAdmin } from '@/lib/auth'
import { UserLink, steamGiftsProfile } from '@/components/UserLink'
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
  users: User[]
  exMembers?: User[]
  lastUpdated?: number | null
  heading?: string
  description?: string
}

type SortKey =
  | 'username'
  | 'sent'
  | 'received'
  | 'difference'
  | 'value'
  | 'playtime'
  | 'ratio'
  | 'last_created'
  | 'last_won'
  | 'play_rate'
  | 'achievements'

type SortDir = 'asc' | 'desc'

function getTotalPlaytime(user: User) {
  if (!user.giveaways_won) return 0
  return user.giveaways_won.reduce(
    (total, game) => total + (game.steam_play_data?.playtime_minutes || 0),
    0,
  )
}

function getTotalAchievements(user: User) {
  if (!user.giveaways_won) return 0
  return user.giveaways_won.reduce(
    (total, game) => total + (game.steam_play_data?.achievements_unlocked || 0),
    0,
  )
}

function getNoEntryGiveaways(user: User) {
  if (!user.giveaways_created) return 0
  return user.giveaways_created.filter(
    (g) => g.entries === 0 && g.end_timestamp < Date.now() / 1000,
  ).length
}

function getRecentWins(user: User) {
  if (!user.giveaways_won) return 0
  const twoWeeksAgo = Date.now() / 1000 - 14 * 24 * 60 * 60
  return user.giveaways_won.filter((g) => g.end_timestamp > twoWeeksAgo).length
}

function userTypeBadge(user: User) {
  switch (getUserRatio(user.stats.giveaway_ratio)) {
    case 'contributor':
      return (
        <Badge variant="success" size="sm">
          Net contributor
        </Badge>
      )
    case 'receiver':
      return (
        <Badge variant="error" size="sm">
          Net receiver
        </Badge>
      )
    default:
      return (
        <Badge variant="info" size="sm">
          Neutral
        </Badge>
      )
  }
}

export default function UsersClient({
  users,
  exMembers,
  lastUpdated,
  heading = 'Users',
  description,
}: Props) {
  const isAdmin = useIsAdmin()
  const [includeExMembers, setIncludeExMembers] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('difference')
  const [sortDirection, setSortDirection] = useState<SortDir>('desc')
  const [filterTags, setFilterTags] = useState<string[]>([])

  const allUsers = useMemo(() => {
    if (includeExMembers && exMembers?.length) {
      return [...users, ...exMembers]
    }
    return users
  }, [users, exMembers, includeExMembers])

  const filteredAndSortedUsers = useMemo(() => {
    const filtered = allUsers.filter((user) => {
      const matchesSearch = user.username
        .toLowerCase()
        .includes(searchTerm.toLowerCase())
      if (!matchesSearch) return false

      if (filterTags.length === 0) return true

      const ratio = user.stats.giveaway_ratio ?? 0
      const userFlags: Record<string, boolean> = {
        warnings: (user.warnings?.length ?? 0) > 0,
        contributors: getUserRatio(ratio) === 'contributor',
        receivers: getUserRatio(ratio) === 'receiver',
        neutral: getUserRatio(ratio) === 'neutral',
      }

      return filterTags.some((key) => userFlags[key])
    })

    filtered.sort((a, b) => {
      let comparison = 0
      switch (sortBy) {
        case 'username':
          comparison = a.username.localeCompare(b.username)
          break
        case 'sent':
          comparison =
            b.stats.real_total_sent_count - a.stats.real_total_sent_count
          break
        case 'received':
          comparison =
            b.stats.real_total_received_count -
            a.stats.real_total_received_count
          break
        case 'difference':
          comparison =
            b.stats.real_total_gift_difference -
            a.stats.real_total_gift_difference
          break
        case 'value':
          comparison =
            b.stats.real_total_value_difference -
            a.stats.real_total_value_difference
          break
        case 'playtime':
          comparison = getTotalPlaytime(b) - getTotalPlaytime(a)
          break
        case 'ratio':
          comparison =
            (b.stats.giveaway_ratio ?? 0) - (a.stats.giveaway_ratio ?? 0)
          break
        case 'last_created':
          comparison =
            (b.stats.last_giveaway_created_at || 0) -
            (a.stats.last_giveaway_created_at || 0)
          break
        case 'last_won':
          comparison =
            (b.stats.last_giveaway_won_at || 0) -
            (a.stats.last_giveaway_won_at || 0)
          break
        case 'play_rate':
          comparison =
            getUnplayedGamesStats(b).percentage -
            getUnplayedGamesStats(a).percentage
          break
        case 'achievements':
          comparison =
            (b.stats.real_total_achievements_percentage ?? 0) -
            (a.stats.real_total_achievements_percentage ?? 0)
          break
      }
      return sortDirection === 'asc' ? -comparison : comparison
    })

    return filtered
  }, [allUsers, searchTerm, sortBy, sortDirection, filterTags])

  const activeFilters =
    (searchTerm ? 1 : 0) + filterTags.length

  const resetFilters = () => {
    setSearchTerm('')
    setFilterTags([])
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            {heading}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
          {lastUpdated && (
            <div className="mt-1 text-sm text-muted-foreground">
              <LastUpdated lastUpdatedDate={lastUpdated} />
            </div>
          )}
        </div>
        {exMembers && exMembers.length > 0 && (
          <ToggleGroup
            type="single"
            value={includeExMembers ? 'all' : 'active'}
            onValueChange={(v) => v && setIncludeExMembers(v === 'all')}
            size="sm"
          >
            <ToggleGroupItem value="active">Active</ToggleGroupItem>
            <ToggleGroupItem value="all">Including ex-members</ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>

      <Toolbar>
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search a username..."
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={sortBy}
            onValueChange={(v) => setSortBy(v as SortKey)}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="difference">Gift difference</SelectItem>
              <SelectItem value="ratio">Giveaway ratio</SelectItem>
              <SelectItem value="value">Value difference</SelectItem>
              <SelectItem value="sent">Gifts sent</SelectItem>
              <SelectItem value="received">Gifts received</SelectItem>
              <SelectItem value="play_rate">Play rate</SelectItem>
              <SelectItem value="playtime">Total playtime</SelectItem>
              <SelectItem value="achievements">Achievements rate</SelectItem>
              <SelectItem value="username">Username</SelectItem>
              <SelectItem value="last_created">Last GA created</SelectItem>
              <SelectItem value="last_won">Last GA won</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={() =>
              setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
            }
            aria-label="Toggle sort direction"
          >
            {sortDirection === 'asc' ? (
              <ArrowUp className="h-4 w-4" />
            ) : (
              <ArrowDown className="h-4 w-4" />
            )}
          </Button>
        </div>
      </Toolbar>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          type="multiple"
          value={filterTags}
          onValueChange={setFilterTags}
          size="sm"
          className="flex-wrap"
        >
          {isAdmin && (
            <ToggleGroupItem value="warnings">
              <AlertTriangle className="h-3.5 w-3.5" /> Needs attention
            </ToggleGroupItem>
          )}
          <ToggleGroupItem value="contributors">
            <Coins className="h-3.5 w-3.5" /> Net contributor
          </ToggleGroupItem>
          {isAdmin && (
            <ToggleGroupItem value="receivers">
              <TrendingDown className="h-3.5 w-3.5" /> Net receiver
            </ToggleGroupItem>
          )}
          <ToggleGroupItem value="neutral">
            <Scale className="h-3.5 w-3.5" /> Neutral
          </ToggleGroupItem>
        </ToggleGroup>
        {activeFilters > 0 && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      <div className="flex items-center justify-between text-sm">
        <p className="text-muted-foreground">
          Showing{' '}
          <span className="font-medium text-foreground tabular-nums-strict">
            {filteredAndSortedUsers.length.toLocaleString()}
          </span>{' '}
          of{' '}
          <span className="font-medium text-foreground tabular-nums-strict">
            {allUsers.length.toLocaleString()}
          </span>{' '}
          users
        </p>
        <p className="text-xs text-muted-foreground italic">
          Ratio is full CV 1:3 without proof-of-play games.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredAndSortedUsers.map((user) => (
          <UserCard key={user.steam_id} user={user} isAdmin={isAdmin} />
        ))}
      </div>

      {filteredAndSortedUsers.length === 0 && (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <Filter className="h-8 w-8 text-subtle" />
          <p className="text-sm text-muted-foreground">
            No users match the current filters.
          </p>
          <Button variant="primary" size="sm" onClick={resetFilters}>
            Clear filters
          </Button>
        </Card>
      )}
    </div>
  )
}

function UserCard({ user, isAdmin }: { user: User; isAdmin: boolean }) {
  const ratio = user.stats.giveaway_ratio ?? 0
  const ratioCategory = getUserRatio(ratio)
  const diff = user.stats.real_total_gift_difference
  const valueDiff = user.stats.real_total_value_difference
  const totalPlaytime = getTotalPlaytime(user)
  const totalAchievements = getTotalAchievements(user)
  const playtimeText =
    totalPlaytime === 0 && totalAchievements > 0
      ? 'Unavailable'
      : formatPlaytime(totalPlaytime)
  const recentWins = getRecentWins(user)
  const noEntryGAs = getNoEntryGiveaways(user)
  const accentClass = !isAdmin
    ? 'before:bg-[var(--card-border-strong)]'
    : ratioCategory === 'contributor'
      ? 'before:bg-[var(--success)]'
      : ratioCategory === 'receiver'
        ? 'before:bg-[var(--error)]'
        : 'before:bg-[var(--card-border-strong)]'
  const headlineColor = !isAdmin
    ? 'text-foreground'
    : diff > 0
      ? 'text-success-foreground'
      : diff < 0
        ? 'text-error-foreground'
        : 'text-muted-foreground'

  return (
    <Card
      className={cn(
        'relative flex flex-col gap-4 overflow-hidden p-5 transition-all hover:border-card-border-strong hover:shadow-md',
        'before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:z-10',
        accentClass,
      )}
    >
      <div className="flex items-start gap-3">
        <a
          href={steamGiftsProfile(user.username)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${user.username} on SteamGifts`}
          className="flex-shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {user.avatar_url ? (
            <Image
              src={user.avatar_url}
              alt={user.username}
              width={48}
              height={48}
              className="h-12 w-12 rounded-full ring-1 ring-card-border transition-transform hover:scale-105"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-card-background-hover ring-1 ring-card-border text-muted-foreground transition-transform hover:scale-105">
              <span className="text-sm font-bold">
                {user.username[0]?.toUpperCase()}
              </span>
            </div>
          )}
        </a>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <UserLink
              username={user.username}
              className="truncate text-base font-semibold text-foreground hover:text-accent hover:underline"
            >
              {user.username}
            </UserLink>
            <div className="flex items-center gap-1 text-muted-foreground">
              {user.steam_id && !user.steam_profile_is_private && (
                <Tooltip content="Steam account connected">
                  <Gamepad2 className="h-4 w-4" />
                </Tooltip>
              )}
            </div>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {isAdmin && userTypeBadge(user)}
            {user.is_deleted_sg_account && (
              <Badge variant="error" size="sm" title="This SteamGifts account no longer exists. Stats are reconstructed from their historical giveaways.">
                Account deleted
              </Badge>
            )}
            {isAdmin && user.warnings && user.warnings.length > 0 && (
              <Badge
                variant={
                  getWarningsSeverity(user.warnings) === 'problem'
                    ? 'error'
                    : 'warning'
                }
                size="sm"
              >
                <AlertTriangle className="h-3 w-3" />
                Needs attention
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Headline metrics: gift difference + giveaway ratio side by side */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-card-border bg-card-background-hover/40 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Gift difference
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={cn(
                'font-display text-3xl font-bold leading-none tabular-nums-strict',
                headlineColor,
              )}
            >
              {diff > 0 ? '+' : ''}
              {diff}
            </span>
          </div>
          <p
            className={cn(
              'mt-1 text-xs font-medium tabular-nums-strict',
              valueDiff > 0
                ? 'text-success-foreground'
                : valueDiff < 0
                  ? 'text-error-foreground'
                  : 'text-muted-foreground',
            )}
          >
            {valueDiff > 0 ? '+' : ''}${valueDiff.toFixed(2)}
          </p>
        </div>
        <div className="rounded-lg border border-card-border bg-card-background-hover/40 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Giveaway ratio
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={cn(
                'font-display text-3xl font-bold leading-none tabular-nums-strict',
                !isAdmin
                  ? 'text-foreground'
                  : ratioCategory === 'contributor'
                    ? 'text-success-foreground'
                    : ratioCategory === 'receiver'
                      ? 'text-error-foreground'
                      : 'text-muted-foreground',
              )}
            >
              {ratio.toFixed(2)}
            </span>
          </div>
          {isAdmin && (
            <p className="mt-1 text-xs text-muted-foreground">
              {ratioCategory === 'contributor'
                ? 'Sends ≥3× the value received'
                : ratioCategory === 'receiver'
                  ? 'Receives more than 3× the value sent'
                  : 'Within balanced range'}
            </p>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Stat label="Sent" value={user.stats.real_total_sent_count} accent="success" />
        <Stat
          label="Received"
          value={user.stats.real_total_received_count}
          accent="info"
        />
      </dl>

      <dl className="grid grid-cols-2 gap-3 border-t border-card-border pt-3 text-xs">
        <DateBlock
          label="Last GA created"
          ts={user.stats.last_giveaway_created_at}
        />
        <DateBlock
          label="Last GA won"
          ts={user.stats.last_giveaway_won_at}
        />
      </dl>

      {user.steam_id &&
        !user.steam_profile_is_private &&
        user.giveaways_won &&
        user.giveaways_won.length > 0 && (
          <div className="grid grid-cols-3 gap-2 border-t border-card-border pt-3">
            <SmallStat
              label="Playtime"
              value={playtimeText}
              accent="text-accent-purple"
              icon={Gamepad2}
            />
            <SmallStat
              label="Achievements"
              value={`${user.stats.real_total_achievements_percentage ?? 0}%`}
              accent="text-accent-yellow"
              icon={Trophy}
              extra={
                user.stats.has_missing_achievements_data ? (
                  <Tooltip content="Some games are missing achievement data — figure may be inaccurate.">
                    <AlertTriangle className="h-3 w-3 text-accent-yellow" />
                  </Tooltip>
                ) : null
              }
            />
            <UnplayedGamesStats user={user} />
          </div>
        )}

      {(noEntryGAs > 0 || recentWins > 0) && (
        <div className="grid grid-cols-2 gap-2 border-t border-card-border pt-3 text-xs">
          {noEntryGAs > 0 && (
            <div className="text-center">
              <div className="font-medium text-accent-orange tabular-nums-strict">
                {noEntryGAs}
              </div>
              <div className="text-muted-foreground">No-entry GAs</div>
            </div>
          )}
          {recentWins > 0 && (
            <div className="text-center">
              <div className="font-medium text-accent-green tabular-nums-strict">
                {recentWins}
              </div>
              <div className="text-muted-foreground">Recent wins</div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: number | string
  accent: 'success' | 'info' | 'muted'
}) {
  const cls =
    accent === 'success'
      ? 'text-success-foreground'
      : accent === 'info'
        ? 'text-info-foreground'
        : 'text-muted-foreground'
  return (
    <div className="rounded-md bg-card-background-hover/40 p-3 text-center">
      <div
        className={cn('text-2xl font-bold tabular-nums-strict', cls)}
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function DateBlock({
  label,
  ts,
}: {
  label: string
  ts?: number | null
}) {
  return (
    <div className="text-center">
      <div className="font-medium text-foreground">
        {ts ? <FormattedDate timestamp={ts} /> : (
          <span className="text-muted-foreground">Never</span>
        )}
      </div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  )
}

function SmallStat({
  label,
  value,
  accent,
  extra,
}: {
  label: string
  value: React.ReactNode
  accent: string
  icon?: React.ComponentType<{ className?: string }>
  extra?: React.ReactNode
}) {
  return (
    <div className="text-center">
      <div className={cn('inline-flex items-center gap-1 font-medium', accent)}>
        {value}
        {extra}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
