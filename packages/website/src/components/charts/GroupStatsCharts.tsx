'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
  BarChart,
} from 'recharts'
import { ChartCard, ChartStat } from './ChartCard'
import {
  axisProps,
  chartColors,
  chartPalette,
  formatCompactCurrency,
  formatCompactNumber,
  formatNumber,
  formatUsd,
  gridProps,
  tooltipContentStyle,
  tooltipItemStyle,
  tooltipLabelStyle,
} from './chart-theme'
import { Gift, Coins, Target, Users, Trophy } from 'lucide-react'
import {
  StatsDrilldownModal,
  type DrilldownMemberRow,
  type DrilldownNav,
} from './StatsDrilldownModal'
import { useIsAdmin } from '@/lib/auth'
import { steamGiftsProfile } from '@/components/UserLink'
import { cn } from '@/lib/cn'

export interface MonthDatum {
  month: string
  label: string
  [key: string]: string | number
}

export interface ContributorDatum {
  username: string
  value: number
}

interface GroupStatsChartsProps {
  giveawaysPerMonth: MonthDatum[]
  cvPerMonth: MonthDatum[]
  avgEntriesPerMonth: MonthDatum[]
  membersPerMonth: MonthDatum[]
  /** "Mon YY" label -> members (current + ex) who joined that month, for the members chart's drill-down modal. */
  membersJoinedByMonth: Record<string, DrilldownMemberRow[]>
  /** "Mon YY" label -> ex-members who left that month, for the members chart's drill-down modal. */
  membersLeftByMonth: Record<string, DrilldownMemberRow[]>
  topContributors: ContributorDatum[]
}

/** Truncates a username tick label so long names don't blow out the axis width. */
function truncateUsername(value: string): string {
  return value.length > 14 ? `${value.slice(0, 13)}…` : value
}

interface RechartsTickProps {
  x?: number
  y?: number
  payload?: { value: string }
}

/**
 * Custom YAxis tick for the top-contributors chart: renders the username as
 * a clickable label routing to the member's profile, same admin-aware
 * routing as UserLink (internal /users/[username] for admins, the
 * SteamGifts profile otherwise) — a plain <text> can't be wrapped in
 * next/link, so the navigation is done by hand in onClick.
 */
