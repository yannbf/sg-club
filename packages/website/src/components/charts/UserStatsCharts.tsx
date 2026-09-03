'use client'

import { useState } from 'react'
import { useIsAdmin } from '@/lib/auth'
import {
  CartesianGrid,
  ComposedChart,
  Line,
  Bar,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
  Pie,
  PieChart,
  Cell,
} from 'recharts'
import { ChartCard, ChartStat } from './ChartCard'
import {
  axisProps,
  chartColors,
  formatCompactCurrency,
  formatCompactNumber,
  formatNumber,
  formatUsd,
  gridProps,
  tooltipContentStyle,
  tooltipItemStyle,
  tooltipLabelStyle,
} from './chart-theme'
import { TrendingUp, Heart, Coins, PieChart as PieChartIcon, Clock } from 'lucide-react'
import type { MonthDatum } from './GroupStatsCharts'
import {
  StatsDrilldownModal,
  type DrilldownGameRow,
  type DrilldownNav,
} from './StatsDrilldownModal'
import type { WinPlayStatus } from '@/lib/chart-data'

export interface WinsBreakdownDatum {
  name: string
  value: number
  color: string
  bucket: WinPlayStatus
}

export interface UserStatsSummary {
  giftsSent: number
  giftsWon: number
  enteredTotal: number
  enteredLatest: number
  enteredLatestLabel?: string
  cvSentTotal: number
  cvReceivedTotal: number
  winCounts: Record<WinPlayStatus, number>
}

interface UserStatsChartsProps {
  giftsCumulative: MonthDatum[]
  /** Entered per month — the "Activity per month" chart. Created/won stay in the data for the month drill-down. */
  activityPerMonth: MonthDatum[]
  cvCumulative: MonthDatum[]
  /** Hours gained per month on this member's own won games, from playtime snapshot deltas. */
  hoursPerMonth: MonthDatum[]
  winsBreakdown: WinsBreakdownDatum[]
  summary: UserStatsSummary
  /** Month label ("Mar 24", matching the chart's x-axis) -> that month's records, for the drill-down modals. */
  sentByMonth: Map<string, DrilldownGameRow[]>
  wonByMonth: Map<string, DrilldownGameRow[]>
  enteredByMonth: Map<string, DrilldownGameRow[]>
  /** Month label -> that month's games with playtime/achievement gains, highest hours first. Server-computed, so a plain Record rather than a Map. */
  hoursByMonth: Record<string, DrilldownGameRow[]>
  /** Not-counted created giveaways (deleted / zero-entry) — gifts sent & won modal only. */
  notCountedByMonth: Map<string, DrilldownGameRow[]>
  winsByBucket: Record<WinPlayStatus, DrilldownGameRow[]>
}

const winBucketLabels: Record<WinPlayStatus, string> = {
  finished: 'Finished',
  played: 'Played',
  never_played: 'Never played',
  unreleased: 'Unreleased',
}

type MonthModalKind = 'gifts' | 'cv' | 'activity' | 'hours'

interface MonthModalState {
  kind: MonthModalKind
  /** The chart's x-axis label for the clicked month, e.g. "Mar 24" — also the key into *ByMonth maps. */
  label: string
}

