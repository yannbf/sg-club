import type { Giveaway, GameData, NoStatsReason, User } from '@/types'
import type {
  BeatenGameMarker,
  BeatenGamesData,
  NoDataReason,
  NoMarkerReason,
} from '@/types/beaten'
import { beatenWinKey } from '@/types/beaten'
import type { IpbDiscordData, IpbDiscordWinEntry } from '@/types/ipb-discord'
import { ipbDiscordWinKey } from '@/types/ipb-discord'
import { isCountedGiveaway } from './events'
import { isConfirmedPlayed } from './play-status'
import { buildGameDataIndex, findGameData, type GameDataIndex } from './chart-data'

/**
 * "Play Required" / "I Play Bro" win analysis — one row per win where the
 * winner owed play evidence (a play requirement or an "I played, bro"
 * attestation), cross-referencing what Steam shows, what a mod signed off
 * on, and (when available) whether the game's story-completion achievement
 * was actually unlocked. Pure and serializable so it can run at build time
 * and be handed to the client as plain data.
 *
 * Per AGENTS.md, self-reported attestation (`i_played_bro`,
 * `required_play_meta.requirements_met`) is a signal distinct from
 * Steam-verified evidence — every row keeps `attestation` and `beaten`
 * separate rather than folding them into one verdict.
 */

export type WinType = 'required_play' | 'i_played_bro' | 'both'

/**
 * Verdict against the generated beaten_games.json data (Steam-verified, not
 * self-reported):
 *  - `beaten_verified`: the win's marker achievement was unlocked.
 *  - `not_beaten`: the game has a marker, and it wasn't unlocked.
 *  - `no_data`: the game has a marker, but this win's player data couldn't
 *    be checked (private profile, no stats, etc).
 *  - `no_marker`: no story-completion achievement could be established for
 *    this game at all.
 *  - `pending`: not yet processed (either beaten_games.json is missing, or
 *    this game/win hasn't been checked yet).
 *  - `package_only`: the giveaway is package-only (no app id), which the
 *    beaten-games pipeline doesn't support.
 */
export type BeatenVerdict =
  | 'beaten_verified'
  | 'not_beaten'
  | 'no_data'
  | 'no_marker'
  | 'pending'
  | 'package_only'

/** Display/sort ranking for `BeatenVerdict` — ascending is "most resolved" first. */
export const BEATEN_VERDICT_ORDER: readonly BeatenVerdict[] = [
  'beaten_verified',
  'not_beaten',
  'pending',
  'no_data',
  'no_marker',
  'package_only',
]

