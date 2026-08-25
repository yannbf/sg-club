import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { SteamGameChecker } from '../api/fetch-steam-data.js'
import {
  fetchSteamHuntersAchievements,
  fetchSteamHuntersTags,
  STEAMHUNTERS_DELAY_MS,
} from '../api/fetch-steamhunters-data.js'
import type {
  BeatenGameEntry,
  BeatenGamesData,
  BeatenMarker,
  BeatenWinEntry,
  NoBeatenDataReason,
  NoMarkerReason,
} from '../types/beaten.js'
import type { Giveaway, User } from '../types/steamgifts.js'
import { delay } from '../utils/common.js'
import { logError } from '../utils/log-error.js'

/**
 * "Beaten game" detection: for every group win flagged Play Required or I
 * Play Bro, plus every win with a pending Discord verification submission
 * (`ipb_discord.json`), determine the single achievement that marks the
 * game as finished (the "beaten marker") and check whether the winner has
 * unlocked it. Feeds a website badge showing whether a play-required win
 * was actually completed, independent of self-reported attestation.
 *
 * Two phases:
 *  1. Marker detection (per app_id, cached ~forever): Steam Hunters'
 *     community "Main Storyline" tag is the primary signal; a description
 *     heuristic over the Steam achievement schema is the fallback.
 *  2. Player checks (per steam_id::app_id, cached with a re-check window):
 *     has this winner unlocked the marker achievement?
 *
 * Env vars:
 *  - BEATEN_LIMIT=N — cap the number of distinct games processed for marker
 *    detection (testing).
 *  - BEATEN_PLAYER_LIMIT=N — cap the number of player checks performed
 *    (testing).
 *  - SKIP_STEAMHUNTERS=1 — skip Steam Hunters entirely, marker detection
 *    falls straight to the heuristic. Ignored for an appId present in
 *    STEAMHUNTERS_TAGS_FILE.
 *  - STEAMHUNTERS_TAGS_FILE=<path> — load Steam Hunters story-tag
 *    candidates from a pre-harvested JSON file instead of live-fetching the
 *    (Cloudflare-gated) achievements page. Format:
 *    `{ "<appId>": { "status": "ok" | "no_story_tags" | "not_found" |
 *    "no_achievements_parsed", "candidates": [ { "apiname": "...",
 *    "is_dlc": false } ] } }`. An appId present with status "ok" uses its
 *    candidates; any other status is treated as no story tags found. An
 *    appId absent from the file falls back to the live fetch path (unless
 *    SKIP_STEAMHUNTERS is set).
 *  - SKIP_STEAM_API=1 — skip all Steam Web API calls (schema, global %,
 *    player achievements); nothing new can be determined, existing cache
 *    entries are still used.
 *
 * Run with: pnpm --filter scraper beaten
 */

const currentDir = dirname(fileURLToPath(import.meta.url))
const rootEnvPath = resolve(currentDir, '../../../../.env')
loadEnv({ path: existsSync(rootEnvPath) ? rootEnvPath : undefined })

const dataDir = resolve(currentDir, '../../../website/public/data')
const giveawaysPath = resolve(dataDir, 'giveaways.json')
const groupUsersPath = resolve(dataDir, 'group_users.json')
const exMembersPath = resolve(dataDir, 'ex_members.json')
const ipbDiscordPath = resolve(dataDir, 'ipb_discord.json')
const outputPath = resolve(dataDir, 'beaten_games.json')

const cacheDir = resolve(currentDir, '../../data')
const cachePath = resolve(cacheDir, 'beaten-cache.json')

const MARKER_FETCH_CAP = parseInt(process.env.MARKER_FETCH_CAP ?? '200', 10)
const PLAYER_CHECK_CAP = 500
// Reviewers act on fresh submissions, and members often finish a game hours
// after submitting — a not-yet-beaten verdict older than this is re-checked
// each run (achieved verdicts stay cached forever).
const PLAYER_RECHECK_STALE_MS = 12 * 60 * 60 * 1000 // 12 hours
const STEAM_API_DELAY_MS = 1000
// appdetails is aggressively rate-limited (~200 req/5min) even without a key.
const APPDETAILS_DELAY_MS = 1500

const SKIP_STEAMHUNTERS = process.env.SKIP_STEAMHUNTERS === '1'
const SKIP_STEAM_API = process.env.SKIP_STEAM_API === '1'

