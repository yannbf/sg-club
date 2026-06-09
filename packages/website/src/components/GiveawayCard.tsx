'use client'

import * as React from 'react'
import Image from 'next/image'
import {
  Flame,
  Gamepad2,
  Globe2,
  Heart,
  Trash2,
  Users as UsersIcon,
} from 'lucide-react'
import type { Giveaway, GameData } from '@/types'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import UserAvatar from '@/components/UserAvatar'
import { UserLink } from '@/components/UserLink'
import FormattedDate from '@/components/FormattedDate'
import { CvStatusIndicator } from '@/components/CvStatusIndicator'
import { cn } from '@/lib/cn'

const PLACEHOLDER_IMAGE =
  'https://steamplayercount.com/theme/img/placeholder.svg'
const FALLBACK_AVATAR =
  'https://images.icon-icons.com/2550/PNG/512/question_mark_circle_icon_152550.png'

export function getGameImageUrl(giveaway: Giveaway): string {
  if (giveaway.app_id) {
    return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${giveaway.app_id}/header.jpg`
  }
  if (giveaway.package_id) {
    return `https://shared.akamai.steamstatic.com/store_item_assets/steam/subs/${giveaway.package_id}/header.jpg`
  }
  return PLACEHOLDER_IMAGE
}

function statusBadge(giveaway: Giveaway) {
  const now = Date.now() / 1000
  const isEnded = giveaway.end_timestamp < now
  const isFuture = giveaway.start_timestamp > now
  const hasWinners = giveaway.winners && giveaway.winners.length > 0
  // This badge sits on top of the game header image. The translucent Badge
  // variants (e.g. success-light) washed out over bright artwork and failed
  // contrast. A solid dark scrim with white text guarantees legibility over any
  // image (well above WCAG AA), and a colored status dot keeps the semantics.
  const [label, dot]: [string, string] = giveaway.deleted
    ? ['Deleted', 'var(--error)']
    : isFuture
      ? ['Not started', 'var(--accent-purple)']
      : !isEnded
        ? ['Open', 'var(--info)']
        : hasWinners
          ? ['Ended', 'var(--success)']
          : ['No winners', 'var(--warning)']
  return (
    <Badge
      size="sm"
      className="gap-1 border-transparent bg-black/75 text-white shadow-[0_1px_4px_rgba(0,0,0,0.55)] ring-1 ring-white/15 backdrop-blur-sm"
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: dot }}
        aria-hidden
      />
      {label}
    </Badge>
  )
}

function cardAccent(g: Giveaway): string {
  const now = Date.now() / 1000
  const isEnded = g.end_timestamp < now
  const isFuture = g.start_timestamp > now
  const hasWinners = g.winners && g.winners.length > 0
  if (g.deleted) return 'before:bg-[var(--error)]'
  if (isFuture) return 'before:bg-[var(--accent-purple)]'
  if (!isEnded) return 'before:bg-[var(--info)]'
  if (hasWinners) return 'before:bg-[var(--success)]'
  return 'before:bg-[var(--warning)]'
}

export interface GiveawayCardProps {
  giveaway: Giveaway
  /** Display name for the creator (resolved from steam_id where possible). */
  creatorName: string
  creatorAvatar?: string
  /** Resolves a winner's raw `name` (steam_id/username) to a display name. */
  resolveWinnerName?: (raw: string) => string
  resolveWinnerAvatar?: (raw: string) => string | undefined
  /** Whether a winner is an ex-member (shows an "ex" tag instead of a tomb icon). */
  resolveWinnerIsEx?: (raw: string) => boolean
  game?: GameData
}

/**
 * Self-contained giveaway card — the same visual design used on the Giveaways
 * page, but standalone (internal failed-image state) so it can be dropped into
 * any list (e.g. event detail pages).
 */
