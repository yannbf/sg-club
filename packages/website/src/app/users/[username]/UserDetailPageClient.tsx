'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import {
  Activity,
  AlertTriangle,
  Award,
  Coins,
  Copy,
  Gamepad2,
  Gift,
  Heart,
  Info,
  Scale,
  Trophy,
  Users as UsersIcon,
} from 'lucide-react'
import { formatPlaytime } from '@/lib/data'
import { createCreatorResolver } from '@/lib/creator-resolver'
import type { WinnerPlayStats } from '@/lib/winner-play-stats'
import { isConfirmedPlayed } from '@/lib/play-status'
import GivenGiveawaysClient from './GivenGiveawaysClient'
import WonGiveawaysClient from './WonGiveawaysClient'
import type { User, UserGroupData, UserEntry, SteamIdMap } from '@/types'
import type { Giveaway, GameData } from '@/types'
import FormattedDate from '@/components/FormattedDate'
import GiveawaysClient from '@/app/giveaways/client'
import CountryFlag from '@/components/CountryFlag'
import { LastUpdated } from '@/components/LastUpdated'
import GiveawayLeaversClient from './GiveawayLeaversClient'
import { GiveawayLeaver } from '@/types/stats'
import {
  getUnplayedGamesStats,
  UnplayedGamesStats,
} from '@/components/UnplayedGamesStats'
import Tooltip from '@/components/Tooltip'
import { getDeadlineData } from '@/components/DeadlineStatus'
import { isUnfulfilledRequiredPlay } from '../../../../api/_lib/required-play'
import { isCountedGiveaway, isValidRatioGiveaway } from '@/lib/events'
import { classifyPerson, personBadgeText } from '@/lib/person'
import {
  getUserRatio,
  buildValidFcvLinks,
  buildDeletedGaLinks,
  isCountedGa,
  lastValidFcvCreated,
} from '../util'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { DiscordBadge } from '@/components/DiscordBadge'
import { useIsAdmin } from '@/lib/auth'
import { cn } from '@/lib/cn'
import {
  UserStatsCharts,
  type WinsBreakdownDatum,
  type UserStatsSummary,
} from '@/components/charts/UserStatsCharts'
import type {
  DrilldownGameRow,
  DrilldownWinner,
} from '@/components/charts/StatsDrilldownModal'
import type { MonthDatum } from '@/components/charts/GroupStatsCharts'
import { chartColors } from '@/components/charts/chart-theme'
import {
  buildGameDataIndex,
  classifyWinPlayStatus,
  combineMonthlySeries,
  cvValueForLink,
  findGameData,
  monthKey,
  monthLabel,
  monthlyAggregate,
  withCumulative,
  type WinPlayStatus,
} from '@/lib/chart-data'
import { winnerPlayStatsKey } from '@/lib/winner-play-stats'

interface Props {
  user: User
  allUsers: UserGroupData | null
  giveaways: Giveaway[]
  gameData: GameData[]
  /** This user's entries only (scoped server-side — user_entries.json is large). */
  userEntries: UserEntry[string]
  lastUpdated: number | null
  leavers: GiveawayLeaver[]
  steamIdMap: SteamIdMap
  isExMember?: boolean
  /** steam_ids of ex-members — distinguishes "ex member" from "non-member" winners on shared/whitelist giveaways. */
  exMemberIds?: string[]
  /** Winner play stats for this user's own giveaways, keyed by winnerPlayStatsKey. */
  playStatsByWin?: Record<string, WinnerPlayStats>
  /** Hours gained per month on this user's own won games, computed server-side from playtime snapshot deltas. */
  hoursPerMonth: MonthDatum[]
  /** "Mon YY" label -> that month's games with playtime/achievement gains, highest hours first. */
  hoursByMonth: Record<string, DrilldownGameRow[]>
}

type UserWarning = {
  description: string
  severity: 'problem' | 'warning' | 'info'
}

type StatsCvFilter = 'all' | 'FULL_CV' | 'REDUCED_CV' | 'NO_CV' | 'RATIO_VALID'

/**
 * Whether the giveaway a stats-tab record (created/won/entry) points at
 * passes the Stats tab's global CV filter. Mirrors the CV filter on the
 * Created tab (GivenGiveawaysClient): 'RATIO_VALID' requires both
 * isValidRatioGiveaway and isCountedGiveaway, 'all' keeps everything but
 * deleted giveaways, and a specific CV status matches cv_status (also
 * excluding deleted). A link with no resolved giveaway only passes 'all'.
 */
function matchesStatsCvFilter(
  giveaway: Giveaway | undefined,
  filter: StatsCvFilter,
): boolean {
  if (filter === 'all') return !giveaway?.deleted
  if (!giveaway || giveaway.deleted) return false
  if (filter === 'RATIO_VALID') {
    return isValidRatioGiveaway(giveaway) && isCountedGiveaway(giveaway)
  }
  return giveaway.cv_status === filter
}

const getLink = (link: string) => {
  return `https://www.steamgifts.com/giveaway/${link}`
}