// --- Marker heuristic patterns, checked case-insensitively against
// displayName + description ---
const MARKER_PATTERNS: RegExp[] = [
  /finish(ed)? the (game|story)/i,
  /complete(d)? the (game|story|main story)/i,
  /beat the game/i,
  /roll(ed)? credits/i,
  /see (the )?credits/i,
  /reach(ed)? the end/i,
  /final (boss|chapter|mission)/i,
  /(any|first) ending/i,
  /complete the final/i,
]

const HEURISTIC_MIN_PERCENT = 2
const HEURISTIC_MAX_PERCENT = 90

// --- Steam Hunters story-tag candidate filtering ---
// Checked case-insensitively against displayName + description of the
// candidate's schema achievement. These catch difficulty-specific variants
// ("Beat the game on EASY") and challenge-run achievements ("finished the
// game without eating meat") that carry the Main Storyline tag but are poor
// beaten markers. "on any difficulty" must not match: the difficulty
// alternation excludes "any", and the trailing negative lookahead excludes
// "on hard or easy"-style compound phrasing.
const CHALLENGE_MARKER_PATTERNS: RegExp[] = [
  /\bon (easy|normal|hard|hardest|nightmare|expert|extreme|insane|survival|new game\+?|ng\+)\b(?! or)/i,
  /\bwithout\b/i,
  /\bno (deaths?|damage|hits?)\b/i,
  /\bdon'?t\b/i,
  /\b(all|every) (endings?|achievements?|difficult)/i,
  /\b100\s*%/,
  /\bspeedrun|\bunder \d+ (minutes|hours)\b/i,
]

/** A Steam Hunters story-tag candidate, from either the live fetch or the offline tags file. */
interface StoryCandidate {
  apiname: string
  isDlc: boolean
  /** Shipped in a post-launch content update — usually a DLC campaign even
   *  when Steam Hunters has no dlcAppId for the update. */
  isLaterUpdate: boolean
}

/** One appId's entry in STEAMHUNTERS_TAGS_FILE. */
interface TagsFileEntry {
  status: 'ok' | 'no_story_tags' | 'not_found' | 'no_achievements_parsed'
  candidates?: Array<{ apiname: string; is_dlc: boolean; is_later_update?: boolean }>
}

let tagsFileCache: Record<string, TagsFileEntry> | null | undefined

/** Lazily loads and memoizes STEAMHUNTERS_TAGS_FILE. Returns null if unset or unreadable. */
function loadTagsFile(): Record<string, TagsFileEntry> | null {
  if (tagsFileCache !== undefined) return tagsFileCache
  const path = process.env.STEAMHUNTERS_TAGS_FILE
  if (!path) {
    tagsFileCache = null
    return tagsFileCache
  }
  try {
    tagsFileCache = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (error) {
    logError(error, `Failed to load STEAMHUNTERS_TAGS_FILE at ${path}`)
    tagsFileCache = null
  }
  return tagsFileCache ?? null
}

interface GiveawayLookup {
  app_id: number | null
  package_id: number | null
}

interface TargetWin {
  steamId: string
  appId: number
  link: string
}

// --- Cache ---

interface MarkerCacheEntry {
  fetched_at: string
  marker: BeatenMarker | null
  no_marker_reason: NoMarkerReason | null
  story_tag_count: number
  resolved_app_id?: number
  resolved_app_name?: string
}

/** DLC/soundtrack -> base-game appId resolution (store appdetails). Permanent
 *  once determined: `resolved_app_id: null` means "checked, not a DLC (or no
 *  base game listed)", not "not yet checked". */
interface AppResolutionCacheEntry {
  fetched_at: string
  resolved_app_id: number | null
  resolved_app_name?: string
}

interface PlayerCheckCacheEntry {
  fetched_at: string
  /** apiname of the marker this entry was checked against; a mismatch with
   *  the current marker (or a missing field, from an older cache) is
   *  treated as a cache miss. */
  marker_apiname: string
  beaten: boolean | null
  unlock_time: number | null
  no_data_reason: NoBeatenDataReason | null
}

interface BeatenCache {
  markers: Record<string, MarkerCacheEntry>
  player_checks: Record<string, PlayerCheckCacheEntry>
  app_resolutions: Record<string, AppResolutionCacheEntry>
}

function loadCache(): BeatenCache {
  if (existsSync(cachePath)) {
    try {
      const raw = JSON.parse(readFileSync(cachePath, 'utf-8'))
      return {
        markers: raw.markers ?? {},
        player_checks: raw.player_checks ?? {},
        app_resolutions: raw.app_resolutions ?? {},
      }
    } catch (error) {
      console.warn('⚠️  Could not parse existing beaten cache, starting fresh:', error)
    }
  }
  return { markers: {}, player_checks: {}, app_resolutions: {} }
}

function saveCache(cache: BeatenCache): void {
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true })
  writeFileSync(cachePath, JSON.stringify(cache, null, 2))
}

