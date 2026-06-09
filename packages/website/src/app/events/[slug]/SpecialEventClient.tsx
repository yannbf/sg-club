'use client'

import {
  CalendarCheck,
  CheckCircle2,
  ExternalLink,
  Gift,
  PartyPopper,
  Sparkles,
  Trophy,
} from 'lucide-react'
import type { EventMeta } from '@/lib/events'
import type { GameData, Giveaway } from '@/types'
import { Card } from '@/components/ui/Card'
import { GiveawayCard } from '@/components/GiveawayCard'
import { cn } from '@/lib/cn'
import { EventPageHeader } from './EventPageHeader'

interface GiveawayProps {
  giveaways?: Giveaway[]
  currentCount?: number
  recordCount?: number
  nameByRaw?: Record<string, string>
  avatarByRaw?: Record<string, string>
  exByRaw?: Record<string, boolean>
  gameById?: Record<string, GameData>
}

function RecordProgress({
  current,
  record,
  recordLabel,
}: {
  current: number
  record: number
  recordLabel: string
}) {
  const beaten = current >= record && record > 0
  const pct = record > 0 ? Math.min(100, Math.round((current / record) * 100)) : 0
  const remaining = Math.max(0, record - current)

  return (
    <Card className="space-y-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            This June
          </p>
          <p className="mt-1 text-4xl font-bold leading-none tracking-tight text-primary-hi tabular-nums-strict">
            {current.toLocaleString()}
            <span className="ml-1 text-base font-medium text-muted-foreground">
              giveaways
            </span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Last year’s record · {recordLabel}
          </p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-2xl font-bold leading-none tracking-tight text-foreground tabular-nums-strict">
            <Trophy className="h-5 w-5 text-[var(--accent-yellow)]" />
            {record.toLocaleString()}
          </p>
        </div>
      </div>

      <div className="h-2.5 w-full overflow-hidden rounded-full bg-card-background-hover">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            beaten ? 'bg-[var(--success)]' : 'bg-[var(--primary)]',
          )}
          style={{ width: `${beaten ? 100 : pct}%` }}
        />
      </div>

      <p className="text-sm text-muted-foreground">
        {beaten ? (
          <span className="font-medium text-success-foreground">
            🎉 Record smashed! {current.toLocaleString()} vs{' '}
            {record.toLocaleString()} last year — a new TGC best.
          </span>
        ) : (
          <>
            <span className="font-semibold text-foreground">
              {remaining.toLocaleString()}
            </span>{' '}
            more {remaining === 1 ? 'giveaway' : 'giveaways'} to beat last year’s
            record of {record.toLocaleString()} ({pct}% there).
          </>
        )}
      </p>
    </Card>
  )
}

