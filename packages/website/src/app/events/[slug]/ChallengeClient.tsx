'use client'

import * as React from 'react'
import Image from 'next/image'
import {
  Award,
  Clock,
  Crown,
  ExternalLink,
  Gamepad2,
  Sparkles,
  Timer,
  Trophy,
  Users as UsersIcon,
} from 'lucide-react'
import type { EventMeta } from '@/lib/events'
import type {
  ChallengeData,
  ChallengeMilestone,
  ChallengeNonParticipant,
  ChallengeParticipant,
  GameData,
} from '@/types'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { UserLink } from '@/components/UserLink'
import { StatCard } from '@/components/StatCard'
import { LastUpdated } from '@/components/LastUpdated'
import { EventPageHeader } from './EventPageHeader'
import { cn } from '@/lib/cn'

const FALLBACK_AVATAR =
  'https://images.icon-icons.com/2550/PNG/512/question_mark_circle_icon_152550.png'

/** Links to the SG profile for members, or the Steam profile for guests. */
function ParticipantName({
  p,
  className,
  children,
}: {
  p: { username: string; sg_username: string | null; profile_url: string | null }
  className?: string
  children?: React.ReactNode
}) {
  const content = children ?? p.username
  if (p.sg_username) {
    return (
      <UserLink username={p.sg_username} className={className}>
        {content}
      </UserLink>
    )
  }
  return (
    <a
      href={p.profile_url ?? '#'}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {content}
    </a>
  )
}

function fmtMinutes(m: number): string {
  if (!m) return '0m'
  const h = Math.floor(m / 60)
  const min = m % 60
  if (h === 0) return `${min}m`
  return min === 0 ? `${h}h` : `${h}h ${min}m`
}

function fmtDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtDay(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })
}

/**
 * A live, second-by-second countdown to the challenge deadline. Renders a stable
 * placeholder until mounted (so the static export's HTML matches first paint),
 * then ticks every second on the client.
 */
function LiveCountdown({ deadline }: { deadline: number }) {
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const diffMs = now == null ? null : Math.max(0, deadline * 1000 - now)
  const ended = diffMs != null && diffMs <= 0
  const totalSec = diffMs == null ? 0 : Math.floor(diffMs / 1000)
  const segments = [
    { label: 'days', value: Math.floor(totalSec / 86400) },
    { label: 'hrs', value: Math.floor((totalSec % 86400) / 3600) },
    { label: 'min', value: Math.floor((totalSec % 3600) / 60) },
    { label: 'sec', value: totalSec % 60 },
  ]

  return (
    <Card className="flex flex-col items-center justify-between gap-3 p-4 sm:flex-row sm:p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Timer className="h-4 w-4 text-primary-hi" />
        {ended ? 'Challenge ended' : 'Time remaining'}
      </div>
      {!ended && (
        <div className="flex items-center gap-1.5 sm:gap-2">
          {segments.map((s, i) => (
            <React.Fragment key={s.label}>
              {i > 0 && (
                <span className="text-lg font-bold text-subtle">:</span>
              )}
              <div className="flex min-w-[3rem] flex-col items-center rounded-lg bg-card-background-hover px-2 py-1.5">
                <span className="text-xl font-bold tabular-nums-strict text-foreground sm:text-2xl">
                  {now == null ? '––' : String(s.value).padStart(2, '0')}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {s.label}
                </span>
              </div>
            </React.Fragment>
          ))}
        </div>
      )}
    </Card>
  )
}

/**
 * The inclusive last day of a completion challenge, as a display timestamp.
 * The stored `deadline` is the exclusive UTC-midnight cutoff (e.g. 1 Jul 00:00
 * = "before the 30th"); pinning to noon of the previous day makes it render as
 * the right calendar day ("30 Jun") in every viewer timezone.
 */
function deadlineDisplayTs(deadline: number | null | undefined): number | null {
  return deadline != null ? deadline - 43200 : null
}

/** Small "Guest" badge for non-member participants. */
function GuestTag() {
  return (
    <span
      title="Invited guest (not a group member)"
      className="rounded-full border border-card-border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-subtle"
    >
      Guest
    </span>
  )
}