// --- Marker detection ---

/**
 * Reduces a Steam Hunters story-tag candidate set to the ones worth
 * ranking by global percentage. DLC achievements are dropped unless every
 * candidate is DLC (a DLC marker beats none). Difficulty-specific and
 * challenge-run achievements are then dropped by matching their schema
 * displayName + description against {@link CHALLENGE_MARKER_PATTERNS}. If
 * that second pass eliminates every remaining candidate, it's discarded and
 * the pre-pattern-filter set is returned instead (a debatable marker beats
 * none) with `filtered: false`.
 */
function selectStoryCandidates(
  candidates: StoryCandidate[],
  achievements: Array<{ name: string; displayName?: string; description?: string }>,
  hiddenDescriptions?: Map<string, string>,
): { survivors: StoryCandidate[]; filtered: boolean } {
  const nonDlc = candidates.filter((c) => !c.isDlc)
  const dlcPass = nonDlc.length > 0 ? nonDlc : candidates
  // Prefer launch-update achievements: post-launch story tags are usually a
  // DLC campaign shipped as a title update (no dlcAppId to filter on).
  const launchOnly = dlcPass.filter((c) => !c.isLaterUpdate)
  const dlcFiltered = launchOnly.length > 0 ? launchOnly : dlcPass

  const textFor = (c: StoryCandidate) => {
    const schemaAch = achievements.find((a) => a.name === c.apiname)
    const description =
      schemaAch?.description || hiddenDescriptions?.get(c.apiname) || ''
    return `${schemaAch?.displayName ?? ''} ${description}`
  }

  const patternFiltered = dlcFiltered.filter(
    (c) => !CHALLENGE_MARKER_PATTERNS.some((re) => re.test(textFor(c))),
  )

  if (patternFiltered.length > 0) return { survivors: patternFiltered, filtered: true }
  return { survivors: dlcFiltered, filtered: false }
}