export default function SpecialEventClient({
  meta,
  giveaways,
  currentCount,
  recordCount,
  nameByRaw = {},
  avatarByRaw = {},
  exByRaw = {},
  gameById = {},
}: { meta: EventMeta } & GiveawayProps) {
  const now = Date.now() / 1000
  const isOngoing =
    meta.startTimestamp != null &&
    meta.endTimestamp != null &&
    now >= meta.startTimestamp &&
    now <= meta.endTimestamp

  const hasCommunityGoal =
    meta.howToContribute?.length || meta.rewardRule || meta.finale
  const hasGiveaways = giveaways != null

  return (
    <div className="mx-auto max-w-screen-xl space-y-8">
      <div className="mx-auto max-w-screen-md space-y-8">
        <EventPageHeader
          meta={meta}
          startTimestamp={meta.startTimestamp ?? null}
          endTimestamp={meta.endTimestamp ?? null}
          isOngoing={isOngoing}
        />

        {/* Record progress (giveaway-window events) */}
        {hasGiveaways && meta.recordWindow && (
          <RecordProgress
            current={currentCount ?? 0}
            record={recordCount ?? 0}
            recordLabel={meta.recordWindow.label}
          />
        )}

        {/* Community-goal content */}
        {hasCommunityGoal && (
          <div className="space-y-6">
            {meta.howToContribute && meta.howToContribute.length > 0 && (
              <Card className="space-y-4 p-6">
                <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <Gift className="h-5 w-5 text-primary-hi" />
                  {meta.howToTitle ?? 'How to contribute'}
                </h2>
                <ul className="space-y-2.5">
                  {meta.howToContribute.map((c) => (
                    <li key={c} className="flex items-start gap-2.5 text-sm">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--success)]" />
                      <span className="text-foreground">{c}</span>
                    </li>
                  ))}
                </ul>
                {meta.rewardRule && (
                  <div
                    className="flex items-start gap-3 rounded-lg p-4"
                    style={{
                      background: `color-mix(in oklab, ${meta.accent} 12%, transparent)`,
                    }}
                  >
                    <Sparkles
                      className="mt-0.5 h-5 w-5 flex-shrink-0"
                      style={{ color: meta.accent }}
                    />
                    <p className="text-sm leading-relaxed text-foreground">
                      {meta.rewardRule}
                    </p>
                  </div>
                )}
              </Card>
            )}

            {meta.finale && (
              <Card
                className="relative overflow-hidden p-6 text-center"
                style={{
                  background: `radial-gradient(120% 80% at 50% 0%, color-mix(in oklab, ${meta.accent} 16%, transparent) 0%, transparent 60%)`,
                }}
              >
                <div className="mb-1 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <CalendarCheck className="h-3.5 w-3.5" />
                  Grand Finale
                </div>
                <p
                  className="text-3xl font-bold tracking-tight"
                  style={{ color: meta.accent }}
                >
                  {meta.finale.label}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {meta.finale.subtitle ?? 'Join us for an epic Anniversary Gymkhana'}
                </p>
                {meta.finale.items && meta.finale.items.length > 0 && (
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {meta.finale.items.map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-card-border bg-card-background px-3 py-1 text-sm text-foreground"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                )}
                <p className="mx-auto mt-5 max-w-prose text-sm leading-relaxed text-muted-foreground">
                  {meta.finale.note ??
                    'Whether you create giveaways, clear your pending wins, or do both, every action brings us closer to breaking last year’s record. No one gets left behind this year. 🔥'}
                </p>
              </Card>
            )}
          </div>
        )}

        {/* Link-only event (anniversary train) */}
        {!hasCommunityGoal && !hasGiveaways && (
          <Card
            className="relative flex flex-col items-center gap-5 overflow-hidden p-8 text-center sm:p-10"
            style={{
              background: `radial-gradient(120% 80% at 50% 0%, color-mix(in oklab, ${meta.accent} 16%, transparent) 0%, transparent 60%)`,
            }}
          >
            <span
              className="flex h-16 w-16 items-center justify-center rounded-2xl text-4xl ring-1 ring-card-border"
              style={{
                background: `color-mix(in oklab, ${meta.accent} 22%, var(--card-background))`,
              }}
              aria-hidden
            >
              {meta.emoji}
            </span>
            {meta.headlineStat && (
              <div>
                <p
                  className="text-5xl font-bold tracking-tight"
                  style={{ color: meta.accent }}
                >
                  {meta.headlineStat.value}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {meta.headlineStat.label}
                </p>
              </div>
            )}
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
              All the action lived in a single SteamGifts thread. Hop over to
              browse the full train and relive the celebration.
            </p>
            {meta.websiteUrl && (
              <a
                href={meta.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5"
              >
                <PartyPopper className="h-4 w-4" />
                {meta.linkLabel ?? 'View the thread'}
                <ExternalLink className="h-4 w-4 opacity-80" />
              </a>
            )}
          </Card>
        )}
      </div>

      {/* Event giveaways list (full width) */}
      {hasGiveaways && giveaways!.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              June giveaways
            </h2>
            <span className="text-sm text-muted-foreground">
              {giveaways!.length} ending this month
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {giveaways!.map((g) => {
              const key = g.app_id ?? g.package_id
              return (
                <GiveawayCard
                  key={g.id}
                  giveaway={g}
                  creatorName={nameByRaw[g.creator] ?? g.creator}
                  creatorAvatar={avatarByRaw[g.creator]}
                  resolveWinnerName={(raw) => nameByRaw[raw] ?? raw}
                  resolveWinnerAvatar={(raw) => avatarByRaw[raw]}
                  resolveWinnerIsEx={(raw) => exByRaw[raw] ?? false}
                  game={key != null ? gameById[key] : undefined}
                />
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
