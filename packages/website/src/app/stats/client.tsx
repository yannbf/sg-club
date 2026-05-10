'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Clock,
  Filter,
  LogOut,
  Search,
  TrendingUp,
  Users as UsersIcon,
} from 'lucide-react'
import { Giveaway } from '@/types'
import { GiveawayLeaver } from '@/types/stats'
import GameImage from '@/components/GameImage'
import UserAvatar from '@/components/UserAvatar'
import Tooltip from '@/components/Tooltip'
import FormattedDate, { getFullDate } from '@/components/FormattedDate'
import { CvStatusIndicator } from '@/components/CvStatusIndicator'
import { LastUpdated } from '@/components/LastUpdated'
import { useDebounce } from '@/lib/hooks'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Toolbar } from '@/components/ui/Toolbar'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/ToggleGroup'
import { StatCard } from '@/components/StatCard'
import { cn } from '@/lib/cn'

type GiveawayWithLeavers = Giveaway & {
  leavers: {
    user: { username: string; avatar_url: string; isExMember?: boolean }
    leaver: Omit<GiveawayLeaver, 'giveaway'>
  }[]
}

type Props = {
  giveaways: GiveawayWithLeavers[]
  lastUpdated: string | null
}

function leaverColor(hours: number) {
  if (hours < 0) return 'text-muted-foreground'
  if (hours < 24) return 'text-error-foreground'
  if (hours < 48) return 'text-warning-foreground'
  return 'text-success-foreground'
}

export default function Client({ giveaways, lastUpdated }: Props) {
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 200)
  const [includeExMembers, setIncludeExMembers] = useState(false)

  const filteredGiveaways = useMemo(() => {
    const term = debouncedSearch.toLowerCase()
    return giveaways
      .map((ga) => {
        const filteredLeavers = includeExMembers
          ? ga.leavers
          : ga.leavers.filter((l) => !l.user.isExMember)
        return { ...ga, leavers: filteredLeavers }
      })
      .filter((ga) => {
        if (ga.leavers.length === 0) return false
        const hasLeaver = ga.leavers.some((l) =>
          l.user.username.toLowerCase().includes(term),
        )
        return (
          ga.name.toLowerCase().includes(term) ||
          ga.id === debouncedSearch ||
          hasLeaver
        )
      })
      .sort((a, b) => b.end_timestamp - a.end_timestamp)
  }, [giveaways, debouncedSearch, includeExMembers])

  const stats = useMemo(() => {
    const allLeavers = filteredGiveaways.flatMap((g) => g.leavers)
    const uniqueUsers = new Set(allLeavers.map((l) => l.user.username))
    const thirtyDaysAgo = Date.now() / 1000 - 30 * 24 * 60 * 60
    const recent = filteredGiveaways.filter(
      (g) => g.end_timestamp > thirtyDaysAgo,
    ).length
    return {
      totalLeaves: allLeavers.length,
      uniqueLeavers: uniqueUsers.size,
      affectedGiveaways: filteredGiveaways.length,
      recentGiveaways: recent,
    }
  }, [filteredGiveaways])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Giveaway leavers
        </h1>
        {lastUpdated && (
          <div className="mt-1 text-sm text-muted-foreground">
            <LastUpdated lastUpdatedDate={lastUpdated} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={LogOut}
          label="Total leaves"
          value={stats.totalLeaves.toLocaleString()}
          accent="rose"
        />
        <StatCard
          icon={UsersIcon}
          label="Unique leavers"
          value={stats.uniqueLeavers.toLocaleString()}
          accent="amber"
        />
        <StatCard
          icon={TrendingUp}
          label="Giveaways affected"
          value={stats.affectedGiveaways.toLocaleString()}
          accent="primary"
        />
        <StatCard
          icon={Clock}
          label="Last 30 days"
          value={stats.recentGiveaways.toLocaleString()}
          accent="purple"
        />
      </div>

      <Toolbar>
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by giveaway name, id, or username..."
            className="pl-9"
          />
        </div>
        <ToggleGroup
          type="single"
          value={includeExMembers ? 'all' : 'active'}
          onValueChange={(v) => v && setIncludeExMembers(v === 'all')}
          size="sm"
        >
          <ToggleGroupItem value="active">Active members</ToggleGroupItem>
          <ToggleGroupItem value="all">Including ex-members</ToggleGroupItem>
        </ToggleGroup>
      </Toolbar>

      <div className="space-y-3">
        {filteredGiveaways.map((ga) => {
          const isOpen = ga.end_timestamp > Date.now() / 1000
          return (
            <Card
              key={ga.id}
              className={cn(
                'relative overflow-hidden p-4',
                'before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:z-10',
                isOpen
                  ? 'before:bg-[var(--info)]'
                  : 'before:bg-[var(--accent-rose)]',
              )}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="w-32 flex-shrink-0">
                  <GameImage
                    appId={ga.app_id ?? undefined}
                    packageId={ga.package_id ?? undefined}
                    name={ga.name}
                    fillWidth
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`https://steamgifts.com/giveaway/${ga.link}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="line-clamp-1 text-base font-semibold text-foreground hover:text-accent hover:underline"
                      >
                        {ga.name}{' '}
                        <span className="font-mono text-sm text-muted-foreground">
                          ({ga.points}P)
                        </span>
                      </Link>
                      <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CvStatusIndicator giveaway={ga} />
                        {isOpen ? 'Ends' : 'Ended'}{' '}
                        <FormattedDate
                          timestamp={ga.end_timestamp}
                          className="font-medium text-foreground"
                        />
                      </p>
                    </div>
                    <Badge
                      variant={isOpen ? 'info' : 'rose'}
                      size="sm"
                    >
                      {ga.leavers.length}{' '}
                      {ga.leavers.length === 1 ? 'leaver' : 'leavers'}
                    </Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {ga.leavers.map(({ user, leaver }) => (
                      <Tooltip
                        key={user.username}
                        content={`Detected at: ${
                          leaver.time_difference_hours < 0
                            ? 'after the giveaway ended (exact time unknown)'
                            : getFullDate(leaver.leave_detected_at)
                        }`}
                      >
                        <Link
                          href={`/users/${user.username}`}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full border border-card-border bg-card-background-hover px-2 py-0.5 text-xs transition-colors hover:border-card-border-strong hover:bg-card-background',
                            user.isExMember && 'opacity-70',
                          )}
                        >
                          <UserAvatar
                            src={user.avatar_url}
                            username={user.username}
                          />
                          <span className="font-medium">{user.username}</span>
                          <span
                            className={cn(
                              'font-bold tabular-nums-strict',
                              leaverColor(leaver.time_difference_hours),
                            )}
                          >
                            {leaver.time_difference_hours < 0
                              ? '?'
                              : `${leaver.time_difference_hours}h`}
                          </span>
                          {user.isExMember && (
                            <span className="text-subtle">(ex)</span>
                          )}
                        </Link>
                      </Tooltip>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {filteredGiveaways.length === 0 && (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <Filter className="h-8 w-8 text-subtle" />
          <p className="text-sm text-muted-foreground">
            No giveaways match the current filters.
          </p>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setSearch('')
              setIncludeExMembers(false)
            }}
          >
            Clear filters
          </Button>
        </Card>
      )}
    </div>
  )
}
