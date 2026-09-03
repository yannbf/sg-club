'use client'

import * as React from 'react'
import { formatDistanceToNowStrict } from 'date-fns'
import GameImage from '@/components/GameImage'
import Tooltip from '@/components/Tooltip'
import { getFullDate } from '@/components/FormattedDate'
import { cn } from '@/lib/cn'

/**
 * The phone-sized giveaway row used by the Created and Won tabs below `md`,
 * where the desktop card's fixed 192px thumbnail leaves no room for anything
 * else. Three lines at most — identity, verdict, what's outstanding — and a
 * constant height whatever the tag load, so the list stays scannable.
 *
 * Desktop keeps its own card; these rows are only rendered inside `md:hidden`.
 */

export function LedgerRow({
  name,
  link,
  points,
  appId,
  packageId,
  fallbackUrl,
  titleSuffix,
  muted,
  className,
  children,
}: {
  name: string
  /** SteamGifts giveaway path, e.g. `OPkXn/sanabi`. */
  link: string
  points?: number | null
  appId?: number | string | null
  packageId?: number | string | null
  fallbackUrl?: string | null
  /** Small indicator rendered after the title, e.g. the CV asterisks. */
  titleSuffix?: React.ReactNode
  /** Deleted / invalid giveaways read back at reduced weight. */
  muted?: boolean
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-xl border border-card-border bg-card-background px-3 py-2.5',
        muted && 'opacity-70',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <GameImage
          appId={appId?.toString()}
          packageId={packageId?.toString()}
          fallbackUrl={fallbackUrl}
          name={name}
          className="w-16 rounded-md"
          rounded
        />
        <a
          href={`https://www.steamgifts.com/giveaway/${link}`}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-accent hover:underline"
        >
          {name}
        </a>
        {titleSuffix}
        {points != null && (
          <span className="tabular-nums-strict flex-shrink-0 font-mono text-[11.5px] text-muted-foreground">
            {points}P
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

/** One wrapping line of the row. */
export function LedgerLine({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {children}
    </div>
  )
}

const TONES = {
  ok: 'bg-success-light text-success-foreground',
  bad: 'bg-error-light text-error-foreground',
  warn: 'bg-warning-light text-warning-foreground',
  info: 'bg-info-light text-info-foreground',
  neutral: 'bg-card-background-hover text-muted-foreground ring-1 ring-card-border',
} as const

export function LedgerChip({
  tone = 'neutral',
  dot,
  title,
  children,
}: {
  tone?: keyof typeof TONES
  /** Status colour shown as a leading dot instead of tinting the whole chip. */
  dot?: string
  title?: string
  children: React.ReactNode
}) {
  const chip = (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold leading-relaxed',
        TONES[tone],
      )}
    >
      {dot && (
        <span
          className="h-1.5 w-1.5 flex-none rounded-full"
          style={{ background: dot }}
          aria-hidden
        />
      )}
      {children}
    </span>
  )
  return title ? <Tooltip content={title}>{chip}</Tooltip> : chip
}

/** Playtime, achievements and the like — icons carry the meaning, digits align. */
export function LedgerStats({ children }: { children: React.ReactNode }) {
  return (
    <span className="tabular-nums-strict inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {children}
    </span>
  )
}

export function LedgerSep() {
  return (
    <span className="text-subtle" aria-hidden>
      ·
    </span>
  )
}

export interface LedgerAttr {
  emoji: string
  label: string
}

/**
 * Giveaway attributes — restricted, shared, whitelist, play required — collapse
 * into a single pill of icons. Five of them cost the width of one word instead
 * of a second line of chips, and each keeps its label on press or hover.
 */
export function LedgerAttrs({ attrs }: { attrs: LedgerAttr[] }) {
  if (attrs.length === 0) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-card-background-hover px-1.5 py-0.5 text-[11px] leading-relaxed ring-1 ring-card-border">
      {attrs.map((attr) => (
        <Tooltip key={attr.label} content={attr.label}>
          <span aria-label={attr.label}>{attr.emoji}</span>
        </Tooltip>
      ))}
    </span>
  )
}

/**
 * Right-aligned age of the row: "2mo ago", "in 1d". Deliberately terse — at 267px
 * of usable width, "about 2 months ago" is the difference between one line and
 * two. The full date is one press away.
 */
export function LedgerWhen({ timestamp }: { timestamp: number }) {
  const date = new Date(timestamp * 1000)
  const distance = formatDistanceToNowStrict(date)
    .replace(/ seconds?/, 's')
    .replace(/ minutes?/, 'm')
    .replace(/ hours?/, 'h')
    .replace(/ days?/, 'd')
    .replace(/ months?/, 'mo')
    .replace(/ years?/, 'y')
  const future = timestamp * 1000 > Date.now()
  return (
    <Tooltip content={getFullDate(timestamp)}>
      <span className="tabular-nums-strict ml-auto whitespace-nowrap text-[11px] text-subtle">
        {future ? `in ${distance}` : `${distance} ago`}
      </span>
    </Tooltip>
  )
}
