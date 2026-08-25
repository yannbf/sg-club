'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  Gamepad2,
  HelpCircle,
  Loader2,
  MessageSquare,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import type {
  IpbCardId,
  IpbSummary,
  PlayRequiredRow,
  PlayRequiredSummary,
  PrCardId,
  VerifyOverrideMap,
  VerifyOverrideState,
} from '@/lib/beaten'
import {
  applyVerifyOverrides,
  BEATEN_VERDICT_ORDER,
  matchesIpbCard,
  matchesPrCard,
  parseVerifyOverrides,
  pruneVerifyOverrides,
  summarizeIpbRows,
  summarizeRows,
  VERIFY_OVERRIDES_STORAGE_KEY,
  verifyOverrideKey,
} from '@/lib/beaten'
import type { IpbDiscordUnmatchedThread } from '@/types/ipb-discord'
import type { BeatenGameMarker } from '@/types/beaten'
import { formatPlaytimeCompact } from '@/lib/data'
import { getStoredAdminPassword, verifyAdminPasswordHash } from '@/lib/auth'
import { UserLink } from '@/components/UserLink'
import UserAvatar from '@/components/UserAvatar'
import GameImage from '@/components/GameImage'
import FormattedDate from '@/components/FormattedDate'
import Tooltip from '@/components/Tooltip'
import { LastUpdated } from '@/components/LastUpdated'
import { DeadlineStatus } from '@/components/DeadlineStatus'
import { StatCard } from '@/components/StatCard'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Toolbar } from '@/components/ui/Toolbar'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/ToggleGroup'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { useDebounce } from '@/lib/hooks'
import { cn } from '@/lib/cn'

interface Props {
  rows: PlayRequiredRow[]
  summary: PlayRequiredSummary
  ipbSummary: IpbSummary
  beatenDataAvailable: boolean
  beatenLastUpdated: string | null
  lastUpdated: string | null
  unmatchedDiscordThreads: IpbDiscordUnmatchedThread[]
}

type Tab = 'play_required' | 'ipb'

/** Maps the internal tab id to/from the `?tab=` query param value. */
const TAB_TO_PARAM: Record<Tab, string> = { play_required: 'play-required', ipb: 'ipb' }
const PARAM_TO_TAB: Record<string, Tab> = { 'play-required': 'play_required', ipb: 'ipb' }

/** Reads the current tab from `window.location.search`; missing/invalid falls back to `ipb`. */
function readTabFromLocation(): Tab {
  if (typeof window === 'undefined') return 'ipb'
  const raw = new URLSearchParams(window.location.search).get('tab')
  return (raw && PARAM_TO_TAB[raw]) || 'ipb'
}

/**
 * Returns the admin password for /api/verify calls — captured at admin login,
 * so a logged-in admin is never re-prompted. Falls back to a one-time prompt
 * (validated against the client-side hash, then stored for the session) for
 * sessions that logged in before the password started being kept.
 */
async function getAdminPassword(): Promise<string | null> {
  const stored = getStoredAdminPassword()
  if (stored) return stored

  const entered = window.prompt('Enter the admin password to verify this win:')
  if (!entered) return null
  if (!(await verifyAdminPasswordHash(entered))) {
    window.alert('Incorrect password.')
    return null
  }
  try {
    localStorage.setItem('sg-club-admin-secret', entered)
  } catch {}
  return entered
}

type SortKey =
  | 'game'
  | 'winner'
  | 'won'
  | 'submitted'
  | 'playtime'
  | 'achievements'
  | 'beaten'
  | 'signoff'
  | 'status'
type SortDir = 'asc' | 'desc'

const IPB_STATUS_ORDER: readonly PlayRequiredRow['ipbStatus'][] = [
  'verified',
  'submitted',
  'not_submitted',
]

const typeLabel: Record<PlayRequiredRow['type'], string> = {
  required_play: 'Play Required',
  i_played_bro: 'I Played Bro',
  both: 'PR + IPB',
}

const typeVariant: Record<PlayRequiredRow['type'], 'primary' | 'purple' | 'amber'> = {
  required_play: 'primary',
  i_played_bro: 'purple',
  both: 'amber',
}

function sgGiveawayUrl(link: string) {
  return `https://www.steamgifts.com/giveaway/${link}`
}

/** Discord's snowflake epoch (2015-01-01T00:00:00.000Z) baked into every id — see discordSnowflakeDate. */
const DISCORD_EPOCH_MS = BigInt(1420070400000)

/** Extracts the creation timestamp embedded in a Discord snowflake id. */
function discordSnowflakeDate(id: string): Date {
  return new Date(Number((BigInt(id) >> BigInt(22)) + DISCORD_EPOCH_MS))
}

const PLAY_REQUIRED_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1h20q3RPeYTDwL_hl3uWEq6SSRbSlsHJW3VhN538oP3A/edit#gid=2065024481'

function steamAchievementsUrl(steamId: string, appId: number) {
  return `https://steamcommunity.com/profiles/${steamId}/stats/${appId}/achievements`
}

/** The game's global achievement stats page (unlock rates across all Steam owners). */
function steamGlobalStatsUrl(appId: number) {
  return `https://steamcommunity.com/stats/${appId}/achievements`
}

/** Steam Hunters' achievements page for a game, or the specific marker achievement when known. */
function steamHuntersUrl(appId: number, marker: BeatenGameMarker | null) {
  if (marker?.sh_achievement_id != null) {
    return `https://steamhunters.com/apps/${appId}/achievements/${marker.sh_achievement_id}`
  }
  return `https://steamhunters.com/apps/${appId}/achievements`
}

/**
 * App id to use for the winner's Steam achievements page — the beaten-games
 * pipeline's resolved base-game app id when the giveaway's app id is a DLC,
 * otherwise the giveaway's own app id.
 */
function achievementsAppId(row: PlayRequiredRow): number | null {
  return row.beaten.resolvedAppId ?? row.game.appId
}