async function detectMarker(
  appId: number,
  checker: SteamGameChecker,
): Promise<{
  marker: BeatenMarker | null
  no_marker_reason: NoMarkerReason | null
  story_tag_count: number
}> {
  if (SKIP_STEAM_API) {
    return { marker: null, no_marker_reason: 'schema_unavailable', story_tag_count: 0 }
  }

  const achievements = await checker.getSchemaAchievements(appId)
  if (!achievements) {
    return { marker: null, no_marker_reason: 'schema_unavailable', story_tag_count: 0 }
  }
  if (achievements.length === 0) {
    return { marker: null, no_marker_reason: 'no_achievements', story_tag_count: 0 }
  }

  const globalPercentages = await checker.getGlobalAchievementPercentages(appId)

  // --- Primary signal: Steam Hunters "Main Storyline" tag ---
  const tagsFile = loadTagsFile()
  const fileEntry = tagsFile?.[String(appId)]

  let storyCandidates: StoryCandidate[] = []
  if (fileEntry) {
    if (fileEntry.status === 'ok') {
      storyCandidates = (fileEntry.candidates ?? []).map((c) => ({
        apiname: c.apiname,
        isDlc: c.is_dlc,
        isLaterUpdate: c.is_later_update ?? false,
      }))
    }
    // Any other status means no story tags were found for this appId; leave
    // storyCandidates empty and fall through to the heuristic below.
  } else if (!SKIP_STEAMHUNTERS) {
    const tagsResult = await fetchSteamHuntersTags(appId)
    await delay(STEAMHUNTERS_DELAY_MS)

    if (tagsResult.status === 'ok') {
      storyCandidates = tagsResult.candidates.map((c) => ({
        apiname: c.apiName,
        isDlc: c.isDlc,
        isLaterUpdate: c.isLaterUpdate,
      }))
    }
  }

  if (storyCandidates.length > 0) {
    // Hidden achievements have an empty description in the Steam schema, so
    // the challenge-pattern filter can't see e.g. "finish the game without
    // eating meat". Steam Hunters' JSON API (not Cloudflare-challenged, so
    // usable even when the tags themselves came from an offline file)
    // exposes those descriptions — fetch them when any candidate is hidden.
    let hiddenDescriptions: Map<string, string> | undefined
    const hasHidden = storyCandidates.some((c) => {
      const schemaAch = achievements.find((a) => a.name === c.apiname)
      return schemaAch != null && !schemaAch.description
    })
    if (hasHidden) {
      const shAchievements = await fetchSteamHuntersAchievements(appId)
      await delay(STEAMHUNTERS_DELAY_MS)
      if (shAchievements) {
        hiddenDescriptions = new Map(
          shAchievements.map((a) => [a.apiName, a.description ?? '']),
        )
      }
    }

    const { survivors, filtered } = selectStoryCandidates(
      storyCandidates,
      achievements,
      hiddenDescriptions,
    )

    let best: { apiname: string; percent: number } | null = null
    for (const c of survivors) {
      const percent = globalPercentages?.[c.apiname]
      if (percent == null) continue
      if (!best || percent < best.percent) best = { apiname: c.apiname, percent }
    }
    if (best) {
      const schemaAch = achievements.find((a) => a.name === best!.apiname)
      return {
        marker: {
          apiname: best.apiname,
          name: schemaAch?.displayName ?? best.apiname,
          description:
            schemaAch?.description || hiddenDescriptions?.get(best.apiname) || '',
          global_percent: best.percent,
          source: 'steamhunters',
          filtered,
        },
        no_marker_reason: null,
        story_tag_count: storyCandidates.length,
      }
    }
  }

  // --- Fallback: description/name heuristic ---
  let best: { apiname: string; name: string; description: string; percent: number } | null = null
  for (const a of achievements) {
    const text = `${a.displayName ?? ''} ${a.description ?? ''}`
    if (!MARKER_PATTERNS.some((re) => re.test(text))) continue
    // "Finish the game …" can still be a challenge variant ("… in under 4
    // hours", "… on Hard"); those are markers most finishers won't have.
    if (CHALLENGE_MARKER_PATTERNS.some((re) => re.test(text))) continue
    const percent = globalPercentages?.[a.name]
    if (percent == null) continue
    if (percent < HEURISTIC_MIN_PERCENT || percent > HEURISTIC_MAX_PERCENT) continue
    if (!best || percent < best.percent) {
      best = { apiname: a.name, name: a.displayName, description: a.description, percent }
    }
  }

  if (best) {
    return {
      marker: {
        apiname: best.apiname,
        name: best.name,
        description: best.description,
        global_percent: best.percent,
        source: 'heuristic',
      },
      no_marker_reason: null,
      story_tag_count: 0,
    }
  }

  return { marker: null, no_marker_reason: 'no_marker_found', story_tag_count: 0 }
}

// --- DLC -> base game resolution ---

/**
 * Resolves an appId to its base game via the Steam store appdetails
 * endpoint, when it's a DLC or soundtrack with a listed `fullgame`. Result
 * is cached permanently (including negative results) since the answer never
 * changes. Only called for games whose marker detection came back empty —
 * a small set — since appdetails is aggressively rate-limited.
 */
async function resolveAppForDlc(
  appId: number,
  checker: SteamGameChecker,
  cache: BeatenCache,
): Promise<AppResolutionCacheEntry> {
  const key = String(appId)
  const cached = cache.app_resolutions[key]
  if (cached) return cached

  let entry: AppResolutionCacheEntry
  if (SKIP_STEAM_API) {
    entry = { fetched_at: new Date().toISOString(), resolved_app_id: null }
  } else {
    const details = await checker.getAppDetails(appId)
    await delay(APPDETAILS_DELAY_MS)

    const isDlcLike = details?.type === 'dlc' || details?.type === 'music'
    entry = {
      fetched_at: new Date().toISOString(),
      resolved_app_id: isDlcLike && details?.fullgameAppId != null ? details.fullgameAppId : null,
      ...(isDlcLike && details?.fullgameName ? { resolved_app_name: details.fullgameName } : {}),
    }
  }

  cache.app_resolutions[key] = entry
  return entry
}

/**
 * Marker detection with DLC fallback: if the direct schema lookup for
 * `appId` comes back unavailable/empty (the DLC case — no achievement
 * schema of its own), resolve it to its base game and re-run detection
 * there instead. Play evidence for a DLC lives on the base game.
 */
