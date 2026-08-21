'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
  BarChart,
} from 'recharts'
import type { TooltipContentProps } from 'recharts'
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
import { Gift, Coins, Target, Users, Trophy, Clock } from 'lucide-react'
import {
  StatsDrilldownModal,
  type DrilldownGameRow,
  type DrilldownMemberRow,
  type DrilldownNav,
} from './StatsDrilldownModal'
import { monthKey, monthLabel } from '@/lib/chart-data'
import { SPECIAL_EVENTS } from '@/lib/events'
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
  /** "Mon YY" label -> that month's counted giveaways, newest first, for the giveaways-created chart's drill-down modal. */
  giveawaysCreatedByMonth: Record<string, DrilldownGameRow[]>
  /** "Mon YY" label -> that month's counted giveaways, highest CV first, for the CV-sent chart's drill-down modal. */
  cvSentByMonth: Record<string, DrilldownGameRow[]>
  /** username -> that contributor's own counted giveaways, newest first (top 10 contributors only). */
  contributorGiveaways: Record<string, DrilldownGameRow[]>
  hoursPerMonth: MonthDatum[]
  /** "Mon YY" label -> that month's won games with play data, highest playtime first. */
  hoursByMonth: Record<string, DrilldownGameRow[]>
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

/**
 * Custom tooltip for the members chart: the chart itself now renders a
 * single "members in the group" line, but the tooltip still surfaces that
 * month's joined/left counts by reading them off the row data directly
 * (rather than off recharts' payload, which only carries the rendered
 * line's own series).
 */
function MembersTooltipContent({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0]?.payload as MonthDatum | undefined
  const net = Number(row?.net ?? 0)
  const joined = Number(row?.joined ?? 0)
  const left = Number(row?.left ?? 0)
  return (
    <div style={tooltipContentStyle}>
      <div style={tooltipLabelStyle}>{label}</div>
      <div style={{ ...tooltipItemStyle, color: chartColors.blue }}>
        Members: {formatNumber(net)}
      </div>
      {joined > 0 && (
        <div style={{ ...tooltipItemStyle, color: chartColors.green }}>
          Joined: {formatNumber(joined)}
        </div>
      )}
      {left > 0 && (
        <div style={{ ...tooltipItemStyle, color: chartColors.red }}>
          Left: {formatNumber(left)}
        </div>
      )}
    </div>
  )
}

/**
 * Custom tooltip for the giveaways-created chart: reads the month's count
 * directly off the row data (rather than recharts' payload) so the event
 * dots' own Scatter series — which shares the same "count" dataKey to sit on
 * the line — doesn't produce a duplicate "Giveaways" entry. Event names for
 * the hovered month are appended only while the event overlay is toggled on.
 */
function GiveawaysTooltipContent({
  active,
  payload,
  label,
  showEvents,
  eventNamesByMonth,
}: TooltipContentProps & { showEvents: boolean; eventNamesByMonth: Record<string, string[]> }) {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0]?.payload as MonthDatum | undefined
  const count = Number(row?.count ?? 0)
  const events = row ? eventNamesByMonth[String(row.label)] : undefined
  return (
    <div style={tooltipContentStyle}>
      <div style={tooltipLabelStyle}>{label}</div>
      <div style={{ ...tooltipItemStyle, color: chartColors.blue }}>
        Giveaways: {formatNumber(count)}
      </div>
      {showEvents && events && events.length > 0 && (
        <div style={{ ...tooltipItemStyle, color: chartColors.primary }}>
          Events: {events.join(', ')}
        </div>
      )}
    </div>
  )
}

/** Small accent-colored dot marking a month with an active community event, drawn on top of the giveaways line. */
function EventDot({ cx, cy }: { cx?: number; cy?: number }) {
  if (cx == null || cy == null) return null
  return (
    <circle
      cx={cx}
      cy={cy}
      r={5}
      fill={chartColors.primary}
      stroke="var(--card-background)"
      strokeWidth={2}
    />
  )
}