/**
 * Item-discovery progression toward the win condition:
 * Discoverer (200) → Expert (400) → Hero (700). Reached tiers are filled.
 */
function MilestoneTrack({ milestones }: { milestones: ChallengeMilestone[] }) {
  if (!milestones?.length) return null
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-0.5 gap-y-1">
      {milestones.map((m, i) => {
        const isHero = m.apiname === 'ItemHero'
        return (
          <React.Fragment key={m.apiname}>
            {i > 0 && (
              <span
                className={cn(
                  'h-px w-2 sm:w-3',
                  m.unlocked ? 'bg-[var(--primary)]' : 'bg-card-border',
                )}
                aria-hidden
              />
            )}
            <span
              title={`${m.label} — discover ${m.items} items${m.unlocked ? ' ✓' : ''}`}
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none',
                m.unlocked
                  ? isHero
                    ? 'bg-[var(--accent-yellow)] text-[#1a1505]'
                    : 'bg-[color-mix(in_oklab,var(--primary)_22%,transparent)] text-primary-hi'
                  : 'border border-card-border text-subtle',
              )}
            >
              {m.label}
            </span>
          </React.Fragment>
        )
      })}
    </div>
  )
}

function Avatar({
  src,
  username,
  size = 40,
  ringClass,
}: {
  src: string
  username: string
  size?: number
  ringClass?: string
}) {
  const [failed, setFailed] = React.useState(false)
  return (
    <Image
      src={failed || !src ? FALLBACK_AVATAR : src}
      alt={username}
      width={size}
      height={size}
      unoptimized
      onError={() => setFailed(true)}
      className={cn(
        'flex-shrink-0 rounded-full bg-card-background-hover object-cover ring-2',
        ringClass ?? 'ring-card-border',
      )}
      style={{ width: size, height: size }}
    />
  )
}

const PODIUM = [
  {
    ring: 'ring-[var(--accent-yellow)]',
    text: 'text-[#1a1505]',
    // Opaque gold pill (matches the solidity of the 2nd-place badge).
    bg: 'bg-[var(--accent-yellow)]',
    label: '1st',
    // Mobile: natural 1-2-3 stack. Desktop: 1st in the centre (2-1-3).
    order: 'order-1 sm:order-2',
    lift: 'sm:-translate-y-4',
    avatar: 88,
  },
  {
    ring: 'ring-[var(--subtle)]',
    text: 'text-foreground',
    bg: 'bg-card-background-hover',
    label: '2nd',
    order: 'order-2 sm:order-1',
    lift: '',
    avatar: 72,
  },
  {
    ring: 'ring-[var(--accent-rose)]',
    text: 'text-white',
    // Opaque bronze/rose pill.
    bg: 'bg-[var(--accent-rose)]',
    label: '3rd',
    order: 'order-3 sm:order-3',
    lift: '',
    avatar: 72,
  },
]

