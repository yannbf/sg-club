'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import {
  Award,
  Coins,
  Gamepad2,
  Gift,
  Info,
  Sparkles,
  Target,
  Trophy,
  Users,
  Wallet,
} from 'lucide-react'
import { GameData, User } from '@/types'
import { LastUpdated } from '@/components/LastUpdated'
import UserAvatar from '@/components/UserAvatar'
import GameImage from '@/components/GameImage'
import { StatCard } from '@/components/StatCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/Tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/ToggleGroup'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { cn } from '@/lib/cn'

export interface UserLuckData {
  steam_id: string
  username: string
  avatar_url: string
  entries: number
  wins: number
  expectedWins: number
  luckScore: number
  avgWinProbability: number
  activeEntriesCount: number
  chanceToWin: number
}

interface UserRankingProps {
  users: {
    user: User
    value: string | number
  }[]
  emptyLabel?: string
}

function UserRanking({ users, emptyLabel = 'No data yet.' }: UserRankingProps) {
  if (!users.length) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        {emptyLabel}
      </p>
    )
  }
  return (
    <ol className="space-y-2">
      {users.map(({ user, value }, index) => (
        <li
          key={user.steam_id}
          className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-card-background-hover"
        >
          <div className="flex flex-1 items-center gap-3 min-w-0">
            <span
              className={cn(
                'inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md font-mono text-xs',
                index === 0 &&
                  'bg-[color-mix(in_oklab,var(--accent-yellow)_22%,transparent)] text-accent-yellow',
                index === 1 &&
                  'bg-[color-mix(in_oklab,var(--subtle)_22%,transparent)] text-foreground',
                index === 2 &&
                  'bg-[color-mix(in_oklab,var(--accent-orange)_22%,transparent)] text-accent-orange',
                index > 2 && 'text-subtle',
              )}
            >
              {index + 1}
            </span>
            <UserAvatar src={user.avatar_url} username={user.username} />
            <Link
              href={`/users/${user.username}`}
              className="truncate text-sm font-medium hover:text-accent hover:underline"
            >
              {user.username}
            </Link>
          </div>
          <span className="text-sm font-semibold tabular-nums-strict">
            {value}
          </span>
        </li>
      ))}
    </ol>
  )
}

export type InsightData = {
  topCreators: { user: User; value: number }[]
  topWinners: { user: User; value: number }[]
  topGamers: { user: User; value: string }[]
  topAchievementHunters: { user: User; value: number }[]
  topAchievementHuntersByPercentage: { user: User; value: string }[]
  topGames: { game: GameData; count: number }[]
}

