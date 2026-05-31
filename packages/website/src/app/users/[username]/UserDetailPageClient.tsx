'use client'

import { useState } from 'react'
import Image from 'next/image'
import {
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
import { getUserRatio } from '../util'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { useIsAdmin } from '@/lib/auth'
import { cn } from '@/lib/cn'

interface Props {
  user: User
  allUsers: UserGroupData | null
  giveaways: Giveaway[]
  gameData: GameData[]
  userEntries: UserEntry | null
  lastUpdated: number | null
  leavers: GiveawayLeaver[]
  steamIdMap: SteamIdMap
  isExMember?: boolean
}

type UserWarning = {
  description: string
  severity: 'problem' | 'warning' | 'info'
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
      user.giveaways_won?.filter(
        (g) => g.required_play && !g.required_play_meta?.requirements_met,
      ) || []

    unplayedRequired.sort((a, b) => a.end_timestamp - b.end_timestamp)

    const unplayedText = unplayedRequired
      .map((g) => {
        const { daysRemaining, deadlineDate } = getDeadlineData(
          g.end_timestamp,
          g.required_play_meta?.deadline_in_months,
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
}: Props) {
  const isAdmin = useIsAdmin()
  const [showOriginalStats, setShowOriginalStats] = useState(false)

  // Resolve creator fields through steam_id_map: handles renamed users
  // (creator stored under an old username) and deleted SG accounts (creator
  // stored as a raw username string because it never resolved to a steam_id).
  const creatorResolver = createCreatorResolver(steamIdMap)
  const userGiveaways = giveaways.filter(
    (g) => creatorResolver.canonicalSteamId(g.creator) === user.steam_id,
  )
  const enteredGiveawayData = userEntries?.[user.steam_id] || []
  const enteredGiveaways = enteredGiveawayData
    .map((g) => giveaways.find((ga) => ga.link === g.link))
    .filter((g) => g !== undefined)
  const lastEnteredGiveaway = enteredGiveawayData.sort(
    (a, b) => b.joined_at - a.joined_at,
  )[0]

  const userAvatars = new Map(
    Object.values(allUsers?.users || {}).map((u) => [
      u.steam_id,
      u.avatar_url,
    ]),
  )
  const userNames = new Map(
    Object.entries(steamIdMap).map(([steamId, entry]) => [
      steamId,
      entry.current,
    ]),
  )

  const ratio = ratioInfo(user)

  const getTotalPlaytime = () =>
    (user.giveaways_won || []).reduce(
      (total, game) => total + (game.steam_play_data?.playtime_minutes || 0),
      0,
    )
  const getTotalAchievements = () =>
    (user.giveaways_won || []).reduce(
      (total, game) => total + (game.steam_play_data?.achievements_unlocked || 0),
      0,
    )
  const getOwnedGames = () => (user.giveaways_won || []).length

  const realCvRatio =
    user.stats.real_total_received_value === 0
      ? 0
      : Number(
          (
            user.stats.real_total_sent_value /
            user.stats.real_total_received_value
          ).toFixed(2),
        )

  const createdGiveaways = user.giveaways_created
    ? Object.values(user.giveaways_created).length
    : 0
  const ongoingGiveaways = user.giveaways_created
    ? Object.values(user.giveaways_created).filter(
        (ga) => ga.end_timestamp > Date.now() / 1000,
      ).length
    : 0

  const handleCopyWarningMessage = async () => {
    const message = generateWarningMessage(
      user,
      userEntries?.[user.steam_id] ?? [],
      giveaways,
    )
    if (message) {
      try {
        await navigator.clipboard.writeText(message)
      } catch (err) {
        alert(`Failed to copy message: ${String(err)}`)
      }
    }
  }

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
            {user.steam_profile_url && (
              <a
                href={user.steam_profile_url}
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
              {user.stats.last_giveaway_created_at && (
                <div className="flex items-baseline gap-2">
                  <dt className="text-muted-foreground">Last GA created</dt>
                  <dd className="text-foreground">
                    <FormattedDate
                      timestamp={user.stats.last_giveaway_created_at}
                    />
                  </dd>
                </div>
              )}
              {user.stats.last_giveaway_won_at && (
                <div className="flex items-baseline gap-2">
                  <dt className="text-muted-foreground">Last GA won</dt>
                  <dd className="text-foreground">
                    <FormattedDate
                      timestamp={user.stats.last_giveaway_won_at}
                    />
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
      <Tabs defaultValue="created">
        <TabsList className="flex flex-wrap">
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
              <span className="text-xs text-muted-foreground tabular-nums-strict">
                {user.giveaways_won.length}
              </span>
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
            defaultGiveawayStatus="open"
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