export interface PlayRequiredRow {
  /** Stable row id: `${steamId}::${giveawayLink}`. */
  key: string
  giveawayLink: string
  giveawayName: string
  endTimestamp: number
  game: {
    name: string
    appId: number | null
    packageId: number | null
    headerImageUrl: string | null
    hltbMainStoryHours: number | null
    /** The game hadn't released on Steam as of the last game-data run. */
    unreleased: boolean
    /** Steam's announced release date, when `unreleased`. Free-form display text. */
    releaseDate: string | null
  }
  winner: {
    steamId: string
    username: string
    isExMember: boolean
    avatarUrl: string | null
  }
  /** Discord thread where an "I Play Bro" submission was discussed, when matched. */
  discord: IpbDiscordWinEntry | null
  type: WinType
  /** `required_play` flag set on the win. */
  isPlayRequired: boolean
  /**
   * Whether this win has a row in the Google Sheet's manually-maintained
   * PLAY_REQUIRED tab (`won.required_play_meta` exists). Only meaningful for
   * `isPlayRequired` rows — a detected-but-unregistered win has no sheet row
   * yet, so the site's verify flow has nothing to update until one is added.
   */
  prRegistered: boolean
  /** `i_played_bro` flag set on the win, or a Discord submission exists for it. */
  isIpb: boolean
  /**
   * Submitted-vs-verified status for the "I Play Bro" tab:
   *  - `verified`: attestation.confirmed (i_played_bro or requirements_met set).
   *  - `submitted`: not confirmed, but a Discord wins entry exists for this win.
   *  - `not_submitted`: IPB/PR-flagged but neither confirmed nor submitted.
   */
  ipbStatus: 'verified' | 'submitted' | 'not_submitted'
  steam: {
    playtimeMinutes?: number
    playtimeFormatted?: string
    achievementsUnlocked?: number
    achievementsTotal?: number
    achievementsPercentage?: number
    neverPlayed?: boolean
    hasNoAvailableStats?: boolean
    noStatsReason?: NoStatsReason
    isPotentiallyIdling?: boolean
    /** Playtime is hidden by the user's Steam privacy settings — never 0 minutes played. */
    isPlaytimePrivate?: boolean
    /** ms epoch when this snapshot was last pulled from Steam. */
    lastChecked?: number
  }
  attestation: {
    /** Mod sign-off — isConfirmedPlayed(win). */
    confirmed: boolean
    iPlayedBro: boolean
    requiredPlay: boolean
    requirementsMet: boolean
    deadline?: string
    deadlineInMonths?: number
  }
  beaten: {
    verdict: BeatenVerdict
    marker: BeatenGameMarker | null
    noMarkerReason: NoMarkerReason | null
    beaten: boolean | null
    unlockTime: number | null
    noDataReason: NoDataReason | null
    /**
     * Base-game app id the verdict was actually computed against, when it
     * differs from `game.appId` — either a DLC resolved to its base game's
     * achievements, or a package resolved to a single game. Use this instead
     * of `game.appId` for the Steam achievements link whenever it's set.
     */
    resolvedAppId: number | null
    /** Display name of `resolvedAppId`'s game, when set. */
    resolvedAppName: string | null
    /** When the winner's beaten status was last checked (ISO), null if never. */
    checkedAt: string | null
  }
  /**
   * Heuristic evidence of completion shown SEPARATELY from the Steam-verified
   * `beaten` verdict above — never merged into it.
   */
  likelyBeaten: {
    isLikely: boolean
    reason?: 'achievements_100' | 'playtime_ge_hltb'
  }
}

/**
 * Summary-card filters for the Play Required tab. Each id names a StatCard
 * on that tab; `all` is the "clear filter" card (the Play Required wins
 * total).
 */
export type PrCardId = 'all' | 'not_in_sheet' | 'pending_verification' | 'signed_off'

/**
 * Summary-card filters for the I Play Bro tab. Each id names a StatCard on
 * that tab; `all` is the "clear filter" card (the IPB wins total).
 */
export type IpbCardId = 'all' | 'pending_verification' | 'verified'

export function matchesPrCard(row: PlayRequiredRow, card: PrCardId): boolean {
  switch (card) {
    case 'all':
      return true
    case 'not_in_sheet':
      return !row.prRegistered
    case 'signed_off':
      return row.attestation.confirmed
    case 'pending_verification':
      return !row.attestation.confirmed && row.prRegistered
  }
}

export function matchesIpbCard(row: PlayRequiredRow, card: IpbCardId): boolean {
  switch (card) {
    case 'all':
      return true
    case 'pending_verification':
      return row.ipbStatus === 'submitted'
    case 'verified':
      return row.ipbStatus === 'verified'
  }
}

function beatenVerdictFor(
  appId: number | null,
  packageId: number | null,
  steamId: string,
  beatenGames: BeatenGamesData | null,
): Pick<
  PlayRequiredRow['beaten'],
  | 'verdict'
  | 'marker'
  | 'noMarkerReason'
  | 'beaten'
  | 'unlockTime'
  | 'noDataReason'
  | 'resolvedAppId'
  | 'resolvedAppName'
  | 'checkedAt'
