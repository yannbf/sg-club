'use client'

import { Gift, Coins, Users, Target } from 'lucide-react'
import { StatCard } from '@/components/StatCard'
import { LastUpdated } from '@/components/LastUpdated'
import {
  GroupStatsCharts,
  type ContributorDatum,
  type MonthDatum,
} from '@/components/charts/GroupStatsCharts'
import type { DrilldownMemberRow } from '@/components/charts/StatsDrilldownModal'
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
      />
    </div>
  )
}