function InsightPanel({
  data,
  disclaimer,
}: {
  data: InsightData
  disclaimer: string
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-primary-hi" />
          <span className="font-semibold">Top games created</span>
        </div>
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5" />
          Exclusive Full CV giveaways {disclaimer}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {data.topGames.length === 0 && (
          <p className="col-span-full text-sm text-muted-foreground text-center py-6">
            No giveaways in this period.
          </p>
        )}
        {data.topGames.map(({ game, count }) => (
          <Card
            key={game.app_id ?? game.package_id ?? game.name}
            className="group overflow-hidden p-0 transition-all hover:border-card-border-strong hover:shadow-md"
          >
            <GameImage
              appId={game.app_id?.toString()}
              packageId={game.package_id?.toString()}
              name={game.name}
              fillWidth
            />
            <div className="p-3 space-y-1">
              <a
                href={`https://www.steamgifts.com/group/WlYTQ/thegiveawaysclub/search?q=${encodeURIComponent(game.name)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-sm font-semibold text-foreground hover:text-accent hover:underline"
                title={game.name}
              >
                {game.name}
              </a>
              <Badge variant="primary" size="sm">
                {count} {count === 1 ? 'giveaway' : 'giveaways'}
              </Badge>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Member rankings</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="creators" className="w-full">
            <TabsList className="flex w-full flex-wrap gap-1 sm:w-auto">
              <TabsTrigger value="creators" className="gap-1.5">
                <Gift className="h-3.5 w-3.5" /> Creators
              </TabsTrigger>
              <TabsTrigger value="winners" className="gap-1.5">
                <Trophy className="h-3.5 w-3.5" /> Winners
              </TabsTrigger>
              <TabsTrigger value="playtime" className="gap-1.5">
                <Gamepad2 className="h-3.5 w-3.5" /> Playtime
              </TabsTrigger>
              <TabsTrigger value="achievements" className="gap-1.5">
                <Award className="h-3.5 w-3.5" /> Achievements
              </TabsTrigger>
              <TabsTrigger value="achievementsPct" className="gap-1.5">
                <Target className="h-3.5 w-3.5" /> Ach. %
              </TabsTrigger>
            </TabsList>
            <TabsContent value="creators" className="mt-4">
              <UserRanking users={data.topCreators} />
            </TabsContent>
            <TabsContent value="winners" className="mt-4">
              <UserRanking users={data.topWinners} />
            </TabsContent>
            <TabsContent value="playtime" className="mt-4">
              <UserRanking users={data.topGamers} />
            </TabsContent>
            <TabsContent value="achievements" className="mt-4">
              <UserRanking users={data.topAchievementHunters} />
            </TabsContent>
            <TabsContent value="achievementsPct" className="mt-4">
              <UserRanking users={data.topAchievementHuntersByPercentage} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}

type LuckSortKey =
  | 'luckScore'
  | 'wins'
  | 'expectedWins'
  | 'entries'
  | 'avgWinProbability'
  | 'chanceToWin'

function getLuckLabel(score: number): {
  label: string
  className: string
  variant: 'success' | 'warning' | 'error' | 'default' | 'amber'
} {
  if (score >= 2.0)
    return {
      label: 'Very Lucky',
      className: 'text-accent-yellow',
      variant: 'amber',
    }
  if (score >= 1.5)
    return {
      label: 'Lucky',
      className: 'text-success-foreground',
      variant: 'success',
    }
  if (score >= 0.75)
    return {
      label: 'Average',
      className: 'text-muted-foreground',
      variant: 'default',
    }
  if (score >= 0.5)
    return {
      label: 'Unlucky',
      className: 'text-warning-foreground',
      variant: 'warning',
    }
  return {
    label: 'Very Unlucky',
    className: 'text-error-foreground',
    variant: 'error',
  }
}

function SortableHeader({
  label,
  sortKey,
  currentSort,
  direction,
  onSort,
}: {
  label: string
  sortKey: LuckSortKey
  currentSort: LuckSortKey
  direction: 'asc' | 'desc'
  onSort: (key: LuckSortKey) => void
}) {
  const isActive = currentSort === sortKey
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn(
        'inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide transition-colors',
        isActive
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
      <span className="text-xs">
        {isActive ? (direction === 'desc' ? '↓' : '↑') : '↕'}
      </span>
    </button>
  )
}

function LuckRankingSection({ rankings }: { rankings: UserLuckData[] }) {
  const [search, setSearch] = useState('')
  const [minEntries, setMinEntries] = useState('10')
  const [sortBy, setSortBy] = useState<LuckSortKey>('luckScore')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const handleSort = (key: LuckSortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortBy(key)
      setSortDir('desc')
    }
  }

  const filtered = useMemo(() => {
    const min = parseInt(minEntries, 10) || 0
    return rankings
      .filter(
        (r) =>
          r.entries >= min &&
          r.username.toLowerCase().includes(search.toLowerCase()),
      )
      .sort((a, b) => {
        const diff = a[sortBy] - b[sortBy]
        return sortDir === 'desc' ? -diff : diff
      })
  }, [rankings, minEntries, search, sortBy, sortDir])

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary-hi" />
              Luck ranking
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground max-w-prose">
              Compares actual wins against statistically expected wins.{' '}
              <span className="font-medium text-foreground">1.0x</span> is
              expected, &gt;1.0 is luckier, &lt;1.0 is unluckier.
            </p>
          </div>
          <Badge variant="outline">
            {filtered.length} user{filtered.length !== 1 ? 's' : ''}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Search username..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sm:flex-1"
          />
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              Min entries
            </span>
            <Select value={minEntries} onValueChange={setMinEntries}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1+</SelectItem>
                <SelectItem value="5">5+</SelectItem>
                <SelectItem value="10">10+</SelectItem>
                <SelectItem value="25">25+</SelectItem>
                <SelectItem value="50">50+</SelectItem>
                <SelectItem value="100">100+</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-card-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border bg-card-background-hover/50">
                <th className="w-10 py-2 pl-3 pr-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  #
                </th>
                <th className="py-2 pl-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  User
                </th>
                <th className="px-3 py-2 text-right">
                  <SortableHeader
                    label="Entries"
                    sortKey="entries"
                    currentSort={sortBy}
                    direction={sortDir}
                    onSort={handleSort}
                  />
                </th>
                <th className="px-3 py-2 text-right">
                  <SortableHeader
                    label="Wins"
                    sortKey="wins"
                    currentSort={sortBy}
                    direction={sortDir}
                    onSort={handleSort}
                  />
                </th>
                <th className="px-3 py-2 text-right">
                  <SortableHeader
                    label="Expected"
                    sortKey="expectedWins"
                    currentSort={sortBy}
                    direction={sortDir}
                    onSort={handleSort}
                  />
                </th>
                <th className="px-3 py-2 text-right">
                  <SortableHeader
                    label="Avg Win Prob"
                    sortKey="avgWinProbability"
                    currentSort={sortBy}
                    direction={sortDir}
                    onSort={handleSort}
                  />
                </th>
                <th className="px-3 py-2 text-right">
                  <SortableHeader
                    label="Chance to Win"
                    sortKey="chanceToWin"
                    currentSort={sortBy}
                    direction={sortDir}
                    onSort={handleSort}
                  />
                </th>
                <th className="pl-3 pr-4 py-2 text-right">
                  <SortableHeader
                    label="Luck"
                    sortKey="luckScore"
                    currentSort={sortBy}
                    direction={sortDir}
                    onSort={handleSort}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, index) => {
                const luck = getLuckLabel(row.luckScore)
                return (
                  <tr
                    key={row.steam_id}
                    className="border-b border-card-border/50 last:border-0 transition-colors hover:bg-card-background-hover"
                  >
                    <td className="py-2 pl-3 pr-2 text-right text-muted-foreground tabular-nums-strict">
                      {index + 1}
                    </td>
                    <td className="py-2 pl-2 pr-4">
                      <div className="flex items-center gap-2 min-w-0">
                        <UserAvatar
                          src={row.avatar_url}
                          username={row.username}
                        />
                        <Link
                          href={`/users/${row.username}`}
                          className="truncate font-medium hover:text-accent hover:underline"
                        >
                          {row.username}
                        </Link>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground tabular-nums-strict">
                      {row.entries}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums-strict">
                      {row.wins}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground tabular-nums-strict">
                      {row.expectedWins.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground tabular-nums-strict">
                      {row.avgWinProbability.toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.activeEntriesCount > 0 ? (
                        <div className="flex flex-col items-end">
                          <span className="font-medium text-accent tabular-nums-strict">
                            {row.chanceToWin.toFixed(1)}%
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {row.activeEntriesCount} active
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="pl-3 pr-4 py-2 text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span
                          className={cn(
                            'font-bold tabular-nums-strict',
                            luck.className,
                          )}
                        >
                          {row.luckScore.toFixed(2)}x
                        </span>
                        <Badge variant={luck.variant} size="sm">
                          {luck.label}
                        </Badge>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No users match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

export type DashboardStats = {
  memberCount: number
  memberLabel: string
  totalGiveawaysCount: number
  totalValueSent: number
  totalGiveawaysCreated: number
  totalGiveawaysWon: number
  totalGiveawaysCreatedFullCV: number
  totalGiveawaysWonFullCV: number
  totalValueReceived: number
  netContributors: number
  neutralUsers: number
  netReceivers: number
  usersWithWarningsCount: number
  usersWithWarningsPercentage: number
  allTimeInsights: InsightData
  last30DaysInsights: InsightData
  last7DaysInsights: InsightData
  luckRankings: UserLuckData[]
}

type Props = {
  activeStats: DashboardStats
  allStats: DashboardStats
  lastUpdated: string | null
}

const fmt = (n: number) => n.toLocaleString()
const fmtMoney = (n: number) =>
  `$${Math.round(n).toLocaleString()}`

export default function DashboardClient({
  activeStats,
  allStats,
  lastUpdated,
}: Props) {
  const [scope, setScope] = useState<'active' | 'all'>('active')
  const stats = scope === 'all' ? allStats : activeStats

  const contribPct = stats.memberCount
    ? ((stats.netContributors / stats.memberCount) * 100).toFixed(1)
    : '0'
  const neutralPct = stats.memberCount
    ? ((stats.neutralUsers / stats.memberCount) * 100).toFixed(1)
    : '0'
  const receiverPct = stats.memberCount
    ? ((stats.netReceivers / stats.memberCount) * 100).toFixed(1)
    : '0'

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            Group Analytics
          </h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            {lastUpdated ? (
              <LastUpdated lastUpdatedDate={lastUpdated} />
            ) : (
              <span>Last updated: unknown</span>
            )}
          </div>
        </div>
        <ToggleGroup
          type="single"
          value={scope}
          onValueChange={(v) => v && setScope(v as 'active' | 'all')}
          size="sm"
        >
          <ToggleGroupItem value="active">Active members</ToggleGroupItem>
          <ToggleGroupItem value="all">Including ex-members</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Users}
          label={stats.memberLabel}
          value={fmt(stats.memberCount)}
          accent="primary"
        />
        <StatCard
          icon={Gift}
          label="Total giveaways"
          value={fmt(stats.totalGiveawaysCount)}
          hint={`${fmt(stats.totalGiveawaysCreatedFullCV)} Full CV`}
          accent="green"
        />
        <StatCard
          icon={Wallet}
          label="Value sent"
          value={fmtMoney(stats.totalValueSent)}
          accent="amber"
        />
        <StatCard
          icon={Coins}
          label="Value received"
          value={fmtMoney(stats.totalValueReceived)}
          accent="purple"
        />
      </div>

      {/* Health & Activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Community health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row
              label="Net contributors"
              value={
                <span className="text-success-foreground">
                  {stats.netContributors}{' '}
                  <span className="text-muted-foreground font-normal">
                    ({contribPct}%)
                  </span>
                </span>
              }
            />
            <Row
              label="Neutral users"
              value={
                <span className="text-muted-foreground">
                  {stats.neutralUsers}{' '}
                  <span className="font-normal">({neutralPct}%)</span>
                </span>
              }
            />
            <Row
              label="Net receivers"
              value={
                <span className="text-error-foreground">
                  {stats.netReceivers}{' '}
                  <span className="text-muted-foreground font-normal">
                    ({receiverPct}%)
                  </span>
                </span>
              }
            />
            <Row
              label="Members with warnings"
              value={
                <span className="text-error-foreground">
                  {stats.usersWithWarningsCount}{' '}
                  <span className="text-muted-foreground font-normal">
                    ({stats.usersWithWarningsPercentage.toFixed(1)}%)
                  </span>
                </span>
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activity summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row
              label="Giveaways created"
              value={fmt(stats.totalGiveawaysCreated)}
              accent="info"
            />
            <Row
              label="Giveaways successfully sent"
              value={fmt(stats.totalGiveawaysWon)}
              accent="success"
            />
            <Row
              label={
                <>
                  <span className="font-semibold">Full CV</span> giveaways
                  created
                </>
              }
              value={fmt(stats.totalGiveawaysCreatedFullCV)}
              accent="info"
            />
            <Row
              label={
                <>
                  <span className="font-semibold">Full CV</span> giveaways
                  successfully sent
                </>
              }
              value={fmt(stats.totalGiveawaysWonFullCV)}
              accent="success"
            />
            <Row
              label="Total value received"
              value={fmtMoney(stats.totalValueReceived)}
              accent="primary"
            />
          </CardContent>
        </Card>
      </div>

      {/* Period insights */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Insights</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="7d">
            <TabsList>
              <TabsTrigger value="7d">Last 7 days</TabsTrigger>
              <TabsTrigger value="30d">Last 30 days</TabsTrigger>
              <TabsTrigger value="all">All time</TabsTrigger>
            </TabsList>
            <TabsContent value="7d" className="mt-6">
              <InsightPanel
                data={stats.last7DaysInsights}
                disclaimer="(last 7 days)"
              />
            </TabsContent>
            <TabsContent value="30d" className="mt-6">
              <InsightPanel
                data={stats.last30DaysInsights}
                disclaimer="(last 30 days)"
              />
            </TabsContent>
            <TabsContent value="all" className="mt-6">
              <InsightPanel
                data={stats.allTimeInsights}
                disclaimer="(all time)"
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <LuckRankingSection rankings={stats.luckRankings} />
    </div>
  )
}

function Row({
  label,
  value,
  accent,
}: {
  label: React.ReactNode
  value: React.ReactNode
  accent?: 'success' | 'info' | 'primary' | 'warn' | 'error'
}) {
  const accentMap = {
    success: 'text-success-foreground',
    info: 'text-info-foreground',
    primary: 'text-primary-hi',
    warn: 'text-warning-foreground',
    error: 'text-error-foreground',
  }
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          'text-sm font-semibold tabular-nums-strict',
          accent && accentMap[accent],
        )}
      >
        {value}
      </span>
    </div>
  )
}