> {
  const empty = {
    marker: null as BeatenGameMarker | null,
    noMarkerReason: null as NoMarkerReason | null,
    beaten: null as boolean | null,
    unlockTime: null as number | null,
    noDataReason: null as NoDataReason | null,
    resolvedAppId: null as number | null,
    resolvedAppName: null as string | null,
    checkedAt: null as string | null,
  }

  // A package-only giveaway (no app id) can still be checked when the
  // scraper resolved its package to a single game — proceed as if that
  // resolved app id were the giveaway's own, falling back to package_only
  // when there's no resolution (or no app id and no package id at all).
  let effectiveAppId = appId
  let packageResolvedName: string | null = null
  if (effectiveAppId == null) {
    const resolution =
      packageId != null ? beatenGames?.package_resolutions?.[String(packageId)] : undefined
    if (!resolution) {
      return { verdict: 'package_only', ...empty }
    }
    effectiveAppId = resolution.app_id
    packageResolvedName = resolution.app_name ?? null
  }

  if (!beatenGames) {
    return { verdict: 'pending', ...empty }
  }

  const gameEntry = beatenGames.games[String(effectiveAppId)]
  if (!gameEntry) {
    return { verdict: 'pending', ...empty }
  }
  // A DLC entry's own resolved_app_id/name take precedence — it names the
  // base game the marker was actually checked against. Otherwise, when the
  // giveaway itself had no app id, resolvedAppId/Name surface the package's
  // resolved game so achievement/thumbnail/SH links work.
  const resolvedAppId = gameEntry.resolved_app_id ?? (appId == null ? effectiveAppId : null)
  const resolvedAppName = gameEntry.resolved_app_name ?? (appId == null ? packageResolvedName : null)
  if (!gameEntry.marker) {
    return {
      verdict: 'no_marker',
      ...empty,
      noMarkerReason: gameEntry.no_marker_reason,
      resolvedAppId,
      resolvedAppName,
    }
  }

  const winEntry = beatenGames.wins[beatenWinKey(steamId, effectiveAppId)]
  if (!winEntry) {
    return {
      verdict: 'pending',
      ...empty,
      marker: gameEntry.marker,
      resolvedAppId,
      resolvedAppName,
    }
  }

  if (winEntry.beaten === true) {
    return {
      verdict: 'beaten_verified',
      marker: gameEntry.marker,
      noMarkerReason: null,
      beaten: true,
      unlockTime: winEntry.unlock_time,
      noDataReason: null,
      resolvedAppId,
      resolvedAppName,
      checkedAt: winEntry.checked_at ?? null,
    }
  }
  if (winEntry.beaten === false) {
    return {
      verdict: 'not_beaten',
      marker: gameEntry.marker,
      noMarkerReason: null,
      beaten: false,
      unlockTime: null,
      noDataReason: null,
      resolvedAppId,
      resolvedAppName,
      checkedAt: winEntry.checked_at ?? null,
    }
  }
  return {
    verdict: 'no_data',
    marker: gameEntry.marker,
    noMarkerReason: null,
    beaten: null,
    unlockTime: null,
    noDataReason: winEntry.no_data_reason,
    resolvedAppId,
    resolvedAppName,
    checkedAt: winEntry.checked_at ?? null,
  }
}

/** achievements_percentage === 100, or playtime_minutes >= hltb_main_story_hours*60. */
function likelyBeatenFor(
  hltbHours: number | null,
  playtimeMinutes: number | undefined,
  achievementsPercentage: number | undefined,
): PlayRequiredRow['likelyBeaten'] {
  if (achievementsPercentage === 100) {
    return { isLikely: true, reason: 'achievements_100' }
  }
  if (hltbHours != null && hltbHours > 0 && playtimeMinutes != null && playtimeMinutes >= hltbHours * 60) {
    return { isLikely: true, reason: 'playtime_ge_hltb' }
  }
  return { isLikely: false }
}

