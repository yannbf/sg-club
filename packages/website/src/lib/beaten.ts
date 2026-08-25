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
     * Base-game app id, when the giveaway's app id is a DLC resolved to its
     * base game's achievements. Use this instead of `game.appId` for the
     * Steam achievements link whenever it's set.
     */
    resolvedAppId: number | null
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

export type StatusFilter =
  | 'all'
  | 'not_verified'
  | 'likely_not_signed_off'
  | 'beaten_verified'
  | 'no_evidence'
  | 'unverifiable'

export function matchesStatusFilter(
  row: PlayRequiredRow,
  filter: StatusFilter,
): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'not_verified':
      return !row.attestation.confirmed
    case 'likely_not_signed_off':
      return (
        (row.beaten.verdict === 'beaten_verified' || row.likelyBeaten.isLikely) &&
        !row.attestation.confirmed
      )
    case 'beaten_verified':
      return row.beaten.verdict === 'beaten_verified'
    case 'no_evidence':
      return (
        !row.attestation.confirmed &&
        !row.likelyBeaten.isLikely &&
        row.beaten.verdict !== 'beaten_verified' &&
        !row.steam.hasNoAvailableStats &&
        (row.steam.playtimeMinutes ?? 0) === 0 &&
        (row.steam.achievementsUnlocked ?? 0) === 0
      )
    case 'unverifiable':
      return row.beaten.verdict === 'no_data' || row.beaten.verdict === 'no_marker'
  }
}

function beatenVerdictFor(
  appId: number | null,
  packageId: number | null,
  steamId: string,
  beatenGames: BeatenGamesData | null,
): Pick<
  PlayRequiredRow['beaten'],
  'verdict' | 'marker' | 'noMarkerReason' | 'beaten' | 'unlockTime' | 'noDataReason' | 'resolvedAppId'
> {
  const empty = {
    marker: null as BeatenGameMarker | null,
    noMarkerReason: null as NoMarkerReason | null,
    beaten: null as boolean | null,
    unlockTime: null as number | null,
    noDataReason: null as NoDataReason | null,
    resolvedAppId: null as number | null,
  }

  if (appId == null) {
    return { verdict: 'package_only', ...empty }
  }
  if (!beatenGames) {
    return { verdict: 'pending', ...empty }
  }

  const gameEntry = beatenGames.games[String(appId)]
  if (!gameEntry) {
    return { verdict: 'pending', ...empty }
  }
  const resolvedAppId = gameEntry.resolved_app_id ?? null
  if (!gameEntry.marker) {
    return {
      verdict: 'no_marker',
      ...empty,
      noMarkerReason: gameEntry.no_marker_reason,
      resolvedAppId,
    }
  }

  const winEntry = beatenGames.wins[beatenWinKey(steamId, appId)]
  if (!winEntry) {
    return { verdict: 'pending', ...empty, marker: gameEntry.marker, resolvedAppId }
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
  verifiedBeaten: number
  signedOff: number
  unverified: number
  noData: number
}

export function summarizeRows(rows: PlayRequiredRow[]): PlayRequiredSummary {
  let totalRequiredPlay = 0
  let totalIPlayedBro = 0
  let verifiedBeaten = 0
  let signedOff = 0
  let unverified = 0
  let noData = 0

  for (const row of rows) {
    if (row.attestation.requiredPlay) totalRequiredPlay++
    if (row.attestation.iPlayedBro) totalIPlayedBro++
    if (row.beaten.verdict === 'beaten_verified') verifiedBeaten++
    if (row.attestation.confirmed) signedOff++
    else unverified++
    if (row.beaten.verdict === 'no_data' || row.beaten.verdict === 'no_marker') noData++
  }

  return { totalRequiredPlay, totalIPlayedBro, verifiedBeaten, signedOff, unverified, noData }
}

/**
 * Submitted-vs-verified tiles for the "I Play Bro" tab. Computed over
 * `isIpb` rows only (a set that may include rows also flagged Play
 * Required), from the full row set — filters narrow the table, not these
 * tiles.
 */
export interface IpbSummary {
  submitted: number
  verified: number
  notSubmitted: number
  verifiedBeaten: number
}

/** Which of a row's two independent verify actions an override applies to. */
export type VerifyOverrideType = 'ipb' | 'play_required'
export type VerifyOverrideState = 'verified' | 'unverified'

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
        (value as VerifyOverride).state === 'unverified') &&
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
    if (prOverride) {
      next = { ...next, attestation: { ...next.attestation, confirmed: prOverride.state === 'verified' } }
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
  let submitted = 0
  let verified = 0
  let notSubmitted = 0
  let verifiedBeaten = 0

  for (const row of rows) {
    if (!row.isIpb) continue
    if (row.ipbStatus === 'submitted') submitted++
    else if (row.ipbStatus === 'verified') verified++
    else notSubmitted++
    if (row.beaten.verdict === 'beaten_verified') verifiedBeaten++
  }

  return { submitted, verified, notSubmitted, verifiedBeaten }
}