function ContributorYAxisTick({ x, y, payload }: RechartsTickProps) {
  const isAdmin = useIsAdmin()
  const router = useRouter()
  if (!payload) return null
  const username = payload.value

  const handleClick = () => {
    if (isAdmin) {
      router.push(`/users/${username}`)
    } else {
      window.open(steamGiftsProfile(username), '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      fontSize={12}
      fill="var(--muted-foreground)"
      className="cursor-pointer transition-colors hover:fill-[var(--primary-hi)] hover:underline"
      onClick={handleClick}
    >
      {truncateUsername(username)}
      <title>{username}</title>
    </text>
  )
}

export function GroupStatsCharts({
  giveawaysPerMonth,
  cvPerMonth,
  avgEntriesPerMonth,
  membersPerMonth,
  membersJoinedByMonth,
  membersLeftByMonth,
  topContributors,
}: GroupStatsChartsProps) {
  const [membersMonth, setMembersMonth] = useState<string | null>(null)
  const [showLeft, setShowLeft] = useState(false)

  // Months with at least one joiner or leaver, in chart-axis order, for the
  // drill-down modal's prev/next controls.
  const membersMonths = membersPerMonth
    .map((r) => String(r.label))
    .filter(
      (label) =>
        (membersJoinedByMonth[label]?.length ?? 0) > 0 ||
        (membersLeftByMonth[label]?.length ?? 0) > 0,
    )

  const membersNav: DrilldownNav | undefined = membersMonth
    ? (() => {
        const idx = membersMonths.indexOf(membersMonth)
        return {
          onPrev: () => {
            if (idx > 0) setMembersMonth(membersMonths[idx - 1])
          },
          onNext: () => {
            if (idx >= 0 && idx < membersMonths.length - 1) {
              setMembersMonth(membersMonths[idx + 1])
            }
          },
          canPrev: idx > 0,
          canNext: idx >= 0 && idx < membersMonths.length - 1,
        }
      })()
    : undefined

  const membersJoinedRows = membersMonth ? membersJoinedByMonth[membersMonth] ?? [] : []
  const membersLeftRows = membersMonth ? membersLeftByMonth[membersMonth] ?? [] : []

  const latestGiveawaysMonth = giveawaysPerMonth.at(-1)
  const totalGiveaways = giveawaysPerMonth.reduce(
    (sum, r) => sum + Number(r.count ?? 0),
    0,
  )
  const latestGiveawaysCount = Number(latestGiveawaysMonth?.count ?? 0)

  const latestCvMonth = cvPerMonth.at(-1)
  const totalCv = cvPerMonth.reduce((sum, r) => sum + Number(r.cv ?? 0), 0)
  const latestCv = Number(latestCvMonth?.cv ?? 0)

  const latestAvgEntriesMonth = avgEntriesPerMonth.at(-1)
  const nonZeroAvgRows = avgEntriesPerMonth.filter((r) => Number(r.avgEntries ?? 0) > 0)
  const overallAvgEntries = nonZeroAvgRows.length
    ? nonZeroAvgRows.reduce((sum, r) => sum + Number(r.avgEntries ?? 0), 0) /
      nonZeroAvgRows.length
    : 0
  const latestAvgEntries = Number(latestAvgEntriesMonth?.avgEntries ?? 0)

  const latestMembersMonth = membersPerMonth.at(-1)
  const netMembers = Number(latestMembersMonth?.net ?? 0)
  const latestJoined = Number(latestMembersMonth?.joined ?? 0)
  const latestLeft = Number(latestMembersMonth?.left ?? 0)

  const topContributor = topContributors[0]

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <ChartCard
        title="Giveaways created per month"
        description="Counted group giveaways, by creation month"
        summary={
          <>
            <ChartStat>{formatNumber(totalGiveaways)}</ChartStat> total ·{' '}
            <ChartStat>{formatNumber(latestGiveawaysCount)}</ChartStat> in{' '}
            {latestGiveawaysMonth?.label ?? 'the latest month'}
          </>
        }
        icon={Gift}
      >
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={giveawaysPerMonth} margin={{ left: 0, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="giveawaysGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartColors.blue} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={chartColors.blue} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis
                {...axisProps}
                allowDecimals={false}
                width={44}
                tickFormatter={(v: number) => formatCompactNumber(v)}
              />
              <Tooltip
                contentStyle={tooltipContentStyle}
                labelStyle={tooltipLabelStyle}
                itemStyle={tooltipItemStyle}
                cursor={{ stroke: 'var(--card-border-strong)' }}
              />
              <Area
                type="monotone"
                dataKey="count"
                name="Giveaways"
                stroke={chartColors.blue}
                strokeWidth={2}
                fill="url(#giveawaysGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard
        title="CV sent per month"
        description="Total contribution value of giveaways created, by month"
        summary={
          <>
            <ChartStat>{formatUsd(totalCv)}</ChartStat> total ·{' '}
            <ChartStat>{formatUsd(latestCv)}</ChartStat> in{' '}
            {latestCvMonth?.label ?? 'the latest month'}
          </>
        }
        icon={Coins}
      >
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cvPerMonth} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis
                {...axisProps}
                width={52}
                tickFormatter={(v: number) => formatCompactCurrency(v)}
              />
              <Tooltip
                contentStyle={tooltipContentStyle}
                labelStyle={tooltipLabelStyle}
                itemStyle={tooltipItemStyle}
                formatter={(value) => formatUsd(Number(value))}
                cursor={{ fill: 'color-mix(in oklab, var(--accent-green) 10%, transparent)' }}
              />
              <Bar dataKey="cv" name="CV sent" fill={chartColors.green} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard
        title="Average entries per giveaway"
        description="Mean entry count of giveaways ending each month"
        summary={
          <>
            Avg <ChartStat>{overallAvgEntries.toFixed(1)}</ChartStat> overall ·{' '}
            <ChartStat>{latestAvgEntries.toFixed(1)}</ChartStat> in{' '}
            {latestAvgEntriesMonth?.label ?? 'the latest month'}
          </>
        }
        icon={Target}
      >
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={avgEntriesPerMonth} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis
                {...axisProps}
                width={44}
                allowDecimals={false}
                tickFormatter={(v: number) => formatCompactNumber(v)}
              />
              <Tooltip
                contentStyle={tooltipContentStyle}
                labelStyle={tooltipLabelStyle}
                itemStyle={tooltipItemStyle}
                formatter={(value) => Number(value).toFixed(1)}
                cursor={{ stroke: 'var(--card-border-strong)' }}
              />
              <Line
                type="monotone"
                dataKey="avgEntries"
                name="Avg entries"
                stroke={chartColors.purple}
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard
        title="Members joined per month"
        description="Joined (bar) and net membership (line) — toggle to add left"
        summary={
          <>
            <ChartStat>{formatNumber(netMembers)}</ChartStat> members ·{' '}
            <ChartStat>{formatNumber(latestJoined)}</ChartStat> joined ·{' '}
            <ChartStat>{formatNumber(latestLeft)}</ChartStat> left in{' '}
            {latestMembersMonth?.label ?? 'the latest month'}{' '}
            <span className="text-muted-foreground">· click a bar for details</span>
          </>
        }
        icon={Users}
        actions={
          <button
            type="button"
            onClick={() => setShowLeft((v) => !v)}
            className={cn(
              'shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              showLeft
                ? 'border-[var(--accent-red)] bg-[color-mix(in_oklab,var(--accent-red)_12%,transparent)] text-[var(--accent-red)]'
                : 'border-card-border bg-transparent text-muted-foreground hover:bg-card-background-hover',
            )}
          >
            {showLeft ? 'Hide left' : 'Show left'}
          </button>
        }
      >
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={membersPerMonth}
              margin={{ left: 0, right: 8, top: 8 }}
              onClick={(state: { activeLabel?: string | number }) => {
                if (state?.activeLabel == null) return
                setMembersMonth(String(state.activeLabel))
              }}
              className="cursor-pointer"
            >
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis
                {...axisProps}
                yAxisId="left"
                width={44}
                allowDecimals={false}
                tickFormatter={(v: number) => formatCompactNumber(v)}
              />
              <YAxis
                {...axisProps}
                yAxisId="right"
                orientation="right"
                width={44}
                allowDecimals={false}
                tickFormatter={(v: number) => formatCompactNumber(v)}
              />
              <Tooltip
                contentStyle={tooltipContentStyle}
                labelStyle={tooltipLabelStyle}
                itemStyle={tooltipItemStyle}
                cursor={{ fill: 'color-mix(in oklab, var(--accent-blue) 10%, transparent)' }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: 'var(--muted-foreground)' }} />
              <Bar
                yAxisId="left"
                dataKey="joined"
                name="Joined"
                fill={chartColors.blue}
                radius={[4, 4, 0, 0]}
                cursor="pointer"
              />
              {showLeft && (
                <Bar
                  yAxisId="left"
                  dataKey="left"
                  name="Left"
                  fill={chartColors.red}
                  radius={[4, 4, 0, 0]}
                  cursor="pointer"
                  isAnimationActive
                />
              )}
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="net"
                name="Net members"
                stroke={chartColors.orange}
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard
        title="Top 10 contributors"
        description="By real (post-return) value sent"
        summary={
          topContributor && (
            <>
              <ChartStat>{topContributor.username}</ChartStat> leads with{' '}
              <ChartStat>{formatUsd(topContributor.value)}</ChartStat>
            </>
          )
        }
        icon={Trophy}
        className="lg:col-span-2"
      >
        <div className="h-96 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={topContributors}
              layout="vertical"
              margin={{ left: 8, right: 24, top: 8 }}
            >
              <CartesianGrid {...gridProps} horizontal={false} />
              <XAxis
                type="number"
                {...axisProps}
                tickFormatter={(v: number) => formatCompactCurrency(v)}
              />
              <YAxis
                type="category"
                dataKey="username"
                {...axisProps}
                width={130}
                tick={<ContributorYAxisTick />}
              />
              <Tooltip
                contentStyle={tooltipContentStyle}
                labelStyle={tooltipLabelStyle}
                itemStyle={tooltipItemStyle}
                formatter={(value) => formatUsd(Number(value))}
                cursor={{ fill: 'color-mix(in oklab, var(--primary) 8%, transparent)' }}
              />
              <Bar dataKey="value" name="Value sent" radius={[0, 4, 4, 0]}>
                {topContributors.map((entry, index) => (
                  <Cell key={entry.username} fill={chartPalette[index % chartPalette.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {membersMonth && (
        <StatsDrilldownModal
          open={membersMonth != null}
          onOpenChange={(open) => !open && setMembersMonth(null)}
          title={membersMonth}
          sections={[
            {
              kind: 'member',
              heading: `Joined (${membersJoinedRows.length})`,
              rows: membersJoinedRows,
            },
            {
              kind: 'member',
              heading: `Left (${membersLeftRows.length})`,
              rows: membersLeftRows,
            },
          ]}
          nav={membersNav}
        />
      )}
    </div>
  )
}