/**
 * Builds one row per (member, win) where the win owed play evidence — a
 * play requirement or an "I played, bro" attestation — joined against the
 * giveaway (skipping any that fail `isCountedGiveaway`), game data, and the
 * beaten-games analysis (when present).
 */
export function buildPlayRequiredRows(params: {
  memberUsers: User[]
  exMemberUsers: User[]
  giveaways: Giveaway[]
  gameData: GameData[]
  beatenGames: BeatenGamesData | null
  ipbDiscord?: IpbDiscordData | null
  now?: number
}): PlayRequiredRow[] {
  const { memberUsers, exMemberUsers, giveaways, gameData, beatenGames, ipbDiscord } = params
  const now = params.now ?? Date.now() / 1000

  const giveawayByLink = new Map<string, Giveaway>()
  for (const g of giveaways) giveawayByLink.set(g.link, g)

  const gameDataIndex: GameDataIndex = buildGameDataIndex(gameData)

  const rows: PlayRequiredRow[] = []

  const process = (user: User, isExMember: boolean) => {
    for (const won of user.giveaways_won ?? []) {
      if (won.deleted) continue

      const discord = ipbDiscord?.wins[ipbDiscordWinKey(user.steam_id, won.link)] ?? null

      // A win qualifies for a row when it's flagged (Play Required or I Played
      // Bro) or when a Discord submission exists for it — the latter covers
      // wins submitted for IPB review but not yet flagged by a mod.
      if (!won.required_play && !won.i_played_bro && !discord) continue

      const giveaway = giveawayByLink.get(won.link)
      if (!giveaway || !isCountedGiveaway(giveaway, now)) continue

      const appId = giveaway.app_id ?? null
      const packageId = giveaway.package_id ?? null
      const gd = findGameData(appId, packageId, gameDataIndex)

      const type: WinType =
        won.required_play && won.i_played_bro
          ? 'both'
          : won.required_play
            ? 'required_play'
            : 'i_played_bro'

      const play = won.steam_play_data
      const beaten = beatenVerdictFor(appId, packageId, user.steam_id, beatenGames)
      const likelyBeaten = likelyBeatenFor(
        gd?.hltb_main_story_hours ?? null,
        play?.playtime_minutes,
        play?.achievements_percentage,
      )

      const confirmed = isConfirmedPlayed(won)
      const ipbStatus: PlayRequiredRow['ipbStatus'] = confirmed
        ? 'verified'
        : discord
          ? 'submitted'
          : 'not_submitted'

      rows.push({
        key: `${user.steam_id}::${won.link}`,
        giveawayLink: won.link,
        giveawayName: won.name,
        endTimestamp: won.end_timestamp,
        game: {
          name: won.name,
          appId,
          packageId,
          headerImageUrl: gd?.header_image_url ?? null,
          hltbMainStoryHours: gd?.hltb_main_story_hours ?? null,
          unreleased: Boolean(won.unreleased),
          releaseDate: won.release_date ?? null,
        },
        winner: {
          steamId: user.steam_id,
          username: user.username,
          isExMember,
          avatarUrl: user.avatar_url || null,
        },
        discord,
        type,
        isPlayRequired: Boolean(won.required_play),
        prRegistered: won.required_play_meta != null,
        isIpb: Boolean(won.i_played_bro) || discord != null,
        ipbStatus,
        steam: play
          ? {
              playtimeMinutes: play.playtime_minutes,
              playtimeFormatted: play.playtime_formatted,
              achievementsUnlocked: play.achievements_unlocked,
              achievementsTotal: play.achievements_total,
              achievementsPercentage: play.achievements_percentage,
              neverPlayed: play.never_played,
              hasNoAvailableStats: play.has_no_available_stats,
              noStatsReason: play.no_stats_reason,
              isPotentiallyIdling: play.is_potentially_idling,
              isPlaytimePrivate: play.is_playtime_private,
              lastChecked: play.last_checked,
            }
          : {},
        attestation: {
          confirmed,
          iPlayedBro: Boolean(won.i_played_bro),
          requiredPlay: Boolean(won.required_play),
          requirementsMet: Boolean(won.required_play_meta?.requirements_met),
          deadline: won.required_play_meta?.deadline,
          deadlineInMonths: won.required_play_meta?.deadline_in_months,
        },
        beaten,
        likelyBeaten,
      })
    }
  }

  for (const u of memberUsers) process(u, false)
  for (const u of exMemberUsers) process(u, true)

  rows.sort((a, b) => b.endTimestamp - a.endTimestamp)
  return rows
}