export const generateWarningMessage = (
  user: User,
  enteredGiveawayData: UserEntry[string],
  giveaways: Giveaway[],
) => {
  if (!user.warnings || user.warnings.length === 0) return ''

  const messages = [`Hi ${user.username}, this is a notice from The Giveaways Club.`]
  const enteredGiveawaysWithData = enteredGiveawayData
    .map((g) => giveaways.find((ga) => ga.link === g.link))
    .filter((g): g is Giveaway => g !== undefined)

  if (user.warnings.includes('unplayed_required_play_giveaways')) {
    messages.push(
      'Please keep track of your PLAY REQUIRED giveaways. As per the rules, you are not allowed to enter any more PLAY REQUIRED giveaways if you have 2 unfulfilled PLAY REQUIRED wins:',
    )
    const unplayedRequired =
      user.giveaways_won?.filter(isUnfulfilledRequiredPlay) || []

    unplayedRequired.sort((a, b) => a.end_timestamp - b.end_timestamp)

    const unplayedText = unplayedRequired
      .map((g) => {
        const { daysRemaining, deadlineDate } = getDeadlineData(
          g.end_timestamp,
          g.required_play_meta?.deadline_in_months,
          g.required_play_meta?.deadline,
        )
        const formatter = new Intl.DateTimeFormat('en-US', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
        const formattedDate = formatter.format(deadlineDate)
        return `${getLink(g.link)} (${daysRemaining} days remaining for requirements: ${formattedDate})`
      })
      .join('\n')

    messages.push(unplayedText)
    messages.push(
      'Please note the individual requirements for each giveaway won. If none are specified, then by default, we expect the game to be added into active rotation prior to the deadline.',
    )

    if (
      !user.warnings.includes('illegal_entered_required_play_giveaways') &&
      !user.warnings.includes('illegal_entered_any_giveaways')
    ) {
      messages.push(
        'Please fulfill the giveaway requirements prior to joining any additional PLAY REQUIRED giveaways.',
      )
    }
  }

  if (user.warnings.includes('illegal_entered_required_play_giveaways')) {
    const giveawaysToLeave = enteredGiveawaysWithData.filter(
      (g) => g.required_play && g.end_timestamp > Date.now() / 1000,
    )
    const toLeaveText = giveawaysToLeave.map((g) => getLink(g.link)).join('\n')
    messages.push(`Please leave the following giveaways:
${toLeaveText}`)
  } else if (user.warnings.includes('illegal_entered_any_giveaways')) {
    const giveawaysToLeave = enteredGiveawaysWithData.filter(
      (g) => g.end_timestamp > Date.now() / 1000,
    )
    const toLeaveText = giveawaysToLeave.map((g) => getLink(g.link)).join('\n')
    messages.push(
      'As it seems that you have more than 2 unfulfilled PLAY REQUIRED wins, you are currently not allowed to enter **any** additional giveaways within the group. Once you are back down to 2 unfulfilled PLAY REQUIRED giveaways, you are allowed to join normal giveaways again but are still barred from joining PLAY REQUIRED until you only have 1 unfulfilled play required giveaway.',
    )
    messages.push(`Please leave the following giveaways:\n${toLeaveText}`)
  }

  if (user.warnings.includes('required_play_deadline_expired')) {
    const expiredRequired = (user.giveaways_won || []).filter((g) => {
      if (!isUnfulfilledRequiredPlay(g)) return false
      const { daysRemaining } = getDeadlineData(
        g.end_timestamp,
        g.required_play_meta?.deadline_in_months,
        g.required_play_meta?.deadline,
      )
      return daysRemaining < 0
    })

    expiredRequired.sort((a, b) => a.end_timestamp - b.end_timestamp)

    const formatter = new Intl.DateTimeFormat('en-US', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    const expiredText = expiredRequired
      .map((g) => {
        const { daysRemaining, deadlineDate } = getDeadlineData(
          g.end_timestamp,
          g.required_play_meta?.deadline_in_months,
          g.required_play_meta?.deadline,
        )
        return `${getLink(g.link)} (deadline passed ${Math.abs(daysRemaining)} day(s) ago: ${formatter.format(deadlineDate)})`
      })
      .join('\n')

    messages.push(
      'The deadline for the following PLAY REQUIRED win(s) has already passed. Please fulfill the requirements as soon as possible:',
    )
    messages.push(expiredText)
  }

  const unplayedGamesStats = getUnplayedGamesStats(user)
  const hasLowPlayRate = unplayedGamesStats.percentage < 33

  if (hasLowPlayRate) {
    messages.push(
      `Also do note that you have relatively low play rate within this group (${unplayedGamesStats.percentage}% - ${unplayedGamesStats.played} out of ${unplayedGamesStats.total} wins). While we don't require a 1:1 in this group, we are more stringent on ratios for lower play rate members.`,
    )
  }

  return messages.join('\n\n')
}

function CopyButton({ onClick }: { onClick: () => void }) {
  const [isCopied, setIsCopied] = useState(false)
  const handleClick = async () => {
    await onClick()
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }
  return (
    <Button variant="outline" size="sm" onClick={handleClick}>
      <Copy className="h-3.5 w-3.5" />
      {isCopied ? 'Copied!' : 'Copy chase-up message'}
    </Button>
  )
}

export const getWarningsSeverity = (
  warnings: string[],
): 'problem' | 'warning' | 'info' => {
  let hasWarning = false
  for (const warning of warnings) {
    const warningSeverity = warningToMessageMap[warning]?.severity
    if (warningSeverity === 'problem') {
      return 'problem'
    }
    if (warningSeverity === 'warning') {
      hasWarning = true
    }
  }
  if (hasWarning) {
    return 'warning'
  }
  return 'info'
}

const warningToMessageMap: Record<string, UserWarning> = {
  unplayed_required_play_giveaways: {
    description: 'Has not played two or more required play giveaways',
    severity: 'warning',
  },
  required_play_deadline_within_15_days: {
    description: 'Has required play games with less than 15 days remaining',
    severity: 'warning',
  },
  required_play_deadline_expired: {
    description: 'Has required play games whose deadline has passed',
    severity: 'problem',
  },
  zero_play_rate_with_wins: {
    description: 'Has a 0% play rate despite having more than 2 wins',
    severity: 'problem',
  },
  low_play_rate_many_wins: {
    description: 'Has an under 10% play rate with more than 7 wins',
    severity: 'problem',
  },
  inactive_play_but_active: {
    description:
      'Has not played any game in over 4 months but is still joining or winning giveaways',
    severity: 'warning',
  },
  no_giveaway_created_in_6_months: {
    description: 'Has not created a giveaway in over 6 months',
    severity: 'warning',
  },
  required_plays_need_review: {
    description: 'Has required play games which were played and need review',
    severity: 'info',
  },
  illegal_entered_required_play_giveaways: {
    description:
      'Has entered required play giveaways while not having played 2 required play giveaways',
    severity: 'problem',
  },
  illegal_entered_any_giveaways: {
    description:
      'Has entered any giveaways while not having played 3 or more required play giveaways',
    severity: 'problem',
  },
}

function ratioInfo(user: User) {
  const ratio = getUserRatio(user.stats.giveaway_ratio)
  switch (ratio) {
    case 'contributor':
      return {
        label: 'Net contributor',
        variant: 'success' as const,
        accent: 'before:bg-[var(--success)]',
      }
    case 'receiver':
      return {
        label: 'Net receiver',
        variant: 'error' as const,
        accent: 'before:bg-[var(--error)]',
      }
    default:
      return {
        label: 'Neutral',
        variant: 'info' as const,
        accent: 'before:bg-[var(--card-border-strong)]',
      }
  }
}

export default function UserDetailPageClient({
  user,
  allUsers,
  giveaways,
  gameData,
  userEntries,
  lastUpdated,
  leavers,
  steamIdMap,
  isExMember,
  exMemberIds,
  playStatsByWin,
  hoursPerMonth,
  hoursByMonth,
}: Props) {
  const isAdmin = useIsAdmin()
  const [showOriginalStats, setShowOriginalStats] = useState(false)
  const [statsFilterCV, setStatsFilterCV] = useState<StatsCvFilter>('RATIO_VALID')

  // Deep links (e.g. the Discord bot's mod report / weekly digest) can
  // preselect a tab and pre-enable a filter via query params:
  //   /users/<name>/?tab=won&filter=play-required  (Won, "Play required" on)
  //   /users/<name>/?tab=entered&filter=open       (Entered, open GAs only)
  // The site is a static export, so the query string is only readable
  // client-side; reading it in an effect keeps hydration consistent. Both
  // states flip in the same commit, so the tab content mounts with the
  // filter prop already set.
  const [activeTab, setActiveTab] = useState('created')
  const [deepLinkPlayRequired, setDeepLinkPlayRequired] = useState(false)
  const [deepLinkEnteredOpen, setDeepLinkEnteredOpen] = useState(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tab = params.get('tab')
    if (tab && ['created', 'won', 'entered', 'stats', 'leavers'].includes(tab)) {
      setActiveTab(tab)
    }
    if (params.get('filter') === 'play-required') {
      setDeepLinkPlayRequired(true)
    }
    if (params.get('filter') === 'open') {
      setDeepLinkEnteredOpen(true)
    }
  }, [])

  // Keep the selected tab shareable: reflect it into ?tab= without adding
  // history entries. The default tab keeps a clean URL.
  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    const params = new URLSearchParams(window.location.search)
    if (tab === 'created') {
      params.delete('tab')
    } else {
      params.set('tab', tab)
    }
    const query = params.toString()
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
    )
  }

  // Resolve creator fields through steam_id_map: handles renamed users
  // (creator stored under an old username) and deleted SG accounts (creator
  // stored as a raw username string because it never resolved to a steam_id).
  const creatorResolver = createCreatorResolver(steamIdMap)
  const userGiveaways = giveaways.filter(
    (g) => creatorResolver.canonicalSteamId(g.creator) === user.steam_id,
  )
  const enteredGiveawayData = userEntries
  const enteredGiveaways = enteredGiveawayData
    .map((g) => giveaways.find((ga) => ga.link === g.link))
    .filter((g) => g !== undefined)
  const lastEnteredGiveaway = enteredGiveawayData.sort(
    (a, b) => b.joined_at - a.joined_at,
  )[0]

  const userAvatars = useMemo(
    () =>
      new Map(
        Object.values(allUsers?.users || {}).map((u) => [
          u.steam_id,
          u.avatar_url,
        ]),
      ),
    [allUsers],
  )
  const userNames = useMemo(
    () =>
      new Map(
        Object.entries(steamIdMap).map(([steamId, entry]) => [
          steamId,
          entry.current,
        ]),
      ),
    [steamIdMap],
  )
  const exMemberSet = useMemo(
    () => new Set(exMemberIds ?? []),
    [exMemberIds],
  )

  const ratio = ratioInfo(user)

  // Deleted and ended-with-no-entries giveaways stay visible in the tabs for
  // inspection, but every count/stat on this page must ignore them.
  const deletedGaLinks = useMemo(
    () => buildDeletedGaLinks(giveaways),
    [giveaways],
  )
  const nowSec = Date.now() / 1000
  const countedWon = (user.giveaways_won || []).filter((g) =>
    isCountedGa(g, deletedGaLinks),
  )
  const countedCreated = (user.giveaways_created || []).filter(
    (g) =>
      isCountedGa(g, deletedGaLinks) &&
      !(g.end_timestamp < nowSec && (g.entries ?? 0) === 0),
  )

  const giveawayByLink = useMemo(
    () => new Map(giveaways.map((g) => [g.link, g])),
    [giveaways],
  )
  const gameDataIndex = useMemo(() => buildGameDataIndex(gameData), [gameData])

  const statsCharts = useMemo(() => {
    const filteredCreated = countedCreated.filter((g) =>
      matchesStatsCvFilter(giveawayByLink.get(g.link), statsFilterCV),
    )
    const filteredWon = countedWon.filter((g) =>
      matchesStatsCvFilter(giveawayByLink.get(g.link), statsFilterCV),
    )
    const filteredEntries = userEntries.filter((e) =>
      matchesStatsCvFilter(giveawayByLink.get(e.link), statsFilterCV),
    )

    const sentMap = monthlyAggregate(filteredCreated, (g) => g.created_timestamp)
    const wonMap = monthlyAggregate(filteredWon, (g) => g.end_timestamp)
    const giftsCumulative: MonthDatum[] = withCumulative(
      combineMonthlySeries({ sent: sentMap, won: wonMap }),
      ['sent', 'won'],
    )

    const enteredMap = monthlyAggregate(filteredEntries, (e) => e.joined_at)
    const enteredPerMonth: MonthDatum[] = combineMonthlySeries({
      count: enteredMap,
    })
    // "Activity per month" combines entered (bars) with created/won (lines) —
    // entered/created reuse the same monthly maps as the gifts/entered charts
    // above so the three series stay consistent with each other.
    const activityPerMonth: MonthDatum[] = combineMonthlySeries({
      entered: enteredMap,
      created: sentMap,
      won: wonMap,
    })

    const cvSentMap = monthlyAggregate(
      filteredCreated,
      (g) => g.created_timestamp,
      (g) =>
        cvValueForLink(g.link, g.cv_status, g.copies, giveawayByLink, gameDataIndex),
    )
    const cvReceivedMap = monthlyAggregate(
      filteredWon,
      (g) => g.end_timestamp,
      (g) => cvValueForLink(g.link, g.cv_status, 1, giveawayByLink, gameDataIndex),
    )
    const cvCumulative: MonthDatum[] = withCumulative(
      combineMonthlySeries({ sent: cvSentMap, received: cvReceivedMap }),
      ['sent', 'received'],
    )

    const winStatusCounts: UserStatsSummary['winCounts'] = {
      finished: 0,
      played: 0,
      never_played: 0,
      unreleased: 0,
    }
    for (const win of filteredWon) {
      winStatusCounts[classifyWinPlayStatus(win)]++
    }
    const winsBreakdown: WinsBreakdownDatum[] = [
      { name: 'Finished', value: winStatusCounts.finished, color: chartColors.green, bucket: 'finished' as const },
      { name: 'Played', value: winStatusCounts.played, color: chartColors.blue, bucket: 'played' as const },
      { name: 'Never played', value: winStatusCounts.never_played, color: chartColors.red, bucket: 'never_played' as const },
      { name: 'Unreleased', value: winStatusCounts.unreleased, color: chartColors.orange, bucket: 'unreleased' as const },
    ].filter((d) => d.value > 0)

    // Per-month/per-bucket record lists for the charts' click-to-drill-down
    // modals — keyed by the same "Mon YY" label the x-axis renders, so a
    // click's activeLabel is usable as a map key without a lookup step.
    const monthLabelOf = (ts: number) => monthLabel(monthKey(ts))
    const pushRow = (map: Map<string, DrilldownGameRow[]>, key: string, row: DrilldownGameRow) => {
      const arr = map.get(key)
      if (arr) arr.push(row)
      else map.set(key, [row])
    }
    const fallbackUrlFor = (ga: Giveaway | undefined) =>
      findGameData(ga?.app_id, ga?.package_id, gameDataIndex)?.header_image_url

    // Winners of a created giveaway, resolved the same way the Created tab
    // resolves them (steam_id -> display name/avatar, ex-member/non-member
    // fallback), for the stats modal's sent-giveaway rows.
    const buildWinners = (ga: Giveaway | undefined): DrilldownWinner[] | undefined => {
      if (!ga) return undefined
      const winners = ga.winners?.filter((w) => w.name)
      if (!winners || winners.length === 0) return undefined
      const isSharedOrWhitelist = Boolean(ga.is_shared || ga.whitelist)
      return winners.map((w): DrilldownWinner => {
        const kind = classifyPerson({
          isCurrentMember: userAvatars.has(w.name),
          isExMember: exMemberSet.has(w.name),
          isSharedOrWhitelist,
        })
        return {
          steamId: w.name,
          displayName: userNames.get(w.name) || w.winner_username || w.name,
          avatarUrl: userAvatars.get(w.name),
          badgeText: personBadgeText(kind),
          playStats: playStatsByWin?.[winnerPlayStatsKey(w.name, ga.link)],
        }
      })
    }

    const sentByMonth = new Map<string, DrilldownGameRow[]>()
    for (const g of filteredCreated) {
      const ga = giveawayByLink.get(g.link)
      pushRow(sentByMonth, monthLabelOf(g.created_timestamp), {
        link: g.link,
        name: g.name,
        timestamp: g.created_timestamp,
        appId: ga?.app_id,
        packageId: ga?.package_id,
        giveaway: ga,
        fallbackUrl: fallbackUrlFor(ga),
        cvValue: cvValueForLink(g.link, g.cv_status, g.copies, giveawayByLink, gameDataIndex),
        winners: buildWinners(ga),
        isOpen: (ga?.end_timestamp ?? g.end_timestamp) > nowSec,
      })
    }

    // Created giveaways this user has that don't count toward any stat
    // (deleted, or ended with zero entries) — surfaced as a muted subsection
    // under "Sent" in the gifts sent & won modal only, never mixed into
    // sentByMonth so they can't affect the chart series or section counts.
    const notCountedByMonth = new Map<string, DrilldownGameRow[]>()
    const matchesNotCountedCvFilter = (
      cvStatus: string | undefined,
      filter: StatsCvFilter,
    ) => filter === 'all' || filter === 'RATIO_VALID' || cvStatus === filter
    for (const g of user.giveaways_created ?? []) {
      const ga = giveawayByLink.get(g.link)
      const deleted = ga?.deleted ?? g.deleted ?? false
      const endTs = ga?.end_timestamp ?? g.end_timestamp
      const entryCount = ga?.entry_count ?? g.entries
      const noEntries = !deleted && endTs < nowSec && (entryCount ?? 0) === 0
      if (!deleted && !noEntries) continue
      if (!matchesNotCountedCvFilter(ga?.cv_status ?? g.cv_status, statsFilterCV)) continue
      pushRow(notCountedByMonth, monthLabelOf(g.created_timestamp), {
        link: g.link,
        name: g.name,
        timestamp: g.created_timestamp,
        appId: ga?.app_id,
        packageId: ga?.package_id,
        giveaway: ga,
        fallbackUrl: fallbackUrlFor(ga),
        notCounted: {
          reason: deleted ? 'deleted' : 'no_entries',
          deletedReason: ga?.deleted_reason ?? g.deleted_reason,
        },
      })
    }

    const wonByMonth = new Map<string, DrilldownGameRow[]>()
    const winsByBucket: Record<WinPlayStatus, DrilldownGameRow[]> = {
      finished: [],
      played: [],
      never_played: [],
      unreleased: [],
    }
    for (const g of filteredWon) {
      const ga = giveawayByLink.get(g.link)
      const status = classifyWinPlayStatus(g)
      const row: DrilldownGameRow = {
        link: g.link,
        name: g.name,
        timestamp: g.end_timestamp,
        appId: ga?.app_id,
        packageId: ga?.package_id,
        giveaway: ga,
        fallbackUrl: fallbackUrlFor(ga),
        cvValue: cvValueForLink(g.link, g.cv_status, 1, giveawayByLink, gameDataIndex),
        playtimeMinutes: g.steam_play_data?.playtime_minutes,
        achievementsUnlocked: g.steam_play_data?.achievements_unlocked,
        achievementsTotal: g.steam_play_data?.achievements_total,
        neverPlayed: status === 'never_played',
        confirmedPlayed: isConfirmedPlayed(g),
        unreleased: status === 'unreleased',
      }
      pushRow(wonByMonth, monthLabelOf(g.end_timestamp), row)
      winsByBucket[status].push(row)
    }

    // Links of giveaways this user actually won — used to flag "Won" entries
    // in the Entered modal.
    const wonLinks = new Set((user.giveaways_won ?? []).map((g) => g.link))

    const enteredByMonth = new Map<string, DrilldownGameRow[]>()
    for (const e of filteredEntries) {
      const ga = giveawayByLink.get(e.link)
      pushRow(enteredByMonth, monthLabelOf(e.joined_at), {
        link: e.link,
        name: ga?.name ?? e.link,
        timestamp: e.joined_at,
        appId: ga?.app_id,
        packageId: ga?.package_id,
        giveaway: ga,
        fallbackUrl: fallbackUrlFor(ga),
        won: wonLinks.has(e.link),
      })
    }

    const byDateDesc = (a: DrilldownGameRow, b: DrilldownGameRow) => b.timestamp - a.timestamp
    // Entered rows show the ones the user actually won first, then by date
    // within each group — winners are the more interesting half of the list.
    const byWonThenDateDesc = (a: DrilldownGameRow, b: DrilldownGameRow) =>
      Number(b.won ?? false) - Number(a.won ?? false) || byDateDesc(a, b)
    for (const arr of sentByMonth.values()) arr.sort(byDateDesc)
    for (const arr of wonByMonth.values()) arr.sort(byDateDesc)
    for (const arr of enteredByMonth.values()) arr.sort(byWonThenDateDesc)
    for (const arr of notCountedByMonth.values()) arr.sort(byDateDesc)
    for (const arr of Object.values(winsByBucket)) arr.sort(byDateDesc)

    const lastGifts = giftsCumulative.at(-1)
    const lastEntered = enteredPerMonth.at(-1)
    const lastCv = cvCumulative.at(-1)
    const summary: UserStatsSummary = {
      giftsSent: Number(lastGifts?.sent_cumulative ?? 0),
      giftsWon: Number(lastGifts?.won_cumulative ?? 0),
      enteredTotal: filteredEntries.length,
      enteredLatest: Number(lastEntered?.count ?? 0),
      enteredLatestLabel: lastEntered?.label,
      cvSentTotal: Number(lastCv?.sent_cumulative ?? 0),
      cvReceivedTotal: Number(lastCv?.received_cumulative ?? 0),
      winCounts: winStatusCounts,
    }

    return {
      giftsCumulative,
      enteredPerMonth,
      activityPerMonth,
      cvCumulative,
      winsBreakdown,
      summary,
      sentByMonth,
      wonByMonth,
      enteredByMonth,
      notCountedByMonth,
      winsByBucket,
    }
  }, [
    countedCreated,
    countedWon,
    userEntries,
    giveawayByLink,
    gameDataIndex,
    statsFilterCV,
    userAvatars,
    userNames,
    exMemberSet,
    playStatsByWin,
    user.giveaways_created,
    user.giveaways_won,
    nowSec,
  ])

  const getTotalPlaytime = () =>
    countedWon.reduce(
      (total, game) => total + (game.steam_play_data?.playtime_minutes || 0),
      0,
    )
  const getTotalAchievements = () =>
    countedWon.reduce(
      (total, game) => total + (game.steam_play_data?.achievements_unlocked || 0),
      0,
    )
  const getOwnedGames = () => countedWon.length

  const realCvRatio =
    user.stats.real_total_received_value === 0
      ? 0
      : Number(
          (
            user.stats.real_total_sent_value /
            user.stats.real_total_received_value
          ).toFixed(2),
        )

  const createdGiveaways = countedCreated.length
  const ongoingGiveaways = countedCreated.filter(
    (ga) => ga.end_timestamp > Date.now() / 1000,
  ).length

  const handleCopyWarningMessage = async () => {
    const message = generateWarningMessage(user, userEntries, giveaways)
    if (message) {
      try {
        await navigator.clipboard.writeText(message)
      } catch (err) {
        alert(`Failed to copy message: ${String(err)}`)
      }
    }
  }

  // Some users have a numeric steam_id but no stored profile URL, so derive it.
  const steamProfileUrl =
    user.steam_profile_url ??
    (/^\d+$/.test(user.steam_id)
      ? `https://steamcommunity.com/profiles/${user.steam_id}`
      : null)

  const previousNames = (() => {
    const prev = steamIdMap[user.steam_id]?.previous
    if (!prev?.length) return [] as string[]
    return [...new Set(prev.map((p) => p.username))].filter(
      (name) => name !== user.username,
    )
  })()

  const lastEnteredGameName = lastEnteredGiveaway
    ? giveaways.find((g) => g.link === lastEnteredGiveaway.link)?.name
    : undefined

  const validFcvLinks = useMemo(
    () => buildValidFcvLinks(giveaways),
    [giveaways],
  )
  const lastCreatedGiveaway =
    lastValidFcvCreated(user, validFcvLinks) ?? undefined
  const lastWonGiveaway = countedWon.length
    ? [...countedWon].sort((a, b) => b.end_timestamp - a.end_timestamp)[0]
    : undefined

  return (
    <div className="space-y-6">
      {lastUpdated && (
        <div className="text-sm text-muted-foreground">
          <LastUpdated lastUpdatedDate={lastUpdated} />
        </div>
      )}

      {/* User header */}
      <Card
        className={cn(
          'relative overflow-hidden p-6',
          'before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:z-10',
          isAdmin
            ? ratio.accent
            : 'before:bg-[var(--card-border-strong)]',
        )}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="flex-shrink-0">
            {user.avatar_url ? (
              <a
                href={`https://www.steamgifts.com/user/${user.username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                <Image
                  src={user.avatar_url}
                  alt={user.username}
                  width={80}
                  height={80}
                  className="h-20 w-20 rounded-full ring-2 ring-card-border-strong"
                />
              </a>
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-card-background-hover ring-2 ring-card-border-strong text-2xl font-bold text-muted-foreground">
                {user.username[0]?.toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`https://www.steamgifts.com/user/${user.username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-display text-3xl font-bold tracking-tight text-foreground hover:text-accent hover:underline"
              >
                {user.username}
              </a>
              <CountryFlag countryCode={user.country_code} />
              <DiscordBadge
                member={user.discord_member}
                handle={user.discord_handle}
                size="md"
              />
              {isExMember && isAdmin && (
                <Badge variant="error" size="md">
                  Ex member
                </Badge>
              )}
              {user.is_deleted_sg_account && (
                <Badge
                  variant="error"
                  size="md"
                  title="This SteamGifts account no longer exists. The stats shown are reconstructed from their historical giveaways recorded in the group."
                >
                  Account deleted
                </Badge>
              )}
              {isAdmin && (
                <Badge variant={ratio.variant} size="md">
                  {ratio.label}
                </Badge>
              )}
              <Badge variant="outline" size="md">
                <Scale className="h-3 w-3" />
                <span className="tabular-nums-strict">
                  {(user.stats.giveaway_ratio ?? 0).toFixed(2)}
                </span>{' '}
                ratio
              </Badge>
              {isAdmin && user.warnings && user.warnings.length > 0 && (
                <Badge
                  variant={
                    getWarningsSeverity(user.warnings) === 'problem'
                      ? 'error'
                      : 'warning'
                  }
                  size="md"
                >
                  <AlertTriangle className="h-3 w-3" />
                  Needs attention
                </Badge>
              )}
            </div>
            {previousNames.length > 0 && (
              <p className="mt-2 text-sm text-muted-foreground">
                Previously known as:{' '}
                <span className="text-foreground">
                  {previousNames.join(', ')}
                </span>
              </p>
            )}
            {steamProfileUrl && (
              <a
                href={steamProfileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-sm text-accent hover:underline"
              >
                <Gamepad2 className="h-3.5 w-3.5" /> View Steam profile
              </a>
            )}
            <dl className="mt-4 space-y-1 text-sm">
              {user.contributor_level != null && (
                <div className="flex items-baseline gap-2">
                  <dt className="text-muted-foreground">SG level</dt>
                  <dd className="text-foreground font-medium tabular-nums-strict">
                    {user.contributor_level.toFixed(2)}
                  </dd>
                </div>
              )}
              {user.registered_at && (
                <div className="flex items-baseline gap-2">
                  <dt className="text-muted-foreground">Registered on SG</dt>
                  <dd className="text-foreground">
                    <FormattedDate timestamp={user.registered_at} />
                  </dd>
                </div>
              )}
              {user.stats.first_seen_at && (
                <div className="flex items-baseline gap-2">
                  <dt
                    className="text-muted-foreground"
                    title="Earliest evidence of group activity (oldest GA created/won/entered)"
                  >
                    Member since
                  </dt>
                  <dd className="text-foreground">
                    <FormattedDate timestamp={user.stats.first_seen_at} />
                  </dd>
                </div>
              )}
              {lastCreatedGiveaway && (
                <div className="flex items-baseline gap-2 min-w-0">
                  <dt className="text-muted-foreground shrink-0">Last FCV GA created</dt>
                  <dd
                    className="text-foreground truncate min-w-0"
                    title={lastCreatedGiveaway.name}
                  >
                    <a
                      href={getLink(lastCreatedGiveaway.link)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold hover:text-accent hover:underline"
                    >
                      {lastCreatedGiveaway.name}
                    </a>{' '}
                    <span className="text-muted-foreground">
                      <FormattedDate
                        timestamp={lastCreatedGiveaway.created_timestamp}
                      />
                    </span>
                  </dd>
                </div>
              )}
              {lastWonGiveaway && (
                <div className="flex items-baseline gap-2 min-w-0">
                  <dt className="text-muted-foreground shrink-0">Last GA won</dt>
                  <dd
                    className="text-foreground truncate min-w-0"
                    title={lastWonGiveaway.name}
                  >
                    <a
                      href={getLink(lastWonGiveaway.link)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold hover:text-accent hover:underline"
                    >
                      {lastWonGiveaway.name}
                    </a>{' '}
                    <span className="text-muted-foreground">
                      <FormattedDate timestamp={lastWonGiveaway.end_timestamp} />
                    </span>
                  </dd>
                </div>
              )}
              {lastEnteredGiveaway && (
                <div className="flex items-baseline gap-2 min-w-0">
                  <dt className="text-muted-foreground shrink-0">Last GA entered</dt>
                  <dd
                    className="text-foreground truncate min-w-0"
                    title={lastEnteredGameName}
                  >
                    <a
                      href={getLink(lastEnteredGiveaway.link)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold hover:text-accent hover:underline"
                    >
                      {lastEnteredGameName}
                    </a>{' '}
                    <span className="text-muted-foreground">
                      <FormattedDate timestamp={lastEnteredGiveaway.joined_at} />
                    </span>
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </Card>

      {/* Warnings */}
      {isAdmin && user.warnings && user.warnings.length > 0 && (
        <Card
          className={cn(
            'border-l-4',
            getWarningsSeverity(user.warnings) === 'problem'
              ? 'border-l-[var(--error)]'
              : 'border-l-[var(--warning)]',
          )}
        >
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle
                  className={cn(
                    'h-4 w-4',
                    getWarningsSeverity(user.warnings) === 'problem'
                      ? 'text-error-foreground'
                      : 'text-warning-foreground',
                  )}
                />
                Needs attention
              </CardTitle>
              {getWarningsSeverity(user.warnings) !== 'info' && (
                <CopyButton onClick={handleCopyWarningMessage} />
              )}
            </div>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
              {user.warnings.map((warning) => (
                <li key={warning}>
                  {warningToMessageMap[warning]?.description ?? warning}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Real Totals */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SimpleStat
          label="Sent"
          value={user.stats.real_total_sent_count}
          hint={`$${user.stats.real_total_sent_value.toFixed(2)}`}
          icon={Gift}
          accent="text-info-foreground"
        />
        <SimpleStat
          label="Received"
          value={user.stats.real_total_received_count}
          hint={`$${user.stats.real_total_received_value.toFixed(2)}`}
          icon={Trophy}
          accent="text-success-foreground"
        />
        <SimpleStat
          label="Difference"
          value={
            <span
              className={
                user.stats.real_total_gift_difference > 0
                  ? 'text-success-foreground'
                  : user.stats.real_total_gift_difference < 0
                    ? 'text-error-foreground'
                    : 'text-muted-foreground'
              }
            >
              {user.stats.real_total_gift_difference > 0 ? '+' : ''}
              {user.stats.real_total_gift_difference}
            </span>
          }
          hint={`${user.stats.real_total_value_difference > 0 ? '+' : ''}$${user.stats.real_total_value_difference.toFixed(2)}`}
          icon={Coins}
        />
        <SimpleStat
          label="CV ratio"
          value={
            <Tooltip
              content={`Sent / Received ($${user.stats.real_total_sent_value} / $${user.stats.real_total_received_value}) = ${realCvRatio}`}
            >
              <span className="cursor-help">{realCvRatio}</span>
            </Tooltip>
          }
          icon={Scale}
        />
      </div>

      {/* Original stats toggle */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="h-4 w-4 text-muted-foreground" />
              Original SteamGifts stats
              <span className="text-xs font-normal text-muted-foreground">
                (incl. reduced, shared, etc.)
              </span>
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowOriginalStats((v) => !v)}
            >
              {showOriginalStats ? 'Hide' : 'Show breakdown'}
            </Button>
          </div>
        </CardHeader>
        {showOriginalStats && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <SimpleStat
                label="Created GAs"
                value={createdGiveaways}
                hint={`${ongoingGiveaways} ongoing`}
                icon={Gift}
                accent="text-accent-blue"
              />
              <SimpleStat
                label="Sent"
                value={user.stats.total_sent_count}
                hint={`$${user.stats.total_sent_value.toFixed(2)}`}
                icon={Gift}
                accent="text-info-foreground"
              />
              <SimpleStat
                label="Received"
                value={user.stats.total_received_count}
                hint={`$${user.stats.total_received_value.toFixed(2)}`}
                icon={Trophy}
                accent="text-success-foreground"
              />
              <SimpleStat
                label="Difference"
                value={
                  <span
                    className={
                      user.stats.total_gift_difference > 0
                        ? 'text-success-foreground'
                        : user.stats.total_gift_difference < 0
                          ? 'text-error-foreground'
                          : 'text-muted-foreground'
                    }
                  >
                    {user.stats.total_gift_difference > 0 ? '+' : ''}
                    {user.stats.total_gift_difference}
                  </span>
                }
                hint={`${user.stats.total_value_difference > 0 ? '+' : ''}$${user.stats.total_value_difference.toFixed(2)}`}
                icon={Coins}
              />
            </div>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <CvBreakdown
                label="Full CV"
                accent="text-accent-green"
                sent={user.stats.fcv_sent_count}
                received={user.stats.fcv_received_count}
              />
              <CvBreakdown
                label="Reduced CV"
                accent="text-accent-yellow"
                sent={user.stats.rcv_sent_count}
                received={user.stats.rcv_received_count}
              />
              <CvBreakdown
                label="No CV"
                accent="text-accent-orange"
                sent={user.stats.ncv_sent_count}
                received={user.stats.ncv_received_count}
              />
              <CvBreakdown
                label="Shared"
                accent="text-accent-purple"
                sent={user.stats.shared_sent_count}
                received={user.stats.shared_received_count}
                sentLabel="Created"
                receivedLabel="Won"
              />
            </div>
          </CardContent>
        )}
      </Card>

      {/* Steam activity */}
      {user.steam_id &&
        !user.steam_profile_is_private &&
        user.giveaways_won &&
        user.giveaways_won.some((g) => g.steam_play_data) && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Gamepad2 className="h-4 w-4 text-accent-purple" />
                  Steam activity
                  {user.stats.has_missing_achievements_data && (
                    <Tooltip content="Some games won by this user don't have achievement data available, so percentages might be inaccurate.">
                      <AlertTriangle className="h-4 w-4 text-warning-foreground" />
                    </Tooltip>
                  )}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Activity related only to games won in the group.
                </p>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <SimpleStat
                  label="Activated games"
                  value={getOwnedGames()}
                  icon={Gift}
                  accent="text-accent-orange"
                />
                <SimpleStat
                  label="Total playtime"
                  value={
                    getTotalPlaytime() === 0 ? 'Unavailable' : formatPlaytime(getTotalPlaytime())
                  }
                  icon={Gamepad2}
                  accent="text-accent-blue"
                />
                <SimpleStat
                  label="Total achievements"
                  value={getTotalAchievements()}
                  hint={`${user.stats.total_achievements_percentage ?? 0}% total · ${user.stats.average_achievements_percentage ?? 0}% avg`}
                  icon={Award}
                  accent="text-accent-yellow"
                />
                <div className="rounded-lg border border-card-border bg-card-background-hover/40 p-4 text-center">
                  <UnplayedGamesStats user={user} size="large" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

      {/* Tabs: Created / Won / Entered / Leavers */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="flex w-full max-w-full flex-nowrap justify-start gap-1 overflow-x-auto sm:flex-wrap sm:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsTrigger value="created" className="gap-1.5">
            <Gift className="h-3.5 w-3.5" /> Created
            {createdGiveaways > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums-strict">
                {createdGiveaways}
              </span>
            )}
          </TabsTrigger>
          {user.giveaways_won && user.giveaways_won.length > 0 && (
            <TabsTrigger value="won" className="gap-1.5">
              <Trophy className="h-3.5 w-3.5" /> Won
              {countedWon.length > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums-strict">
                  {countedWon.length}
                </span>
              )}
            </TabsTrigger>
          )}
          <TabsTrigger value="entered" className="gap-1.5">
            <Heart className="h-3.5 w-3.5" /> Entered
            {enteredGiveaways.length > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums-strict">
                {enteredGiveaways.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="stats" className="gap-1.5">
            <Activity className="h-3.5 w-3.5" /> Stats
          </TabsTrigger>
          {isAdmin && leavers.length > 0 && (
            <TabsTrigger value="leavers" className="gap-1.5">
              <UsersIcon className="h-3.5 w-3.5" /> Leavers
              <span className="text-xs text-muted-foreground tabular-nums-strict">
                {leavers.length}
              </span>
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="created" className="mt-6">
          <GivenGiveawaysClient
            giveaways={userGiveaways}
            userAvatars={userAvatars}
            userNames={userNames}
            exMemberIds={exMemberSet}
            playStatsByWin={playStatsByWin}
            gameData={gameData}
          />
        </TabsContent>

        {user.giveaways_won && user.giveaways_won.length > 0 && (
          <TabsContent value="won" className="mt-6">
            <WonGiveawaysClient
              giveaways={giveaways}
              wonGiveaways={user.giveaways_won}
              gameData={gameData}
              user={user}
              steamIdMap={steamIdMap}
              userAvatars={userAvatars}
              initialFilterPlayRequired={deepLinkPlayRequired}
            />
          </TabsContent>
        )}

        <TabsContent value="entered" className="mt-6">
          <GiveawaysClient
            heading="Entered giveaways"
            giveaways={enteredGiveaways}
            userAvatars={userAvatars}
            userNames={userNames}
            gameData={gameData}
            lastUpdated={null}
            defaultGiveawayStatus={deepLinkEnteredOpen ? 'open' : 'all'}
          />
        </TabsContent>

        <TabsContent value="stats" className="mt-6">
          <div className="flex items-center gap-2 mb-4">
            <label htmlFor="stats-cv-filter" className="text-sm font-medium">CV:</label>
            <select
              id="stats-cv-filter"
              value={statsFilterCV}
              onChange={(e) => setStatsFilterCV(e.target.value as StatsCvFilter)}
              className="px-3 py-2 border border-card-border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-accent text-sm"
            >
              <option value="all">All</option>
              <option value="RATIO_VALID">Ratio Valid</option>
              <option value="FULL_CV">Full</option>
              <option value="REDUCED_CV">Reduced</option>
              <option value="NO_CV">No CV</option>
            </select>
          </div>
          <UserStatsCharts
            key={statsFilterCV}
            giftsCumulative={statsCharts.giftsCumulative}
            activityPerMonth={statsCharts.activityPerMonth}
            cvCumulative={statsCharts.cvCumulative}
            hoursPerMonth={hoursPerMonth}
            winsBreakdown={statsCharts.winsBreakdown}
            summary={statsCharts.summary}
            sentByMonth={statsCharts.sentByMonth}
            wonByMonth={statsCharts.wonByMonth}
            enteredByMonth={statsCharts.enteredByMonth}
            hoursByMonth={hoursByMonth}
            notCountedByMonth={statsCharts.notCountedByMonth}
            winsByBucket={statsCharts.winsByBucket}
          />
        </TabsContent>

        {isAdmin && leavers.length > 0 && (
          <TabsContent value="leavers" className="mt-6">
            <GiveawayLeaversClient leavers={leavers} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

function SimpleStat({
  label,
  value,
  hint,
  icon: Icon,
  accent,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  accent?: string
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p
            className={cn(
              'mt-1 text-2xl font-semibold tabular-nums-strict',
              accent,
            )}
          >
            {value}
          </p>
          {hint && (
            <p className="mt-1 text-xs text-muted-foreground tabular-nums-strict">
              {hint}
            </p>
          )}
        </div>
        {Icon && (
          <div
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-md bg-card-background-hover',
              accent || 'text-muted-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
    </Card>
  )
}

function CvBreakdown({
  label,
  accent,
  sent,
  received,
  sentLabel = 'Sent',
  receivedLabel = 'Received',
}: {
  label: string
  accent: string
  sent: number
  received: number
  sentLabel?: string
  receivedLabel?: string
}) {
  return (
    <Card className="p-4">
      <p className={cn('text-sm font-semibold', accent)}>{label}</p>
      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{sentLabel}</dt>
          <dd className="font-medium tabular-nums-strict">{sent}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{receivedLabel}</dt>
          <dd className="font-medium tabular-nums-strict">{received}</dd>
        </div>
      </dl>
    </Card>
  )
}