async function detectMarkerWithResolution(
  appId: number,
  checker: SteamGameChecker,
  cache: BeatenCache,
): Promise<{
  marker: BeatenMarker | null
  no_marker_reason: NoMarkerReason | null
  story_tag_count: number
  resolved_app_id?: number
  resolved_app_name?: string
}> {
  const direct = await detectMarker(appId, checker)

  if (direct.no_marker_reason !== 'schema_unavailable' && direct.no_marker_reason !== 'no_achievements') {
    return direct
  }

  const resolution = await resolveAppForDlc(appId, checker, cache)
  if (resolution.resolved_app_id == null) return direct

  const baseResult = await detectMarker(resolution.resolved_app_id, checker)
  return {
    ...baseResult,
    resolved_app_id: resolution.resolved_app_id,
    ...(resolution.resolved_app_name ? { resolved_app_name: resolution.resolved_app_name } : {}),
  }
}

// --- Player check ---

async function checkPlayerBeaten(
  steamId: string,
  appId: number,
  marker: BeatenMarker,
  checker: SteamGameChecker,
): Promise<{ beaten: boolean | null; unlock_time: number | null; no_data_reason: NoBeatenDataReason | null }> {
  if (SKIP_STEAM_API) {
    return { beaten: null, unlock_time: null, no_data_reason: 'no_stats' }
  }

  const achievements = await checker.getPlayerAchievementsForApp(steamId, appId)

  if (achievements === null) {
    // Matches getPlayerAchievements' contract: null means the profile is
    // private or the game has no stats for this player — can't tell which
    // without a separate visibility check, so classify as private (the more
    // common cause and the more actionable one for a UI badge).
    const visibility = await checker.checkProfileVisibility(steamId)
    return {
      beaten: null,
      unlock_time: null,
      no_data_reason: visibility.is_public ? 'no_stats' : 'profile_private',
    }
  }

  if (achievements.length === 0) {
    return { beaten: null, unlock_time: null, no_data_reason: 'no_stats' }
  }

  const found = achievements.find((a) => a.apiname === marker.apiname)
  if (!found) {
    return { beaten: null, unlock_time: null, no_data_reason: 'marker_missing_from_player_data' }
  }

  return {
    beaten: found.achieved === 1,
    unlock_time: found.achieved === 1 ? found.unlocktime : null,
    no_data_reason: null,
  }
}

// --- Main pipeline ---

