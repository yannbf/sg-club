'use client'

import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowLeft,
  CalendarDays,
  ExternalLink,
  Gift,
  Globe,
  PartyPopper,
  Trophy,
} from 'lucide-react'
import type { EventMeta } from '@/lib/events'
import { Badge } from '@/components/ui/Badge'

function formatRange(start: number | null, end: number | null): string {
  if (!start) return 'Dates TBD'
  const opts: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }
  const startStr = new Date(start * 1000).toLocaleDateString('en-GB', opts)
  if (!end) return `Started ${startStr}`
  return `${startStr} – ${new Date(end * 1000).toLocaleDateString('en-GB', opts)}`
}

export function EventPageHeader({
  meta,
  startTimestamp,
  endTimestamp,
  isOngoing,
  children,
}: {
  meta: EventMeta
  startTimestamp: number | null
  endTimestamp: number | null
  isOngoing?: boolean
  /** Optional extra content rendered under the description (e.g. winner banner). */
  children?: React.ReactNode
}) {
  const isChallenge = meta.kind === 'challenge'
  const isSpecial = meta.kind === 'special'

  return (
    <header className="relative overflow-hidden rounded-2xl border border-card-border bg-card-background">
      {/* Accent glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(120% 80% at 0% 0%, color-mix(in oklab, ${meta.accent} 18%, transparent) 0%, transparent 55%)`,
        }}
        aria-hidden
      />
      <div className="relative space-y-5 p-6 sm:p-8">
        <Link
          href="/events"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          All events
        </Link>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {meta.imageUrl ? (
            <Image
              src={meta.imageUrl}
              alt={meta.name}
              width={64}
              height={64}
              unoptimized
              className="h-16 w-16 flex-shrink-0 rounded-2xl object-cover shadow-sm ring-1 ring-card-border"
            />
          ) : (
            <span
              className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl text-4xl shadow-sm ring-1 ring-card-border"
              style={{
                background: `color-mix(in oklab, ${meta.accent} 22%, var(--card-background))`,
              }}
              aria-hidden
            >
              {meta.emoji}
            </span>
          )}

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {isOngoing && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--success)]/15 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-success-foreground">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--success)] opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--success)]" />
                  </span>
                  Live now
                </span>
              )}
              <Badge
                variant={isChallenge ? 'primary' : isSpecial ? 'amber' : 'purple'}
                size="md"
              >
                {isChallenge ? (
                  <>
                    <Trophy className="h-3.5 w-3.5" /> Gaming Challenge
                  </>
                ) : isSpecial ? (
                  <>
                    <PartyPopper className="h-3.5 w-3.5" /> Special Event
                  </>
                ) : (
                  <>
                    <Gift className="h-3.5 w-3.5" /> Monthly Event
                  </>
                )}
              </Badge>
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {meta.name}
            </h1>

            {meta.tagline && (
              <p
                className="text-sm font-medium"
                style={{ color: meta.accent }}
              >
                {meta.tagline}
              </p>
            )}

            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarDays className="h-4 w-4" />
              {formatRange(startTimestamp, endTimestamp)}
            </p>

            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              {meta.description}
            </p>

            {/* Only monthly giveaway events show the inline website link;
                challenges have none and special events render their own CTA. */}
            {meta.kind === 'giveaway' && (
              <div className="pt-1">
                {meta.websiteUrl ? (
                  <a
                    href={meta.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border border-card-border bg-card-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-card-background-hover"
                  >
                    <Globe className="h-4 w-4" />
                    Event website
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </a>
                ) : (
                  <span
                    className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-dashed border-card-border px-3 py-1.5 text-sm font-medium text-subtle"
                    title="A link will be added here later"
                  >
                    <Globe className="h-4 w-4" />
                    Event website coming soon
                  </span>
                )}
              </div>
            )}

            {children}
          </div>
        </div>
      </div>
    </header>
  )
}
