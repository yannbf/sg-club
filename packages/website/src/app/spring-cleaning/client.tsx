'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowUpRight,
  Ban,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  Filter,
  Gamepad2,
  Gift,
  Heart,
  Scale,
  ShieldAlert,
  Sparkles,
  ThumbsUp,
  Trophy,
} from 'lucide-react'
import {
  FlagSeverity,
  SpringCleaningResult,
  AnalyzedUser,
  FlaggedGame,
  SectionResult,
  UserHighlights,
  RecentGiveaway,
  SpringCleaningEdition,
  SPRING_CLEANINGS,
} from '@/lib/spring-cleaning'
import { DiscordIcon } from '@/components/icons/DiscordIcon'
import { UserLink, steamGiftsProfile } from '@/components/UserLink'
import { LastUpdated } from '@/components/LastUpdated'
import FormattedDate from '@/components/FormattedDate'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/ToggleGroup'
import { cn } from '@/lib/cn'

interface Props {
  result: SpringCleaningResult
  edition: SpringCleaningEdition
  lastUpdated?: number | null
  /** Unix seconds when this edition was frozen. Present ⇒ historical snapshot. */
  frozenAt?: number | null
}

const severityBadge: Record<
  FlagSeverity,
  { variant: 'error' | 'warning' | 'outline'; label: string }
> = {
  expel: { variant: 'error', label: 'Expel' },
  warn: { variant: 'warning', label: 'Warn' },
  info: { variant: 'outline', label: 'Info' },
}