export function GiveawayCard({
  giveaway,
  creatorName,
  creatorAvatar,
  resolveWinnerName,
  resolveWinnerAvatar,
  resolveWinnerIsEx,
  game,
}: GiveawayCardProps) {
  const [imageFailed, setImageFailed] = React.useState(false)
  const now = Date.now() / 1000
  const isEnded = giveaway.end_timestamp < now
  const isFuture = giveaway.start_timestamp > now
  const imageUrl = imageFailed ? PLACEHOLDER_IMAGE : getGameImageUrl(giveaway)
  const hltb =
    game && 'hltb_main_story_hours' in game ? game.hltb_main_story_hours : null

  return (
    <Card
      className={cn(
        'group relative w-full overflow-hidden p-0 transition-all hover:border-card-border-strong hover:shadow-md',
        'before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:z-20 before:rounded-r-full',
        cardAccent(giveaway),
        giveaway.deleted && 'opacity-60',
      )}
    >
      <a
        href={`https://store.steampowered.com/${giveaway.app_id ? `app/${giveaway.app_id}` : `sub/${giveaway.package_id}`}`}
        target="_blank"
        rel="noopener noreferrer"
        className="relative block aspect-[460/215] bg-card-background-hover"
      >
        <Image
          src={imageUrl}
          alt={giveaway.name || 'Game'}
          fill
          unoptimized
          className="object-cover"
          onError={() => setImageFailed(true)}
        />
        <div className="absolute right-2 top-2">{statusBadge(giveaway)}</div>
      </a>

      <div className="space-y-2.5 p-3.5">
        <a
          href={`https://www.steamgifts.com/giveaway/${giveaway.link}`}
          target="_blank"
          rel="noopener noreferrer"
          className="line-clamp-2 text-sm font-semibold leading-snug text-foreground hover:text-accent hover:underline"
        >
          {giveaway.name}{' '}
          <span className="font-mono text-xs text-muted-foreground">
            ({giveaway.points}P)
          </span>
          <span className="ml-1 inline-flex align-middle">
            <CvStatusIndicator giveaway={giveaway} />
          </span>
        </a>

        <div className="flex items-center justify-between gap-2 text-xs">
          <UserLink
            username={creatorName}
            className="flex min-w-0 items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <UserAvatar
              src={creatorAvatar || FALLBACK_AVATAR}
              username={creatorName}
            />
            <span className="truncate">{creatorName}</span>
          </UserLink>
          <span
            className={cn(
              'flex-shrink-0 text-right',
              isFuture
                ? 'text-accent-purple'
                : isEnded
                  ? 'text-muted-foreground'
                  : 'font-medium text-foreground',
            )}
          >
            {isFuture ? 'Starts ' : isEnded ? 'Ended ' : 'Ends '}
            <FormattedDate timestamp={giveaway.end_timestamp} />
          </span>
        </div>

        <div className="tabular-nums-strict flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">
              {giveaway.entry_count}
            </span>{' '}
            entries
          </span>
          <span>·</span>
          <span>
            <span className="font-medium text-foreground">
              {giveaway.copies}
            </span>{' '}
            {giveaway.copies === 1 ? 'copy' : 'copies'}
          </span>
          {hltb != null && (
            <>
              <span>·</span>
              <span>
                <span className="font-medium text-foreground">{hltb}h</span> HLTB
              </span>
            </>
          )}
        </div>

        {(giveaway.deleted ||
          giveaway.region_restricted ||
          giveaway.required_play ||
          giveaway.event_type ||
          giveaway.is_shared ||
          giveaway.whitelist) && (
          <div className="flex flex-wrap gap-1">
            {giveaway.deleted && (
              <Badge variant="error" size="sm">
                <Trash2 className="h-3 w-3" /> Deleted
              </Badge>
            )}
            {giveaway.region_restricted && (
              <Badge variant="info" size="sm">
                <Globe2 className="h-3 w-3" /> Restricted
              </Badge>
            )}
            {giveaway.required_play && (
              <Badge variant="warning" size="sm">
                <Gamepad2 className="h-3 w-3" /> Play required
              </Badge>
            )}
            {giveaway.event_type && (
              <Badge variant="purple" size="sm">
                <Flame className="h-3 w-3" /> Event
              </Badge>
            )}
            {giveaway.is_shared && (
              <Badge variant="info" size="sm">
                <UsersIcon className="h-3 w-3" /> Shared
              </Badge>
            )}
            {giveaway.whitelist && (
              <Badge variant="info" size="sm">
                <Heart className="h-3 w-3" /> Whitelist
              </Badge>
            )}
          </div>
        )}

        {giveaway.winners && giveaway.winners.length > 0 && (
          <div className="border-t border-card-border pt-2">
            <p className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              Winners
            </p>
            <div className="flex flex-wrap gap-1">
              {giveaway.winners.map((winner, index) => {
                if (!winner.name) {
                  return (
                    <Badge key={index} variant="warning" size="sm">
                      Awaiting feedback
                    </Badge>
                  )
                }
                const display = resolveWinnerName
                  ? resolveWinnerName(winner.name)
                  : winner.name
                const avatar = resolveWinnerAvatar?.(winner.name)
                const isEx = resolveWinnerIsEx?.(winner.name) ?? false
                return (
                  <UserLink
                    key={index}
                    username={display}
                    className="inline-flex items-center gap-1.5 rounded-full border border-card-border bg-card-background-hover px-2 py-0.5 text-xs hover:border-card-border-strong"
                  >
                    <UserAvatar src={avatar || FALLBACK_AVATAR} username={display} />
                    <span>{display}</span>
                    {isEx && (
                      <span className="rounded-full bg-card-background px-1 text-[9px] font-medium uppercase tracking-wide text-subtle">
                        ex
                      </span>
                    )}
                  </UserLink>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
