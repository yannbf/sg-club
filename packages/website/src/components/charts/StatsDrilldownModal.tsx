'use client'

import { useEffect } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { ChevronLeft, ChevronRight, Gamepad2, Trophy, Inbox } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/Dialog'
import { Badge } from '@/components/ui/Badge'
import { useIsAdmin } from '@/lib/auth'
import GameImage from '@/components/GameImage'
import UserAvatar from '@/components/UserAvatar'
import { UserLink } from '@/components/UserLink'
import { CvStatusIndicator } from '@/components/CvStatusIndicator'
import { WinnerPlayProgress } from '@/components/WinnerPlayProgress'
import type { WinnerPlayStats } from '@/lib/winner-play-stats'
import { formatPlaytimeCompact } from '@/lib/data'
import { getFullDate } from '@/components/FormattedDate'
import { formatUsd } from './chart-theme'
import { cn } from '@/lib/cn'
import type { Giveaway } from '@/types'

const FALLBACK_AVATAR =
  'https://images.icon-icons.com/2550/PNG/512/question_mark_circle_icon_152550.png'

/** One winner chip inside a "sent" drill-down row. */
export interface DrilldownWinner {
  /** steam_id as recorded on the giveaway — the lookup key into avatar/name maps. */
  steamId: string
  displayName: string
  avatarUrl?: string
  /** "ex member" / "non-member" badge text, or undefined for a current member — see `classifyPerson` in `@/lib/person`. */
  badgeText?: string
  playStats?: WinnerPlayStats
}

/** One giveaway row inside a drill-down modal — the union of every field any chart's modal might show. */
export interface DrilldownGameRow {
  link: string
  name: string
  /** Sort key — created/end timestamp or entry joined_at, in unix seconds. */
  timestamp: number
  appId?: number | null
  packageId?: number | null
  /** The full giveaway record, when resolvable — feeds the CV asterisk indicator. */
  giveaway?: Giveaway
  /** Pre-known header image URL, used if the Steam CDN thumbnail 404s. */
  fallbackUrl?: string | null
  /** Dollar CV value, shown right-aligned when set (CV sent/received modal). */
  cvValue?: number
  /** Winners of this giveaway (sent rows only). */
  winners?: DrilldownWinner[]
  /** The giveaway's creator — group charts' drill-downs only (a user's own modals imply the creator). */
  creator?: {
    displayName: string
    avatarUrl?: string
  }
  playtimeMinutes?: number
  achievementsUnlocked?: number
  achievementsTotal?: number
  /**
   * Minutes of playtime gained during one specific month (hours-per-month
   * chart's drill-down only) — a delta, not the game's total playtime.
   * Shown with a "+" prefix instead of `playtimeMinutes`.
   */
  minutesGained?: number
  /** Achievements unlocked during that same month — a delta, not a total. */
  achievementsGained?: number
  neverPlayed?: boolean
  /**
   * Mod-confirmed "I played, bro" or proof-of-play sign-off — shown as a
   * "Confirmed played" chip in place of playtime when Steam has no hours on
   * file, so the row doesn't read as bare/unplayed.
   */
  confirmedPlayed?: boolean
  unreleased?: boolean
  /** True when the giveaway hasn't ended yet — created/sent rows only. */
  isOpen?: boolean
  /** True when this entered giveaway is one the user actually won. */
  won?: boolean
  /**
   * Set when the giveaway is excluded from every count/stat (deleted, or
   * ended with zero entries) — display only, never affects chart series or
   * section counts.
   */
  notCounted?: {
    reason: 'deleted' | 'no_entries'
    deletedReason?: string
  }
}

/** One member row inside a "members joined"/"members left" drill-down section (group stats page). */
export interface DrilldownMemberRow {
  username: string
  avatarUrl?: string
  /** True when this member has left the group — shown as a muted "ex member" badge. */
  isExMember?: boolean
  /**
   * Overrides the default "ex member" badge text (e.g. "former member" for
   * pre-tracking members with no record in either the current or ex-member
   * files). Only rendered when `isExMember` is also set.
   */
  badgeText?: string
  /** Optional compact subtitle shown under the username, e.g. "14 entered · 1 created · 2 won". */
  detail?: string
}