function Avatar({ user }: { user: { username: string; avatar_url: string } }) {
  return (
    <a
      href={steamGiftsProfile(user.username)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${user.username} on SteamGifts`}
      className="flex-shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {user.avatar_url ? (
        <Image
          src={user.avatar_url}
          alt={user.username}
          width={36}
          height={36}
          className="h-9 w-9 rounded-full ring-1 ring-card-border"
        />
      ) : (
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-card-background-hover text-sm font-bold text-muted-foreground ring-1 ring-card-border">
          {user.username[0]?.toUpperCase()}
        </div>
      )}
    </a>
  )
}

function GameChips({ games }: { games: FlaggedGame[] }) {
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1.5">
      {games.map((g) => (
        <li key={g.link}>
          <a
            href={g.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-card-border bg-card-background-hover/50 px-1.5 py-0.5 text-xs text-foreground transition-colors hover:border-card-border-strong hover:text-accent"
            title={g.note}
          >
            <Gamepad2 className="h-3 w-3 text-subtle" />
            <span className="max-w-[16rem] truncate">{g.name}</span>
            {g.note && (
              <span className="text-[10px] text-muted-foreground">· {g.note}</span>
            )}
            <ExternalLink className="h-2.5 w-2.5 text-subtle" />
          </a>
        </li>
      ))}
    </ul>
  )
}

function DiscordChip({ member }: { member?: boolean }) {
  if (member === undefined) return null
  return member ? (
    <Badge variant="discord" size="sm" title="In the community Discord server">
      <DiscordIcon className="h-3 w-3" />
      Discord
    </Badge>
  ) : (
    <Badge variant="outline" size="sm" title="Not in the community Discord server">
      <DiscordIcon className="h-3 w-3" />
      No Discord
    </Badge>
  )
}

function RecentLine({
  label,
  icon: Icon,
  item,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  item: RecentGiveaway | null
}) {
  if (!item) return null
  return (
    <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      <Icon className="h-3 w-3 shrink-0 text-subtle" />
      <span className="shrink-0">{label}:</span>
      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        className="truncate text-foreground hover:text-accent hover:underline"
      >
        {item.name}
      </a>
      <span className="shrink-0 text-subtle">
        · <FormattedDate timestamp={item.at} />
      </span>
    </p>
  )
}

function Highlights({
  highlights,
  ratio,
}: {
  highlights: UserHighlights
  ratio: number
}) {
  const { badges, createdCount, events, qualityGiven, playedBroCount, requiredPlay } =
    highlights
  const requiredTotal = requiredPlay.played + requiredPlay.notPlayed
  const hasContrib =
    createdCount > 0 ||
    events.length > 0 ||
    qualityGiven.length > 0 ||
    playedBroCount > 0 ||
    requiredTotal > 0
  if (badges.length === 0 && !hasContrib) return null

  return (
    <div className="mt-2 space-y-2">
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {badges.map((b) => (
            <Badge key={b} variant="success" size="sm">
              <ThumbsUp className="h-3 w-3" />
              {b}
            </Badge>
          ))}
        </div>
      )}
      {hasContrib && (
        <div className="rounded-md border border-card-border bg-success-light/20 p-2.5">
          <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-success-foreground">
            <ThumbsUp className="h-3 w-3" /> Contributions
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Gift className="h-3 w-3 text-subtle" />
              {createdCount} full-CV GA{createdCount === 1 ? '' : 's'} created
            </span>
            <span className="inline-flex items-center gap-1">
              <Scale className="h-3 w-3 text-subtle" />
              ratio {ratio.toFixed(2)}
            </span>
            {playedBroCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <Gamepad2 className="h-3 w-3 text-subtle" />
                {playedBroCount} “played, bro”
              </span>
            )}
            {requiredTotal > 0 && (
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-subtle" />
                {requiredPlay.played} play-required played
                {requiredPlay.notPlayed > 0 && (
                  <span className="text-warning-foreground">
                    , {requiredPlay.notPlayed} not played
                  </span>
                )}
              </span>
            )}
          </div>
          {events.length > 0 && (
            <div className="mt-2">
              <p className="text-[11px] text-muted-foreground">
                Group events contributed to:
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {events.map((e) => (
                  <Badge key={e.label} variant="outline" size="sm">
                    <CalendarDays className="h-3 w-3" />
                    {e.label}
                    <span className="text-subtle">
                      · {e.count} GA{e.count === 1 ? '' : 's'}
                    </span>
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {qualityGiven.length > 0 && (
            <div className="mt-2">
              <p className="text-[11px] text-muted-foreground">
                Quality games gifted:
              </p>
              <GameChips games={qualityGiven} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PriorityCard({ user }: { user: AnalyzedUser }) {
  const isExpel = user.classification === 'expel'
  return (
    <Card
      className={cn(
        'relative overflow-hidden p-4',
        'before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:z-10',
        isExpel ? 'before:bg-[var(--error)]' : 'before:bg-[var(--warning)]',
      )}
    >
      <div className="flex items-start gap-3">
        <Avatar user={user} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <UserLink
              username={user.username}
              className="truncate text-base font-semibold text-foreground hover:text-accent hover:underline"
            >
              {user.username}
            </UserLink>
            <Badge variant={isExpel ? 'error' : 'warning'} size="sm">
              {isExpel ? (
                <Ban className="h-3 w-3" />
              ) : (
                <AlertTriangle className="h-3 w-3" />
              )}
              {isExpel ? 'Expel candidate' : 'Warning'}
            </Badge>
            <DiscordChip member={user.discord_member} />
            {user.isDeleted && (
              <Badge variant="error" size="sm">
                Account deleted
              </Badge>
            )}
            <span
              className="ml-auto inline-flex items-center gap-1 rounded-md bg-card-background-hover px-2 py-0.5 text-xs font-semibold tabular-nums-strict text-muted-foreground"
              title="Cleanup priority score (sum of flag weights)"
            >
              score {user.score}
            </span>
          </div>

          {(user.memberSince != null || user.lastActiveAt != null) && (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {user.memberSince != null && (
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3 w-3 text-subtle" />
                  In TGC since <FormattedDate timestamp={user.memberSince} />
                </span>
              )}
              {user.lastActiveAt != null && (
                <span className="inline-flex items-center gap-1">
                  <Activity className="h-3 w-3 text-subtle" />
                  Last active <FormattedDate timestamp={user.lastActiveAt} />
                </span>
              )}
            </p>
          )}

          {(user.lastCreated || user.lastWon || user.lastEntered) && (
            <div className="mt-1.5 space-y-0.5">
              <RecentLine
                label="Last FCV GA created"
                icon={Gift}
                item={user.lastCreated}
              />
              <RecentLine label="Last GA won" icon={Trophy} item={user.lastWon} />
              <RecentLine
                label="Last GA entered"
                icon={Heart}
                item={user.lastEntered}
              />
            </div>
          )}

          <Highlights highlights={user.highlights} ratio={user.ratio} />

          <ul className="mt-3 space-y-2">
            {user.flags.map((flag) => {
              const sev = severityBadge[flag.severity]
              return (
                <li
                  key={flag.id}
                  className="rounded-md border border-card-border bg-card-background-hover/30 p-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={sev.variant} size="sm">
                      {sev.label}
                    </Badge>
                    <span className="text-sm font-medium text-foreground">
                      {flag.label}
                    </span>
                  </div>
                  {flag.detail && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {flag.detail}
                    </p>
                  )}
                  {flag.games && flag.games.length > 0 && (
                    <GameChips games={flag.games} />
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </Card>
  )
}

function SectionUserRow({
  user,
}: {
  user: SectionResult['users'][number]
}) {
  return (
    <li className="flex items-start gap-3 py-3">
      <Avatar user={user} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <UserLink
            username={user.username}
            className="font-medium text-foreground hover:text-accent hover:underline"
          >
            {user.username}
          </UserLink>
          <DiscordChip member={user.discord_member} />
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{user.detail}</p>
        {user.games && user.games.length > 0 && <GameChips games={user.games} />}
      </div>
    </li>
  )
}

function SectionCard({ section }: { section: SectionResult }) {
  const sev = severityBadge[section.severity]
  return (
    <Card id={section.id} className="scroll-mt-20">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Badge variant={sev.variant} size="sm">
              {sev.label}
            </Badge>
            {section.title}
            <span className="text-sm font-normal tabular-nums-strict text-muted-foreground">
              {section.users.length}
            </span>
          </CardTitle>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {section.description}
        </p>
      </CardHeader>
      <CardContent>
        {section.users.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No members match this criterion. 🎉
          </p>
        ) : (
          <ul className="divide-y divide-card-border">
            {section.users.map((u) => (
              <SectionUserRow key={u.steam_id} user={u} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function SummaryStat({
  label,
  value,
  accent,
  icon: Icon,
}: {
  label: string
  value: number
  accent: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className={cn('mt-1 text-3xl font-bold tabular-nums-strict', accent)}>
            {value}
          </p>
        </div>
        <div
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-md bg-card-background-hover',
            accent,
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </Card>
  )
}

type View = 'priority' | 'criteria'

export default function SpringCleaningClient({
  result,
  edition,
  lastUpdated,
  frozenAt,
}: Props) {
  const [view, setView] = useState<View>('priority')
  const [onlyExpel, setOnlyExpel] = useState(false)

  const priorityUsers = useMemo(() => {
    const all = [...result.expel, ...result.warn]
    return onlyExpel ? all.filter((u) => u.classification === 'expel') : all
  }, [result.expel, result.warn, onlyExpel])

  // Only ever show criteria that actually matched someone.
  const visibleSections = useMemo(
    () => result.sections.filter((s) => s.users.length > 0),
    [result.sections],
  )
  const hasExpel = result.expel.length > 0
  const hasWarn = result.warn.length > 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-accent-yellow" />
            <h1 className="font-display text-3xl font-bold tracking-tight">
              {edition.label}
            </h1>
          </div>
          {SPRING_CLEANINGS.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {[...SPRING_CLEANINGS]
                .sort((a, b) => b.year - a.year)
                .map((e) => (
                  <Link
                    key={e.slug}
                    href={`/spring-cleaning/${e.slug}`}
                    className={cn(
                      'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                      e.slug === edition.slug
                        ? 'border-transparent bg-card-background-hover text-foreground'
                        : 'border-card-border bg-card-background text-muted-foreground hover:border-card-border-strong hover:text-foreground',
                    )}
                  >
                    {e.year}
                  </Link>
                ))}
            </div>
          )}
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Members flagged for review across community-health signals — inactivity,
          play rate, proof-of-play, ratio, unplayed quality wins, and Discord
          presence. Use this to decide who to warn or expel.
        </p>
        {frozenAt != null ? (
          <div className="mt-2 flex items-center gap-2 rounded-md border border-card-border bg-card-background-hover/40 px-3 py-1.5 text-xs text-muted-foreground">
            <Archive className="h-3.5 w-3.5 text-subtle" />
            <span>
              Frozen snapshot — data as detected on{' '}
              <span className="font-medium text-foreground">
                <FormattedDate timestamp={frozenAt} />
              </span>
              . It won&apos;t change as members come, go, or fix their stats.
            </span>
          </div>
        ) : (
          lastUpdated && (
            <div className="mt-1 text-sm text-muted-foreground">
              <LastUpdated lastUpdatedDate={lastUpdated} />
            </div>
          )
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryStat
          label="Expel candidates"
          value={result.expel.length}
          accent="text-error-foreground"
          icon={Ban}
        />
        <SummaryStat
          label="Warning candidates"
          value={result.warn.length}
          accent="text-warning-foreground"
          icon={AlertTriangle}
        />
        <SummaryStat
          label="Flagged total"
          value={result.expel.length + result.warn.length}
          accent="text-foreground"
          icon={ShieldAlert}
        />
        <SummaryStat
          label="Members analyzed"
          value={result.totalAnalyzed}
          accent="text-muted-foreground"
          icon={Gamepad2}
        />
      </div>

      {/* Criteria jump links — only the ones with matches */}
      {visibleSections.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {visibleSections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="inline-flex items-center gap-1 rounded-full border border-card-border bg-card-background px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-card-border-strong hover:text-foreground"
            >
              {s.title}
              <span className="tabular-nums-strict text-subtle">
                {s.users.length}
              </span>
              <ArrowUpRight className="h-3 w-3" />
            </a>
          ))}
        </div>
      )}

      {/* View toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-card-border pt-4">
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(v) => v && setView(v as View)}
          size="sm"
        >
          <ToggleGroupItem value="priority">Priority ranking</ToggleGroupItem>
          <ToggleGroupItem value="criteria">By criterion</ToggleGroupItem>
        </ToggleGroup>
        {view === 'priority' && hasExpel && hasWarn && (
          <ToggleGroup
            type="single"
            value={onlyExpel ? 'expel' : 'all'}
            onValueChange={(v) => v && setOnlyExpel(v === 'expel')}
            size="sm"
          >
            <ToggleGroupItem value="all">All flagged</ToggleGroupItem>
            <ToggleGroupItem value="expel">Expel only</ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>

      {/* Body */}
      {view === 'priority' ? (
        priorityUsers.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-12 text-center">
            <Filter className="h-8 w-8 text-subtle" />
            <p className="text-sm text-muted-foreground">
              No members match this filter.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {priorityUsers.map((u) => (
              <PriorityCard key={u.steam_id} user={u} />
            ))}
          </div>
        )
      ) : (
        <div className="space-y-6">
          {visibleSections.map((s) => (
            <SectionCard key={s.id} section={s} />
          ))}
        </div>
      )}
    </div>
  )
}