export async function generateBeatenData(): Promise<void> {
  console.log('🚀 Starting beaten-game detection...')

  const giveawaysJson = JSON.parse(readFileSync(giveawaysPath, 'utf-8'))
  const giveaways: Giveaway[] = giveawaysJson.giveaways ?? []
  const giveawayByLink = new Map<string, Giveaway>()
  for (const g of giveaways) giveawayByLink.set(g.link, g)

  const now = Date.now() / 1000
  const isCounted = (g: Giveaway) =>
    !g.deleted && !(g.end_timestamp < now && (g.entry_count ?? 0) === 0)

  const groupUsersJson = JSON.parse(readFileSync(groupUsersPath, 'utf-8'))
  const exMembersJson = existsSync(exMembersPath)
    ? JSON.parse(readFileSync(exMembersPath, 'utf-8'))
    : { users: {} }

  const allUsers: Record<string, User> = {
    ...(groupUsersJson.users ?? {}),
    ...(exMembersJson.users ?? {}),
  }

  // Wins with a pending Discord verification submission are targets too —
  // reviewers need a beaten verdict for them ahead of the mod flipping
  // i_played_bro. Loaded tolerantly: a missing file behaves as today.
  const ipbDiscordWinKeys = new Set<string>()
  if (existsSync(ipbDiscordPath)) {
    try {
      const ipbDiscordJson = JSON.parse(readFileSync(ipbDiscordPath, 'utf-8'))
      for (const key of Object.keys(ipbDiscordJson.wins ?? {})) ipbDiscordWinKeys.add(key)
    } catch (error) {
      logError(error, `Failed to load ${ipbDiscordPath}`)
    }
  }

  // --- Build target set: (steamId, appId) pairs from qualifying wins ---
  const targetWins: TargetWin[] = []
  const targetAppIds = new Set<number>()
  const packageOnlyAppIds = new Set<string>() // links that resolved to package-only, for logging

  for (const [steamId, user] of Object.entries(allUsers)) {
    for (const win of user.giveaways_won ?? []) {
      if (win.deleted) continue
      const isDiscordSubmitted = ipbDiscordWinKeys.has(`${steamId}::${win.link}`)
      if (!(win.required_play || win.i_played_bro || isDiscordSubmitted)) continue

      const giveaway = giveawayByLink.get(win.link)
      if (!giveaway || !isCounted(giveaway)) continue

      if (giveaway.app_id != null) {
        targetWins.push({ steamId, appId: giveaway.app_id, link: win.link })
        targetAppIds.add(giveaway.app_id)
      } else {
        // package_id-only wins: no marker detection in v1.
        packageOnlyAppIds.add(win.link)
      }
    }
  }

  console.log(
    `🎯 Target wins: ${targetWins.length} (${targetAppIds.size} distinct app_id games); ${packageOnlyAppIds.size} package-only wins skipped`,
  )

  let uniqueAppIds = Array.from(targetAppIds)
  const beatenLimit = Number(process.env.BEATEN_LIMIT)
  if (Number.isFinite(beatenLimit) && beatenLimit > 0) {
    uniqueAppIds = uniqueAppIds.slice(0, beatenLimit)
    console.log(`🔧 BEATEN_LIMIT set — processing first ${uniqueAppIds.length} games for marker detection`)
  }
  const uniqueAppIdSet = new Set(uniqueAppIds)

  const cache = loadCache()
  const checker = new SteamGameChecker()

  // --- Phase 1: marker detection (cached per appId) ---
  const games: Record<string, BeatenGameEntry> = {}
  let markerFetchCount = 0
  let deferredMarkers = 0
  const sourceCounts = { steamhunters: 0, heuristic: 0, none: 0 }

  console.log(`🏅 Detecting beaten markers for ${uniqueAppIds.length} game(s)...`)
  for (let i = 0; i < uniqueAppIds.length; i++) {
    const appId = uniqueAppIds[i]
    const cached = cache.markers[String(appId)]

    // A cached "no schema"/"no achievements" verdict predates DLC
    // resolution unless an app_resolutions entry for it already exists and
    // confirmed it's not a DLC (resolved_app_id: null, permanent). Anything
    // else — never checked, or checked and found to resolve — is stale and
    // treated as a miss so it re-detects (possibly against a base game).
    const appResolution = cache.app_resolutions[String(appId)]
    const staleUnresolved =
      cached != null &&
      (cached.no_marker_reason === 'schema_unavailable' || cached.no_marker_reason === 'no_achievements') &&
      cached.resolved_app_id == null &&
      !(appResolution != null && appResolution.resolved_app_id == null)

    if (cached && !staleUnresolved) {
      games[String(appId)] = {
        marker: cached.marker,
        no_marker_reason: cached.no_marker_reason,
        story_tag_count: cached.story_tag_count,
        checked_at: cached.fetched_at,
        ...(cached.resolved_app_id != null ? { resolved_app_id: cached.resolved_app_id } : {}),
        ...(cached.resolved_app_name ? { resolved_app_name: cached.resolved_app_name } : {}),
      }
      if (cached.marker) sourceCounts[cached.marker.source]++
      else sourceCounts.none++
      continue
    }

    if (markerFetchCount >= MARKER_FETCH_CAP) {
      deferredMarkers++
      continue
    }

    try {
      const result = await detectMarkerWithResolution(appId, checker, cache)
      const fetchedAt = new Date().toISOString()
      cache.markers[String(appId)] = { fetched_at: fetchedAt, ...result }
      games[String(appId)] = { ...result, checked_at: fetchedAt }
      if (result.marker) sourceCounts[result.marker.source]++
      else sourceCounts.none++
      markerFetchCount++
    } catch (error) {
      logError(error, `Failed to detect beaten marker for appId ${appId}`)
      console.warn(`⚠️  Failed to detect marker for appid ${appId}:`, String(error))
    }

    if (!SKIP_STEAM_API) await delay(STEAM_API_DELAY_MS)

    if (markerFetchCount > 0 && markerFetchCount % 50 === 0) {
      saveCache(cache)
      console.log(`💾 Cache checkpoint saved (${markerFetchCount} marker fetches so far)`)
    }
    if ((i + 1) % 25 === 0 || i === uniqueAppIds.length - 1) {
      console.log(`📈 Games processed: ${i + 1}/${uniqueAppIds.length}`)
    }
  }
  saveCache(cache)
  console.log(
    `✅ Marker detection complete — ${markerFetchCount} fresh fetches, ${sourceCounts.steamhunters} steamhunters, ${sourceCounts.heuristic} heuristic, ${sourceCounts.none} undetermined${deferredMarkers > 0 ? `, ${deferredMarkers} deferred to next run` : ''}`,
  )

  // --- Phase 2: player checks (cached per steamId::appId) ---
  let relevantWins = targetWins.filter((w) => uniqueAppIdSet.has(w.appId))
  const playerLimit = Number(process.env.BEATEN_PLAYER_LIMIT)
  if (Number.isFinite(playerLimit) && playerLimit > 0) {
    relevantWins = relevantWins.slice(0, playerLimit)
    console.log(`🔧 BEATEN_PLAYER_LIMIT set — checking first ${relevantWins.length} wins`)
  }

  const wins: Record<string, BeatenWinEntry> = {}
  let playerCheckCount = 0
  let deferredPlayerChecks = 0
  const nowMs = Date.now()

  console.log(`🕹️  Checking beaten status for ${relevantWins.length} win(s)...`)
  for (let i = 0; i < relevantWins.length; i++) {
    const { steamId, appId } = relevantWins[i]
    const key = `${steamId}::${appId}`
    const cached = cache.player_checks[key]
    const gameEntry = games[String(appId)]
    const marker = gameEntry?.marker
    // A DLC's play evidence lives on its base game — check achievements
    // there while keeping the cache/output keyed by the original appId.
    const checkAppId = gameEntry?.resolved_app_id ?? appId

    // A cached entry checked against a different marker (or missing the
    // field, from an older cache) is a miss — the marker may have changed
    // since the entry was written, so its beaten status is unverified.
    const cacheFresh =
      cached &&
      marker != null &&
      cached.marker_apiname === marker.apiname &&
      (cached.beaten === true ||
        nowMs - new Date(cached.fetched_at).getTime() < PLAYER_RECHECK_STALE_MS)

    if (cacheFresh) {
      wins[key] = {
        beaten: cached.beaten,
        unlock_time: cached.unlock_time,
        no_data_reason: cached.no_data_reason,
        checked_at: cached.fetched_at,
      }
      continue
    }

    if (!marker) {
      // No marker to check against — nothing to record; the game entry
      // already carries the reason.
      continue
    }

    if (playerCheckCount >= PLAYER_CHECK_CAP) {
      deferredPlayerChecks++
      // Keep the stale cached value (if any) rather than dropping the win.
      if (cached) {
        wins[key] = {
          beaten: cached.beaten,
          unlock_time: cached.unlock_time,
          no_data_reason: cached.no_data_reason,
          checked_at: cached.fetched_at,
        }
      }
      continue
    }

    try {
      const result = await checkPlayerBeaten(steamId, checkAppId, marker, checker)
      const fetchedAt = new Date().toISOString()
      cache.player_checks[key] = { fetched_at: fetchedAt, marker_apiname: marker.apiname, ...result }
      wins[key] = { ...result, checked_at: fetchedAt }
      playerCheckCount++
    } catch (error) {
      logError(error, `Failed to check beaten status for ${key}`)
      console.warn(`⚠️  Failed to check beaten status for ${key}:`, String(error))
    }

    if (!SKIP_STEAM_API) await delay(STEAM_API_DELAY_MS)

    if (playerCheckCount > 0 && playerCheckCount % 50 === 0) {
      saveCache(cache)
      console.log(`💾 Cache checkpoint saved (${playerCheckCount} player checks so far)`)
    }
    if ((i + 1) % 25 === 0 || i === relevantWins.length - 1) {
      console.log(`📈 Wins checked: ${i + 1}/${relevantWins.length}`)
    }
  }
  saveCache(cache)
  console.log(
    `✅ Player checks complete — ${playerCheckCount} fresh checks${deferredPlayerChecks > 0 ? `, ${deferredPlayerChecks} deferred to next run` : ''}`,
  )

  const output: BeatenGamesData = {
    last_updated: new Date().toISOString(),
    games,
    wins,
  }

  writeFileSync(outputPath, JSON.stringify(output, null, 2))
  console.log(
    `💾 Beaten games data saved to ${outputPath} (${Object.keys(games).length} games, ${Object.keys(wins).length} wins)`,
  )
}

if (
  import.meta.url.startsWith('file:') &&
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  await generateBeatenData()
}