export interface DrilldownGameSection {
  kind?: 'game'
  heading: string
  rows: DrilldownGameRow[]
  /**
   * Not-counted rows for this section (deleted / ended-with-zero-entries
   * giveaways) — rendered muted, after `rows`, under a "Not counted" label.
   * Display only: never part of `rows`, so it can't affect chart series or
   * section counts.
   */
  notCountedRows?: DrilldownGameRow[]
  /**
   * Suppresses the "Never played" badge on every row — used only by the
   * "never played" wins-bucket modal, where every row is never-played and
   * the badge would just repeat the section heading.
   */
  hideNeverPlayedBadge?: boolean
  /**
   * Shows a muted "N months/years ago" relative time (from `row.timestamp`)
   * on each row — used by the wins-bucket modals, where `timestamp` is the
   * win's end_timestamp.
   */
  showWonRelativeTime?: boolean
  /**
   * Prefixes the creator/winner lines with small muted "created by"/"won by"
   * labels — the group stats page's giveaways-created, CV-sent, and
   * top-contributors modals, where a row can show both a creator and
   * winners and the relationship isn't otherwise obvious. Left off
   * elsewhere (e.g. a user page's own "sent" rows, where the winners are
   * implicitly winners of that user's giveaway).
   */
  showCreatedWonLabels?: boolean
}

export interface DrilldownMemberSection {
  kind: 'member'
  heading: string
  rows: DrilldownMemberRow[]
}

export type DrilldownSection = DrilldownGameSection | DrilldownMemberSection

/** Prev/next controls for stepping through the ordered set of keys a modal's parent chart opened from. */
export interface DrilldownNav {
  onPrev: () => void
  onNext: () => void
  canPrev: boolean
  canNext: boolean
}

interface StatsDrilldownModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  sections: DrilldownSection[]
  nav?: DrilldownNav
  /**
   * Shown instead of the generic empty state when every section is empty —
   * e.g. "No giveaways sent or won in Mar 24." Lets a month with no activity
   * still be navigated to (via `nav`) without reading as broken.
   */
  emptyMessage?: string
}

function giveawayUrl(link: string): string {
  return `https://www.steamgifts.com/giveaway/${link}`
}

