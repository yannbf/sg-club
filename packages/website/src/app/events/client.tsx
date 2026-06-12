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
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/cn'

function formatRange(start: number | null, end: number | null): string {
  if (!start) return 'Dates TBD'
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  const startDate = new Date(start * 1000)
  const startStr = startDate.toLocaleDateString('en-GB', {
    ...opts,
    year: 'numeric',
  })
  if (!end) return `Started ${startStr}`
  const endDate = new Date(end * 1000)
  const sameYear = startDate.getFullYear() === endDate.getFullYear()
  return `${startDate.toLocaleDateString('en-GB', sameYear ? opts : { ...opts, year: 'numeric' })} – ${endDate.toLocaleDateString('en-GB', { ...opts, year: 'numeric' })}`
}

function EventCard({
  event,
  featured = false,
}: {
  event: EventSummary
  featured?: boolean
}) {
  const { meta } = event
  const isChallenge = meta.kind === 'challenge'
  const isSpecial = meta.kind === 'special'

  return (
    <Link href={`/events/${meta.slug}`} className="group block h-full">
      <Card
        className={cn(
          'relative flex h-full flex-col overflow-hidden p-0 transition-all hover:-translate-y-0.5 hover:border-card-border-strong hover:shadow-lg',
          featured && 'ring-1 ring-[var(--primary)]/30',
        )}
        style={
          {
            // Subtle top accent bar via gradient overlay
          }
        }
      >
        {/* Accent header band */}
        <div
          className="relative flex items-center gap-3 px-5 pb-4 pt-5"
          style={{
            background: `linear-gradient(135deg, color-mix(in oklab, ${meta.accent} 16%, transparent), transparent 70%)`,
          }}
        >
          {meta.imageUrl ? (
            <Image
              src={meta.imageUrl}
              alt={meta.name}
              width={48}
              height={48}
              unoptimized
              className="h-12 w-12 flex-shrink-0 rounded-xl object-cover shadow-sm ring-1 ring-card-border"
            />
          ) : (
            <span
              className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-2xl shadow-sm ring-1 ring-card-border"
              style={{
                background: `color-mix(in oklab, ${meta.accent} 22%, var(--card-background))`,
              }}
              aria-hidden
            >
              {meta.emoji}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              {event.isOngoing &&
                (event.hasEnded ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--subtle)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Ended
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--success)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success-foreground">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--success)] opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
                    </span>
                    Live
                  </span>
                ))}
              <Badge
                variant={isChallenge ? 'primary' : isSpecial ? 'amber' : 'purple'}
                size="sm"
              >
                {isChallenge ? (
                  <>
                    <Trophy className="h-3 w-3" /> Challenge
                  </>
                ) : isSpecial ? (
                  <>
                    <PartyPopper className="h-3 w-3" /> Special
                  </>
                ) : (
                  <>
                    <Gift className="h-3 w-3" /> Monthly
                  </>
                )}
              </Badge>
            </div>
            <h3
              className={cn(
                'truncate font-semibold leading-tight text-foreground',
                featured ? 'text-lg' : 'text-base',
              )}
            >
              {meta.name}
            </h3>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarDays className="h-3 w-3" />
              {formatRange(event.startTimestamp, event.endTimestamp)}
            </p>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-3 px-5 pb-5">
          <p
            className={cn(
              'text-sm leading-relaxed text-muted-foreground',
              featured ? 'line-clamp-3' : 'line-clamp-2',
            )}
          >
            {meta.description}
          </p>

          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {isSpecial ? (
              meta.match?.endsBetween ? (
                <span className="inline-flex items-center gap-1">
                  <Gift className="h-3.5 w-3.5" />
                  <span className="font-semibold text-foreground">
                    {event.giveawayCount}
                  </span>{' '}
                  giveaways
                </span>
              ) : meta.headlineStat ? (
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span className="font-semibold text-foreground">
                    {meta.headlineStat.value}
                  </span>{' '}
                  {meta.headlineStat.label}
                </span>
              ) : meta.finale ? (
                <span className="inline-flex items-center gap-1">
                  <Trophy className="h-3.5 w-3.5" />
                  Grand finale{' '}
                  <span className="font-semibold text-foreground">
                    {meta.finale.label}
                  </span>
                </span>
              ) : null
            ) : isChallenge ? (
              <>
                <span className="inline-flex items-center gap-1">
                  <UsersIcon className="h-3.5 w-3.5" />
                  <span className="font-semibold text-foreground">
                    {event.participantCount ?? 0}
                  </span>{' '}
                  participants
                </span>
                {event.winnerCount != null ? (
                  event.winnerCount > 0 ? (
                    <span className="inline-flex items-center gap-1 text-[var(--accent-yellow)]">
                      <Trophy className="h-3.5 w-3.5" />
                      <span className="font-semibold">
                        {event.winnerCount}
                      </span>{' '}
                      reached 100%
                    </span>
                  ) : (
                    <span className="text-subtle">No finishers yet</span>
                  )
                ) : event.winnerUsername ? (
                  <span className="inline-flex items-center gap-1 text-[var(--accent-yellow)]">
                    <Trophy className="h-3.5 w-3.5" /> Winner:{' '}
                    <span className="font-semibold">{event.winnerUsername}</span>
                  </span>
                ) : (
                  <span className="text-subtle">No winner yet</span>
                )}
              </>
            ) : (
              <>
                <span className="inline-flex items-center gap-1">
                  <Gift className="h-3.5 w-3.5" />
                  <span className="font-semibold text-foreground">
                    {event.giveawayCount}
                  </span>{' '}
                  giveaways
                </span>
                <span className="inline-flex items-center gap-1">
                  <UsersIcon className="h-3.5 w-3.5" />
                  <span className="font-semibold text-foreground">
                    {event.uniqueCreators}
                  </span>{' '}
                  creators
                </span>
              </>
            )}
          </div>

          <span className="inline-flex items-center gap-1 text-sm font-medium text-primary-hi opacity-0 transition-opacity group-hover:opacity-100">
            View event
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </Card>
    </Link>
  )
}

export default function EventsClient({ events }: { events: EventSummary[] }) {
  const ongoing = events.filter((e) => e.isOngoing)
  const past = events.filter((e) => !e.isOngoing)

  return (
    <div className="mx-auto max-w-screen-xl space-y-10">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-6 w-6 text-primary-hi" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Events
          </h1>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
          Monthly giveaway events and community gaming challenges from The
          Giveaways Club. Jump into anything live, or browse the archive.
        </p>
      </header>

      {ongoing.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--success)] opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--success)]" />
            </span>
            <h2 className="text-lg font-semibold text-foreground">
              Happening now
            </h2>
          </div>
          <div
            className={cn(
              'grid grid-cols-1 gap-4',
              ongoing.length === 1 ? 'lg:grid-cols-2' : 'sm:grid-cols-2',
            )}
          >
            {ongoing.map((e) => (
              <EventCard key={e.meta.slug} event={e} featured />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">
          {ongoing.length > 0 ? 'Past events' : 'All events'}
        </h2>
        {past.length === 0 ? (
          <p className="text-sm text-muted-foreground">No past events yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {past.map((e) => (
              <EventCard key={e.meta.slug} event={e} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
