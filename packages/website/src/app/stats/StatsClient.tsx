'use client'

import { Gift, Coins, Users, Target } from 'lucide-react'
import { StatCard } from '@/components/StatCard'
import { LastUpdated } from '@/components/LastUpdated'
import {
  GroupStatsCharts,
  type ContributorDatum,
  type MonthDatum,
} from '@/components/charts/GroupStatsCharts'
import type { DrilldownMemberRow, DrilldownGameRow } from '@/components/charts/StatsDrilldownModal'
import { formatUsd } from '@/components/charts/chart-theme'

interface StatsClientProps {
  totalGiveaways: number
  totalCvSent: number
  totalMembers: number
  totalEntries: number
  giveawaysPerMonth: MonthDatum[]
  cvPerMonth: MonthDatum[]
  avgEntriesPerMonth: MonthDatum[]
  membersPerMonth: MonthDatum[]
  /** "Mon YY" label -> members (current + ex) who joined that month, sorted by first_seen_at, for the members chart's drill-down modal. */
  membersJoinedByMonth: Record<string, DrilldownMemberRow[]>
  /** "Mon YY" label -> ex-members who left that month, sorted by left_at_timestamp, for the members chart's drill-down modal. */
  membersLeftByMonth: Record<string, DrilldownMemberRow[]>
  topContributors: ContributorDatum[]
  /** "Mon YY" label -> that month's counted giveaways, newest first, for the giveaways-created chart's drill-down modal. */
  giveawaysCreatedByMonth: Record<string, DrilldownGameRow[]>
  /** "Mon YY" label -> that month's counted giveaways, highest CV first, for the CV-sent chart's drill-down modal. */
  cvSentByMonth: Record<string, DrilldownGameRow[]>
  /** username -> that contributor's own counted giveaways, newest first (top 10 contributors only). */
  contributorGiveaways: Record<string, DrilldownGameRow[]>
  hoursPerMonth: MonthDatum[]
  /** "Mon YY" label -> that month's games with hours gained, highest gain first, capped at top 50. */
  hoursByMonth: Record<string, DrilldownGameRow[]>
  /** "Mon YY" label -> that month's true row count before the top-50 cap. */
  hoursByMonthCount: Record<string, number>
  activeMembersPerMonth: MonthDatum[]
  /** "Mon YY" label -> members active that month (entered/created/won), sorted by total actions desc. */
  activeMembersByMonth: Record<string, DrilldownMemberRow[]>
  achievementsPerMonth: MonthDatum[]
  /** "Mon YY" label -> that month's games with achievements gained, highest gain first, capped at top 50. */
  achievementsByMonth: Record<string, DrilldownGameRow[]>
  /** "Mon YY" label -> that month's true row count before the top-50 cap. */
  achievementsByMonthCount: Record<string, number>
  lastUpdated: string | null
}

const fmt = (n: number) => n.toLocaleString('en-US')

export default function StatsClient({
  totalGiveaways,
  totalCvSent,
  totalMembers,
  totalEntries,
  giveawaysPerMonth,
  cvPerMonth,
  avgEntriesPerMonth,
  membersPerMonth,
  membersJoinedByMonth,
  membersLeftByMonth,
  topContributors,
  giveawaysCreatedByMonth,
  cvSentByMonth,
  contributorGiveaways,
  hoursPerMonth,
  hoursByMonth,
  hoursByMonthCount,
  activeMembersPerMonth,
  activeMembersByMonth,
  achievementsPerMonth,
  achievementsByMonth,
  achievementsByMonthCount,
  lastUpdated,
}: StatsClientProps) {
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            Group Stats
          </h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            {lastUpdated ? (
              <LastUpdated lastUpdatedDate={lastUpdated} />
            ) : (
              <span>Last updated: unknown</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Gift}
          label="Total giveaways"
          value={fmt(totalGiveaways)}
          accent="green"
        />
        <StatCard
          icon={Coins}
          label="Total CV sent"
          value={formatUsd(totalCvSent)}
          accent="amber"
        />
        <StatCard
          icon={Users}
          label="Total members"
          value={fmt(totalMembers)}
          accent="primary"
        />
        <StatCard
          icon={Target}
          label="Total entries"
          value={fmt(totalEntries)}
          accent="purple"
        />
      </div>

      <GroupStatsCharts
        giveawaysPerMonth={giveawaysPerMonth}
        cvPerMonth={cvPerMonth}
        avgEntriesPerMonth={avgEntriesPerMonth}
        membersPerMonth={membersPerMonth}
        membersJoinedByMonth={membersJoinedByMonth}
        membersLeftByMonth={membersLeftByMonth}
        topContributors={topContributors}
        giveawaysCreatedByMonth={giveawaysCreatedByMonth}
        cvSentByMonth={cvSentByMonth}
        contributorGiveaways={contributorGiveaways}
        hoursPerMonth={hoursPerMonth}
        hoursByMonth={hoursByMonth}
        hoursByMonthCount={hoursByMonthCount}
        activeMembersPerMonth={activeMembersPerMonth}
        activeMembersByMonth={activeMembersByMonth}
        achievementsPerMonth={achievementsPerMonth}
        achievementsByMonth={achievementsByMonth}
        achievementsByMonthCount={achievementsByMonthCount}
      />
    </div>
  )
}