function DrilldownRow({
  row,
  hideNeverPlayedBadge,
  showWonRelativeTime,
  showCreatedWonLabels,
}: {
  row: DrilldownGameRow
  hideNeverPlayedBadge?: boolean
  showWonRelativeTime?: boolean
  showCreatedWonLabels?: boolean
}) {
  const isAdmin = useIsAdmin()
  const hasAchievements = Boolean(row.achievementsTotal && row.achievementsTotal > 0)
  const achievementsCompleted =
    hasAchievements && (row.achievementsUnlocked ?? 0) >= row.achievementsTotal!
  // "Never played" is a verdict on the member, so only admins see it; the
  // playtime and achievement facts on the row stay for everyone.
  const showNeverPlayedBadge =
    isAdmin && row.neverPlayed && !row.unreleased && !hideNeverPlayedBadge
  const showConfirmedPlayedBadge =
    row.confirmedPlayed && row.playtimeMinutes == null && !row.unreleased

  const hasOwnPlayInfo =
    row.playtimeMinutes != null ||
    row.minutesGained != null ||
    hasAchievements ||
    showNeverPlayedBadge ||
    showConfirmedPlayedBadge ||
    row.unreleased ||
    showWonRelativeTime

  return (
    <li
      className={cn(
        'flex items-center gap-3 px-4 py-2',
        row.notCounted && 'opacity-60',
      )}
    >
      <GameImage
        appId={row.appId?.toString()}
        packageId={row.packageId?.toString()}
        fallbackUrl={row.fallbackUrl}
        name={row.name}
        className="w-16 shrink-0 rounded-md"
        rounded
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <a
            href={giveawayUrl(row.link)}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-sm font-medium text-foreground hover:text-[var(--primary-hi)] hover:underline"
            title={row.name}
          >
            {row.name}
          </a>
          {row.giveaway && <CvStatusIndicator giveaway={row.giveaway} />}
          {row.isOpen && (
            <Badge variant="success" size="sm">
              Open
            </Badge>
          )}
          {row.won && (
            <Badge variant="success" size="sm">
              Won
            </Badge>
          )}
          {row.notCounted?.reason === 'deleted' && (
            <Badge
              variant="error"
              size="sm"
              title={row.notCounted.deletedReason || 'Giveaway was deleted'}
            >
              Deleted
            </Badge>
          )}
          {row.notCounted?.reason === 'no_entries' && (
            <Badge variant="warning" size="sm">
              No entries
            </Badge>
          )}
        </div>

        {row.creator && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {showCreatedWonLabels && (
              <span className="text-[11px] text-muted-foreground">created by</span>
            )}
            <UserLink
              username={row.creator.displayName}
              className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-[var(--primary-hi)] hover:underline"
            >
              <UserAvatar
                src={row.creator.avatarUrl || FALLBACK_AVATAR}
                username={row.creator.displayName}
              />
              <span className="truncate">
                {showCreatedWonLabels ? row.creator.displayName : `by ${row.creator.displayName}`}
              </span>
            </UserLink>
          </div>
        )}

        {row.winners && row.winners.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {showCreatedWonLabels && (
              <span className="text-[11px] text-muted-foreground">won by</span>
            )}
            {row.winners.map((winner) => (
              <UserLink
                key={winner.steamId}
                username={winner.displayName}
                className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-[var(--primary-hi)] hover:underline"
              >
                <UserAvatar
                  src={winner.avatarUrl || FALLBACK_AVATAR}
                  username={winner.displayName}
                />
                <span className="truncate">{winner.displayName}</span>
                {winner.badgeText && (
                  <span className="flex-none text-[10px] uppercase tracking-wide text-subtle">
                    {winner.badgeText}
                  </span>
                )}
                {winner.playStats && <WinnerPlayProgress stats={winner.playStats} />}
              </UserLink>
            ))}
          </div>
        )}

        {hasOwnPlayInfo && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {row.unreleased && (
              <Badge variant="info" size="sm">
                Unreleased
              </Badge>
            )}
            {showNeverPlayedBadge && (
              <Badge variant="error" size="sm">
                Never played
              </Badge>
            )}
            {showConfirmedPlayedBadge && (
              <Badge
                variant="success"
                size="sm"
                title='Mod-confirmed "I played, bro" or proof of play — Steam shows no hours, likely played elsewhere or on a private profile.'
              >
                Confirmed played
              </Badge>
            )}
            {row.playtimeMinutes != null && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Gamepad2 className="h-3 w-3" />
                {formatPlaytimeCompact(row.playtimeMinutes)}
              </span>
            )}
            {row.minutesGained != null && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Gamepad2 className="h-3 w-3" />+{formatPlaytimeCompact(row.minutesGained)}
              </span>
            )}
            {row.achievementsGained != null && row.achievementsGained > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Trophy className="h-3 w-3" />+{row.achievementsGained}
              </span>
            )}
            {hasAchievements && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-[11px] text-muted-foreground',
                  // Gold for a full clear; the trophy is the reward, not a status.
                  achievementsCompleted && 'font-semibold text-[var(--accent-yellow)]',
                )}
                title={`${Math.round(((row.achievementsUnlocked ?? 0) / row.achievementsTotal!) * 100)}%`}
              >
                <Trophy className="h-3 w-3" />
                {row.achievementsUnlocked ?? 0}/{row.achievementsTotal}
              </span>
            )}
            {showWonRelativeTime && (
              <span
                className="text-[11px] text-muted-foreground"
                title={getFullDate(row.timestamp)}
              >
                Won {formatDistanceToNow(new Date(row.timestamp * 1000), { addSuffix: true })}
              </span>
            )}
          </div>
        )}
      </div>
      {row.cvValue != null && (
        <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
          {formatUsd(row.cvValue)}
        </span>
      )}
    </li>
  )
}

