'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { GameData, User } from '@/types'
import { LastUpdated } from '@/components/LastUpdated'
import UserAvatar from '@/components/UserAvatar'
import GameImage from '@/components/GameImage'

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
  title: React.ReactNode
  users: {
    user: User
    value: string | number
  }[]
}

function UserRanking({ title, users }: UserRankingProps) {
  return (
    <div>
      <h4 className="text-md font-semibold mb-3">{title}</h4>
      <div className="space-y-3">
        {users.map(({ user, value }, index) => (
          <div key={user.steam_id} className="flex items-center justify-between">
            <div className="flex flex-1 items-center gap-3 min-w-0">
              <span className="text-sm text-muted-foreground w-6 text-center">{index + 1}</span>
              <UserAvatar src={user.avatar_url} username={user.username} />
              <Link href={`/users/${user.username}`} className="truncate text-sm font-medium hover:underline">
                {user.username}
              </Link>
            </div>
            <span className="text-sm font-semibold">{value}</span>
          </div>
        ))}
      </div>
    </div>
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

interface InsightSectionProps {
  title: string
  data: InsightData
  disclaimer?: string
}

function InsightSection({ title, data, disclaimer }: InsightSectionProps) {
  return (
    <>
      <h3 className="text-xl font-bold mb-6">🕒 {title}</h3>
      <div className="bg-card-background rounded-lg border-card-border border p-6">
        <p className="text-sm text-red-500 mb-3">
          * Only exclusive, full CV giveaways{disclaimer ? ` (${disclaimer})` : ''} are taken into account in the calculation
        </p>
        <h4 className="text-md font-semibold mb-3">Top 5 Most Created Giveaway Games</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6 mb-6">
          {data.topGames.map(({ game, count }) => (
            <div key={game.app_id ?? game.package_id} className="bg-card-background rounded-lg border-card-border border overflow-hidden">
              <GameImage
                appId={game.app_id?.toString()}
                packageId={game.package_id?.toString()}
                name={game.name}
                fillWidth={true}
              />
              <div className="p-4">
                <a href={`https://www.steamgifts.com/group/WlYTQ/thegiveawaysclub/search?q=${encodeURIComponent(game.name)}`} target="_blank" className="text-accent hover:underline text-lg font-bold truncate block">
                  {game.name}
                </a>
                <p className="text-sm text-muted-foreground">{count} {count === 1 ? 'Giveaway' : 'Giveaways'}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-8">
          <div>
            <UserRanking title="🎁 Top creators" users={data.topCreators} />
          </div>
          <div className="md:border-l md:pl-4">
            <UserRanking title="🏅 Top winners" users={data.topWinners} />
          </div>
          <div className="lg:border-l lg:pl-4">
            <UserRanking title="🎮 Top gamers (playtime)" users={data.topGamers} />
          </div>
          <div className="md:border-l md:pl-4">
            <UserRanking title="🏆 Top achievement hunters (by quantity)" users={data.topAchievementHunters} />
          </div>
          <div className="md:border-l md:pl-4">
            <UserRanking title="🎯 Top achievement hunters (by %)" users={data.topAchievementHuntersByPercentage} />
          </div>
        </div>
      </div>
    </>
  )
}

type LuckSortKey = 'luckScore' | 'wins' | 'expectedWins' | 'entries' | 'avgWinProbability' | 'chanceToWin'

function getLuckLabel(score: number): { label: string; className: string } {
  if (score >= 2.0) return { label: 'Very Lucky', className: 'text-yellow-500' }
  if (score >= 1.5) return { label: 'Lucky', className: 'text-success-foreground' }
  if (score >= 0.75) return { label: 'Average', className: 'text-muted-foreground' }
  if (score >= 0.5) return { label: 'Unlucky', className: 'text-accent-yellow' }
  return { label: 'Very Unlucky', className: 'text-error-foreground' }
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
      onClick={() => onSort(sortKey)}
      className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wide hover:text-foreground transition-colors ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}
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
  const [minEntries, setMinEntries] = useState(10)
  const [sortBy, setSortBy] = useState<LuckSortKey>('luckScore')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const handleSort = (key: LuckSortKey) => {
    if (sortBy === key) {
      setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortBy(key)
      setSortDir('desc')
    }
  }

  const filtered = useMemo(() => {
    return rankings
      .filter(r => r.entries >= minEntries && r.username.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        const diff = a[sortBy] - b[sortBy]
        return sortDir === 'desc' ? -diff : diff
      })
  }, [rankings, minEntries, search, sortBy, sortDir])

  return (
    <>
      <h3 className="text-xl font-bold mb-6">🍀 Luck Ranking</h3>
      <div className="bg-card-background rounded-lg border-card-border border p-6">
        <p className="text-sm text-muted-foreground mb-4">
          Luck score compares actual wins against statistically expected wins based on entry count and competition per giveaway.
          A score of 1.0 means exactly as lucky as expected; above 1.0 is luckier, below is unluckier.
        </p>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <input
            type="text"
            placeholder="Search username..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 px-3 py-1.5 text-sm rounded border border-card-border bg-background focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="flex items-center gap-2 text-sm">
            <label className="text-muted-foreground whitespace-nowrap">Min entries:</label>
            <select
              value={minEntries}
              onChange={e => setMinEntries(Number(e.target.value))}
              className="px-2 py-1.5 text-sm rounded border border-card-border bg-background focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value={1}>1+</option>
              <option value={5}>5+</option>
              <option value={10}>10+</option>
              <option value={25}>25+</option>
              <option value={50}>50+</option>
              <option value={100}>100+</option>
            </select>
          </div>
          <span className="text-sm text-muted-foreground self-center whitespace-nowrap">
            {filtered.length} user{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border">
                <th className="text-left py-2 pr-3 w-8 text-xs font-semibold uppercase tracking-wide text-muted-foreground">#</th>
                <th className="text-left py-2 pr-4">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">User</span>
                </th>
                <th className="text-right py-2 px-3">
                  <SortableHeader label="Entries" sortKey="entries" currentSort={sortBy} direction={sortDir} onSort={handleSort} />
                </th>
                <th className="text-right py-2 px-3">
                  <SortableHeader label="Wins" sortKey="wins" currentSort={sortBy} direction={sortDir} onSort={handleSort} />
                </th>
                <th className="text-right py-2 px-3">
                  <SortableHeader label="Expected" sortKey="expectedWins" currentSort={sortBy} direction={sortDir} onSort={handleSort} />
                </th>
                <th className="text-right py-2 px-3">
                  <SortableHeader label="Avg Win Prob" sortKey="avgWinProbability" currentSort={sortBy} direction={sortDir} onSort={handleSort} />
                </th>
                <th className="text-right py-2 px-3">
                  <SortableHeader label="Chance to Win" sortKey="chanceToWin" currentSort={sortBy} direction={sortDir} onSort={handleSort} />
                </th>
                <th className="text-right py-2 pl-3">
                  <SortableHeader label="Luck Score" sortKey="luckScore" currentSort={sortBy} direction={sortDir} onSort={handleSort} />
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, index) => {
                const { label, className } = getLuckLabel(row.luckScore)
                return (
                  <tr key={row.steam_id} className="border-b border-card-border/50 hover:bg-card-border/10 transition-colors">
                    <td className="py-2 pr-3 text-muted-foreground text-right">{index + 1}</td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2 min-w-0">
                        <UserAvatar src={row.avatar_url} username={row.username} />
                        <Link href={`/users/${row.username}`} className="truncate font-medium hover:underline">
                          {row.username}
                        </Link>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right text-muted-foreground">{row.entries}</td>
                    <td className="py-2 px-3 text-right font-medium">{row.wins}</td>
                    <td className="py-2 px-3 text-right text-muted-foreground">{row.expectedWins.toFixed(2)}</td>
                    <td className="py-2 px-3 text-right text-muted-foreground">{row.avgWinProbability.toFixed(2)}%</td>
                    <td className="py-2 px-3 text-right">
                      {row.activeEntriesCount > 0 ? (
                        <div className="flex flex-col items-end">
                          <span className="font-medium text-accent">{row.chanceToWin.toFixed(1)}%</span>
                          <span className="text-xs text-muted-foreground">{row.activeEntriesCount} active</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2 pl-3 text-right">
                      <div className="flex flex-col items-end">
                        <span className={`font-bold ${className}`}>{row.luckScore.toFixed(2)}x</span>
                        <span className={`text-xs ${className}`}>{label}</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">No users match the current filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
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

export default function DashboardClient({ activeStats, allStats, lastUpdated }: Props) {
  const [includeExMembers, setIncludeExMembers] = useState(false)

  const stats = includeExMembers ? allStats : activeStats

  return (
    <div className="space-y-8">
      <div className="mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Group Analytics Overview</h1>
            {lastUpdated ? <LastUpdated lastUpdatedDate={lastUpdated} /> : <p className="mt-2 text-sm text-muted-foreground">Last updated: Unknown</p>}
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap cursor-pointer">
            <input
              type="checkbox"
              checked={includeExMembers}
              onChange={(e) => setIncludeExMembers(e.target.checked)}
              className="rounded border-card-border"
            />
            Include ex-members
          </label>
        </div>
      </div>

      {/* Key Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-card-background rounded-lg border-card-border border p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-accent-blue rounded-full flex items-center justify-center">
                <span className="text-white font-semibold">👥</span>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted-foreground">{stats.memberLabel}</p>
              <p className="text-2xl font-semibold">{stats.memberCount}</p>
            </div>
          </div>
        </div>

        <div className="bg-card-background rounded-lg border-card-border border p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-accent-green rounded-full flex items-center justify-center">
                <span className="text-white font-semibold">🎁</span>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted-foreground">Total Giveaways</p>
              <p className="text-2xl font-semibold">{stats.totalGiveawaysCount}</p>
            </div>
          </div>
        </div>

        <div className="bg-card-background rounded-lg border-card-border border p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-accent-purple rounded-full flex items-center justify-center">
                <span className="text-white font-semibold">💰</span>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted-foreground">Total Value Sent</p>
              <p className="text-2xl font-semibold">${stats.totalValueSent.toFixed(0)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Community Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-card-background rounded-lg border-card-border border p-6">
          <h3 className="text-lg font-semibold mb-4">Community Health</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Net Contributors</span>
              <span className="text-sm font-semibold text-success-foreground">
                {stats.netContributors} ({((stats.netContributors / stats.memberCount) * 100).toFixed(1)}%)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Neutral Users</span>
              <span className="text-sm font-semibold text-muted-foreground">
                {stats.neutralUsers} ({((stats.neutralUsers / stats.memberCount) * 100).toFixed(1)}%)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Net Receivers</span>
              <span className="text-sm font-semibold text-error-foreground">
                {stats.netReceivers} ({((stats.netReceivers / stats.memberCount) * 100).toFixed(1)}%)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Users with warnings</span>
              <span className="text-sm font-semibold text-error-foreground">
                {stats.usersWithWarningsCount} ({stats.usersWithWarningsPercentage.toFixed(1)}%)
              </span>
            </div>
          </div>
        </div>

        <div className="bg-card-background rounded-lg border-card-border border p-6">
          <h3 className="text-lg font-semibold mb-4">Activity Summary</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Giveaways Created</span>
              <span className="text-sm font-semibold text-info-foreground">{stats.totalGiveawaysCreated}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Giveaways Successfully Sent</span>
              <span className="text-sm font-semibold text-success-foreground">{stats.totalGiveawaysWon}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground"><strong>Full CV</strong> Giveaways Created</span>
              <span className="text-sm font-semibold text-info-foreground">{stats.totalGiveawaysCreatedFullCV}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground"><strong>Full CV</strong> Giveaways Successfully Sent</span>
              <span className="text-sm font-semibold text-success-foreground">{stats.totalGiveawaysWonFullCV}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Total Value Received</span>
              <span className="text-sm font-semibold text-accent-purple">${stats.totalValueReceived.toFixed(0)}</span>
            </div>
          </div>
        </div>
      </div>

      <InsightSection title="Last 7 Days Insights" data={stats.last7DaysInsights} disclaimer="won in last 7 days" />
      <InsightSection title="Last 30 Days Insights" data={stats.last30DaysInsights} disclaimer="won in last 30 days" />
      <InsightSection title="All-Time Insights" data={stats.allTimeInsights} disclaimer="all time" />
      <LuckRankingSection rankings={stats.luckRankings} />
    </div>
  )
}