export function UserStatsCharts({
  giftsCumulative,
  activityPerMonth,
  cvCumulative,
  hoursPerMonth,
  winsBreakdown,
  summary,
  sentByMonth,
  wonByMonth,
  enteredByMonth,
  hoursByMonth,
  notCountedByMonth,
  winsByBucket,
}: UserStatsChartsProps) {
  const isAdmin = useIsAdmin()
  const hasWinsData = winsBreakdown.some((d) => d.value > 0)
  const hasHoursData = hoursPerMonth.length > 0
  const [monthModal, setMonthModal] = useState<MonthModalState | null>(null)
  const [winsBucket, setWinsBucket] = useState<WinPlayStatus | null>(null)

  const playableWins =
    summary.winCounts.finished + summary.winCounts.played + summary.winCounts.never_played
  const playRate =
    playableWins > 0
      ? Math.round(((summary.winCounts.finished + summary.winCounts.played) / playableWins) * 100)
      : null

  const winsSummaryParts = [
    summary.winCounts.finished > 0 && { count: summary.winCounts.finished, label: 'finished' },
    summary.winCounts.played > 0 && { count: summary.winCounts.played, label: 'played' },
    summary.winCounts.never_played > 0 && {
      count: summary.winCounts.never_played,
      label: 'never played',
    },
    summary.winCounts.unreleased > 0 && {
      count: summary.winCounts.unreleased,
      label: 'unreleased',
    },
  ].filter((part): part is { count: number; label: string } => Boolean(part))

  // Ordered month-label axes for the prev/next drill-down controls — every
  // month each chart's x-axis shows, including empty ones, so navigation
  // never skips or dead-ends on a month with no activity.
  const giftsMonths = giftsCumulative.map((r) => String(r.label))
  const cvMonths = cvCumulative.map((r) => String(r.label))
  const activityMonths = activityPerMonth.map((r) => String(r.label))
  const hoursMonths = hoursPerMonth.map((r) => String(r.label))

  const monthsForKind = (kind: MonthModalKind): string[] => {
    if (kind === 'gifts') return giftsMonths
    if (kind === 'cv') return cvMonths
    if (kind === 'hours') return hoursMonths
    return activityMonths
  }

  const handleGiftsClick = (state: { activeLabel?: string | number }) => {
    if (state?.activeLabel == null) return
    setMonthModal({ kind: 'gifts', label: String(state.activeLabel) })
  }

  const handleCvClick = (state: { activeLabel?: string | number }) => {
    if (state?.activeLabel == null) return
    setMonthModal({ kind: 'cv', label: String(state.activeLabel) })
  }

  const handleActivityClick = (state: { activeLabel?: string | number }) => {
    if (state?.activeLabel == null) return
    setMonthModal({ kind: 'activity', label: String(state.activeLabel) })
  }

  const handleHoursClick = (state: { activeLabel?: string | number }) => {
    if (state?.activeLabel == null) return
    setMonthModal({ kind: 'hours', label: String(state.activeLabel) })
  }

  const monthModalProps = (() => {
    if (!monthModal) return null
    const { label } = monthModal
    if (monthModal.kind === 'gifts') {
      return {
        title: label,
        emptyMessage: `No giveaways sent or won in ${label}.`,
        sections: [
          {
            heading: `Sent (${(sentByMonth.get(label) ?? []).length})`,
            rows: sentByMonth.get(label) ?? [],
            notCountedRows: notCountedByMonth.get(label) ?? [],
          },
          { heading: `Won (${(wonByMonth.get(label) ?? []).length})`, rows: wonByMonth.get(label) ?? [] },
        ],
      }
    }
    if (monthModal.kind === 'cv') {
      return {
        title: label,
        description: 'CV values shown per giveaway.',
        emptyMessage: `No CV sent or received in ${label}.`,
        sections: [
          { heading: `Sent (${(sentByMonth.get(label) ?? []).length})`, rows: sentByMonth.get(label) ?? [] },
          { heading: `Received (${(wonByMonth.get(label) ?? []).length})`, rows: wonByMonth.get(label) ?? [] },
        ],
      }
    }
    if (monthModal.kind === 'hours') {
      const rows = hoursByMonth[label] ?? []
      return {
        title: label,
        description: 'Sorted by hours gained, highest first.',
        emptyMessage: `No playtime gained in ${label}.`,
        sections: [{ heading: `Games (${rows.length})`, rows }],
      }
    }
    const enteredRows = enteredByMonth.get(label) ?? []
    const createdRows = sentByMonth.get(label) ?? []
    const wonRows = wonByMonth.get(label) ?? []
    const wonCount = enteredRows.filter((row) => row.won).length
    return {
      title: label,
      emptyMessage: `No activity in ${label}.`,
      sections: [
        {
          heading:
            wonCount > 0 ? `Entered (${enteredRows.length} · ${wonCount} won)` : `Entered (${enteredRows.length})`,
          rows: enteredRows,
        },
        { heading: `Created (${createdRows.length})`, rows: createdRows },
        { heading: `Won (${wonRows.length})`, rows: wonRows },
      ],
    }
  })()

  const winsModalRows = winsBucket ? winsByBucket[winsBucket] ?? [] : []

  const monthNav: DrilldownNav | undefined = monthModal
    ? (() => {
        const months = monthsForKind(monthModal.kind)
        const idx = months.indexOf(monthModal.label)
        return {
          onPrev: () => {
            if (idx > 0) setMonthModal({ kind: monthModal.kind, label: months[idx - 1] })
          },
          onNext: () => {
            if (idx >= 0 && idx < months.length - 1) {
              setMonthModal({ kind: monthModal.kind, label: months[idx + 1] })
            }
          },
          canPrev: idx > 0,
          canNext: idx >= 0 && idx < months.length - 1,
        }
      })()
    : undefined

  const bucketOrder = winsBreakdown.map((d) => d.bucket)
  const winsNav: DrilldownNav | undefined = winsBucket
    ? (() => {
        const idx = bucketOrder.indexOf(winsBucket)
        return {
          onPrev: () => {
            if (idx > 0) setWinsBucket(bucketOrder[idx - 1])
          },
          onNext: () => {
            if (idx >= 0 && idx < bucketOrder.length - 1) setWinsBucket(bucketOrder[idx + 1])
          },
          canPrev: idx > 0,
          canNext: idx >= 0 && idx < bucketOrder.length - 1,
        }
      })()
    : undefined

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <ChartCard
        title="Gifts sent & won"
        description="Cumulative giveaways created (sent) vs. won over time"
        summary={
          <>
            <ChartStat>{formatNumber(summary.giftsSent)}</ChartStat> sent ·{' '}
            <ChartStat>{formatNumber(summary.giftsWon)}</ChartStat> won{' '}
            <span className="text-muted-foreground">· click a month for details</span>
          </>
        }
        icon={TrendingUp}
      >
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={giftsCumulative}
              margin={{ left: 0, right: 8, top: 8 }}
              onClick={handleGiftsClick}
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
                cursor={{ stroke: 'var(--card-border-strong)' }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: 'var(--muted-foreground)' }} />
              <Line
                type="monotone"
                dataKey="sent_cumulative"
                name="Sent"
                stroke={chartColors.blue}
                strokeWidth={2}
                dot={{ r: 3, cursor: 'pointer' }}
                activeDot={{ r: 5, cursor: 'pointer' }}
              />
              <Line
                type="monotone"
                dataKey="won_cumulative"
                name="Won"
                stroke={chartColors.green}
                strokeWidth={2}
                dot={{ r: 3, cursor: 'pointer' }}
                activeDot={{ r: 5, cursor: 'pointer' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard
        title="Activity per month"
        description="Giveaways entered per month"
        summary={(() => {
          const last = activityPerMonth.at(-1)
          return (
            <>
              <ChartStat>{formatNumber(Number(last?.entered ?? 0))}</ChartStat> entered in{' '}
              {last?.label ?? 'the latest month'}{' '}
              <span className="text-muted-foreground">· click a month for details</span>
            </>
          )
        })()}
        icon={Heart}
      >
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={activityPerMonth}
              margin={{ left: 0, right: 8, top: 8 }}
              onClick={handleActivityClick}
              className="cursor-pointer"
            >
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis
                yAxisId="left"
                {...axisProps}
                width={44}
                allowDecimals={false}
                tickFormatter={(v: number) => formatCompactNumber(v)}
              />
              <Tooltip
                contentStyle={tooltipContentStyle}
                labelStyle={tooltipLabelStyle}
                itemStyle={tooltipItemStyle}
                cursor={{ fill: 'color-mix(in oklab, var(--accent-rose) 10%, transparent)' }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: 'var(--muted-foreground)' }} />
              <Bar
                yAxisId="left"
                dataKey="entered"
                name="Entered"
                fill={chartColors.rose}
                radius={[4, 4, 0, 0]}
                cursor="pointer"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard
        title="Hours played per month"
        description="Hours gained each month on this member's own won games, from periodic playtime snapshots — not affected by the CV filter above"
        summary={
          hasHoursData ? (
            (() => {
              const totalHours = hoursPerMonth.reduce((sum, r) => sum + Number(r.hours ?? 0), 0)
              const latest = hoursPerMonth.at(-1)
              return (
                <>
                  <ChartStat>{formatNumber(Math.round(totalHours))}</ChartStat> hours total across{' '}
                  <ChartStat>{hoursPerMonth.length}</ChartStat> months ·{' '}
                  <ChartStat>{formatNumber(Math.round(Number(latest?.hours ?? 0)))}</ChartStat> in{' '}
                  {latest?.label ?? 'the latest month'}{' '}
                  <span className="text-muted-foreground">· click a bar for details</span>
                </>
              )
            })()
          ) : undefined
        }
        icon={Clock}
      >
        <div className="h-72 w-full">
          {hasHoursData ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={hoursPerMonth}
                margin={{ left: 0, right: 8, top: 8 }}
                onClick={handleHoursClick}
                className="cursor-pointer"
              >
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis
                  {...axisProps}
                  width={44}
                  allowDecimals={false}
                  tickFormatter={(v: number) => `${formatCompactNumber(v)}h`}
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
                  name="Hours"
                  fill={chartColors.purple}
                  radius={[4, 4, 0, 0]}
                  cursor="pointer"
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No playtime data yet.
            </div>
          )}
        </div>
      </ChartCard>

      <ChartCard
        title="CV sent vs. received"
        description="Cumulative contribution value over time"
        summary={
          <>
            <ChartStat>{formatUsd(summary.cvSentTotal)}</ChartStat> sent ·{' '}
            <ChartStat>{formatUsd(summary.cvReceivedTotal)}</ChartStat> received{' '}
            <span className="text-muted-foreground">· click a month for details</span>
          </>
        }
        icon={Coins}
      >
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={cvCumulative}
              margin={{ left: 0, right: 8, top: 8 }}
              onClick={handleCvClick}
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
                cursor={{ stroke: 'var(--card-border-strong)' }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: 'var(--muted-foreground)' }} />
              <Line
                type="monotone"
                dataKey="sent_cumulative"
                name="Sent"
                stroke={chartColors.yellow}
                strokeWidth={2}
                dot={{ r: 3, cursor: 'pointer' }}
                activeDot={{ r: 5, cursor: 'pointer' }}
              />
              <Line
                type="monotone"
                dataKey="received_cumulative"
                name="Received"
                stroke={chartColors.purple}
                strokeWidth={2}
                dot={{ r: 3, cursor: 'pointer' }}
                activeDot={{ r: 5, cursor: 'pointer' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {isAdmin && (
      <ChartCard
        title="Wins breakdown"
        description="How won games have been played"
        summary={
          winsSummaryParts.length > 0 ? (
            <>
              {playRate != null && (
                <>
                  <ChartStat>{playRate}%</ChartStat> play rate ·{' '}
                </>
              )}
              {winsSummaryParts.map((part, i) => (
                <span key={part.label}>
                  {i > 0 && ' · '}
                  <ChartStat>{formatNumber(part.count)}</ChartStat> {part.label}
                </span>
              ))}{' '}
              <span className="text-muted-foreground">· click a slice for details</span>
            </>
          ) : undefined
        }
        icon={PieChartIcon}
      >
        <div className="h-72 w-full">
          {hasWinsData ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: 'var(--muted-foreground)' }} />
                <Pie
                  data={winsBreakdown}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="55%"
                  outerRadius="80%"
                  paddingAngle={2}
                  cursor="pointer"
                  onClick={(entry) => {
                    const bucket = (entry?.payload as WinsBreakdownDatum | undefined)?.bucket
                    if (bucket) setWinsBucket(bucket)
                  }}
                >
                  {winsBreakdown.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No wins yet.
            </div>
          )}
        </div>
      </ChartCard>
      )}

      {monthModalProps && (
        <StatsDrilldownModal
          open={monthModal != null}
          onOpenChange={(open) => !open && setMonthModal(null)}
          title={monthModalProps.title}
          description={monthModalProps.description}
          sections={monthModalProps.sections}
          nav={monthNav}
          emptyMessage={monthModalProps.emptyMessage}
        />
      )}

      {winsBucket && (
        <StatsDrilldownModal
          open={winsBucket != null}
          onOpenChange={(open) => !open && setWinsBucket(null)}
          title={`${winBucketLabels[winsBucket]} (${winsModalRows.length})`}
          sections={[
            {
              heading: winBucketLabels[winsBucket],
              rows: winsModalRows,
              hideNeverPlayedBadge: winsBucket === 'never_played',
              showWonRelativeTime: true,
            },
          ]}
          nav={winsNav}
        />
      )}
    </div>
  )
}
