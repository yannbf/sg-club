// Steam Hunters fetcher.
//
// Steam Hunters (steamhunters.com) exposes achievement metadata — including
// global unlock rarity, same as Steam's own endpoint — through a plain JSON
// API. What it has that Steam doesn't is community-voted *tags* on
// individual achievements ("Main Storyline", "Missable", "Collectible", …),
// which are the strongest signal for picking the achievement that marks a
// game as "beaten". Tags are NOT in the JSON API; the achievements HTML page
// embeds a JSON bootstrap model whose achievement objects carry a
// `tagVotes` array of numeric tag ids alongside `apiName` and `updateId`,
// and the tags are only rendered into the visible DOM client-side. The raw
// HTML is therefore parsed for those embedded JSON objects, not for markup.
//
// The same bootstrap model embeds an `"updates":[...]` array describing each
// content update; an update entry lists the DLC it shipped with under
// `dlcAppIds` (an empty array for base-game updates; older pages used a
// single `dlcAppId` key that is absent for base-game updates). Cross-referencing
// each story-tagged achievement's `updateId` against that array flags
// DLC-only achievements, which are a common source of bad "beaten" markers
// (a DLC mission achievement is a poor stand-in for finishing the base
// game).
//
// The HTML page sits behind Cloudflare and can return a 403/challenge page,
// especially from CI IP ranges. That's treated as "tags unavailable" for
// this game, not retried — the JSON API (used for global percentages) is
// unaffected since it isn't behind the same challenge.

import { delay, isRateLimitedHtml } from '../utils/common.js'
import { logError } from '../utils/log-error.js'

const BASE_URL = 'https://steamhunters.com'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

/** Delay observed between Steam Hunters requests to stay under the radar. */
export const STEAMHUNTERS_DELAY_MS = 2000

export interface SteamHuntersAchievement {
  achievementId: number
  apiName: string
  name: string
  description: string
  steamPercentage: number
}

export type SteamHuntersTagStatus = 'ok' | 'blocked' | 'error'

/** A Main Storyline-tagged achievement candidate for the "beaten" marker. */
export interface SteamHuntersCandidate {
  apiName: string
  /** Whether the achievement shipped with a DLC update rather than the base game. */
  isDlc: boolean
  /**
   * Whether the achievement shipped in a content update AFTER the game's
   * first tracked update. Post-launch story achievements are usually DLC
   * campaigns even when Steam Hunters has no dlcAppId for the update (DLC
   * shipped as a title update), so selection prefers launch candidates.
   */
  isLaterUpdate: boolean
}

export interface SteamHuntersTagsResult {
  status: SteamHuntersTagStatus
  /** Story-tag candidates, only present (possibly empty) when status is 'ok'. */
  candidates: SteamHuntersCandidate[]
}

/** GET /api/apps/{appId}/achievements — plain JSON, no Cloudflare challenge
 *  observed on this endpoint. Returns null on any failure. */
export async function fetchSteamHuntersAchievements(
  appId: number,
): Promise<SteamHuntersAchievement[] | null> {
  const url = `${BASE_URL}/api/apps/${appId}/achievements`
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    })
    if (!response.ok) return null
    const data = await response.json()
    if (!Array.isArray(data)) return null
    return data as SteamHuntersAchievement[]
  } catch (error) {
    logError(error, `Failed to fetch Steam Hunters achievements for appId ${appId}`)
    return null
  }
}

/**
 * GET /apps/{appId}/achievements — HTML page; the embedded JSON bootstrap
 * model is parsed for achievements whose `tagVotes` include the Main
 * Storyline tag id. The apiName is part of the same embedded object, so no
 * follow-up JSON API call is needed.
 */
export async function fetchSteamHuntersTags(
  appId: number,
): Promise<SteamHuntersTagsResult> {
  const url = `${BASE_URL}/apps/${appId}/achievements`
  let html: string
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    })
    const body = await response.text()
    if (
      response.status === 403 ||
      response.status === 503 ||
      isRateLimitedHtml(body)
    ) {
      return { status: 'blocked', candidates: [] }
    }
    if (!response.ok) {
      return { status: 'error', candidates: [] }
    }
    html = body
  } catch (error) {
    logError(error, `Failed to fetch Steam Hunters achievements page for appId ${appId}`)
    return { status: 'error', candidates: [] }
  }

  return { status: 'ok', candidates: parseTagsByApiName(html) }
}

/** Steam Hunters' numeric id for the "Main Storyline" achievement tag. */
const MAIN_STORYLINE_TAG_ID = 3

/** An update object that shipped with at least one DLC, in either page format. */
const DLC_UPDATE_RE = /"dlcAppIds?":\s*(?:\[\s*\d|\d)/

/**
 * Parse the achievements page's embedded JSON model into Main
 * Storyline-tagged candidates, each flagged with whether it shipped as part
 * of a DLC update.
 *
 * Achievement objects appear inline as
 * `"achievementId":N,"updateId":N,...,"apiName":"...","name":"..."[,"description":"..."]...,"tagVotes":[{"tagId":3},…]`;
 * the keys between `updateId` and `apiName` vary by page version
 * (`internalKey` appeared in 2026), so only their absence of braces is
 * relied on.
 * Only the Main Storyline tag is extracted — it's the sole tag the beaten
 * pipeline consumes, and other tag ids' names are not present in the HTML.
 *
 * The `"updates":[...]` array holds flat objects like
 * `{"updateId":N,"updateNumber":N,...,"dlcAppIds":[...]}`; an update shipped
 * with a DLC when that array is non-empty (or, on older pages, when a
 * `"dlcAppId":N` key is present). Achievements are matched to
 * updates by `updateId` to derive `isDlc`. These arrays contain JS
 * expressions (e.g. `new Date(...)`) so they are not valid JSON on their
 * own — both are parsed with targeted regexes instead of a single
 * `JSON.parse`.
 */
export function parseTagsByApiName(html: string): SteamHuntersCandidate[] {
  const dlcUpdateIds = new Set<number>()
  const allUpdateIds: number[] = []
  const updateRe = /\{"updateId":(\d+),"updateNumber"[^{}]*?\}/g
  for (const match of html.matchAll(updateRe)) {
    allUpdateIds.push(Number(match[1]))
    if (DLC_UPDATE_RE.test(match[0])) {
      dlcUpdateIds.add(Number(match[1]))
    }
  }
  const firstUpdateId = allUpdateIds.length > 0 ? Math.min(...allUpdateIds) : 0

  const candidates: SteamHuntersCandidate[] = []
  const achievementRe =
    /"achievementId":\d+,"updateId":(\d+),[^{}]*?"apiName":"((?:[^"\\]|\\.)*)","name":"(?:[^"\\]|\\.)*"[\s\S]*?"tagVotes":(\[[^\]]*\])/g

  for (const match of html.matchAll(achievementRe)) {
    try {
      const updateId = Number(match[1])
      const apiName: string = JSON.parse(`"${match[2]}"`)
      const votes: Array<{ tagId?: number }> = JSON.parse(match[3])
      if (votes.some((v) => v.tagId === MAIN_STORYLINE_TAG_ID)) {
        candidates.push({
          apiName,
          isDlc: dlcUpdateIds.has(updateId),
          isLaterUpdate: updateId > firstUpdateId,
        })
      }
    } catch {
      // Malformed fragment — skip this block rather than failing the page.
    }
  }
  return candidates
}

export { delay as steamHuntersDelay }