function DrilldownMemberRowItem({ row }: { row: DrilldownMemberRow }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <UserAvatar src={row.avatarUrl || FALLBACK_AVATAR} username={row.username} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <UserLink
            username={row.username}
            className="min-w-0 truncate text-sm font-medium text-foreground hover:text-[var(--primary-hi)] hover:underline"
          >
            {row.username}
          </UserLink>
          {row.isExMember && (
            <span className="flex-none text-[10px] uppercase tracking-wide text-subtle">
              {row.badgeText ?? 'ex member'}
            </span>
          )}
        </div>
        {row.detail && (
          <div className="truncate text-[11px] text-muted-foreground">{row.detail}</div>
        )}
      </div>
    </li>
  )
}

/** Drill-down modal shared by every stats chart: a titled list of the giveaways or members behind a clicked data point. */
export function StatsDrilldownModal({
  open,
  onOpenChange,
  title,
  description,
  sections,
  nav,
  emptyMessage,
}: StatsDrilldownModalProps) {
  const nonEmptySections = sections.filter((section) => section.rows.length > 0)

  useEffect(() => {
    if (!open || !nav) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && nav.canPrev) nav.onPrev()
      if (e.key === 'ArrowRight' && nav.canNext) nav.onNext()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, nav])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[70vh]">
        <DialogHeader className="shrink-0">
          <div className="flex h-6 items-center gap-1.5">
            {nav ? (
              <>
                <button
                  type="button"
                  onClick={nav.onPrev}
                  disabled={!nav.canPrev}
                  aria-disabled={!nav.canPrev}
                  aria-label="Previous"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card-background-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <DialogTitle className="min-w-0 flex-1 truncate text-center">
                  {title}
                </DialogTitle>
                <button
                  type="button"
                  onClick={nav.onNext}
                  disabled={!nav.canNext}
                  aria-disabled={!nav.canNext}
                  aria-label="Next"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card-background-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            ) : (
              <DialogTitle className="min-w-0 flex-1 truncate">{title}</DialogTitle>
            )}
          </div>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-2">
          {nonEmptySections.length > 0 ? (
            nonEmptySections.map((section) => (
              <div key={section.heading} className="mb-2 last:mb-0">
                <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {section.heading}
                </div>
                <ul className="divide-y divide-card-border">
                  {section.kind === 'member'
                    ? section.rows.map((row) => (
                        <DrilldownMemberRowItem key={`${section.heading}-${row.username}`} row={row} />
                      ))
                    : section.rows.map((row) => (
                        <DrilldownRow
                          key={`${section.heading}-${row.link}-${row.winners?.[0]?.steamId ?? ''}`}
                          row={row}
                          hideNeverPlayedBadge={section.hideNeverPlayedBadge}
                          showWonRelativeTime={section.showWonRelativeTime}
                          showCreatedWonLabels={section.showCreatedWonLabels}
                        />
                      ))}
                </ul>
                {section.kind !== 'member' &&
                  section.notCountedRows &&
                  section.notCountedRows.length > 0 && (
                    <div className="mt-1">
                      <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
                        Not counted ({section.notCountedRows.length})
                      </div>
                      <ul className="divide-y divide-card-border">
                        {section.notCountedRows.map((row) => (
                          <DrilldownRow key={`${section.heading}-notcounted-${row.link}`} row={row} />
                        ))}
                      </ul>
                    </div>
                  )}
              </div>
            ))
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-8 text-center text-muted-foreground">
              <Inbox className="h-6 w-6 opacity-50" />
              <p className="text-sm">{emptyMessage ?? 'Nothing here.'}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
