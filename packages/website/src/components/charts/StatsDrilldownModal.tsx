'use client'

import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, Gamepad2, Trophy } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/Dialog'
import { Badge } from '@/components/ui/Badge'
import GameImage from '@/components/GameImage'
import UserAvatar from '@/components/UserAvatar'
import { UserLink } from '@/components/UserLink'
import { CvStatusIndicator } from '@/components/CvStatusIndicator'
import { WinnerPlayProgress } from '@/components/WinnerPlayProgress'
import type { WinnerPlayStats } from '@/lib/winner-play-stats'
import { formatPlaytimeCompact } from '@/lib/data'
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
  /** False when the winner isn't a current group member (ex-member or non-group). */
  isGroupMember: boolean
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
  playtimeMinutes?: number
  achievementsUnlocked?: number
  achievementsTotal?: number
  neverPlayed?: boolean
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
}

function giveawayUrl(link: string): string {
  return `https://www.steamgifts.com/giveaway/${link}`
}

function DrilldownRow({ row }: { row: DrilldownGameRow }) {
  const hasAchievements = Boolean(row.achievementsTotal && row.achievementsTotal > 0)
  const achievementsCompleted =
    hasAchievements && (row.achievementsUnlocked ?? 0) >= row.achievementsTotal!

  const hasOwnPlayInfo =
    row.playtimeMinutes != null || hasAchievements || row.neverPlayed || row.unreleased

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

        {row.winners && row.winners.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {row.winners.map((winner) => (
              <div
                key={winner.steamId}
                className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground"
              >
                <UserAvatar
                  src={winner.avatarUrl || FALLBACK_AVATAR}
                  username={winner.displayName}
                />
                <span className="truncate">{winner.displayName}</span>
                {!winner.isGroupMember && (
                  <span className="flex-none text-[10px] uppercase tracking-wide text-subtle">
                    non-group
                  </span>
                )}
                {winner.playStats && <WinnerPlayProgress stats={winner.playStats} />}
              </div>
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
            {row.neverPlayed && !row.unreleased && (
              <Badge variant="error" size="sm">
                Never played
              </Badge>
            )}
            {row.playtimeMinutes != null && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Gamepad2 className="h-3 w-3" />
                {formatPlaytimeCompact(row.playtimeMinutes)}
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
    <li className="flex items-center gap-1.5 px-4 py-2">
      <UserAvatar src={row.avatarUrl || FALLBACK_AVATAR} username={row.username} />
      <UserLink
        username={row.username}
        className="truncate text-sm font-medium text-foreground hover:text-[var(--primary-hi)] hover:underline"
      >
        {row.username}
      </UserLink>
      {row.isExMember && (
        <span className="flex-none text-[10px] uppercase tracking-wide text-subtle">
          ex member
        </span>
      )}
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
                        <DrilldownRow key={`${section.heading}-${row.link}`} row={row} />
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
            <p className="px-4 py-2 text-sm text-muted-foreground">Nothing here.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
