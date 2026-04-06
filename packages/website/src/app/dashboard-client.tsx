'use client'

import { useState } from 'react'
import Link from 'next/link'
import { GameData, User } from '@/types'
import { LastUpdated } from '@/components/LastUpdated'
import UserAvatar from '@/components/UserAvatar'
import GameImage from '@/components/GameImage'

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
    </div>
  )
}