export interface PlayRequiredSummary {
  totalRequiredPlay: number
  totalIPlayedBro: number
  signedOff: number
  /** Not signed off, but registered in the PLAY_REQUIRED sheet — see `matchesPrCard('pending_verification')`. */
  pendingVerification: number
  noData: number
  /** Play Required wins with no PLAY_REQUIRED sheet row yet — see `PlayRequiredRow.prRegistered`. */
  notRegistered: number
}

export function summarizeRows(rows: PlayRequiredRow[]): PlayRequiredSummary {
  let totalRequiredPlay = 0
  let totalIPlayedBro = 0
  let signedOff = 0
  let pendingVerification = 0
  let noData = 0
  let notRegistered = 0

  for (const row of rows) {
    if (row.attestation.requiredPlay) totalRequiredPlay++
    if (row.attestation.iPlayedBro) totalIPlayedBro++
    if (row.attestation.confirmed) signedOff++
    else if (row.prRegistered) pendingVerification++
    if (row.beaten.verdict === 'no_data' || row.beaten.verdict === 'no_marker') noData++
    if (row.isPlayRequired && !row.prRegistered) notRegistered++
  }

  return { totalRequiredPlay, totalIPlayedBro, signedOff, pendingVerification, noData, notRegistered }
}

/**
 * Submitted-vs-verified tiles for the "I Play Bro" tab. Computed over
 * `isIpb` rows only (a set that may include rows also flagged Play
 * Required), from the full row set — filters narrow the table, not these
 * tiles.
 */
export interface IpbSummary {
  /** All IPB-eligible rows (`row.isIpb`), regardless of status — the tab's "clear filter" total. */
  total: number
  submitted: number
  verified: number
}

/** Which of a row's two independent verify actions an override applies to. */
export type VerifyOverrideType = 'ipb' | 'play_required'
/**
 * `registered` only applies to the `play_required` type — it records a
 * successful `/api/verify` `register` call (a PLAY_REQUIRED sheet row now
 * exists), independently of `verified`/`unverified` sign-off state.
 */
export type VerifyOverrideState = 'verified' | 'unverified' | 'registered'

export interface VerifyOverride {
  state: VerifyOverrideState
  /** ISO timestamp of when the override was recorded. */
  at: string
}

/** Keyed by `verifyOverrideKey(row.key, type)`. */
export type VerifyOverrideMap = Record<string, VerifyOverride>

export const VERIFY_OVERRIDES_STORAGE_KEY = 'sg-club-verify-overrides'

const VERIFY_OVERRIDE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * A local /api/verify result outlives the page it was made on (localStorage,
 * see `VERIFY_OVERRIDES_STORAGE_KEY`), so a refresh can show the same
 * verified/unverified state as the session that made the call, without
 * waiting for the next scraper run to regenerate `PlayRequiredRow[]`.
 */
export function verifyOverrideKey(rowKey: string, type: VerifyOverrideType): string {
  return `${rowKey}:${type}`
}

/** Parses a `VERIFY_OVERRIDES_STORAGE_KEY` payload, dropping anything malformed. */
export function parseVerifyOverrides(raw: string | null | undefined): VerifyOverrideMap {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object') return {}

  const result: VerifyOverrideMap = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (
      value &&
      typeof value === 'object' &&
      ((value as VerifyOverride).state === 'verified' ||
        (value as VerifyOverride).state === 'unverified' ||
        (value as VerifyOverride).state === 'registered') &&
      typeof (value as VerifyOverride).at === 'string'
    ) {
      result[key] = { state: (value as VerifyOverride).state, at: (value as VerifyOverride).at }
    }
  }
  return result
}