function Podium({
  top,
  totalAchievements,
  isCompletion = false,
}: {
  top: ChallengeParticipant[]
  totalAchievements: number
  isCompletion?: boolean
}) {
  return (
    <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-3">
      {top.map((p, i) => {
        const style = PODIUM[i]
        return (
          <div
            key={p.steam_id}
            className={cn('flex flex-col items-center', style.order, style.lift)}
          >
            <Card
              className={cn(
                'flex w-full flex-col items-center gap-2 p-5 text-center',
                i === 0 && 'ring-1 ring-[var(--accent-yellow)]/40',
              )}
            >
              <div className="relative">
                {p.is_winner && (
                  <Crown className="pointer-events-none absolute -top-5 left-1/2 z-10 h-6 w-6 -translate-x-1/2 text-[var(--accent-yellow)] drop-shadow" />
                )}
                <ParticipantName
                  p={p}
                  className="block rounded-full transition hover:opacity-80"
                >
                  <Avatar
                    src={p.avatar_url}
                    username={p.username}
                    size={style.avatar}
                    ringClass={style.ring}
                  />
                </ParticipantName>
                <span
                  className={cn(
                    'absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ring-2 ring-card-background',
                    style.bg,
                    style.text,
                  )}
                >
                  {i + 1}
                </span>
              </div>
              <div className="mt-1 flex max-w-full items-center gap-1">
                <ParticipantName
                  p={p}
                  className="truncate text-sm font-semibold text-foreground hover:text-accent hover:underline"
                />
                {p.is_guest && <GuestTag />}
              </div>
              <div className="flex items-center gap-1.5">
                <Award className={cn('h-4 w-4', style.text)} />
                <span className="text-lg font-bold tabular-nums-strict text-foreground">
                  {isCompletion
                    ? p.achievements_unlocked_total
                    : p.challenge_achievement_count}
                </span>
                <span className="text-xs text-muted-foreground">
                  / {totalAchievements}
                </span>
              </div>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {fmtMinutes(p.playtime_challenge_minutes)} played
              </span>
              {isCompletion
                ? p.is_winner && (
                    <Badge variant="amber" size="sm">
                      <Trophy className="h-3 w-3" /> Qualified
                    </Badge>
                  )
                : p.has_hero && (
                    <Badge variant="amber" size="sm">
                      <Trophy className="h-3 w-3" /> Hero
                    </Badge>
                  )}
            </Card>
          </div>
        )
      })}
    </div>
  )
}

function LeaderboardRow({
  p,
  rank,
  totalAchievements,
  isCompletion = false,
  minPlaytime = 0,
}: {
  p: ChallengeParticipant
  rank: number
  totalAchievements: number
  isCompletion?: boolean
  minPlaytime?: number
}) {
  // Completion races rank by total achievements unlocked (progress toward 100%);
  // achievement challenges by achievements earned since the start. Playtime is
  // always the challenge-window figure.
  const metric = isCompletion
    ? p.achievements_unlocked_total
    : p.challenge_achievement_count
  const playtimeMin = p.playtime_challenge_minutes
  // Completion: a 100% member still needs `minPlaytime` of challenge-window play
  // to qualify; surface how much is left.
  const playtimeLeft = Math.max(0, (minPlaytime ?? 0) - playtimeMin)
  const pct = Math.min(
    100,
    Math.round((metric / totalAchievements) * 100),
  )
  const rankColor =
    rank === 1
      ? 'text-[var(--accent-yellow)]'
      : rank === 2
        ? 'text-muted-foreground'
        : rank === 3
          ? 'text-[var(--accent-rose)]'
          : 'text-subtle'

  return (
    <div
      className={cn(
        'grid grid-cols-[2rem_1fr_auto] items-center gap-3 px-3 py-2.5 sm:grid-cols-[2.5rem_1fr_9rem_7rem_4rem] sm:gap-4',
        'rounded-lg transition-colors hover:bg-card-background-hover',
        p.is_winner && 'bg-[color-mix(in_oklab,var(--accent-yellow)_8%,transparent)]',
      )}
    >
      {/* Rank */}
      <div
        className={cn(
          'text-center text-sm font-bold tabular-nums-strict',
          rankColor,
        )}
      >
        {rank}
      </div>

      {/* Member */}
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative">
          <ParticipantName
            p={p}
            className="block rounded-full transition hover:opacity-80"
          >
            <Avatar src={p.avatar_url} username={p.username} size={36} />
          </ParticipantName>
          {p.is_winner && (
            <Crown className="pointer-events-none absolute -right-1 -top-1.5 h-3.5 w-3.5 text-[var(--accent-yellow)]" />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <ParticipantName
              p={p}
              className="block truncate text-sm font-medium text-foreground hover:text-accent hover:underline"
            />
            {p.is_guest && <GuestTag />}
          </div>
          {isCompletion ? (
            p.is_winner ? (
              <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent-yellow)]">
                <Trophy className="h-3 w-3" />
                Qualified
                {p.completed_at != null && ` · 100% on ${fmtDate(p.completed_at)}`}
              </span>
            ) : p.is_complete ? (
              <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <Clock className="h-3 w-3" />
                100% ·{' '}
                {playtimeLeft > 0
                  ? `${fmtMinutes(playtimeLeft)} more play to qualify`
                  : 'qualifying…'}
              </span>
            ) : null
          ) : (
            <MilestoneTrack milestones={p.milestones ?? []} />
          )}
        </div>
      </div>

      {/* Achievements progress (desktop) */}
      <div className="hidden flex-col gap-1 sm:flex">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold tabular-nums-strict text-foreground">
            {metric}
            <span className="text-muted-foreground"> / {totalAchievements}</span>
          </span>
          <span className="text-muted-foreground">{pct}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-background-hover">
          <div
            className="h-full rounded-full bg-[var(--primary)] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Playtime (desktop) */}
      <div className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
        <Clock className="h-3.5 w-3.5" />
        <span className="tabular-nums-strict">{fmtMinutes(playtimeMin)}</span>
      </div>

      {/* Compact stats (mobile) + hero (desktop) */}
      <div className="flex items-center justify-end gap-2">
        {/* Mobile: achievements + hours played stacked */}
        <div className="flex flex-col items-end gap-0.5 sm:hidden">
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-foreground">
            <Award className="h-3.5 w-3.5 text-primary-hi" />
            {metric}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums-strict">
            <Clock className="h-3 w-3" />
            {fmtMinutes(playtimeMin)}
          </span>
        </div>
        {(isCompletion ? p.is_winner : p.has_hero) ? (
          <Trophy className="h-4 w-4 text-[var(--accent-yellow)]" />
        ) : (
          <span className="hidden text-subtle sm:inline">—</span>
        )}
      </div>
    </div>
  )
}

