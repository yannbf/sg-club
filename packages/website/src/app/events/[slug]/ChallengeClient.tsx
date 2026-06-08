'use client'

import * as React from 'react'
import Image from 'next/image'
import {
  Award,
  Clock,
  Crown,
  ExternalLink,
  Gamepad2,
  RefreshCw,
  Sparkles,
  Timer,
  Trophy,
  Users as UsersIcon,
} from 'lucide-react'
import type { EventMeta } from '@/lib/events'
import type {
  ChallengeData,
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
  'https://cdn-icons-png.flaticon.com/512/9287/9287610.png'

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

function fmtRelative(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function fmtDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Renders time-dependent text only after mount, so server-rendered static HTML
 * (built in UTC, "X ago" frozen at build time) doesn't mismatch the client.
 */
function MountedText({
  children,
  fallback = '…',
}: {
  children: React.ReactNode
  fallback?: string
}) {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  return <>{mounted ? children : fallback}</>
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
}: {
  top: ChallengeParticipant[]
  totalAchievements: number
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
                  <Crown className="absolute -top-5 left-1/2 h-6 w-6 -translate-x-1/2 text-[var(--accent-yellow)] drop-shadow" />
                )}
                <Avatar
                  src={p.avatar_url}
                  username={p.username}
                  size={style.avatar}
                  ringClass={style.ring}
                />
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
                  {p.challenge_achievement_count}
                </span>
                <span className="text-xs text-muted-foreground">
                  / {totalAchievements}
                </span>
              </div>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {fmtMinutes(p.playtime_challenge_minutes)} played
              </span>
              {p.has_hero && (
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
}: {
  p: ChallengeParticipant
  rank: number
  totalAchievements: number
}) {
  const pct = Math.min(
    100,
    Math.round((p.challenge_achievement_count / totalAchievements) * 100),
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
          <Avatar src={p.avatar_url} username={p.username} size={36} />
          {p.is_winner && (
            <Crown className="absolute -right-1 -top-1.5 h-3.5 w-3.5 text-[var(--accent-yellow)]" />
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
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{p.achievements_unlocked_total}/{p.achievements_total} all-time</span>
          </div>
        </div>
      </div>

      {/* Achievements progress (desktop) */}
      <div className="hidden flex-col gap-1 sm:flex">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold tabular-nums-strict text-foreground">
            {p.challenge_achievement_count}
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
        <span className="tabular-nums-strict">
          {fmtMinutes(p.playtime_challenge_minutes)}
        </span>
      </div>

      {/* Compact stats (mobile) + hero (desktop) */}
      <div className="flex items-center justify-end gap-2">
        {/* Mobile: achievements + hours played stacked */}
        <div className="flex flex-col items-end gap-0.5 sm:hidden">
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-foreground">
            <Award className="h-3.5 w-3.5 text-primary-hi" />
            {p.challenge_achievement_count}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums-strict">
            <Clock className="h-3 w-3" />
            {fmtMinutes(p.playtime_challenge_minutes)}
          </span>
        </div>
        {p.has_hero ? (
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

  // Active = made progress since the challenge started. Everyone else is
  // "yet to start" (they own the game but have no post-start stats).
  const active = data.participants.filter(
    (p) =>
      p.challenge_achievement_count > 0 || p.playtime_challenge_minutes > 0,
  )
  const yetToStart = data.participants.filter(
    (p) =>
      p.challenge_achievement_count === 0 &&
      p.playtime_challenge_minutes === 0,
  )

  const podium = active.slice(0, 3)
  const rest = active.slice(3)

  const totalAchievementsEarned = active.reduce(
    (s, p) => s + p.challenge_achievement_count,
    0,
  )
  const totalPlaytime = active.reduce(
    (s, p) => s + p.playtime_challenge_minutes,
    0,
  )
  const heroHolders = data.participants.filter((p) => p.has_hero).length
  const generatedIso = new Date(data.generatedAt).toISOString()

  return (
    <div className="mx-auto max-w-screen-xl space-y-8">
      <EventPageHeader
        meta={meta}
        startTimestamp={data.startTimestamp}
        endTimestamp={null}
        isOngoing={!data.winnerUsername}
      >
        {data.winnerUsername && (
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
        )}

        {/* Make it clear the board is a periodic snapshot, not a live feed. */}
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCw className="h-3 w-3" />
          <span>
            Leaderboard updated{' '}
            <MountedText fallback="recently">
              {fmtRelative(data.generatedAt)}
            </MountedText>{' '}
            — not live; refreshed every few hours.
          </span>
        </p>
      </EventPageHeader>

      {/* Game spotlight — links to the Steam store page */}
      <GameSpotlight appId={data.appId} gameName={data.gameName} game={game} />

      {/* Winning-achievement callout */}
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
            after the challenge start wins. Only achievements earned and playtime
            logged <span className="font-medium text-foreground">after</span> the
            start are counted.
          </p>
        </div>
      </Card>

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
          label="Achievements earned"
          value={totalAchievementsEarned}
          icon={Award}
          accent="purple"
          hint="since challenge start"
        />
        <StatCard
          label="Hours played"
          value={Math.round(totalPlaytime / 60)}
          icon={Clock}
          accent="blue"
          hint="combined, since start"
        />
        <StatCard
          label="Hero unlocked"
          value={heroHolders}
          icon={Trophy}
          accent="amber"
          hint={data.winnerUsername ? `Winner: ${data.winnerUsername}` : 'No winner yet'}
        />
      </section>

      {/* Podium */}
      {podium.length > 0 && (
        <section className="space-y-4 pt-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[var(--accent-yellow)]" />
            <h2 className="text-lg font-semibold text-foreground">Top players</h2>
          </div>
          <Podium top={podium} totalAchievements={data.totalAchievements} />
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
              <span>Challenge achievements</span>
              <span>Playtime</span>
              <span className="text-right">Hero</span>
            </div>
            <div className="space-y-0.5">
              {podium.concat(rest).map((p, i) => (
                <LeaderboardRow
                  key={p.steam_id}
                  p={p}
                  rank={i + 1}
                  totalAchievements={data.totalAchievements}
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
            Roster · yet to start ({yetToStart.length})
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
        <NonParticipants list={data.nonParticipants} />
      )}
    </div>
  )
}

function NonParticipants({ list }: { list: ChallengeNonParticipant[] }) {
  return (
    <section className="space-y-3 border-t border-card-border pt-6">
      <h2 className="text-sm font-semibold text-muted-foreground">
        Not competing · members who own &amp; played Backpack Hero ({list.length})
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
