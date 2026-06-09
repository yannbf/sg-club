'use client'

import Image from 'next/image'
import {
  Crown,
  Gift,
  Heart,
  Layers,
  Sparkles,
  Trophy,
  Users as UsersIcon,
} from 'lucide-react'
import type { EventMeta } from '@/lib/events'
import type { GameData, Giveaway } from '@/types'
import { GiveawayCard, getGameImageUrl } from '@/components/GiveawayCard'
import { StatCard } from '@/components/StatCard'
import { Card } from '@/components/ui/Card'
import { EventPageHeader } from './EventPageHeader'

const FALLBACK_AVATAR =
  'https://images.icon-icons.com/2550/PNG/512/question_mark_circle_icon_152550.png'

export interface EventLeader {
  name: string
  avatar: string | null
  count: number
}

interface EventStats {
  giveawayCount: number
  totalCopies: number
  totalEntries: number
  uniqueCreators: number
  winnersCount: number
  startTimestamp: number | null
  endTimestamp: number | null
  topCreator: EventLeader | null
  topWinner: EventLeader | null
}

function LeaderChip({
  label,
  icon: Icon,
  leader,
  unit,
}: {
  label: string
  icon: typeof Crown
  leader: EventLeader | null
  unit: string
}) {
  if (!leader) return null
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className="relative flex-shrink-0">
        <Image
          src={leader.avatar || FALLBACK_AVATAR}
          alt={leader.name}
          width={44}
          height={44}
          unoptimized
          className="h-11 w-11 rounded-full object-cover ring-2 ring-card-border"
        />
        <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-yellow)] text-[#1a1505]">
          <Icon className="h-3 w-3" />
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-sm font-semibold text-foreground">
          {leader.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {leader.count} {unit}
          {leader.count === 1 ? '' : 's'}
        </p>
      </div>
    </Card>
  )
}

export default function EventDetailClient({
  meta,
  giveaways,
  notableGiveaways,
  wishlistCountById,
  stats,
  nameByRaw,
  avatarByRaw,
  exByRaw,
  gameById,
}: {
  meta: EventMeta
  giveaways: Giveaway[]
  notableGiveaways: Giveaway[]
  wishlistCountById: Record<string, number>
  stats: EventStats
  nameByRaw: Record<string, string>
  avatarByRaw: Record<string, string>
  exByRaw: Record<string, boolean>
  gameById: Record<string, GameData>
}) {
  const now = Date.now() / 1000
  const isOngoing =
    stats.startTimestamp != null &&
    stats.endTimestamp != null &&
    now >= stats.startTimestamp &&
    now <= stats.endTimestamp

  const renderCard = (g: Giveaway) => {
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
  }

  return (
    <div className="mx-auto max-w-screen-xl space-y-8">
      <EventPageHeader
        meta={meta}
        startTimestamp={stats.startTimestamp}
        endTimestamp={stats.endTimestamp}
        isOngoing={isOngoing}
      />

      {/* Stats */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Giveaways"
          value={stats.giveawayCount.toLocaleString()}
          icon={Gift}
          accent="primary"
        />
        <StatCard
          label="Total entries"
          value={stats.totalEntries.toLocaleString()}
          icon={Layers}
          accent="blue"
          hint={`${stats.totalCopies.toLocaleString()} copies`}
        />
        <StatCard
          label="Creators"
          value={stats.uniqueCreators.toLocaleString()}
          icon={UsersIcon}
          accent="purple"
        />
        <StatCard
          label="Winners"
          value={stats.winnersCount.toLocaleString()}
          icon={Trophy}
          accent="amber"
        />
      </section>

      {/* Leaders */}
      {(stats.topCreator || stats.topWinner) && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <LeaderChip
            label="Most prolific creator"
            icon={Sparkles}
            leader={stats.topCreator}
            unit="giveaway"
          />
          <LeaderChip
            label="Most decorated winner"
            icon={Crown}
            leader={stats.topWinner}
            unit="win"
          />
        </section>
      )}

      {/* Notable giveaways (>25 wishlists), once the event is over — a compact
          horizontal carousel so it doesn't dominate the page. */}
      {notableGiveaways.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Heart className="h-5 w-5 text-[var(--accent-rose)]" />
            <h2 className="text-lg font-semibold text-foreground">
              Notable giveaways
            </h2>
            <span className="text-sm text-muted-foreground">
              {notableGiveaways.length} most-wishlisted drops
            </span>
          </div>
          <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
            {notableGiveaways.map((g) => (
              <a
                key={g.id}
                href={`https://www.steamgifts.com/giveaway/${g.link}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group/mini w-40 flex-shrink-0 snap-start sm:w-44"
                title={g.name}
              >
                <div className="relative aspect-[460/215] overflow-hidden rounded-lg bg-card-background-hover ring-1 ring-card-border transition-all group-hover/mini:ring-card-border-strong">
                  <Image
                    src={getGameImageUrl(g)}
                    alt={g.name || 'Game'}
                    fill
                    unoptimized
                    className="object-cover transition-transform group-hover/mini:scale-105"
                  />
                  <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-[var(--accent-rose)] px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm">
                    <Heart className="h-2.5 w-2.5 fill-current" />
                    {wishlistCountById[g.id]}
                  </span>
                  {/* Mini creator avatar (no name) so it's clear who made the drop. */}
                  <Image
                    src={avatarByRaw[g.creator] || FALLBACK_AVATAR}
                    alt={`Created by ${nameByRaw[g.creator] ?? g.creator}`}
                    title={`Created by ${nameByRaw[g.creator] ?? g.creator}`}
                    width={24}
                    height={24}
                    unoptimized
                    className="absolute bottom-1.5 left-1.5 h-6 w-6 rounded-full object-cover ring-2 ring-black/40"
                  />
                </div>
                <p className="mt-1.5 line-clamp-1 text-xs font-medium text-foreground group-hover/mini:text-accent">
                  {g.name}
                </p>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* All giveaways */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            All giveaways
          </h2>
          <span className="text-sm text-muted-foreground">
            {giveaways.length} total
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {giveaways.map(renderCard)}
        </div>
      </section>
    </div>
  )
}