/** Highlights the challenge's game, linking to its Steam store page. */
function GameSpotlight({
  appId,
  gameName,
  game,
}: {
  appId: number
  gameName: string
  game?: GameData | null
}) {
  const storeUrl = `https://store.steampowered.com/app/${appId}/`
  const headerUrl = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`
  const hltb = game?.hltb_main_story_hours ?? null
  const priceCents = game?.price_usd_full ?? null
  const price =
    priceCents == null
      ? null
      : priceCents === 0
        ? 'Free'
        : `$${(priceCents / 100).toFixed(2)}`

  return (
    <a
      href={storeUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group block"
    >
      <Card className="flex items-stretch overflow-hidden p-0 transition-all hover:border-card-border-strong hover:shadow-md">
        <div className="relative aspect-[460/215] w-36 flex-shrink-0 bg-card-background-hover sm:w-56">
          <Image
            src={headerUrl}
            alt={gameName}
            fill
            unoptimized
            className="object-cover transition-transform group-hover:scale-105"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            The game
          </p>
          <h2 className="truncate text-base font-semibold text-foreground sm:text-lg">
            {gameName}
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {hltb != null && (
              <span className="inline-flex items-center gap-1">
                <Timer className="h-3.5 w-3.5" />~{hltb}h to beat
              </span>
            )}
            {price && (
              <span className="font-medium text-foreground">{price}</span>
            )}
          </div>
          <span className="mt-0.5 inline-flex items-center gap-1 text-sm font-medium text-primary-hi">
            View on Steam
            <ExternalLink className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </Card>
    </a>
  )
}

export default function ChallengeClient({
  meta,
  data,
  game,
}: {
  meta: EventMeta
  data: ChallengeData | null
  game?: GameData | null
}) {
  if (!data) {
    return (
      <div className="mx-auto max-w-screen-xl space-y-8">
        <EventPageHeader
          meta={meta}
          startTimestamp={null}
          endTimestamp={null}
          isOngoing
        />
        <Card className="flex flex-col items-center gap-2 p-12 text-center">
          <Gamepad2 className="h-8 w-8 text-subtle" />
          <p className="text-muted-foreground">
            Leaderboard data hasn’t been generated yet. Run{' '}
            <code className="rounded bg-card-background-hover px-1.5 py-0.5 text-xs">
              pnpm --filter scraper challenge
            </code>{' '}
            to populate it.
          </p>
        </Card>
      </div>
    )
  }

  // A "completion" challenge has many winners; an "achievement" challenge has a
  // single winner. Completion winners need BOTH 100% (whenever reached) AND over
  // `minPlaytimeMinutes` of play logged during the challenge window.
  const isCompletion = data.winType === 'completion'
  const minPlaytime = data.minPlaytimeMinutes ?? 0

  // "Started" semantics differ by challenge kind:
  //  - achievement (clean slate): made progress SINCE the start — challenge-window
  //    playtime OR achievements gained since the baseline.
  //  - completion: any achievements or playtime at all (pre-challenge progress
  //    counts toward 100%), so longtime owners still show on the board.
  // `has_started` from the data file is authoritative; fall back for older files.
  const hasStarted = (p: (typeof data.participants)[number]) =>
    p.has_started ??
    (isCompletion
      ? p.achievements_unlocked_total > 0 || p.playtime_total_minutes > 0
      : p.challenge_achievement_count > 0 ||
        p.playtime_challenge_minutes > 0 ||
        p.achievements_unlocked_total > 0)

  const active = data.participants.filter(hasStarted)
  const yetToStart = data.participants.filter((p) => !hasStarted(p))

  const podium = active.slice(0, 3)
  const rest = active.slice(3)

  // Headline metric per kind: total achievements unlocked (completion, since the
  // goal is 100%) vs achievements earned since the start (achievement). Playtime
  // shown is challenge-window playtime in both cases (the completion 2h gate is
  // measured over the window).
  const metricOf = (p: (typeof data.participants)[number]) =>
    isCompletion ? p.achievements_unlocked_total : p.challenge_achievement_count
  const totalAchievementsEarned = active.reduce((s, p) => s + metricOf(p), 0)
  const totalPlaytime = active.reduce(
    (s, p) => s + p.playtime_challenge_minutes,
    0,
  )
  const generatedIso = new Date(data.generatedAt).toISOString()

  const winners = data.participants
    .filter((p) => p.is_winner)
    .sort(
      (a, b) =>
        (a.completed_at ?? Number.POSITIVE_INFINITY) -
        (b.completed_at ?? Number.POSITIVE_INFINITY),
    )
  const heroHolders = data.participants.filter((p) => p.has_hero).length
  // Headline "win count": members who reached 100% in-window (completion) or
  // who hold the Hero achievement (achievement).
  const winCount = isCompletion ? winners.length : heroHolders
  const deadlinePassed =
    data.deadline != null && Date.now() / 1000 >= data.deadline
  const isOngoing = isCompletion ? !deadlinePassed : !data.winnerUsername
  // The challenge's natural end: deadline reached (completion) or a winner
  // recorded (achievement). It then lingers with an "Ended" badge.
  const hasEnded = isCompletion ? deadlinePassed : Boolean(data.winnerUsername)
  // Inclusive last day for display ("30 Jun"), robust across timezones.
  const deadlineDisplay = deadlineDisplayTs(data.deadline)

  return (
    <div className="mx-auto max-w-screen-xl space-y-8">
      <EventPageHeader
        meta={meta}
        startTimestamp={data.startTimestamp}
        endTimestamp={isCompletion ? deadlineDisplay : null}
        isOngoing={isOngoing}
        hasEnded={hasEnded}
      >
        {isCompletion ? (
          winners.length > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--accent-yellow)]/40 bg-[color-mix(in_oklab,var(--accent-yellow)_12%,transparent)] px-3 py-2.5 text-sm font-semibold text-foreground">
              <Crown className="h-4 w-4 flex-shrink-0 text-[var(--accent-yellow)]" />
              {winners.length === 1
                ? '1 member qualified 🎉'
                : `${winners.length} members qualified 🎉`}
            </div>
          )
        ) : (
          data.winnerUsername && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--accent-yellow)]/40 bg-[color-mix(in_oklab,var(--accent-yellow)_12%,transparent)] px-3 py-2 text-sm">
              <Crown className="h-4 w-4 flex-shrink-0 text-[var(--accent-yellow)]" />
              <span className="font-semibold text-foreground">
                {data.winnerUsername}
              </span>
              <span className="text-muted-foreground">
                claimed the Hero achievement
                {data.winnerUnlocktime
                  ? ` on ${fmtDate(data.winnerUnlocktime)}`
                  : ''}{' '}
                and won the challenge! 🎉
              </span>
            </div>
          )
        )}
      </EventPageHeader>

      {/* Game spotlight — links to the Steam store page */}
      <GameSpotlight appId={data.appId} gameName={data.gameName} game={game} />

      {/* Win-condition callout */}
      {isCompletion ? (
        <Card className="flex items-start gap-4 p-5">
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--accent-yellow)_18%,transparent)] text-[var(--accent-yellow)]">
            <Trophy className="h-6 w-6" />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">
                Unlock all {data.totalAchievements} achievements
                {minPlaytime > 0
                  ? ` + play over ${fmtMinutes(minPlaytime)}`
                  : ''}
              </h2>
              <Badge variant="amber" size="sm">
                {winners.length} qualified
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              This is a completion race, not a single-winner challenge —{' '}
              <span className="font-medium text-foreground">
                every participant
              </span>{' '}
              wins who unlocks all {data.totalAchievements} achievements
              {minPlaytime > 0 ? (
                <>
                  {' '}
                  <span className="font-medium text-foreground">and</span> logs
                  over {fmtMinutes(minPlaytime)} of play
                </>
              ) : null}
              {deadlineDisplay
                ? ` during the challenge (by the end of ${fmtDay(deadlineDisplay)})`
                : ''}
              . Achievements earned before the challenge count too. The
              leaderboard records when each member hits 100%.
            </p>
          </div>
        </Card>
      ) : (
        data.heroAchievement && (
          <Card className="flex items-start gap-4 p-5">
            {data.heroAchievement.iconUrl ? (
              <Image
                src={data.heroAchievement.iconUrl}
                alt={`${data.heroAchievement.displayName} achievement`}
                width={56}
                height={56}
                unoptimized
                className="h-14 w-14 flex-shrink-0 rounded-xl ring-2 ring-[var(--accent-yellow)]/60"
              />
            ) : (
              <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--accent-yellow)_18%,transparent)] text-[var(--accent-yellow)]">
                <Trophy className="h-6 w-6" />
              </div>
            )}
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-foreground">
                  Winning achievement: “{data.heroAchievement.displayName}”
                </h2>
                <Badge variant="amber" size="sm">
                  {heroHolders} unlocked
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {data.heroAchievement.description}. The first member to unlock it
                after the challenge start wins. Only achievements earned and
                playtime logged{' '}
                <span className="font-medium text-foreground">after</span> the
                start are counted.
              </p>
            </div>
          </Card>
        )
      )}

      {/* Live countdown to the deadline (completion challenges) */}
      {isCompletion && data.deadline != null && !hasEnded && (
        <LiveCountdown deadline={data.deadline} />
      )}

      {/* Stats */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Participants"
          value={data.participants.length}
          icon={UsersIcon}
          accent="primary"
          hint={`${active.length} active`}
        />
        <StatCard
          label={isCompletion ? 'Achievements unlocked' : 'Achievements earned'}
          value={totalAchievementsEarned}
          icon={Award}
          accent="purple"
          hint={isCompletion ? 'combined, all-time' : 'since challenge start'}
        />
        <StatCard
          label="Hours played"
          value={Math.round(totalPlaytime / 60)}
          icon={Clock}
          accent="blue"
          hint="combined, since start"
        />
        {isCompletion ? (
          <StatCard
            label="Qualified"
            value={winCount}
            icon={Trophy}
            accent="amber"
            hint={
              deadlineDisplay
                ? `Deadline: ${fmtDay(deadlineDisplay)}`
                : 'Complete to win'
            }
          />
        ) : (
          <StatCard
            label="Hero unlocked"
            value={heroHolders}
            icon={Trophy}
            accent="amber"
            hint={
              data.winnerUsername
                ? `Winner: ${data.winnerUsername}`
                : 'No winner yet'
            }
          />
        )}
      </section>

      {/* Podium */}
      {podium.length > 0 && (
        <section className="space-y-4 pt-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[var(--accent-yellow)]" />
            <h2 className="text-lg font-semibold text-foreground">Top players</h2>
          </div>
          <Podium
            top={podium}
            totalAchievements={data.totalAchievements}
            isCompletion={isCompletion}
          />
        </section>
      )}

      {/* Full leaderboard */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Leaderboard</h2>
          <LastUpdated lastUpdatedDate={generatedIso} />
        </div>

        {active.length === 0 ? (
          <Card className="flex flex-col items-center gap-2 p-10 text-center">
            <Gamepad2 className="h-7 w-7 text-subtle" />
            <p className="text-sm text-muted-foreground">
              No one has made progress yet — be the first to climb the board!
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden p-2">
            {/* Header row (desktop) */}
            <div className="hidden grid-cols-[2.5rem_1fr_9rem_7rem_4rem] gap-4 px-3 pb-2 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:grid">
              <span className="text-center">#</span>
              <span>Member</span>
              <span>{isCompletion ? 'Achievements' : 'Challenge achievements'}</span>
              <span>Playtime</span>
              <span className="text-right">{isCompletion ? 'Qualified' : 'Hero'}</span>
            </div>
            <div className="space-y-0.5">
              {podium.concat(rest).map((p, i) => (
                <LeaderboardRow
                  key={p.steam_id}
                  p={p}
                  rank={i + 1}
                  totalAchievements={data.totalAchievements}
                  isCompletion={isCompletion}
                  minPlaytime={minPlaytime}
                />
              ))}
            </div>
          </Card>
        )}
      </section>

      {/* Roster · yet to start */}
      {yetToStart.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {isCompletion
              ? `Owns the game · not started yet (${yetToStart.length})`
              : `Roster · yet to start (${yetToStart.length})`}
          </h2>
          <div className="flex flex-wrap gap-2">
            {yetToStart.map((p) => (
              <ParticipantName
                key={p.steam_id}
                p={p}
                className="inline-flex items-center gap-2 rounded-full border border-card-border bg-card-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-card-border-strong hover:text-foreground"
              >
                <Avatar src={p.avatar_url} username={p.username} size={20} />
                <span>{p.username}</span>
                {p.is_guest && <GuestTag />}
                {p.had_hero_before && (
                  <span
                    title="Already had the Hero achievement before the challenge"
                    className="text-[var(--accent-yellow)]"
                  >
                    <Trophy className="h-3 w-3" />
                  </span>
                )}
              </ParticipantName>
            ))}
          </div>
        </section>
      )}

      {/* Non-participants who own & played the game */}
      {data.nonParticipants.length > 0 && (
        <NonParticipants list={data.nonParticipants} gameName={data.gameName} />
      )}
    </div>
  )
}

function NonParticipants({
  list,
  gameName,
}: {
  list: ChallengeNonParticipant[]
  gameName: string
}) {
  return (
    <section className="space-y-3 border-t border-card-border pt-6">
      <h2 className="text-sm font-semibold text-muted-foreground">
        Not competing · members who own &amp; played {gameName} ({list.length})
      </h2>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((p) => {
          const complete =
            p.achievements_total > 0 &&
            p.achievements_unlocked_total >= p.achievements_total
          return (
            <a
              key={p.steam_id}
              href={p.profile_url ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'flex items-center gap-2.5 rounded-lg border border-card-border bg-card-background px-2.5 py-1.5 transition-colors hover:border-card-border-strong',
                complete && 'shine-100',
              )}
            >
              <Avatar src={p.avatar_url} username={p.username} size={28} />
              <span className="relative z-10 min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {p.username}
              </span>
              <span className="relative z-10 flex flex-shrink-0 items-center gap-2 text-[11px] text-muted-foreground tabular-nums-strict">
                <span className="inline-flex items-center gap-0.5">
                  <Clock className="h-3 w-3" />
                  {fmtMinutes(p.playtime_total_minutes)}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5',
                    complete && 'font-semibold text-[var(--accent-yellow)]',
                  )}
                >
                  {complete ? (
                    <Trophy className="h-3 w-3" />
                  ) : (
                    <Award className="h-3 w-3" />
                  )}
                  {p.achievements_unlocked_total}/{p.achievements_total}
                </span>
              </span>
            </a>
          )
        })}
      </div>
    </section>
  )
}