/** Builds prev/next controls stepping through an ordered list of keys — shared by every month/rank drill-down modal below. */
function buildNav<T>(
  order: T[],
  current: T | null,
  setCurrent: (value: T) => void,
): DrilldownNav | undefined {
  if (current == null) return undefined
  const idx = order.indexOf(current)
  return {
    onPrev: () => {
      if (idx > 0) setCurrent(order[idx - 1])
    },
    onNext: () => {
      if (idx >= 0 && idx < order.length - 1) setCurrent(order[idx + 1])
    },
    canPrev: idx > 0,
    canNext: idx >= 0 && idx < order.length - 1,
  }
}

export function GroupStatsCharts({
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
}: GroupStatsChartsProps) {
  const [membersMonth, setMembersMonth] = useState<string | null>(null)
  const [giveawaysMonth, setGiveawaysMonth] = useState<string | null>(null)
  const [showEvents, setShowEvents] = useState(false)
  const [cvMonth, setCvMonth] = useState<string | null>(null)
  const [contributorUser, setContributorUser] = useState<string | null>(null)
  const [hoursMonth, setHoursMonth] = useState<string | null>(null)

  // Every month each chart's x-axis shows, in order, for the drill-down
  // modals' prev/next controls — including empty months, so navigation never
  // skips or dead-ends on a month with no activity.
  const membersMonths = membersPerMonth.map((r) => String(r.label))
  const giveawaysMonths = giveawaysPerMonth.map((r) => String(r.label))
  const cvMonths = cvPerMonth.map((r) => String(r.label))
  const hoursMonths = hoursPerMonth.map((r) => String(r.label))
  const contributorUsernames = topContributors.map((c) => c.username)

  const membersNav = buildNav(membersMonths, membersMonth, setMembersMonth)
  const giveawaysNav = buildNav(giveawaysMonths, giveawaysMonth, setGiveawaysMonth)
  const cvNav = buildNav(cvMonths, cvMonth, setCvMonth)
  const hoursNav = buildNav(hoursMonths, hoursMonth, setHoursMonth)
  const contributorNav = buildNav(contributorUsernames, contributorUser, setContributorUser)

  const membersJoinedRows = membersMonth ? membersJoinedByMonth[membersMonth] ?? [] : []
  const membersLeftRows = membersMonth ? membersLeftByMonth[membersMonth] ?? [] : []
  const giveawaysRows = giveawaysMonth ? giveawaysCreatedByMonth[giveawaysMonth] ?? [] : []
  const cvRows = cvMonth ? cvSentByMonth[cvMonth] ?? [] : []
  const contributorRows = contributorUser ? contributorGiveaways[contributorUser] ?? [] : []
  const hoursRows = hoursMonth ? hoursByMonth[hoursMonth] ?? [] : []

  // Community-event bands for the "show event data" overlay — special events
  // only (community goals, Secret Santa, etc); gaming challenges are
  // deliberately excluded (they're a different, always-on program, not a
  // moment to correlate against giveaway volume). Clipped to the chart's own
  // month range so a stray/future event can't stretch the x-axis.
  const eventBands = useMemo(() => {
    if (giveawaysPerMonth.length === 0) return []
    const monthSet = new Set(giveawaysMonths)
    const firstMonth = giveawaysMonths[0]
    const lastMonth = giveawaysMonths[giveawaysMonths.length - 1]
    return SPECIAL_EVENTS.filter(
      (e) => e.startTimestamp != null && e.endTimestamp != null,
    )
      .map((e) => {
        const startLabel = monthLabel(monthKey(e.startTimestamp!))
        // endTimestamp is often an exact boundary (e.g. "ends July 4th
        // 12:00"), so back it off a second to land in the event's last real
        // month instead of spilling into the next one.
        const endLabel = monthLabel(monthKey(e.endTimestamp! - 1))
        return { slug: e.slug, name: e.name, x1: startLabel, x2: endLabel }
      })
      .filter((b) => monthSet.has(b.x1) || monthSet.has(b.x2))
      .map((b) => ({
        ...b,
        x1: monthSet.has(b.x1) ? b.x1 : firstMonth,
        x2: monthSet.has(b.x2) ? b.x2 : lastMonth,
      }))
  }, [giveawaysPerMonth, giveawaysMonths])

  // Event names active in each month, derived from the bands above — an
  // event spanning several months gets an entry (and a dot) in every one of
  // them, not just its start month.
  const eventNamesByMonth = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const band of eventBands) {
      const startIdx = giveawaysMonths.indexOf(band.x1)
      const endIdx = giveawaysMonths.indexOf(band.x2)
      if (startIdx === -1 || endIdx === -1) continue
      for (const m of giveawaysMonths.slice(startIdx, endIdx + 1)) {
        const arr = map[m]
        if (arr) arr.push(band.name)
        else map[m] = [band.name]
      }
    }
    return map
  }, [eventBands, giveawaysMonths])

  // Giveaways-chart data augmented with an `eventDot` field (the month's
  // count, or null) for the event-dot Scatter series. Scatter must read this
  // off the *same* row array as the Area series — giving it a separately
  // filtered `data` array causes recharts to append extra x-axis categories
  // for a category axis, even when every label value is already present.
  const giveawaysChartData = useMemo(
    () =>
      giveawaysPerMonth.map((r) => ({
        ...r,
        eventDot: eventNamesByMonth[String(r.label)] ? r.count : null,
      })),
    [giveawaysPerMonth, eventNamesByMonth],
  )

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

  const latestHoursMonth = hoursPerMonth.at(-1)
  const totalHours = hoursPerMonth.reduce((sum, r) => sum + Number(r.hours ?? 0), 0)
  const latestHours = Number(latestHoursMonth?.hours ?? 0)

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <ChartCard
        title="Giveaways created per month"
        description="Counted group giveaways, by creation month"
        summary={
          <>
            <ChartStat>{formatNumber(totalGiveaways)}</ChartStat> total ·{' '}
            <ChartStat>{formatNumber(latestGiveawaysCount)}</ChartStat> in{' '}
            {latestGiveawaysMonth?.label ?? 'the latest month'}{' '}
            <span className="text-muted-foreground">· click a month for details</span>
          </>
        }
        icon={Gift}
        actions={
          <button
            type="button"
            onClick={() => setShowEvents((v) => !v)}
            className={cn(
              'shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              showEvents
                ? 'border-[var(--primary)] bg-[color-mix(in_oklab,var(--primary)_12%,transparent)] text-[var(--primary)]'
                : 'border-card-border bg-transparent text-muted-foreground hover:bg-card-background-hover',
            )}
          >
            {showEvents ? 'Hide event data' : 'Show event data'}
          </button>
        }
      >
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={giveawaysChartData}
              margin={{ left: 0, right: 8, top: 8 }}
              onClick={(state: { activeLabel?: string | number }) => {
                if (state?.activeLabel == null) return
                setGiveawaysMonth(String(state.activeLabel))
              }}
              className="cursor-pointer"
            >
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
                content={(props) => (
                  <GiveawaysTooltipContent
                    {...(props as TooltipContentProps)}
                    showEvents={showEvents}
                    eventNamesByMonth={eventNamesByMonth}
                  />
                )}
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
              {showEvents && <Scatter dataKey="eventDot" name="Events" shape={EventDot} />}
            </ComposedChart>
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
            {latestCvMonth?.label ?? 'the latest month'}{' '}
            <span className="text-muted-foreground">· click a month for details</span>
          </>
        }
        icon={Coins}
      >
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={cvPerMonth}
              margin={{ left: 0, right: 8, top: 8 }}
              onClick={(state: { activeLabel?: string | number }) => {
                if (state?.activeLabel == null) return
                setCvMonth(String(state.activeLabel))
              }}
              className="cursor-pointer"
            >
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
              <Bar
                dataKey="cv"
                name="CV sent"
                fill={chartColors.green}
                radius={[4, 4, 0, 0]}
                cursor="pointer"
              />
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
        title="Members in the group"
        description="Total membership over time — click a month for who joined/left"
        summary={
          <>
            <ChartStat>{formatNumber(netMembers)}</ChartStat> members ·{' '}
            <ChartStat>{formatNumber(latestJoined)}</ChartStat> joined ·{' '}
            <ChartStat>{formatNumber(latestLeft)}</ChartStat> left in{' '}
            {latestMembersMonth?.label ?? 'the latest month'}{' '}
            <span className="text-muted-foreground">· click a month for details</span>
          </>
        }
        icon={Users}
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
                width={44}
                allowDecimals={false}
                domain={[0, 'auto']}
                tickFormatter={(v: number) => formatCompactNumber(v)}
              />
              <Tooltip
                content={MembersTooltipContent}
                cursor={{ stroke: 'var(--card-border-strong)' }}
              />
              <Line
                type="monotone"
                dataKey="net"
                name="Members"
                stroke={chartColors.blue}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5, cursor: 'pointer' }}
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
              <ChartStat>{formatUsd(topContributor.value)}</ChartStat>{' '}
              <span className="text-muted-foreground">· click a bar for details</span>
            </>
          )
        }
        icon={Trophy}
      >
        <div className="h-96 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={topContributors}
              layout="vertical"
              margin={{ left: 8, right: 24, top: 8 }}
              className="cursor-pointer"
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
              <Bar
                dataKey="value"
                name="Value sent"
                radius={[0, 4, 4, 0]}
                cursor="pointer"
                onClick={(entry) => {
                  const username = (entry?.payload as ContributorDatum | undefined)?.username
                  if (username) setContributorUser(username)
                }}
              >
                {topContributors.map((entry, index) => (
                  <Cell key={entry.username} fill={chartPalette[index % chartPalette.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard
        title="Playtime on games won each month"
        description="Total hours winners have put (to date) into the games won that month — not hours played during the month"
        summary={
          <>
            <ChartStat>{formatNumber(Math.round(totalHours))}</ChartStat> hours (to date) total ·{' '}
            <ChartStat>{formatNumber(Math.round(latestHours))}</ChartStat> in{' '}
            {latestHoursMonth?.label ?? 'the latest month'}{' '}
            <span className="text-muted-foreground">· click a month for details</span>
          </>
        }
        icon={Clock}
      >
        <div className="h-96 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={hoursPerMonth}
              margin={{ left: 0, right: 8, top: 8 }}
              onClick={(state: { activeLabel?: string | number }) => {
                if (state?.activeLabel == null) return
                setHoursMonth(String(state.activeLabel))
              }}
              className="cursor-pointer"
            >
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
                formatter={(value) => `${formatNumber(Math.round(Number(value)))}h`}
                cursor={{ fill: 'color-mix(in oklab, var(--accent-purple) 10%, transparent)' }}
              />
              <Bar
                dataKey="hours"
                name="Hours (to date)"
                fill={chartColors.purple}
                radius={[4, 4, 0, 0]}
                cursor="pointer"
              />
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
          emptyMessage={`No members joined or left in ${membersMonth}.`}
        />
      )}

      {giveawaysMonth && (
        <StatsDrilldownModal
          open={giveawaysMonth != null}
          onOpenChange={(open) => !open && setGiveawaysMonth(null)}
          title={giveawaysMonth}
          sections={[
            { heading: `Giveaways created (${giveawaysRows.length})`, rows: giveawaysRows },
          ]}
          nav={giveawaysNav}
          emptyMessage={`No giveaways created in ${giveawaysMonth}.`}
        />
      )}

      {cvMonth && (
        <StatsDrilldownModal
          open={cvMonth != null}
          onOpenChange={(open) => !open && setCvMonth(null)}
          title={cvMonth}
          description="Sorted by CV value, highest first."
          sections={[{ heading: `CV sent (${cvRows.length})`, rows: cvRows }]}
          nav={cvNav}
          emptyMessage={`No CV sent in ${cvMonth}.`}
        />
      )}

      {contributorUser && (
        <StatsDrilldownModal
          open={contributorUser != null}
          onOpenChange={(open) => !open && setContributorUser(null)}
          title={contributorUser}
          sections={[
            { heading: `Giveaways created (${contributorRows.length})`, rows: contributorRows },
          ]}
          nav={contributorNav}
          emptyMessage={`No giveaways created by ${contributorUser}.`}
        />
      )}

      {hoursMonth && (
        <StatsDrilldownModal
          open={hoursMonth != null}
          onOpenChange={(open) => !open && setHoursMonth(null)}
          title={hoursMonth}
          description="Sorted by playtime, highest first."
          sections={[{ heading: `Won games (${hoursRows.length})`, rows: hoursRows }]}
          nav={hoursNav}
          emptyMessage={`No wins with play data in ${hoursMonth}.`}
        />
      )}
    </div>
  )
}