function overrideTypeFromKey(key: string): { rowKey: string; type: VerifyOverrideType } | null {
  const lastColon = key.lastIndexOf(':')
  if (lastColon === -1) return null
  const type = key.slice(lastColon + 1)
  if (type !== 'ipb' && type !== 'play_required') return null
  return { rowKey: key.slice(0, lastColon), type }
}

/** Whether `row`'s current JSON-derived status for `type` already matches `state`. */
function overrideMatchesRow(row: PlayRequiredRow, type: VerifyOverrideType, state: VerifyOverrideState): boolean {
  if (state === 'registered') return row.prRegistered
  const verified = type === 'play_required' ? row.attestation.confirmed : row.ipbStatus === 'verified'
  return verified === (state === 'verified')
}

/**
 * Drops overrides that have served their purpose (the underlying JSON has
 * caught up and already agrees with them) and ones older than
 * `VERIFY_OVERRIDE_MAX_AGE_MS` — a safety valve for a row that never gets
 * regenerated (e.g. renamed/removed upstream).
 */
export function pruneVerifyOverrides(
  overrides: VerifyOverrideMap,
  rows: PlayRequiredRow[],
  now: number = Date.now(),
): VerifyOverrideMap {
  const rowsByKey = new Map(rows.map((r) => [r.key, r]))
  const next: VerifyOverrideMap = {}
  for (const [key, override] of Object.entries(overrides)) {
    const age = now - new Date(override.at).getTime()
    if (!Number.isFinite(age) || age > VERIFY_OVERRIDE_MAX_AGE_MS) continue

    const parsedKey = overrideTypeFromKey(key)
    const row = parsedKey ? rowsByKey.get(parsedKey.rowKey) : undefined
    if (row && parsedKey && overrideMatchesRow(row, parsedKey.type, override.state)) continue

    next[key] = override
  }
  return next
}

/**
 * Applies `overrides` on top of `rows`, flipping `attestation.confirmed` /
 * `ipbStatus` (and therefore every badge/filter/summary derived from them)
 * exactly like a successful `/api/verify` call does — refresh and in-session
 * behave identically because both go through this function.
 */
export function applyVerifyOverrides(
  rows: PlayRequiredRow[],
  overrides: VerifyOverrideMap,
): PlayRequiredRow[] {
  if (Object.keys(overrides).length === 0) return rows
  return rows.map((row) => {
    let next = row

    const prOverride = overrides[verifyOverrideKey(row.key, 'play_required')]
    if (prOverride?.state === 'registered') {
      next = { ...next, prRegistered: true }
    } else if (prOverride) {
      // A play_required verify/unverify only ever succeeds against an
      // existing sheet row, so `verified` implies the row is registered too.
      next = {
        ...next,
        attestation: { ...next.attestation, confirmed: prOverride.state === 'verified' },
        prRegistered: prOverride.state === 'verified' ? true : next.prRegistered,
      }
    }

    const ipbOverride = overrides[verifyOverrideKey(row.key, 'ipb')]
    if (ipbOverride) {
      const verified = ipbOverride.state === 'verified'
      next = {
        ...next,
        ipbStatus: verified ? 'verified' : next.discord ? 'submitted' : 'not_submitted',
      }
    }

    return next
  })
}

export function summarizeIpbRows(rows: PlayRequiredRow[]): IpbSummary {
  let total = 0
  let submitted = 0
  let verified = 0

  for (const row of rows) {
    if (!row.isIpb) continue
    total++
    if (row.ipbStatus === 'submitted') submitted++
    else if (row.ipbStatus === 'verified') verified++
  }

  return { total, submitted, verified }
}
