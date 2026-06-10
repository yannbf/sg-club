'use client'

import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowRight,
  CalendarDays,
  Gift,
  PartyPopper,
  Sparkles,
  Trophy,
  Users as UsersIcon,
} from 'lucide-react'
import type { EventSummary } from '@/lib/events'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/cn'

/**
 * Compact "happening now" strip shown at the top of the dashboard. Renders
 * nothing when no events are live.
 */
export function OngoingEventsBanner({ events }: { events: EventSummary[] }) {
  if (events.length === 0) return null

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--success)] opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--success)]" />
        </span>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Events happening now
        </h2>
        <Link
          href="/events"
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary-hi hover:underline"
        >
          All events
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div
        className={cn(
          'grid grid-cols-1 gap-3',
          events.length > 1 && 'sm:grid-cols-2',
        )}
      >
        {events.map((e) => {
          const isChallenge = e.meta.kind === 'challenge'
          return (
            <Link key={e.meta.slug} href={`/events/${e.meta.slug}`} className="group block">
              <Card
                className="relative flex items-center gap-3 overflow-hidden p-3.5 transition-all hover:-translate-y-0.5 hover:border-card-border-strong hover:shadow-md"
                style={{
                  background: `linear-gradient(120deg, color-mix(in oklab, ${e.meta.accent} 12%, transparent), transparent 60%)`,
                }}
              >
                {e.meta.imageUrl ? (
                  <Image
                    src={e.meta.imageUrl}
                    alt={e.meta.name}
                    width={44}
                    height={44}
                    unoptimized
                    className="h-11 w-11 flex-shrink-0 rounded-xl object-cover ring-1 ring-card-border"
                  />
                ) : (
                  <span
                    className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-2xl ring-1 ring-card-border"
                    style={{
                      background: `color-mix(in oklab, ${e.meta.accent} 22%, var(--card-background))`,
                    }}
                    aria-hidden
                  >
                    {e.meta.emoji}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--success)]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-success-foreground">
                      Live
                    </span>
                    <p className="truncate text-sm font-semibold text-foreground">
                      {e.meta.name}
                    </p>
                  </div>
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    {isChallenge ? (
                      <span className="inline-flex items-center gap-1">
                        <UsersIcon className="h-3 w-3" />
                        {e.participantCount ?? 0} participants
                      </span>
                    ) : e.meta.kind === 'special' ? (
                      e.meta.match?.endsBetween ? (
                        <span className="inline-flex items-center gap-1">
                          <Gift className="h-3 w-3" />
                          {e.giveawayCount} giveaways
                        </span>
                      ) : e.meta.headlineStat ? (
                        <span className="inline-flex items-center gap-1">
                          <Sparkles className="h-3 w-3" />
                          {e.meta.headlineStat.value} {e.meta.headlineStat.label}
                        </span>
                      ) : null
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Gift className="h-3 w-3" />
                        {e.giveawayCount} giveaways
                      </span>
                    )}
                    <span className="truncate text-subtle">{e.meta.tagline}</span>
                  </p>
                </div>
                {isChallenge ? (
                  <Trophy className="h-4 w-4 flex-shrink-0 text-[var(--accent-yellow)]" />
                ) : e.meta.kind === 'special' ? (
                  <PartyPopper className="h-4 w-4 flex-shrink-0 text-[var(--accent-rose)]" />
                ) : (
                  <CalendarDays className="h-4 w-4 flex-shrink-0 text-subtle" />
                )}
              </Card>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
