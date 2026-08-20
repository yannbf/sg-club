'use client'

import { Check, Clock3, Trophy } from 'lucide-react'
import type { WinnerPlayStats } from '@/lib/winner-play-stats'
import { useIsAdmin } from '@/lib/auth'
import { formatPlaytime, formatPlaytimeCompact } from '@/lib/data'
import { cn } from '@/lib/cn'

function Tag({
  label,
  verified,
  title,
}: {
  label: string
  verified: boolean
  title: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide',
        verified
          ? 'bg-success-light text-success-foreground'
          : 'bg-card-background text-muted-foreground ring-1 ring-card-border',
      )}
    >
      {label}
      {verified && <Check className="h-2.5 w-2.5" aria-hidden />}
    </span>
  )
}

/**
 * What a winner did with the game they won, shown inline in the winner chip:
 * playtime, achievements, and whether play was attested ("I played, bro!") or
 * signed off against a play requirement. Admin-only — how much a member played
 * their wins is member-sensitive, same bar as the rest of the admin sections.
 *
 * Renders nothing when there is nothing to say — private playtime hides the
 * clock, an achievement-less game hides the trophy.
 */
export function WinnerPlayProgress({
  stats,
  className,
}: {
  stats: WinnerPlayStats
  className?: string
}) {
  const isAdmin = useIsAdmin()
  if (!isAdmin) return null

  const showPlaytime =
    stats.playtime_minutes != null && !stats.is_playtime_private
  const showAchievements = (stats.achievements_total ?? 0) > 0
  if (
    !showPlaytime &&
    !showAchievements &&
    !stats.attested &&
    !stats.required_play
  )
    return null

  const completed =
    showAchievements && stats.achievements_unlocked === stats.achievements_total

  return (
    <span
      className={cn(
        'tabular-nums-strict inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground',
        className,
      )}
    >
      {showPlaytime && (
        <span
          className="inline-flex items-center gap-0.5"
          title={`${formatPlaytime(stats.playtime_minutes!)} played`}
        >
          <Clock3 className="h-3 w-3" aria-hidden />
          {formatPlaytimeCompact(stats.playtime_minutes!)}
        </span>
      )}
      {showAchievements && (
        <span
          className={cn(
            'inline-flex items-center gap-0.5',
            // Gold for a full clear; the trophy is the reward, not a status.
            completed && 'font-semibold text-[var(--accent-yellow)]',
          )}
          title={`${stats.achievements_unlocked} of ${stats.achievements_total} achievements`}
        >
          <Trophy className="h-3 w-3" aria-hidden />
          {stats.achievements_unlocked}/{stats.achievements_total}
        </span>
      )}
      {stats.attested && (
        <Tag label="IPB" verified title={'Marked "I played, bro!"'} />
      )}
      {stats.required_play && (
        <Tag
          label="PR"
          verified={Boolean(stats.requirements_met)}
          title={
            stats.requirements_met
              ? 'Play required — proof of play accepted'
              : 'Play required — no proof of play yet'
          }
        />
      )}
    </span>
  )
}