/** Wraps `children` in a link to the winner's Steam achievements page, when the app id is known. */
function AchievementsLink({
  row,
  children,
}: {
  row: PlayRequiredRow
  children: React.ReactNode
}) {
  const appId = achievementsAppId(row)
  if (appId == null) return <>{children}</>
  return (
    <a
      href={steamAchievementsUrl(row.winner.steamId, appId)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block hover:opacity-80"
    >
      {children}
    </a>
  )
}

/** Small "(?)" link to the marker (or game) achievements page on Steam Hunters, next to a Beaten badge. */
function SteamHuntersLink({ row }: { row: PlayRequiredRow }) {
  const appId = achievementsAppId(row)
  if (appId == null) return null
  return (
    <a
      href={steamHuntersUrl(appId, row.beaten.marker)}
      target="_blank"
      rel="noopener noreferrer"
      title="View on Steam Hunters"
      className="ml-1 inline-flex items-center text-subtle hover:text-accent"
    >
      <HelpCircle className="h-3 w-3" />
    </a>
  )
}

/** "Stats last checked X ago" tooltip content for the Playtime/Achievements cells. */
function lastCheckedTooltip(lastChecked: number | undefined): string | null {
  if (!lastChecked) return null
  return `Stats last checked ${formatDistanceToNow(new Date(lastChecked), { addSuffix: true })}`
}

function BeatenBadge({ row }: { row: PlayRequiredRow }) {
  const { beaten } = row
  switch (beaten.verdict) {
    case 'beaten_verified':
      return (
        <div className="space-y-0.5">
          <div className="flex items-center">
            <AchievementsLink row={row}>
              <Badge variant="success" size="sm">
                <CheckCircle2 className="h-3 w-3" />
                Beaten — {beaten.marker?.name}
                {beaten.marker?.global_percent != null && (
                  <span className="text-subtle">
                    {' '}
                    ({beaten.marker.global_percent.toFixed(1)}%)
                  </span>
                )}
              </Badge>
            </AchievementsLink>
            <SteamHuntersLink row={row} />
          </div>
          {beaten.unlockTime != null && (
            <p className="text-[11px] text-muted-foreground">
              unlocked <FormattedDate timestamp={beaten.unlockTime} />
            </p>
          )}
        </div>
      )
    case 'not_beaten':
      return (
        <div className="flex items-center">
          <AchievementsLink row={row}>
            <Tooltip
              content={`The winner has not unlocked "${beaten.marker?.name}"${
                beaten.marker?.description ? ` (${beaten.marker.description})` : ''
              } — the achievement that marks finishing this game${
                beaten.marker?.global_percent != null
                  ? `, unlocked by ${beaten.marker.global_percent.toFixed(1)}% of players`
                  : ''
              }. Click to open their achievements page.${
                beaten.checkedAt
                  ? ` Checked ${formatDistanceToNow(new Date(beaten.checkedAt), { addSuffix: true })} — a very recent unlock may not show yet.`
                  : ''
              }`}
            >
              <Badge variant="error" size="sm">
                <XCircle className="h-3 w-3" />
                Marker not unlocked
              </Badge>
            </Tooltip>
          </AchievementsLink>
          <SteamHuntersLink row={row} />
        </div>
      )
    case 'no_marker':
      return (
        <div className="flex items-center">
          <Tooltip content={`Reason: ${beaten.noMarkerReason ?? 'unknown'}`}>
            <Badge variant="outline" size="sm">
              Couldn&apos;t automatically check
            </Badge>
          </Tooltip>
          <SteamHuntersLink row={row} />
        </div>
      )
    case 'no_data':
      return (
        <Tooltip content={`Reason: ${beaten.noDataReason ?? 'unknown'}`}>
          <Badge variant="outline" size="sm">
            <HelpCircle className="h-3 w-3" />
            Couldn&apos;t read player data
          </Badge>
        </Tooltip>
      )
    case 'package_only':
      return (
        <Badge variant="outline" size="sm">
          Package — not supported
        </Badge>
      )
    case 'pending':
    default:
      return (
        <Badge variant="outline" size="sm">
          Pending
        </Badge>
      )
  }
}

/** "Verified just now — site data refreshes within a few hours" cue for a row whose badge reflects a pending localStorage override rather than the committed JSON yet. */
function pendingSyncTooltip(state: VerifyOverrideState): string {
  return state === 'verified'
    ? 'Verified just now — site data refreshes within a few hours'
    : 'Unverified just now — site data refreshes within a few hours'
}

function IpbStatusBadge({
  status,
  pendingSync,
}: {
  status: PlayRequiredRow['ipbStatus']
  pendingSync?: VerifyOverrideState
}) {
  const badge = (() => {
    switch (status) {
      case 'verified':
        return (
          <Badge variant="success" size="sm">
            <ShieldCheck className="h-3 w-3" />
            Verified
          </Badge>
        )
      case 'submitted':
        return (
          <Badge variant="warning" size="sm">
            <Clock className="h-3 w-3" />
            Submitted
          </Badge>
        )
      case 'not_submitted':
        return (
          <Badge variant="outline" size="sm">
            <AlertTriangle className="h-3 w-3" />
            Not submitted
          </Badge>
        )
    }
  })()
  return pendingSync ? <Tooltip content={pendingSyncTooltip(pendingSync)}>{badge}</Tooltip> : badge
}

function LinksCell({ row }: { row: PlayRequiredRow }) {
  if (!row.discord) return <span className="text-xs text-subtle">—</span>
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={row.discord.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[11px] font-medium text-[#5865F2] hover:underline dark:text-[#A5AEFF]"
      >
        <MessageSquare className="h-3 w-3" />
        Discord
      </a>
      {row.discord.review_url && (
        <a
          href={row.discord.review_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          Review
        </a>
      )}
    </div>
  )
}

function SignOffCell({ row, pendingSync }: { row: PlayRequiredRow; pendingSync?: VerifyOverrideState }) {
  const { attestation, discord } = row
  if (attestation.confirmed) {
    const parts: string[] = []
    if (attestation.iPlayedBro) parts.push('I played, bro')
    if (attestation.requirementsMet) parts.push('play requirement met')
    const badge = (
      <Badge variant="success" size="sm">
        <ShieldCheck className="h-3 w-3" />
        Verified{parts.length > 0 ? ` — ${parts.join(', ')}` : ''}
      </Badge>
    )
    return pendingSync ? <Tooltip content={pendingSyncTooltip(pendingSync)}>{badge}</Tooltip> : badge
  }
  return (
    <div className="space-y-1">
      {pendingSync ? (
        <Tooltip content={pendingSyncTooltip(pendingSync)}>
          <Badge variant="warning" size="sm">
            <AlertTriangle className="h-3 w-3" />
            Not verified
          </Badge>
        </Tooltip>
      ) : (
        <Badge variant="warning" size="sm">
          <AlertTriangle className="h-3 w-3" />
          Not verified
        </Badge>
      )}
      {attestation.requiredPlay && (
        <div>
          <DeadlineStatus
            endTimestamp={row.endTimestamp}
            deadlineInMonths={attestation.deadlineInMonths}
            deadline={attestation.deadline}
            tagLabel="deadline"
          />
        </div>
      )}
      {discord && (
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={discord.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[#5865F2] hover:underline dark:text-[#A5AEFF]"
          >
            <MessageSquare className="h-3 w-3" />
            Discord
          </a>
          {discord.review_url && (
            <a
              href={discord.review_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Review
            </a>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Sign-off cell for a Play Required row that has no PLAY_REQUIRED sheet row
 * yet (`!row.prRegistered`) — the site's verify flow has nothing to update
 * until a mod adds one, so this replaces the usual Verify button with an
 * "Add to sheet" action that appends the identity columns only.
 */
function NotInSheetCell({
  row,
  state,
  onRegister,
}: {
  row: PlayRequiredRow
  state: VerifyState | undefined
  onRegister: (row: PlayRequiredRow) => void
}) {
  if (state?.status === 'verifying' && state.action === 'register') {
    return (
      <div className="space-y-1.5">
        <Badge variant="outline" size="sm">
          <FileSpreadsheet className="h-3 w-3" />
          Not in sheet
        </Badge>
        <Button size="sm" variant="outline" disabled>
          <Loader2 className="h-3 w-3 animate-spin" />
          Adding…
        </Button>
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      <Badge variant="outline" size="sm">
        <FileSpreadsheet className="h-3 w-3" />
        Not in sheet
      </Badge>
      <div>
        <Button size="sm" variant="outline" onClick={() => onRegister(row)}>
          <FileSpreadsheet className="h-3 w-3" />
          Add to sheet
        </Button>
      </div>
      {state?.status === 'error' && state.action === 'register' && (
        <p className="max-w-[16rem] text-[11px] text-error-foreground">{state.message}</p>
      )}
    </div>
  )
}

/**
 * Renders the Play Required sign-off cell: the "Add to sheet" flow for a
 * row not yet in the PLAY_REQUIRED tab, otherwise the usual sign-off badge
 * plus Verify/Unverify controls, with a one-time "just registered" note
 * layered on top when this session is what registered it.
 */
function PlayRequiredSignOffColumn({
  row,
  verifyStates,
  verifyOverrides,
  onAction,
}: {
  row: PlayRequiredRow
  verifyStates: Record<string, VerifyState>
  verifyOverrides: VerifyOverrideMap
  onAction: (row: PlayRequiredRow, type: 'ipb' | 'play_required', action: VerifyActionKind) => void
}) {
  const stateKey = verifyStateKey(row, 'play_required')
  const state = verifyStates[stateKey]
  const registerState = state?.action === 'register' ? state : undefined
  const verifyOrUnverifyState = state?.action !== 'register' ? state : undefined
  const pendingSync = verifyOverrides[verifyOverrideKey(row.key, 'play_required')]?.state

  if (!row.prRegistered) {
    return (
      <NotInSheetCell
        row={row}
        state={registerState}
        onRegister={(r) => onAction(r, 'play_required', 'register')}
      />
    )
  }

  return (
    <>
      {registerState?.status === 'done' && (
        <p className="mb-1 max-w-[16rem] text-[11px] text-success-foreground">
          {registerState.message}{' '}
          <a
            href={PLAY_REQUIRED_SHEET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Open the sheet
          </a>
          .
        </p>
      )}
      <SignOffCell row={row} pendingSync={pendingSync === 'registered' ? undefined : pendingSync} />
      <VerifiedControls
        row={row}
        type="play_required"
        isVerified={row.attestation.confirmed}
        state={verifyOrUnverifyState}
        onAction={onAction}
      />
    </>
  )
}

function GameCell({ row }: { row: PlayRequiredRow }) {
  const statsAppId = achievementsAppId(row)
  const image = (
    <GameImage
      appId={row.game.appId}
      packageId={row.game.packageId}
      fallbackUrl={row.game.headerImageUrl}
      name={row.game.name}
      width={92}
      height={43}
      className="!w-[92px] flex-shrink-0"
      rounded
      link={false}
    />
  )
  return (
    <div className="flex items-center gap-3">
      {statsAppId != null ? (
        <a
          href={steamGlobalStatsUrl(statsAppId)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 hover:opacity-80"
        >
          {image}
        </a>
      ) : (
        image
      )}
      <div className="min-w-0">
        <a
          href={sgGiveawayUrl(row.giveawayLink)}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-sm font-medium text-foreground hover:text-accent hover:underline"
        >
          {row.game.name}
        </a>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {row.game.hltbMainStoryHours != null && (
            <p className="text-[11px] text-muted-foreground">
              HLTB main story: {row.game.hltbMainStoryHours}h
            </p>
          )}
          {row.game.unreleased && (
            <Tooltip
              content={
                row.game.releaseDate
                  ? `Announced release: ${row.game.releaseDate}`
                  : 'No release date announced'
              }
            >
              <Badge variant="amber" size="sm">
                Unreleased
              </Badge>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}

function WinnerCell({ row }: { row: PlayRequiredRow }) {
  return (
    <div className="flex items-center gap-2">
      <UserLink
        username={row.winner.username}
        className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-accent hover:underline"
      >
        {row.winner.avatarUrl && (
          <UserAvatar src={row.winner.avatarUrl} username={row.winner.username} />
        )}
        {row.winner.username}
      </UserLink>
      {row.winner.isExMember && (
        <Badge variant="outline" size="sm">
          ex-member
        </Badge>
      )}
    </div>
  )
}

function PlaytimeCell({ row }: { row: PlayRequiredRow }) {
  const { steam, game } = row
  const checkedTooltip = lastCheckedTooltip(steam.lastChecked)

  if (steam.hasNoAvailableStats) {
    return (
      <span className="text-xs text-muted-foreground">
        {steam.noStatsReason ?? 'no stats'}
      </span>
    )
  }
  if (steam.isPlaytimePrivate) {
    const content = [
      "Playtime is hidden by the user's privacy settings; achievements may still be readable",
      checkedTooltip,
    ]
      .filter(Boolean)
      .join(' — ')
    return (
      <Tooltip content={content}>
        <span className="text-xs text-muted-foreground">Private</span>
      </Tooltip>
    )
  }
  if (steam.playtimeMinutes == null) {
    return <span className="text-xs text-subtle">—</span>
  }
  const meetsHltb =
    game.hltbMainStoryHours != null &&
    game.hltbMainStoryHours > 0 &&
    steam.playtimeMinutes >= game.hltbMainStoryHours * 60
  const cellContent = (
    <div className="text-xs">
      <span
        className={cn(
          'font-medium tabular-nums-strict',
          meetsHltb ? 'text-success-foreground' : 'text-foreground',
        )}
      >
        {formatPlaytimeCompact(steam.playtimeMinutes)}
      </span>
      {game.hltbMainStoryHours != null && (
        <span className="text-muted-foreground"> / {game.hltbMainStoryHours}h</span>
      )}
      {steam.isPotentiallyIdling && (
        <p className="text-[10px] text-warning-foreground">possibly idling</p>
      )}
    </div>
  )
  return checkedTooltip ? <Tooltip content={checkedTooltip}>{cellContent}</Tooltip> : cellContent
}

function AchievementsCell({ row }: { row: PlayRequiredRow }) {
  const { steam } = row
  const checkedTooltip = lastCheckedTooltip(steam.lastChecked)

  if (steam.hasNoAvailableStats || steam.achievementsTotal == null) {
    return <span className="text-xs text-subtle">—</span>
  }
  const value = (
    <span
      className={cn(
        'text-xs font-medium tabular-nums-strict',
        steam.achievementsPercentage === 100
          ? 'text-success-foreground'
          : 'text-foreground',
      )}
    >
      {steam.achievementsUnlocked}/{steam.achievementsTotal} (
      {Math.round(steam.achievementsPercentage ?? 0)}%)
    </span>
  )
  const withTooltip = checkedTooltip ? <Tooltip content={checkedTooltip}>{value}</Tooltip> : value
  return <AchievementsLink row={row}>{withTooltip}</AchievementsLink>
}

type VerifyActionKind = 'verify' | 'unverify' | 'register'

/** In-flight/result state for one row's verify/unverify action, keyed by `${row.key}:${type}`. */
type VerifyState =
  | { status: 'verifying'; action: VerifyActionKind }
  | { status: 'done'; action: VerifyActionKind; message: string }
  | { status: 'error'; action: VerifyActionKind; message: string }

function verifyStateKey(row: PlayRequiredRow, type: 'ipb' | 'play_required'): string {
  return `${row.key}:${type}`
}

/** A giveaway link to derive a SteamGifts giveaway id from — see handleAction's giveawayId. */
function hasGiveawayCode(row: PlayRequiredRow): boolean {
  return row.giveawayLink.length > 0
}

function searchMatches(row: PlayRequiredRow, term: string): boolean {
  if (!term) return true
  return (
    row.game.name.toLowerCase().includes(term) || row.winner.username.toLowerCase().includes(term)
  )
}

function isRowVerified(row: PlayRequiredRow, type: 'ipb' | 'play_required'): boolean {
  return type === 'play_required' ? row.attestation.confirmed : row.ipbStatus === 'verified'
}

interface TabVisibility {
  filtered: PlayRequiredRow[]
  /** Rows hidden only by the "Show verified" toggle — flipping it alone would reveal them. */
  hiddenByVerified: number
  /** Rows hidden only by the "Show ex-members" toggle — flipping it alone would reveal them. */
  hiddenByExMembers: number
}

/**
 * Applies the card filter, search, and the two visibility toggles in one
 * pass, tracking — separately from the filtered set — how many rows each
 * toggle alone is hiding, so the UI can hint "N hidden — show X" without
 * silently dropping rows a mod might be looking for.
 */
function computeTabVisibility(params: {
  rows: PlayRequiredRow[]
  matchesCard: (row: PlayRequiredRow) => boolean
  term: string
  showVerified: boolean
  showExMembers: boolean
  verifyType: 'ipb' | 'play_required'
  justVerifiedKeys: Set<string>
}): TabVisibility {
  const { rows, matchesCard, term, showVerified, showExMembers, verifyType, justVerifiedKeys } = params
  const filtered: PlayRequiredRow[] = []
  let hiddenByVerified = 0
  let hiddenByExMembers = 0

  for (const row of rows) {
    if (!matchesCard(row) || !searchMatches(row, term)) continue

    const verified = isRowVerified(row, verifyType)
    const justVerified = justVerifiedKeys.has(verifyStateKey(row, verifyType))
    const passesVerifiedGate = showVerified || !verified || justVerified
    const passesExMemberGate = showExMembers || !row.winner.isExMember

    if (passesVerifiedGate && passesExMemberGate) {
      filtered.push(row)
    } else if (passesExMemberGate) {
      hiddenByVerified++
    } else if (passesVerifiedGate) {
      hiddenByExMembers++
    }
    // Hidden by both toggles: flipping either one alone wouldn't reveal it, so it counts toward neither hint.
  }

  return { filtered, hiddenByVerified, hiddenByExMembers }
}

function VerifyControl({
  row,
  type,
  state,
  onVerify,
}: {
  row: PlayRequiredRow
  type: 'ipb' | 'play_required'
  state: VerifyState | undefined
  onVerify: (row: PlayRequiredRow, type: 'ipb' | 'play_required') => void
}) {
  if (state?.status === 'verifying' && state.action === 'verify') {
    return (
      <Button size="sm" variant="outline" disabled className="mt-1.5">
        <Loader2 className="h-3 w-3 animate-spin" />
        Verifying…
      </Button>
    )
  }
  return (
    <div className="mt-1.5 space-y-1">
      <Button size="sm" variant="outline" onClick={() => onVerify(row, type)}>
        <ShieldCheck className="h-3 w-3" />
        Verify
      </Button>
      {state?.status === 'error' && state.action === 'verify' && (
        <p className="max-w-[16rem] text-[11px] text-error-foreground">{state.message}</p>
      )}
      {state?.status === 'done' && state.action === 'unverify' && (
        <p className="max-w-[16rem] text-[11px] text-success-foreground">{state.message}</p>
      )}
    </div>
  )
}

/**
 * Renders the verify/unverify affordances for a row's status cell:
 *  - not verified: the Verify button (plus any leftover unverify result note).
 *  - verified this session (an in-memory 'done' verify result): the success
 *    note with an inline "Undo" link.
 *  - verified from persisted data: a small, subdued "Unverify" link.
 */
function VerifiedControls({
  row,
  type,
  isVerified,
  state,
  onAction,
}: {
  row: PlayRequiredRow
  type: 'ipb' | 'play_required'
  isVerified: boolean
  state: VerifyState | undefined
  onAction: (row: PlayRequiredRow, type: 'ipb' | 'play_required', action: VerifyActionKind) => void
}) {
  if (!isVerified) {
    return <VerifyControl row={row} type={type} state={state} onVerify={(r, t) => onAction(r, t, 'verify')} />
  }

  if (state?.status === 'done' && state.action === 'verify') {
    return (
      <div className="mt-1 space-y-0.5">
        <p className="max-w-[16rem] text-[11px] text-success-foreground">{state.message}</p>
        <button
          type="button"
          onClick={() => onAction(row, type, 'unverify')}
          className="text-[11px] text-muted-foreground underline decoration-dotted hover:text-foreground"
        >
          Undo
        </button>
      </div>
    )
  }

  if (state?.status === 'verifying' && state.action === 'unverify') {
    return (
      <Button size="sm" variant="outline" disabled className="mt-1.5">
        <Loader2 className="h-3 w-3 animate-spin" />
        Unverifying…
      </Button>
    )
  }

  return (
    <div className="mt-1 space-y-1">
      {hasGiveawayCode(row) && (
        <button
          type="button"
          onClick={() => onAction(row, type, 'unverify')}
          className="text-[11px] text-muted-foreground underline decoration-dotted hover:text-foreground"
        >
          Unverify
        </button>
      )}
      {state?.status === 'error' && state.action === 'unverify' && (
        <p className="max-w-[16rem] text-[11px] text-error-foreground">{state.message}</p>
      )}
    </div>
  )
}

function PlayRequiredRowView({
  row,
  verifyStates,
  verifyOverrides,
  onAction,
}: {
  row: PlayRequiredRow
  verifyStates: Record<string, VerifyState>
  verifyOverrides: VerifyOverrideMap
  onAction: (row: PlayRequiredRow, type: 'ipb' | 'play_required', action: VerifyActionKind) => void
}) {
  return (
    <tr className="border-b border-card-border last:border-0">
      <td className="py-2.5 pr-3">
        <GameCell row={row} />
      </td>
      <td className="py-2.5 pr-3">
        <WinnerCell row={row} />
      </td>
      <td className="py-2.5 pr-3">
        <p className="text-xs text-muted-foreground">
          <FormattedDate timestamp={row.endTimestamp} />
        </p>
      </td>
      <td className="py-2.5 pr-3">
        <Badge variant={typeVariant[row.type]} size="sm">
          {typeLabel[row.type]}
        </Badge>
      </td>
      <td className="py-2.5 pr-3">
        <PlaytimeCell row={row} />
      </td>
      <td className="py-2.5 pr-3">
        <AchievementsCell row={row} />
      </td>
      <td className="py-2.5 pr-3">
        <BeatenBadge row={row} />
        {row.likelyBeaten.isLikely && row.beaten.verdict !== 'beaten_verified' && (
          <p className="mt-1 text-[11px] text-accent-yellow">
            Likely beaten
            {row.likelyBeaten.reason === 'playtime_ge_hltb'
              ? ' (playtime ≥ HLTB)'
              : ' (100% achievements)'}
          </p>
        )}
      </td>
      <td className="py-2.5">
        <PlayRequiredSignOffColumn
          row={row}
          verifyStates={verifyStates}
          verifyOverrides={verifyOverrides}
          onAction={onAction}
        />
      </td>
    </tr>
  )
}

function IpbRowView({
  row,
  verifyStates,
  verifyOverrides,
  onAction,
}: {
  row: PlayRequiredRow
  verifyStates: Record<string, VerifyState>
  verifyOverrides: VerifyOverrideMap
  onAction: (row: PlayRequiredRow, type: 'ipb' | 'play_required', action: VerifyActionKind) => void
}) {
  const submittedAt = row.discord?.thread_created_at
  const ipbState = verifyStates[verifyStateKey(row, 'ipb')]
  const ipbPendingSync = verifyOverrides[verifyOverrideKey(row.key, 'ipb')]?.state
  return (
    <tr className="border-b border-card-border last:border-0">
      <td className="py-2.5 pr-3">
        <GameCell row={row} />
      </td>
      <td className="py-2.5 pr-3">
        <WinnerCell row={row} />
      </td>
      <td className="py-2.5 pr-3">
        <p className="text-xs text-muted-foreground">
          <FormattedDate timestamp={row.endTimestamp} />
        </p>
      </td>
      <td className="py-2.5 pr-3">
        {submittedAt ? (
          <p className="text-xs text-muted-foreground">
            <FormattedDate timestamp={Math.floor(new Date(submittedAt).getTime() / 1000)} />
          </p>
        ) : (
          <span className="text-xs text-subtle">—</span>
        )}
      </td>
      <td className="py-2.5 pr-3">
        <PlaytimeCell row={row} />
      </td>
      <td className="py-2.5 pr-3">
        <AchievementsCell row={row} />
      </td>
      <td className="py-2.5 pr-3">
        <BeatenBadge row={row} />
        {row.likelyBeaten.isLikely && row.beaten.verdict !== 'beaten_verified' && (
          <p className="mt-1 text-[11px] text-accent-yellow">
            Likely beaten
            {row.likelyBeaten.reason === 'playtime_ge_hltb'
              ? ' (playtime ≥ HLTB)'
              : ' (100% achievements)'}
          </p>
        )}
      </td>
      <td className="py-2.5 pr-3">
        <IpbStatusBadge status={row.ipbStatus} pendingSync={ipbPendingSync} />
        <VerifiedControls
          row={row}
          type="ipb"
          isVerified={row.ipbStatus === 'verified'}
          state={ipbState}
          onAction={onAction}
        />
      </td>
      <td className="py-2.5">
        <LinksCell row={row} />
      </td>
    </tr>
  )
}

function sortValue(row: PlayRequiredRow, key: SortKey): number | string | null {
  switch (key) {
    case 'game':
      return row.game.name.toLowerCase()
    case 'winner':
      return row.winner.username.toLowerCase()
    case 'won':
      return row.endTimestamp
    case 'submitted':
      return row.discord?.thread_created_at
        ? new Date(row.discord.thread_created_at).getTime()
        : null
    case 'playtime':
      return row.steam.playtimeMinutes ?? null
    case 'achievements':
      return row.steam.achievementsPercentage ?? null
    case 'beaten':
      return BEATEN_VERDICT_ORDER.indexOf(row.beaten.verdict)
    case 'signoff':
      return row.attestation.confirmed ? 1 : 0
    case 'status':
      return IPB_STATUS_ORDER.indexOf(row.ipbStatus)
  }
}

/** Missing values (null) always sort last, regardless of direction. */
function compareRows(a: PlayRequiredRow, b: PlayRequiredRow, key: SortKey, dir: SortDir): number {
  const dirMult = dir === 'asc' ? 1 : -1
  const av = sortValue(a, key)
  const bv = sortValue(b, key)
  const aMissing = av == null
  const bMissing = bv == null
  if (aMissing && bMissing) return 0
  if (aMissing) return 1
  if (bMissing) return -1
  if (typeof av === 'string' && typeof bv === 'string') {
    return av.localeCompare(bv) * dirMult
  }
  return ((av as number) - (bv as number)) * dirMult
}

function SortableHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  className,
}: {
  label: string
  sortKey: SortKey
  activeKey: SortKey
  dir: SortDir
  onSort: (key: SortKey) => void
  className?: string
}) {
  const active = sortKey === activeKey
  return (
    <th
      className={cn(
        'cursor-pointer select-none px-3 py-2 hover:text-foreground',
        active && 'text-foreground',
        className,
      )}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className="w-2.5 text-[9px]">
          {active ? (dir === 'asc' ? '▲' : '▼') : ''}
        </span>
      </span>
    </th>
  )
}

export default function PlayRequiredClient({
  rows,
  beatenDataAvailable,
  beatenLastUpdated,
  lastUpdated,
  unmatchedDiscordThreads,
}: Props) {
  const [tab, setTab] = useState<Tab>('ipb')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 200)
  const [prCard, setPrCard] = useState<PrCardId>('all')
  const [ipbCard, setIpbCard] = useState<IpbCardId>('all')
  const [showVerified, setShowVerified] = useState(false)
  const [showExMembers, setShowExMembers] = useState(false)
  const [prSort, setPrSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: 'playtime',
    dir: 'desc',
  })
  const [ipbSort, setIpbSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: 'submitted',
    dir: 'desc',
  })

  // A successful /api/verify call records an override here — applied on top
  // of `rows` below — instead of mutating row state directly. That's what
  // lets the same flip survive a refresh: overrides are also persisted to
  // localStorage (VERIFY_OVERRIDES_STORAGE_KEY) and reloaded/reconciled on
  // mount, so a page reload and the rest of this session render identically
  // until the next static build regenerates `rows` and the override is
  // pruned as redundant.
  const [verifyOverrides, setVerifyOverrides] = useState<VerifyOverrideMap>({})
  const localRows = useMemo(() => applyVerifyOverrides(rows, verifyOverrides), [rows, verifyOverrides])
  const [verifyStates, setVerifyStates] = useState<Record<string, VerifyState>>({})
  // Rows verified this session (or via a reloaded override) stay visible
  // even when "Show verified" is off, so their inline Undo affordance
  // remains reachable.
  const [justVerifiedKeys, setJustVerifiedKeys] = useState<Set<string>>(new Set())

  // On mount: reload persisted overrides, drop any that are stale (the
  // committed JSON already agrees) or older than 7 days, and persist the
  // pruned set back — see pruneVerifyOverrides.
  useEffect(() => {
    let stored: VerifyOverrideMap
    try {
      stored = parseVerifyOverrides(window.localStorage.getItem(VERIFY_OVERRIDES_STORAGE_KEY))
    } catch {
      stored = {}
    }
    const pruned = pruneVerifyOverrides(stored, rows)
    try {
      window.localStorage.setItem(VERIFY_OVERRIDES_STORAGE_KEY, JSON.stringify(pruned))
    } catch {}
    setVerifyOverrides(pruned)
    setJustVerifiedKeys((prev) => {
      const next = new Set(prev)
      for (const [key, override] of Object.entries(pruned)) {
        if (override.state === 'verified') next.add(key)
      }
      return next
    })
  }, [rows])

  // Mirrors how the server page derives `summary`/`ipbSummary` from `rows`
  // (src/app/verification/page.tsx) — recomputed from `localRows` so the
  // tiles reflect overridden verify/unverify state too.
  const summaryState = useMemo(
    () => summarizeRows(localRows.filter((r) => r.isPlayRequired)),
    [localRows],
  )
  const ipbSummaryState = useMemo(() => summarizeIpbRows(localRows), [localRows])

  /** Best-effort human-readable note for the request's `discord` reaction-toggle result. */
  function discordNoteFor(discordResult: unknown, action: VerifyActionKind): string {
    if (discordResult === 'reacted') return ' Discord thread reacted with ✅.'
    if (discordResult === 'unreacted') return ' Discord ✅ reaction removed.'
    if (discordResult === 'failed') {
      return action === 'verify'
        ? ' (Discord reaction failed — react manually.)'
        : ' (Discord un-reaction failed — remove it manually.)'
    }
    return ''
  }

  const handleAction = useCallback(
    async (row: PlayRequiredRow, type: 'ipb' | 'play_required', action: VerifyActionKind) => {
      if (action === 'unverify') {
        const confirmed = window.confirm(`Unverify ${row.game.name} for ${row.winner.username}?`)
        if (!confirmed) return
      }

      const password = await getAdminPassword()
      if (!password) return

      const stateKey = verifyStateKey(row, type)
      setVerifyStates((prev) => ({ ...prev, [stateKey]: { status: 'verifying', action } }))

      try {
        const res = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            password,
            type,
            action,
            giveawayId: row.giveawayLink.slice(0, 5),
            discordThreadId: row.discord?.thread_id,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(typeof data.error === 'string' ? data.error : `Request failed (${res.status})`)
        }

        if (action === 'register') {
          setVerifyOverrides((prev) => {
            const next: VerifyOverrideMap = {
              ...prev,
              [stateKey]: { state: 'registered', at: new Date().toISOString() },
            }
            try {
              window.localStorage.setItem(VERIFY_OVERRIDES_STORAGE_KEY, JSON.stringify(next))
            } catch {}
            return next
          })
          const message = data.already
            ? 'Already registered.'
            : 'Registered with a TODO note — set deadline/requirements in the sheet.'
          setVerifyStates((prev) => ({ ...prev, [stateKey]: { status: 'done', action, message } }))
          return
        }

        const verified = action === 'verify'
        setVerifyOverrides((prev) => {
          const next: VerifyOverrideMap = {
            ...prev,
            [stateKey]: { state: verified ? 'verified' : 'unverified', at: new Date().toISOString() },
          }
          try {
            window.localStorage.setItem(VERIFY_OVERRIDES_STORAGE_KEY, JSON.stringify(next))
          } catch {}
          return next
        })
        setJustVerifiedKeys((prev) => {
          const next = new Set(prev)
          if (verified) next.add(stateKey)
          else next.delete(stateKey)
          return next
        })

        const discordNote = discordNoteFor(data.discord, action)
        const already = data.already
          ? action === 'verify'
            ? 'Already verified.'
            : 'Already unverified.'
          : action === 'verify'
            ? 'Verified.'
            : 'Unverified.'
        setVerifyStates((prev) => ({
          ...prev,
          [stateKey]: { status: 'done', action, message: `${already}${discordNote}` },
        }))
      } catch (err) {
        const raw = err instanceof Error ? err.message : 'Request failed.'
        const message =
          raw === 'Failed to fetch' || raw.includes('NetworkError')
            ? "Can't reach /api/verify — this endpoint only runs when deployed on Vercel, not in local dev."
            : raw
        setVerifyStates((prev) => ({ ...prev, [stateKey]: { status: 'error', action, message } }))
      }
    },
    [],
  )

  // Static export: the tab can't be read from the server-rendered URL, so
  // sync it from window.location once mounted and keep it in sync from then on.
  useEffect(() => {
    setTab(readTabFromLocation())
  }, [])

  const handleTabChange = (next: Tab) => {
    setTab(next)
    const params = new URLSearchParams(window.location.search)
    params.set('tab', TAB_TO_PARAM[next])
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}?${params.toString()}${window.location.hash}`,
    )
  }

  const handleSort = (current: { key: SortKey; dir: SortDir }, setter: (v: { key: SortKey; dir: SortDir }) => void) =>
    (key: SortKey) => {
      if (key === current.key) {
        setter({ key, dir: current.dir === 'asc' ? 'desc' : 'asc' })
      } else {
        setter({ key, dir: 'asc' })
      }
    }

  const prRows = useMemo(() => localRows.filter((r) => r.isPlayRequired), [localRows])
  const ipbRows = useMemo(() => localRows.filter((r) => r.isIpb), [localRows])

  const term = debouncedSearch.trim().toLowerCase()

  const prVisibility = useMemo(
    () =>
      computeTabVisibility({
        rows: prRows,
        matchesCard: (row) => matchesPrCard(row, prCard),
        term,
        showVerified,
        showExMembers,
        verifyType: 'play_required',
        justVerifiedKeys,
      }),
    [prRows, prCard, term, showVerified, showExMembers, justVerifiedKeys],
  )
  const ipbVisibility = useMemo(
    () =>
      computeTabVisibility({
        rows: ipbRows,
        matchesCard: (row) => matchesIpbCard(row, ipbCard),
        term,
        showVerified,
        showExMembers,
        verifyType: 'ipb',
        justVerifiedKeys,
      }),
    [ipbRows, ipbCard, term, showVerified, showExMembers, justVerifiedKeys],
  )

  const sortedPrRows = useMemo(
    () => [...prVisibility.filtered].sort((a, b) => compareRows(a, b, prSort.key, prSort.dir)),
    [prVisibility, prSort],
  )
  const sortedIpbRows = useMemo(
    () => [...ipbVisibility.filtered].sort((a, b) => compareRows(a, b, ipbSort.key, ipbSort.dir)),
    [ipbVisibility, ipbSort],
  )

  const activeBaseRows = tab === 'play_required' ? prRows : ipbRows
  const activeSortedRows = tab === 'play_required' ? sortedPrRows : sortedIpbRows
  const activeVisibility = tab === 'play_required' ? prVisibility : ipbVisibility

  /** Toggles `id` on if it isn't already the active card, otherwise clears back to "all". */
  function toggleCard<T extends string>(id: T, current: T, setter: (v: T) => void) {
    setter(current === id ? ('all' as T) : id)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Play Required
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Ongoing Play Required and I Play Bro wins — which games have truly
          been beaten (Steam-verified), which are signed off by a mod
          (self-reported attestation), and which are still unverified.
        </p>
        {lastUpdated && (
          <div className="mt-1 text-sm text-muted-foreground">
            <LastUpdated lastUpdatedDate={lastUpdated} />
          </div>
        )}
        {!beatenDataAvailable && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-warning bg-warning-light px-3 py-2 text-xs text-warning-foreground">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            Beaten-games data hasn&apos;t been generated yet — the &quot;Beaten&quot;
            column will show every row as pending until it runs.
          </div>
        )}
        {beatenDataAvailable && beatenLastUpdated && (
          <p className="mt-1 text-xs text-subtle">
            Beaten-games data last checked{' '}
            <FormattedDate timestamp={Math.floor(new Date(beatenLastUpdated).getTime() / 1000)} />
          </p>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => handleTabChange(v as Tab)}>
        <TabsList>
          <TabsTrigger value="play_required">Play Required</TabsTrigger>
          <TabsTrigger value="ipb">I Play Bro</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'play_required' ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            icon={Gamepad2}
            label="Play Required wins"
            value={summaryState.totalRequiredPlay}
            accent="primary"
            selected={prCard === 'all'}
            onClick={() => toggleCard('all', prCard, setPrCard)}
          />
          <StatCard
            icon={FileSpreadsheet}
            label="Not in sheet"
            value={summaryState.notRegistered}
            accent="rose"
            selected={prCard === 'not_in_sheet'}
            onClick={() => toggleCard('not_in_sheet', prCard, setPrCard)}
          />
          <StatCard
            icon={AlertTriangle}
            label="Pending verification"
            value={summaryState.pendingVerification}
            accent="amber"
            selected={prCard === 'pending_verification'}
            onClick={() => toggleCard('pending_verification', prCard, setPrCard)}
          />
          <StatCard
            icon={ShieldCheck}
            label="Verified"
            value={summaryState.signedOff}
            accent="blue"
            selected={prCard === 'signed_off'}
            onClick={() => toggleCard('signed_off', prCard, setPrCard)}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <StatCard
            icon={Gamepad2}
            label="IPB wins"
            value={ipbSummaryState.total}
            accent="primary"
            selected={ipbCard === 'all'}
            onClick={() => toggleCard('all', ipbCard, setIpbCard)}
          />
          <StatCard
            icon={Clock}
            label="Pending verification"
            value={ipbSummaryState.submitted}
            accent="amber"
            selected={ipbCard === 'pending_verification'}
            onClick={() => toggleCard('pending_verification', ipbCard, setIpbCard)}
          />
          <StatCard
            icon={ShieldCheck}
            label="Verified"
            value={ipbSummaryState.verified}
            accent="green"
            selected={ipbCard === 'verified'}
            onClick={() => toggleCard('verified', ipbCard, setIpbCard)}
          />
        </div>
      )}

      <Toolbar>
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input
            type="search"
            placeholder="Search game or winner…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <ToggleGroup
          type="multiple"
          value={[
            ...(showVerified ? ['verified'] : []),
            ...(showExMembers ? ['exMembers'] : []),
          ]}
          onValueChange={(v) => {
            setShowVerified(v.includes('verified'))
            setShowExMembers(v.includes('exMembers'))
          }}
          size="sm"
        >
          <ToggleGroupItem value="verified">
            <Eye className="h-3.5 w-3.5" />
            Show verified
          </ToggleGroupItem>
          <ToggleGroupItem value="exMembers">
            <Eye className="h-3.5 w-3.5" />
            Show ex-members
          </ToggleGroupItem>
        </ToggleGroup>
      </Toolbar>

      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
        <p className="whitespace-nowrap text-xs text-subtle">
          Showing {activeSortedRows.length} of {activeBaseRows.length} wins.
        </p>
        {activeVisibility.hiddenByExMembers > 0 && (
          <button
            type="button"
            onClick={() => setShowExMembers(true)}
            className="whitespace-nowrap text-xs text-accent underline decoration-dotted hover:text-accent-hover"
          >
            {activeVisibility.hiddenByExMembers} hidden — show ex-members
          </button>
        )}
        {activeVisibility.hiddenByVerified > 0 && (
          <button
            type="button"
            onClick={() => setShowVerified(true)}
            className="whitespace-nowrap text-xs text-accent underline decoration-dotted hover:text-accent-hover"
          >
            {activeVisibility.hiddenByVerified} hidden — show verified
          </button>
        )}
      </div>

      <Card className="overflow-hidden">
        {activeSortedRows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-12 text-center">
            <Clock className="h-8 w-8 text-subtle" />
            <p className="text-sm text-muted-foreground">
              No wins match this filter.
            </p>
          </div>
        ) : tab === 'play_required' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-card-border text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <SortableHeader
                    label="Game"
                    sortKey="game"
                    activeKey={prSort.key}
                    dir={prSort.dir}
                    onSort={handleSort(prSort, setPrSort)}
                    className="sm:pl-6"
                  />
                  <SortableHeader
                    label="Winner"
                    sortKey="winner"
                    activeKey={prSort.key}
                    dir={prSort.dir}
                    onSort={handleSort(prSort, setPrSort)}
                  />
                  <SortableHeader
                    label="Won"
                    sortKey="won"
                    activeKey={prSort.key}
                    dir={prSort.dir}
                    onSort={handleSort(prSort, setPrSort)}
                  />
                  <th className="px-3 py-2">Type</th>
                  <SortableHeader
                    label="Playtime"
                    sortKey="playtime"
                    activeKey={prSort.key}
                    dir={prSort.dir}
                    onSort={handleSort(prSort, setPrSort)}
                  />
                  <SortableHeader
                    label="Achievements"
                    sortKey="achievements"
                    activeKey={prSort.key}
                    dir={prSort.dir}
                    onSort={handleSort(prSort, setPrSort)}
                  />
                  <SortableHeader
                    label="Beaten"
                    sortKey="beaten"
                    activeKey={prSort.key}
                    dir={prSort.dir}
                    onSort={handleSort(prSort, setPrSort)}
                  />
                  <SortableHeader
                    label="Sign-off"
                    sortKey="signoff"
                    activeKey={prSort.key}
                    dir={prSort.dir}
                    onSort={handleSort(prSort, setPrSort)}
                    className="sm:pr-6"
                  />
                </tr>
              </thead>
              <tbody className="px-3">
                {sortedPrRows.map((row) => (
                  <PlayRequiredRowView
                    key={row.key}
                    row={row}
                    verifyStates={verifyStates}
                    verifyOverrides={verifyOverrides}
                    onAction={handleAction}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-card-border text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <SortableHeader
                    label="Game"
                    sortKey="game"
                    activeKey={ipbSort.key}
                    dir={ipbSort.dir}
                    onSort={handleSort(ipbSort, setIpbSort)}
                    className="sm:pl-6"
                  />
                  <SortableHeader
                    label="Winner"
                    sortKey="winner"
                    activeKey={ipbSort.key}
                    dir={ipbSort.dir}
                    onSort={handleSort(ipbSort, setIpbSort)}
                  />
                  <SortableHeader
                    label="Won"
                    sortKey="won"
                    activeKey={ipbSort.key}
                    dir={ipbSort.dir}
                    onSort={handleSort(ipbSort, setIpbSort)}
                  />
                  <SortableHeader
                    label="Submitted"
                    sortKey="submitted"
                    activeKey={ipbSort.key}
                    dir={ipbSort.dir}
                    onSort={handleSort(ipbSort, setIpbSort)}
                  />
                  <SortableHeader
                    label="Playtime"
                    sortKey="playtime"
                    activeKey={ipbSort.key}
                    dir={ipbSort.dir}
                    onSort={handleSort(ipbSort, setIpbSort)}
                  />
                  <SortableHeader
                    label="Achievements"
                    sortKey="achievements"
                    activeKey={ipbSort.key}
                    dir={ipbSort.dir}
                    onSort={handleSort(ipbSort, setIpbSort)}
                  />
                  <SortableHeader
                    label="Beaten"
                    sortKey="beaten"
                    activeKey={ipbSort.key}
                    dir={ipbSort.dir}
                    onSort={handleSort(ipbSort, setIpbSort)}
                  />
                  <SortableHeader
                    label="Status"
                    sortKey="status"
                    activeKey={ipbSort.key}
                    dir={ipbSort.dir}
                    onSort={handleSort(ipbSort, setIpbSort)}
                  />
                  <th className="px-3 py-2 sm:pr-6">Links</th>
                </tr>
              </thead>
              <tbody className="px-3">
                {sortedIpbRows.map((row) => (
                  <IpbRowView
                    key={row.key}
                    row={row}
                    verifyStates={verifyStates}
                    verifyOverrides={verifyOverrides}
                    onAction={handleAction}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {tab === 'ipb' && unmatchedDiscordThreads.length > 0 && (
        <details className="rounded-xl border border-card-border bg-card-background p-3 text-sm">
          <summary className="cursor-pointer select-none font-medium text-muted-foreground">
            Unmatched Discord submission threads ({unmatchedDiscordThreads.length})
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">
            These reports couldn&apos;t be automatically checked because they didn&apos;t contain
            enough info, or members might have reported invite-only GA wins or similar.
          </p>
          <ul className="mt-3 space-y-1.5">
            {unmatchedDiscordThreads.map((t) => (
              <li key={t.thread_id} className="flex flex-wrap items-center gap-2 text-xs">
                <a
                  href={t.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-[#5865F2] hover:underline dark:text-[#A5AEFF]"
                >
                  <MessageSquare className="h-3 w-3" />
                  {t.name}
                </a>
                <span className="text-muted-foreground">by {t.owner_discord_name}</span>
                <span className="text-subtle">
                  · {formatDistanceToNow(discordSnowflakeDate(t.thread_id), { addSuffix: true })}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
