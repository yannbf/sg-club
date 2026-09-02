import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import type { SteamIdMap } from '../types/steamgifts.js'

/**
 * Generates the data files that power the gaming-challenge leaderboards under
 * /events. Every challenge lives in ONE file, public/data/challenge_<slug>.json,
 * holding the event info, the leaderboard (`participants`) and, for roster-based
 * challenges, the fixed `roster` + the `nonParticipants` who played anyway.
 *
 * Challenges are declared in the CHALLENGES registry below. There are two kinds:
 *
 *  - **achievement** (e.g. Gaming Challenge #1 — Backpack Hero): a single winning
 *    achievement; the FIRST member to unlock it during the window wins. Uses a
 *    fixed `roster` (participants + guests) preserved in the data file.
 *
 *  - **completion** (e.g. Gaming Challenge #2 — Kill The Crows): win by reaching
 *    100% of the game's achievements (whenever — pre-challenge completions count)
 *    AND logging over `minPlaytimeMinutes` of play during the challenge window.
 *    EVERY participant who qualifies wins; there can be many.
 *
 * Either kind can use a `fixed` roster (sign-up list kept in the data file) or
 * be `open` to every group member who owns the game — see ChallengeConfig.
 *
 * Challenge-window playtime is `current_total − baseline`, where the baseline is
 * seeded on the first run to `playtime_forever − playtime_2weeks` (i.e. play
 * before the recent window) and then frozen, so the figure is meaningful
 * immediately and grows correctly on later runs. Achievement timing uses each
 * achievement's `unlocktime`; for completion challenges total achievements count
 * regardless of when they were unlocked.
 *
 * Progress is treated as monotonic: Steam intermittently hides a member's
 * playtime/achievements when their game-details privacy is toggled, so each run
 * floors playtime and achievement progress at the highest we've previously
 * recorded — an occasionally-private profile can't wipe a qualified member.
 *
 * Re-run regularly with: pnpm --filter scraper challenge
 * Generates every non-dormant challenge by default (finished challenges are
 * marked `dormant` and refresh on a slower cadence); pass a data-slug
 * (CHALLENGE=neo_cab or `… challenge neo_cab`) to run just that one, dormant
 * or not, or set INCLUDE_DORMANT=true to refresh everything (the biweekly CI
 * run).
 *
 * A `fixed`-roster challenge whose start hasn't arrived yet and has no
 * `roster` block in its data file is in **sign-up phase**: instead of
 * erroring, the run generates a preview over every group member (like an
 * `open` challenge), drops non-owners, and marks the file `signup_phase:
 * true`. Every member's baseline is their current total playtime, since
 * everything played before the real challenge starts is pre-challenge
 * progress. The output carries no `roster`, so adding one later switches the
 * challenge to normal fixed-roster mode and clears `signup_phase` on the
 * next run.
 */

const currentDir = dirname(fileURLToPath(import.meta.url))
const rootEnvPath = resolve(currentDir, '../../../../.env')
loadEnv({ path: existsSync(rootEnvPath) ? rootEnvPath : undefined })

// Read at module scope so the fetch helpers can reference it, but validate in
// main() rather than here — a top-level process.exit() would make this module
// impossible to import from tests.
const API_KEY = process.env.STEAM_API_KEY

const BASE = 'https://api.steampowered.com'

const dataDir = resolve(currentDir, '../../../website/public/data')
const usersPath = resolve(dataDir, 'group_users.json')
const legacyParticipantsPath = resolve(dataDir, 'challenge_participants.json')
const steamIdMapPath = resolve(dataDir, 'steam_id_map.json')

type RosterEntry =
  | string
  | { steam_id?: string; username?: string; displayName?: string }

interface MilestoneConfig {
  apiname: string
  label: string
  /** Items required to reach this milestone (e.g. 200/400/700). */
  items: number
}

/** First member to unlock a single winning achievement wins. */
interface AchievementWin {
  type: 'achievement'
  apiname: string
  displayName: string
  description: string
  iconUrl?: string
  /** Optional progression shown on each row (e.g. Discoverer → Expert → Hero). */
  milestones?: MilestoneConfig[]
}

/**
 * Everyone who reaches 100% of the achievements (whenever — pre-challenge
 * completions count too) AND logs more than `minPlaytimeMinutes` of play during
 * the challenge window (when one is set) AND, when `requireReview` is on, has a
 * public Steam review for the game, wins.
 */
interface CompletionWin {
  type: 'completion'
  /** Unix seconds — the end of the challenge window (exclusive). */
  deadline: number
  /** Minutes of challenge-window playtime required to win (0/omitted = none). */
  minPlaytimeMinutes?: number
  /** Winning also requires a public Steam review of the game. */
  requireReview?: boolean
  /**
   * Achievement apinames excluded from the 100% goal (e.g. Bloody Spell's
   * "Master of Magic"): dropped from both the required total and the unlocked
   * count, so completion means "everything except these".
   */
  excludeAchievements?: string[]
  /**
   * Optional lower prize tier: unlocking this single achievement (by the
   * deadline, plus the same playtime/review gates) also qualifies, at the
   * `story` tier. Full completion upgrades the member to the `completion`
   * tier. Each participant's tier lands in `win_tier`.
   */
  storyAchievement?: {
    apiname: string
    displayName: string
    description?: string
  }
}

export type WinTier = 'completion' | 'story'

interface ChallengeConfig {
  /** Stored in the output `slug` field; mirrors the event URL slug. */
  slug: string
  /** Short data-file slug → public/data/challenge_<dataSlug>.json. */
  dataSlug: string
  appId: number
  gameName: string
  startTimestamp: number
  /**
   * `fixed`: only the in-file `roster` (participants + guests) competes; other
   * members who own & played are surfaced as `nonParticipants`.
   * `open`: every group member who owns the game competes; no roster, no
   * `nonParticipants`.
   */
  roster: 'fixed' | 'open'
  win: AchievementWin | CompletionWin
  /**
   * A finished challenge: skipped on normal (hourly) runs so no Steam calls
   * are made for it; refreshed only by the biweekly INCLUDE_DORMANT=true run.
   * Passing the challenge's slug explicitly (CHALLENGE=… / CLI arg) also runs it.
   */
  dormant?: boolean
}

/**
 * The challenge registry. Add a challenge here, create its event entry in
 * packages/website/src/lib/events.ts, and wire the data file into CI.
 */
const CHALLENGES: ChallengeConfig[] = [
  {
    slug: 'gaming-challenge-1-backpack-hero',
    dataSlug: 'backpack_hero',
    appId: 1970580,
    gameName: 'Backpack Hero',
    startTimestamp: Date.UTC(2026, 5, 8) / 1000, // midnight 2026-06-08 UTC
    roster: 'fixed',
    dormant: true, // finished — leaderboard frozen, no more data pulls
    win: {
      type: 'achievement',
      apiname: 'ItemHero',
      displayName: 'Hero',
      description: 'Discover at least 700 items',
      iconUrl:
        'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/1970580/8a4c1ba13e41f1cadff981bfefe467cae6baa6d3.jpg',
      // The item-discovery progression toward the win condition (Hero = 700).
      milestones: [
        { apiname: 'ItemDiscoverer', label: 'Discoverer', items: 200 },
        { apiname: 'ItemExpert', label: 'Expert', items: 400 },
        { apiname: 'ItemHero', label: 'Hero', items: 700 },
      ],
    },
  },
  {
    slug: 'gaming-challenge-2-kill-the-crows',
    dataSlug: 'kill_the_crows',
    appId: 2441270,
    gameName: 'Kill The Crows',
    startTimestamp: Date.UTC(2026, 5, 11) / 1000, // midnight 2026-06-11 UTC
    roster: 'fixed',
    dormant: true, // finished — leaderboard frozen, no more data pulls
    win: {
      type: 'completion',
      // Challenge window ends 30 June. The cutoff is nominally July 1 00:00 UTC,
      // but we extend it to 01:10 UTC to leniently include a member who hit 100%
      // at 01:09 UTC — still 30 June in their local timezone. The site still
      // displays the deadline as "30 Jun" (deadlineDisplayTs backs off 12h).
      deadline: Date.UTC(2026, 6, 1, 1, 10) / 1000,
      // Winners must also log over 2h of play during the window.
      minPlaytimeMinutes: 120,
    },
  },
  {
    slug: 'gaming-challenge-3-neo-cab',
    dataSlug: 'neo_cab',
    appId: 794540,
    gameName: 'Neo Cab',
    startTimestamp: Date.UTC(2026, 6, 3) / 1000, // midnight 2026-07-03 UTC
    roster: 'fixed',
    win: {
      type: 'completion',
      // Challenge window: July 3 – July 31. The cutoff is Aug 1 00:00 UTC
      // (exclusive); the site displays the deadline as "31 Jul".
      deadline: Date.UTC(2026, 7, 1) / 1000,
      // No playtime floor this time — the mission is 100% completion plus a
      // Steam review, so pre-challenge completions only need the review.
      requireReview: true,
    },
  },
  {
    slug: 'gaming-challenge-4-bloody-spell',
    dataSlug: 'bloody_spell',
    appId: 992300,
    gameName: 'Bloody Spell',
    startTimestamp: Date.UTC(2026, 7, 1) / 1000, // midnight 2026-08-01 UTC
    roster: 'fixed',
    win: {
      type: 'completion',
      // Challenge window: Aug 1 – Aug 31. The cutoff is Sept 1 00:00 UTC
      // (exclusive); the site displays the deadline as "31 Aug".
      deadline: Date.UTC(2026, 8, 1) / 1000,
      // Both prize tiers require a Steam review AND over 2h of play logged
      // during the challenge window (even for pre-challenge story clears).
      requireReview: true,
      minPlaytimeMinutes: 120,
      // Two prize tiers: 🥉 clear the main story ("Departure") for the €10
      // draw; 🥇 full completion upgrades the prize to €20. "Master of Magic"
      // is excluded from the 100% goal.
      storyAchievement: {
        apiname: 'a10016',
        displayName: 'Departure',
        description: 'Clear the main storyline.',
      },
      excludeAchievements: ['a30008'], // Master of Magic
    },
  },
  {
    slug: 'gaming-challenge-5-escape-from-mystwood-mansion',
    dataSlug: 'mystwood_mansion',
    appId: 2292650,
    gameName: 'Escape From Mystwood Mansion',
    startTimestamp: Date.UTC(2026, 8, 1) / 1000, // midnight 2026-09-01 UTC
    roster: 'fixed',
    win: {
      type: 'completion',
      // Challenge window: Sept 1 – Sept 30. The cutoff is Oct 1 00:00 UTC
      // (exclusive); the site displays the deadline as "30 Sep".
      deadline: Date.UTC(2026, 9, 1) / 1000,
      // Single tier: 100% completion plus a Steam review. No playtime floor —
      // pre-challenge completions only need the review (€15 draw for everyone).
      requireReview: true,
    },
  },
]

interface Member {
  username: string
  steam_id: string
  avatar_url?: string
  steam_profile_url?: string | null
}

interface UnlockedAchievement {
  apiname: string
  displayName: string
  description?: string
  unlocktime: number
}

interface ResolvedParticipant {
  steam_id: string
  display_name: string
  sg_username: string | null
  avatar_url: string
  profile_url: string | null
  is_guest: boolean
}

export async function getJson(url: string): Promise<any> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

/**
 * `getJson` with linear backoff for transient failures. Steam's public JSON
 * endpoints intermittently 429 or return a short read; retrying usually clears
 * it. Throws only once every attempt has failed.
 */
export async function getJsonWithRetry(url: string, attempts = 4): Promise<any> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await getJson(url)
    } catch (e) {
      lastErr = e
      if (attempt < attempts)
        await new Promise((res) => setTimeout(res, 500 * attempt))
    }
  }
  throw lastErr
}

async function getGameSchema(
  appId: number,
): Promise<Record<string, { displayName: string; description?: string }>> {
  const url = `${BASE}/ISteamUserStats/GetSchemaForGame/v2/?key=${API_KEY}&appid=${appId}&format=json`
  const map: Record<string, { displayName: string; description?: string }> = {}
  try {
    const data = await getJson(url)
    for (const a of data.game?.availableGameStats?.achievements ?? []) {
      map[a.name] = {
        displayName: a.displayName || a.name,
        description: a.description,
      }
    }
  } catch (e) {
    console.warn('⚠️  Could not fetch game schema:', String(e))
  }
  return map
}

async function getPlayerSummary(
  steamId: string,
): Promise<{ name: string; avatar: string; profile: string } | null> {
  const url = `${BASE}/ISteamUser/GetPlayerSummaries/v0002/?key=${API_KEY}&steamids=${steamId}`
  try {
    const data = await getJson(url)
    const p = data.response?.players?.[0]
    if (!p) return null
    return {
      name: p.personaname ?? steamId,
      avatar: p.avatarfull ?? '',
      profile: p.profileurl ?? `https://steamcommunity.com/profiles/${steamId}`,
    }
  } catch {
    return null
  }
}

async function getOwnedGame(
  steamId: string,
  appId: number,
): Promise<{ owned: boolean; total: number; twoWeeks: number }> {
  // Without skip_unvetted_apps=false Steam omits apps it hasn't vetted — a
  // challenge game can be one of them, and the participant reads as not owning
  // it however long they play.
  const url = `${BASE}/IPlayerService/GetOwnedGames/v0001/?key=${API_KEY}&steamid=${steamId}&format=json&include_appinfo=0&include_played_free_games=1&skip_unvetted_apps=false`
  try {
    const data = await getJson(url)
    const resp = data.response ?? {}
    const game = (resp.games ?? []).find((g: any) => g.appid === appId)
    if (!game) return { owned: false, total: 0, twoWeeks: 0 }
    return {
      owned: true,
      total: game.playtime_forever ?? 0,
      twoWeeks: game.playtime_2weeks ?? 0,
    }
  } catch {
    return { owned: false, total: 0, twoWeeks: 0 }
  }
}

async function getAchievements(
  steamId: string,
  appId: number,
): Promise<{ achieved: { apiname: string; unlocktime: number }[]; total: number } | null> {
  const url = `${BASE}/ISteamUserStats/GetPlayerAchievements/v0001/?appid=${appId}&key=${API_KEY}&steamid=${steamId}&format=json`
  try {
    const data = await getJson(url)
    const ps = data.playerstats ?? {}
    if (!ps.success) return null
    const list = ps.achievements ?? []
    return {
      achieved: list
        .filter((a: any) => a.achieved === 1)
        .map((a: any) => ({ apiname: a.apiname, unlocktime: a.unlocktime })),
      total: list.length,
    }
  } catch {
    return null
  }
}

export interface ReviewInfo {
  voted_up: boolean
  timestamp_created: number
  recommendationid: string
}

export interface ReviewFields {
  wrote_review: boolean
  review_voted_up: boolean | null
  review_timestamp: number | null
  review_recommendationid: string | null
  review_url: string | null
}

const MONTH_ABBREVIATIONS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
]

/**
 * Parse the `Posted: <day> <month>[, <year>] @ <h>:<mm><am|pm>` text on a
 * review page into epoch seconds (UTC). The year is omitted for reviews
 * posted within roughly the last twelve months, so a missing year defaults to
 * the current year and rolls back one year if that would land in the future.
 * Returns 0 when the text can't be parsed.
 */
function parsePostedTimestamp(html: string): number {
  const match =
    /Posted:\s*(\d{1,2})\s+([A-Za-z]+)(?:,?\s*(\d{4}))?\s*@\s*(\d{1,2}):(\d{2})\s*([ap]m)/i.exec(
      html,
    )
  if (!match) return 0
  const [, dayStr, monthStr, yearStr, hourStr, minuteStr, ampm] = match
  const monthIndex = MONTH_ABBREVIATIONS.indexOf(monthStr.slice(0, 3).toLowerCase())
  if (monthIndex === -1) return 0
  const day = Number(dayStr)
  const minute = Number(minuteStr)
  let hour = Number(hourStr) % 12
  if (ampm.toLowerCase() === 'pm') hour += 12

  const now = new Date()
  const year = yearStr ? Number(yearStr) : now.getUTCFullYear()
  let ts = Date.UTC(year, monthIndex, day, hour, minute) / 1000
  if (!yearStr && ts > Date.now() / 1000)
    ts = Date.UTC(year - 1, monthIndex, day, hour, minute) / 1000
  return Number.isFinite(ts) ? ts : 0
}

/**
 * Parse a fetched Steam Community `/profiles/<id>/recommended/<appid>` page
 * into a `ReviewInfo`, or null when the member has no review for that app.
 * Steam doesn't 404 for "no review" — it redirects to the member's review
 * list (or, for a private profile, to their profile root) — so the caller's
 * post-redirect URL (`finalUrl`) must still point at this app, and the page
 * title must still read as a review page, for a review to be recognized.
 * Only the `id="ReviewTitle"` block is inspected for the recommendation
 * (thumbs up/down) and its vote-button id; a member's other reviews are
 * listed in a sidebar further down the page and are ignored.
 */
export function parseReviewPage(
  html: string,
  finalUrl: string,
  appId: number,
): ReviewInfo | null {
  const finalPath = finalUrl.split('?')[0].replace(/\/+$/, '')
  if (!finalPath.endsWith(`/recommended/${appId}`)) return null
  if (!/<title>[^<]*Review for/i.test(html)) return null

  const titleIdx = html.indexOf('id="ReviewTitle"')
  if (titleIdx === -1) return null

  const afterTitle = html.slice(titleIdx)
  const btnMatch = /RecommendationVoteUpBtn(\d+)/.exec(afterTitle)
  const recommendationid = btnMatch ? btnMatch[1] : ''
  const reviewBlock = btnMatch ? afterTitle.slice(0, btnMatch.index) : afterTitle

  return {
    voted_up: reviewBlock.includes('icon_thumbsUp'),
    timestamp_created: parsePostedTimestamp(reviewBlock),
    recommendationid,
  }
}

/**
 * Check whether a member has a Steam review for a game by fetching their
 * review page directly, following redirects, and handing the result to
 * `parseReviewPage`. Retries transient failures with linear backoff; once
 * every attempt is exhausted it logs a warning and returns null rather than
 * throwing, so a page fetched with a null review can be carried forward by
 * `stickyReviewFields` rather than treated as a confirmed "no review".
 * A private profile redirects away like a missing review does, so null here
 * means "no visible review", not a guaranteed "never reviewed".
 */
export async function fetchUserReview(
  steamId: string,
  appId: number,
  attempts = 4,
): Promise<ReviewInfo | null> {
  const url = `https://steamcommunity.com/profiles/${steamId}/recommended/${appId}`
  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const html = await res.text()
      return parseReviewPage(html, res.url, appId)
    } catch (e) {
      lastErr = e
      if (attempt < attempts)
        await new Promise((res) => setTimeout(res, 500 * attempt))
    }
  }
  console.warn(
    `⚠️  Review fetch failed after retries for ${steamId}:`,
    String(lastErr),
  )
  return null
}

/** Review fields for a participant, derived from the game-wide review map. */
export function reviewFields(
  steamId: string,
  appId: number,
  reviews: Map<string, ReviewInfo>,
): ReviewFields {
  const r = reviews.get(steamId)
  return {
    wrote_review: Boolean(r),
    review_voted_up: r ? r.voted_up : null,
    review_timestamp: r ? r.timestamp_created : null,
    review_recommendationid: r?.recommendationid ?? null,
    review_url: r
      ? `https://steamcommunity.com/profiles/${steamId}/recommended/${appId}`
      : null,
  }
}

/**
 * Review detection is sticky, mirroring the monotonic playtime/achievement
 * floor: once a member is on record as having reviewed, a later run that fails
 * to see their review must not flip them back to "no review" and knock them off
 * the leaderboard. A per-user review-page fetch can fail outright (a network
 * error, a rate limit) after every retry, or the page can be temporarily
 * inaccessible — that's what briefly un-qualified members on the Neo Cab
 * board. When the fresh fetch finds a review
 * we take it (it's the most current — e.g. a thumbs-down the member later
 * flipped to thumbs-up); otherwise we carry forward whatever the prior run
 * recorded. Like the playtime/achievement floor, this trades away detecting a
 * genuinely deleted review for never dropping a real one on a bad fetch.
 */
export function stickyReviewFields(
  steamId: string,
  appId: number,
  reviews: Map<string, ReviewInfo>,
  prior: Partial<ReviewFields> | undefined,
): ReviewFields {
  const fresh = reviewFields(steamId, appId, reviews)
  if (fresh.wrote_review || !prior?.wrote_review) return fresh
  return {
    wrote_review: true,
    review_voted_up: prior.review_voted_up ?? null,
    review_timestamp: prior.review_timestamp ?? null,
    review_recommendationid: prior.review_recommendationid ?? null,
    review_url:
      prior.review_url ??
      `https://steamcommunity.com/profiles/${steamId}/recommended/${appId}`,
  }
}

/** Generic per-player view: ownership, playtime, and achievement progress. */
async function fetchPlayer(
  steamId: string,
  config: ChallengeConfig,
  schema: Record<string, { displayName: string; description?: string }>,
  schemaTotal: number,
) {
  const start = config.startTimestamp
  const game = await getOwnedGame(steamId, config.appId)
  const ach = game.owned ? await getAchievements(steamId, config.appId) : null
  const achieved = ach?.achieved ?? []

  const challengeAch: UnlockedAchievement[] = achieved
    .filter((a) => a.unlocktime >= start)
    .map((a) => ({
      apiname: a.apiname,
      displayName: schema[a.apiname]?.displayName ?? a.apiname,
      description: schema[a.apiname]?.description,
      unlocktime: a.unlocktime,
    }))
    .sort((a, b) => a.unlocktime - b.unlocktime)

  // Achievements unlocked *before* the challenge, with a reliable timestamp,
  // form the baseline. Anything the account has beyond that count — post-start
  // unlocks AND unlocks that synced without a usable unlocktime (e.g. earned in
  // Steam Deck offline mode) — is treated as challenge progress. This keeps an
  // actively-playing member from being shown as "yet to start" when Steam hands
  // us achievements with a missing/zero unlock time.
  const baselineAchievements = achieved.filter(
    (a) => a.unlocktime > 0 && a.unlocktime < start,
  ).length

  const unlockedTotal = achieved.length
  const achievementsTotal = ach?.total || schemaTotal

  return {
    game,
    achieved,
    stats_available: ach !== null,
    achievements_total: achievementsTotal,
    achievements_unlocked_total: unlockedTotal,
    achievements_before_challenge: baselineAchievements,
    challenge_achievements: challengeAch,
    challenge_achievement_count: challengeAch.length,
  }
}

type PlayerProgress = Awaited<ReturnType<typeof fetchPlayer>>

/** Achievement-challenge win view (Hero + item-discovery milestones). */
function achievementWinFields(p: PlayerProgress, config: ChallengeConfig) {
  const win = config.win as AchievementWin
  const start = config.startTimestamp
  const heroEntry = p.achieved.find((a) => a.apiname === win.apiname)
  const hadHeroBefore = Boolean(
    heroEntry && heroEntry.unlocktime > 0 && heroEntry.unlocktime < start,
  )
  const heroDuring = p.challenge_achievements.find(
    (a) => a.apiname === win.apiname,
  )

  // Item counts are account-cumulative, so report each milestone's current
  // unlock status rather than filtering by the challenge window.
  const milestones = (win.milestones ?? []).map((m) => {
    const entry = p.achieved.find((a) => a.apiname === m.apiname)
    return {
      apiname: m.apiname,
      label: m.label,
      items: m.items,
      unlocked: Boolean(entry),
      unlocktime: entry?.unlocktime ?? null,
    }
  })

  return {
    milestones,
    had_hero_before: hadHeroBefore,
    has_hero: Boolean(heroDuring),
    hero_unlocktime: heroDuring?.unlocktime ?? null,
  }
}

/**
 * Completion-challenge win view. A winner has ALL of: 100% of the achievements
 * (whenever reached — pre-challenge completions count), more than the required
 * playtime logged during the challenge window (when a floor is set), and a
 * public Steam review when the challenge requires one.
 *
 * Tiered challenges (a `storyAchievement` is configured) add a lower prize
 * tier: unlocking the story achievement by the deadline, under the same
 * playtime/review gates, also wins — `win_tier` records which tier each winner
 * reached ('completion' beats 'story'). `excludeAchievements` are dropped from
 * the 100% goal entirely.
 */
export function completionWinFields(
  p: PlayerProgress,
  config: ChallengeConfig,
  playtimeChallengeMinutes: number,
  wroteReview: boolean,
) {
  const win = config.win as CompletionWin
  const start = config.startTimestamp
  const minPlaytime = win.minPlaytimeMinutes ?? 0
  const excluded = new Set(win.excludeAchievements ?? [])
  // Excluded achievements are dropped from BOTH sides of the 100% comparison.
  // When a hidden-profile pull carried a floored count forward we can't see the
  // per-achievement breakdown, so unobserved excluded unlocks simply aren't
  // subtracted — the benefit of the doubt goes to the member.
  const excludedUnlocked = p.achieved.filter((a) =>
    excluded.has(a.apiname),
  ).length
  const effectiveUnlocked = p.achievements_unlocked_total - excludedUnlocked
  const effectiveTotal =
    p.achievements_total > 0 ? p.achievements_total - excluded.size : 0
  const isComplete =
    p.stats_available && effectiveTotal > 0 && effectiveUnlocked >= effectiveTotal
  // The 100% moment is when the final counted achievement unlocked = the latest
  // unlocktime across the account's non-excluded unlocks.
  const lastUnlock = p.achieved.reduce(
    (max, a) =>
      !excluded.has(a.apiname) && a.unlocktime > max ? a.unlocktime : max,
    0,
  )
  const completedAt = isComplete && lastUnlock > 0 ? lastUnlock : null
  const completedBeforeStart = Boolean(
    isComplete && completedAt != null && completedAt < start,
  )
  // Reaching 100% only counts toward winning if it happened by the deadline.
  // Members who finish the achievements *after* the challenge closed are tracked
  // separately (`completed_after_deadline`) and never become winners. A missing
  // timestamp (offline unlocks) is given the benefit of the doubt.
  const completedAfterDeadline = Boolean(
    isComplete && completedAt != null && completedAt > win.deadline,
  )
  // No floor (0/omitted) means playtime never gates the win — a member who
  // completed the game before the challenge shouldn't need to re-play it.
  const meetsPlaytime =
    minPlaytime === 0 || playtimeChallengeMinutes > minPlaytime
  const meetsReview = !win.requireReview || wroteReview
  const completionQualifies =
    isComplete && meetsPlaytime && meetsReview && !completedAfterDeadline

  // Story tier: the single story achievement, same deadline/gate rules as the
  // completion tier (pre-challenge unlocks count, post-deadline ones don't).
  const storyEntry = win.storyAchievement
    ? p.achieved.find((a) => a.apiname === win.storyAchievement!.apiname)
    : undefined
  const storyUnlocktime = storyEntry?.unlocktime ?? null
  const storyAfterDeadline = Boolean(
    storyEntry && storyUnlocktime != null && storyUnlocktime > win.deadline,
  )
  const storyQualifies = Boolean(
    storyEntry && !storyAfterDeadline && meetsPlaytime && meetsReview,
  )

  const winTier: WinTier | null = completionQualifies
    ? 'completion'
    : storyQualifies
      ? 'story'
      : null
  // The moment the winning tier was reached — orders winners on the board.
  const qualifiedAt = completionQualifies
    ? completedAt
    : storyQualifies
      ? storyUnlocktime
      : null

  return {
    is_complete: isComplete,
    completed_at: completedAt,
    completed_before_start: completedBeforeStart,
    completed_after_deadline: completedAfterDeadline,
    // Story-tier fields only exist on tiered challenges, so untouched data
    // files (Kill The Crows, Neo Cab) keep their exact shape.
    ...(win.storyAchievement
      ? {
          story_unlocked: Boolean(storyEntry),
          story_unlocktime: storyUnlocktime,
          story_after_deadline: storyAfterDeadline,
          win_tier: winTier,
          qualified_at: qualifiedAt,
        }
      : {}),
    meets_playtime: meetsPlaytime,
    meets_review: meetsReview,
    is_winner: winTier != null,
  }
}

/**
 * Username → steam_id over everyone the group has ever recorded, current and
 * former, including names they have since changed away from.
 *
 * A challenge roster is a historical record: it names who competed at the time,
 * and those results stay valid after someone leaves the group or renames. The
 * live member list therefore cannot be the only way to resolve a roster name —
 * a leaver would silently drop off the leaderboards they earned a place on.
 */
function loadHistoricalIdIndex(): Map<string, string> {
  const index = new Map<string, string>()
  if (!existsSync(steamIdMapPath)) return index
  let map: SteamIdMap
  try {
    map = JSON.parse(readFileSync(steamIdMapPath, 'utf-8'))
  } catch {
    return index
  }
  for (const [steamId, entry] of Object.entries(map)) {
    const names = [
      entry?.current,
      ...(entry?.previous ?? []).map((p) => p.username),
    ]
    for (const name of names) {
      if (typeof name === 'string' && name) index.set(name.toLowerCase(), steamId)
    }
  }
  return index
}

/** Resolve a fixed roster (participants + guests) to concrete steam identities. */
async function resolveFixedRoster(
  roster: { participants: RosterEntry[]; guests: RosterEntry[] },
  bySteamId: Map<string, Member>,
  byUsername: Map<string, Member>,
  historicalIds: Map<string, string>,
): Promise<ResolvedParticipant[]> {
  // Guest-ness is a property of which list an entry was written into, not of
  // whether they are a member today — otherwise every member who later left
  // would be retroactively relabelled a guest on challenges they competed in.
  const rawEntries: { entry: RosterEntry; isGuest: boolean }[] = [
    ...(roster.participants ?? []).map((entry) => ({ entry, isGuest: false })),
    ...(roster.guests ?? []).map((entry) => ({ entry, isGuest: true })),
  ]
  const resolved: ResolvedParticipant[] = []
  const seen = new Set<string>()
  for (const { entry, isGuest } of rawEntries) {
    let steamId: string | undefined
    let displayName: string | undefined
    let usernameHint: string | undefined

    if (typeof entry === 'string') {
      usernameHint = entry
    } else {
      steamId = entry.steam_id
      displayName = entry.displayName
      usernameHint = entry.username
    }
    if (!steamId && usernameHint) {
      const key = usernameHint.toLowerCase()
      steamId = byUsername.get(key)?.steam_id ?? historicalIds.get(key)
    }

    if (!steamId) {
      console.warn(
        `⚠️  Could not resolve participant "${usernameHint ?? JSON.stringify(entry)}" — skipping`,
      )
      continue
    }
    if (seen.has(steamId)) continue
    seen.add(steamId)

    const member = bySteamId.get(steamId)
    if (member) {
      resolved.push({
        steam_id: steamId,
        display_name: displayName ?? member.username,
        sg_username: member.username,
        avatar_url: member.avatar_url ?? '',
        profile_url:
          member.steam_profile_url ??
          `https://steamcommunity.com/profiles/${steamId}`,
        is_guest: isGuest,
      })
    } else {
      // Former member or a guest who was never in the group: Steam still has
      // their name and avatar, and the id map still has the username they
      // competed under.
      const summary = await getPlayerSummary(steamId)
      resolved.push({
        steam_id: steamId,
        display_name: displayName ?? summary?.name ?? usernameHint ?? steamId,
        sg_username: usernameHint ?? null,
        avatar_url: summary?.avatar ?? '',
        profile_url:
          summary?.profile ?? `https://steamcommunity.com/profiles/${steamId}`,
        is_guest: isGuest,
      })
    }
  }
  return resolved
}

async function generateChallenge(config: ChallengeConfig): Promise<void> {
  const outPath = resolve(dataDir, `challenge_${config.dataSlug}.json`)
  console.log(
    `\n🏆 Generating "${config.gameName}" (app ${config.appId}, ${config.win.type})`,
  )
  console.log(`   Start: ${new Date(config.startTimestamp * 1000).toISOString()}`)
  if (config.win.type === 'completion')
    console.log(
      `   Deadline: ${new Date(config.win.deadline * 1000).toISOString()}`,
    )

  const usersJson = JSON.parse(readFileSync(usersPath, 'utf-8'))
  const members: Member[] = Object.values(usersJson.users)
  const bySteamId = new Map(members.map((m) => [m.steam_id, m]))
  const byUsername = new Map(members.map((m) => [m.username.toLowerCase(), m]))

  // Read the prior file for the frozen baselines (and, for fixed rosters, the
  // roster itself), then write it all back.
  let prior: any = null
  if (existsSync(outPath)) {
    try {
      prior = JSON.parse(readFileSync(outPath, 'utf-8'))
    } catch {
      /* ignore corrupt prior file */
    }
  }

  const priorBaselines = new Map<string, number>()
  const priorByStemId = new Map<string, any>()
  for (const p of prior?.participants ?? []) {
    if (typeof p.baseline_playtime_minutes === 'number')
      priorBaselines.set(p.steam_id, p.baseline_playtime_minutes)
    priorByStemId.set(p.steam_id, p)
  }

  // Prior review state for everyone recorded last run — participants AND
  // non-participants — so review stickiness works regardless of which list a
  // member lands in this time.
  const priorReviewById = new Map<string, Partial<ReviewFields>>(priorByStemId)
  for (const p of prior?.nonParticipants ?? [])
    priorReviewById.set(p.steam_id, p)

  // --- Resolve who competes ---
  const nowSeconds = Math.floor(Date.now() / 1000)
  let roster: { participants: RosterEntry[]; guests: RosterEntry[] } | null = null
  if (config.roster === 'fixed') {
    roster = prior?.roster ?? null
    if (!roster && existsSync(legacyParticipantsPath)) {
      const legacy = JSON.parse(readFileSync(legacyParticipantsPath, 'utf-8'))
      roster = { participants: legacy.participants ?? [], guests: legacy.guests ?? [] }
      console.log('   Migrated roster from legacy challenge_participants.json')
    }
  }
  // Sign-up phase: a fixed-roster challenge with no roster yet, before its
  // declared start — generate an ownership preview instead of erroring.
  const signupPreview =
    config.roster === 'fixed' && !roster && nowSeconds < config.startTimestamp
  if (config.roster === 'fixed' && !roster && !signupPreview) {
    console.error(
      `❌ No roster found. Add a "roster": { "participants": [...], "guests": [...] } block to ${outPath}`,
    )
    return
  }

  let resolved: ResolvedParticipant[]
  if (config.roster === 'open' || signupPreview) {
    // Open challenge, or a sign-up-phase preview: every group member is a
    // candidate; non-owners are dropped after the ownership fetch below.
    resolved = members.map((m) => ({
      steam_id: m.steam_id,
      display_name: m.username,
      sg_username: m.username,
      avatar_url: m.avatar_url ?? '',
      profile_url:
        m.steam_profile_url ?? `https://steamcommunity.com/profiles/${m.steam_id}`,
      is_guest: false,
    }))
  } else {
    resolved = await resolveFixedRoster(
      roster!,
      bySteamId,
      byUsername,
      loadHistoricalIdIndex(),
    )
  }

  const schema = await getGameSchema(config.appId)
  const schemaTotal = Object.keys(schema).length || 0
  const rosterIds = new Set(resolved.map((r) => r.steam_id))

  // Steam reviews for the roster, keyed by steam_id, to flag who reviewed.
  // Checked per-member against their own review page rather than paged from
  // the game-wide feed, so a popular game's reviewer count can't cap it out.
  const reviews = new Map<string, ReviewInfo>()
  for (const r of resolved) {
    const review = await fetchUserReview(r.steam_id, config.appId)
    if (review) reviews.set(r.steam_id, review)
    await new Promise((res) => setTimeout(res, 250)) // be polite to the profile pages
  }
  console.log(`   Reviews: ${reviews.size} of ${resolved.length} roster member(s) reviewed`)

  // --- Participants ---
  // Rows mix the achievement- and completion-shape win fields (plus the
  // optional tier fields), so the row type is deliberately open.
  const participants: Record<string, any>[] = []
  let i = 0
  for (const r of resolved) {
    i++
    process.stderr.write(
      `\r   roster [${i}/${resolved.length}] ${r.display_name.padEnd(22)}`,
    )
    const p = await fetchPlayer(r.steam_id, config, schema, schemaTotal)
    // In an open challenge, or a sign-up-phase preview, you only show up if
    // you own the game.
    if ((config.roster === 'open' || signupPreview) && !p.game.owned) continue

    // Progress is monotonic. Steam intermittently hides a member's playtime or
    // achievements when their game-details privacy is toggled (e.g. Tucs during
    // Kill The Crows: 11h ↔ 0 between pulls). Never let a fresh pull regress what
    // we've already recorded, so an occasionally-private profile can't wipe a
    // qualified member's progress.
    const priorP = priorByStemId.get(r.steam_id)
    if (priorP) {
      if ((priorP.playtime_total_minutes ?? 0) > p.game.total)
        p.game.total = priorP.playtime_total_minutes
      if ((priorP.achievements_unlocked_total ?? 0) > p.achievements_unlocked_total) {
        p.achievements_unlocked_total = priorP.achievements_unlocked_total
        p.achievements_total = p.achievements_total || priorP.achievements_total || 0
        p.achievements_before_challenge =
          priorP.achievements_before_challenge ?? p.achievements_before_challenge
        p.challenge_achievements =
          priorP.challenge_achievements ?? p.challenge_achievements
        p.challenge_achievement_count =
          priorP.challenge_achievement_count ?? p.challenge_achievement_count
        p.stats_available = true
        // Re-seed the 100% timestamp so completed_at survives a hidden pull:
        // completionWinFields reads the latest unlocktime from `achieved`.
        if (priorP.completed_at != null)
          p.achieved = [
            ...p.achieved,
            { apiname: '__carried__', unlocktime: priorP.completed_at },
          ]
      }
    }

    // In a sign-up-phase preview, everything played so far IS pre-challenge
    // play — freezing it as the baseline now means it already equals
    // playtime-at-start once the real challenge begins, more accurate than
    // the total-minus-2weeks seed a normal first run uses.
    const baseline = signupPreview
      ? p.game.total
      : priorBaselines.has(r.steam_id)
        ? priorBaselines.get(r.steam_id)!
        : Math.max(0, p.game.total - p.game.twoWeeks) // seed: play before the recent window

    const playtimeChallengeMinutes = Math.max(0, p.game.total - baseline)
    const achievementsSinceBaseline = Math.max(
      0,
      p.achievements_unlocked_total - p.achievements_before_challenge,
    )
    // "Started" depends on the challenge kind:
    //  - completion (cumulative race toward 100%): any achievements OR playtime
    //    at all, since progress made before the start still counts toward the
    //    win condition.
    //  - achievement (clean slate): only progress made since the start.
    const hasStarted =
      config.win.type === 'completion'
        ? p.achievements_unlocked_total > 0 || p.game.total > 0
        : playtimeChallengeMinutes > 0 || achievementsSinceBaseline > 0

    const review = stickyReviewFields(
      r.steam_id,
      config.appId,
      reviews,
      priorReviewById.get(r.steam_id),
    )
    const winFields =
      config.win.type === 'achievement'
        ? achievementWinFields(p, config)
        : completionWinFields(
            p,
            config,
            playtimeChallengeMinutes,
            review.wrote_review,
          )

    participants.push({
      username: r.display_name,
      sg_username: r.sg_username,
      steam_id: r.steam_id,
      avatar_url: r.avatar_url,
      profile_url: r.profile_url,
      is_guest: r.is_guest,
      owned: p.game.owned,
      stats_available: p.stats_available,
      ...review,
      playtime_total_minutes: p.game.total,
      playtime_2weeks_minutes: p.game.twoWeeks,
      baseline_playtime_minutes: baseline,
      playtime_challenge_minutes: playtimeChallengeMinutes,
      achievements_total: p.achievements_total,
      achievements_unlocked_total: p.achievements_unlocked_total,
      achievements_before_challenge: p.achievements_before_challenge,
      achievements_since_baseline: achievementsSinceBaseline,
      challenge_achievements: p.challenge_achievements,
      challenge_achievement_count: p.challenge_achievement_count,
      has_started: hasStarted,
      ...winFields,
    })
  }
  process.stderr.write('\n')

  // --- Non-participants who own and have played (fixed rosters only) ---
  const nonParticipants = []
  if (config.roster === 'fixed') {
    const others = members.filter((m) => !rosterIds.has(m.steam_id))
    let j = 0
    for (const m of others) {
      j++
      process.stderr.write(
        `\r   others [${j}/${others.length}] ${m.username.padEnd(22)}`,
      )
      const p = await fetchPlayer(m.steam_id, config, schema, schemaTotal)
      if (!p.game.owned || p.game.total <= 0) continue // only those who actually played
      const review = await fetchUserReview(m.steam_id, config.appId)
      if (review) reviews.set(m.steam_id, review)
      nonParticipants.push({
        username: m.username,
        steam_id: m.steam_id,
        avatar_url: m.avatar_url ?? '',
        profile_url:
          m.steam_profile_url ??
          `https://steamcommunity.com/profiles/${m.steam_id}`,
        playtime_total_minutes: p.game.total,
        playtime_2weeks_minutes: p.game.twoWeeks,
        achievements_unlocked_total: p.achievements_unlocked_total,
        achievements_total: p.achievements_total,
        challenge_achievement_count: p.challenge_achievement_count,
        ...stickyReviewFields(
          m.steam_id,
          config.appId,
          reviews,
          priorReviewById.get(m.steam_id),
        ),
      })
    }
    process.stderr.write('\n')
    nonParticipants.sort(
      (a, b) =>
        b.achievements_unlocked_total - a.achievements_unlocked_total ||
        b.playtime_total_minutes - a.playtime_total_minutes,
    )
  }

  // Once the challenge window closes the qualified list is frozen: later data
  // pulls keep refreshing everyone's stats, but the set of winners can neither
  // grow nor shrink. The freeze is captured the first time we generate after the
  // deadline and preserved in the data file from then on.
  const deadlineTs =
    config.win.type === 'completion' ? config.win.deadline : null
  // Dormant challenges are finished by definition — achievement-type ones have
  // no deadline, so without this they'd read as "ongoing" forever and the
  // Discord congrats scanner would keep picking them up.
  const challengeOver =
    config.dormant === true ||
    (deadlineTs != null && Date.now() / 1000 >= deadlineTs)
  let frozenWinnerIds: string[] | null = Array.isArray(prior?.frozenWinnerIds)
    ? (prior.frozenWinnerIds as string[])
    : null
  // Tiered challenges freeze each winner's tier alongside the winner set, so a
  // post-deadline story→completion upgrade can't change anyone's prize.
  let frozenWinnerTiers: Record<string, WinTier> | null =
    prior?.frozenWinnerTiers && typeof prior.frozenWinnerTiers === 'object'
      ? (prior.frozenWinnerTiers as Record<string, WinTier>)
      : null

  // --- Winners ---
  let winners: typeof participants
  if (config.win.type === 'achievement') {
    // FIRST roster member to unlock the winning achievement during the window.
    // Once decided it's locked — later achievers don't become winners.
    const achievers = participants
      .filter((p) => p.has_hero && p.hero_unlocktime != null)
      .sort((a, b) => (a.hero_unlocktime ?? 0) - (b.hero_unlocktime ?? 0))
    const winner = achievers[0] ?? null
    for (const p of participants)
      p.is_winner = winner ? p.steam_id === winner.steam_id : false
    winners = winner ? [winner] : []
  } else {
    // EVERY member who qualified (100% by the deadline + enough challenge-window
    // play). Freeze the set once the challenge is over so it stays fixed.
    const tiered = Boolean((config.win as CompletionWin).storyAchievement)
    if (challengeOver) {
      if (!frozenWinnerIds) {
        frozenWinnerIds = participants
          .filter((p) => p.is_winner)
          .map((p) => p.steam_id)
        if (tiered) {
          frozenWinnerTiers = {}
          for (const p of participants)
            if (p.is_winner && p.win_tier)
              frozenWinnerTiers[p.steam_id] = p.win_tier
        }
      }
      const frozen = new Set(frozenWinnerIds)
      for (const p of participants) {
        p.is_winner = frozen.has(p.steam_id)
        if (tiered)
          p.win_tier = p.is_winner
            ? (frozenWinnerTiers?.[p.steam_id] ?? p.win_tier)
            : null
      }
    }
    // Ordered by when they qualified: full completions above story-tier wins,
    // each by the moment their tier was reached (no usable timestamp sorts
    // last). Untiered challenges keep the plain 100%-moment order.
    const tierRank = (p: (typeof participants)[number]) =>
      p.win_tier === 'story' ? 1 : 0
    winners = participants
      .filter((p) => p.is_winner)
      .sort(
        (a, b) =>
          tierRank(a) - tierRank(b) ||
          (a.qualified_at ?? a.completed_at ?? Number.POSITIVE_INFINITY) -
            (b.qualified_at ?? b.completed_at ?? Number.POSITIVE_INFINITY),
      )
  }

  // --- Leaderboard order ---
  if (config.win.type === 'achievement') {
    // Winner pinned to #1; everyone else by challenge achievements, then
    // challenge playtime, then total completion.
    participants.sort((a, b) => {
      const aw = a.is_winner ? 1 : 0
      const bw = b.is_winner ? 1 : 0
      if (aw !== bw) return bw - aw
      if (b.challenge_achievement_count !== a.challenge_achievement_count)
        return b.challenge_achievement_count - a.challenge_achievement_count
      if (b.playtime_challenge_minutes !== a.playtime_challenge_minutes)
        return b.playtime_challenge_minutes - a.playtime_challenge_minutes
      return b.achievements_unlocked_total - a.achievements_unlocked_total
    })
  } else {
    // Winners (100% + enough challenge play) first, earliest finisher #1. Then
    // members who actually engaged with the challenge (played or unlocked
    // something during the window) rank above those who didn't — so a longtime
    // owner sitting on lots of pre-challenge achievements but no challenge-window
    // play sinks to the bottom, alongside the people who never started. Within
    // each group: closeness to 100%, then challenge-window playtime.
    const engaged = (x: (typeof participants)[number]) =>
      x.playtime_challenge_minutes > 0 ||
      (x.achievements_since_baseline ?? 0) > 0
    participants.sort((a, b) => {
      const aw = a.is_winner ? 1 : 0
      const bw = b.is_winner ? 1 : 0
      if (aw !== bw) return bw - aw
      if (aw && bw) {
        // Tiered: full completions rank above story-tier wins.
        const at = a.win_tier === 'story' ? 1 : 0
        const bt = b.win_tier === 'story' ? 1 : 0
        if (at !== bt) return at - bt
        return (
          (a.qualified_at ?? a.completed_at ?? Number.POSITIVE_INFINITY) -
          (b.qualified_at ?? b.completed_at ?? Number.POSITIVE_INFINITY)
        )
      }
      const ae = engaged(a) ? 1 : 0
      const be = engaged(b) ? 1 : 0
      if (ae !== be) return be - ae
      if (b.achievements_unlocked_total !== a.achievements_unlocked_total)
        return b.achievements_unlocked_total - a.achievements_unlocked_total
      if (b.playtime_challenge_minutes !== a.playtime_challenge_minutes)
        return b.playtime_challenge_minutes - a.playtime_challenge_minutes
      return b.playtime_total_minutes - a.playtime_total_minutes
    })
  }

  const firstWinner = winners[0] ?? null
  const output: Record<string, unknown> = {
    slug: config.slug,
    appId: config.appId,
    gameName: config.gameName,
    winType: config.win.type,
    startTimestamp: config.startTimestamp,
    totalAchievements: schemaTotal || (prior?.totalAchievements ?? 0),
    generatedAt: Date.now(),
    challengeOver,
    winnerUsername: firstWinner?.username ?? null,
    participants,
    nonParticipants,
  }
  // Sign-up-phase preview flag. Deliberately not carried forward from `prior`
  // — a normal run over the same file (once a roster is added) rebuilds the
  // output fresh and simply never sets this, clearing it.
  if (signupPreview) output.signup_phase = true
  // Persist the frozen qualified set (completion challenges past their deadline).
  if (frozenWinnerIds) output.frozenWinnerIds = frozenWinnerIds
  if (frozenWinnerTiers) output.frozenWinnerTiers = frozenWinnerTiers

  if (config.win.type === 'achievement') {
    const win = config.win
    output.heroAchievement = {
      apiname: win.apiname,
      displayName: schema[win.apiname]?.displayName ?? win.displayName,
      description: schema[win.apiname]?.description ?? win.description,
      iconUrl: win.iconUrl,
    }
    output.winnerUnlocktime =
      (firstWinner as { hero_unlocktime?: number | null })?.hero_unlocktime ?? null
  } else {
    output.deadline = config.win.deadline
    output.minPlaytimeMinutes = config.win.minPlaytimeMinutes ?? 0
    output.requireReview = config.win.requireReview ?? false
    output.winnerUnlocktime =
      (firstWinner as { qualified_at?: number | null; completed_at?: number | null })
        ?.qualified_at ??
      (firstWinner as { completed_at?: number | null })?.completed_at ??
      null
    output.winnerUsernames = winners.map((w) => w.username)

    // Tiered-challenge metadata for the site: the story achievement (schema
    // names win over the config fallbacks), which achievements are excluded
    // from the 100% goal, and the resulting required count.
    const story = config.win.storyAchievement
    if (story) {
      output.storyAchievement = {
        apiname: story.apiname,
        displayName: schema[story.apiname]?.displayName ?? story.displayName,
        description: schema[story.apiname]?.description ?? story.description,
      }
    }
    const excludedList = config.win.excludeAchievements ?? []
    if (excludedList.length) {
      output.excludedAchievements = excludedList.map((apiname) => ({
        apiname,
        displayName: schema[apiname]?.displayName ?? apiname,
      }))
      output.requiredAchievements = Math.max(
        0,
        (output.totalAchievements as number) - excludedList.length,
      )
    }
  }

  // Preserve the roster in-file so it's the single source of truth.
  if (config.roster === 'fixed') output.roster = roster

  writeFileSync(outPath, JSON.stringify(output, null, 2))
  const winnerNote =
    config.win.type === 'achievement'
      ? firstWinner
        ? ` — 🥇 winner: ${firstWinner.username}`
        : ' — no winner yet'
      : winners.length
        ? ` — 🏅 ${winners.length} qualified: ${winners.map((w) => w.username).join(', ')}`
        : ' — no qualifiers yet'
  console.log(
    `✅ Wrote ${participants.length} participant(s)` +
      (nonParticipants.length
        ? ` + ${nonParticipants.length} non-participant(s)`
        : '') +
      ` to ${outPath}${winnerNote}`,
  )
}

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error('❌ STEAM_API_KEY not set')
    process.exit(1)
  }
  // Optional filter: `CHALLENGE=neo_cab` env or first CLI arg. Matches a
  // challenge's dataSlug or slug. With no filter, generate every non-dormant
  // challenge — or every challenge when INCLUDE_DORMANT=true (the biweekly CI
  // refresh). Naming a dormant challenge explicitly also runs it.
  const filter = (process.env.CHALLENGE || process.argv[2] || '').trim()
  const includeDormant = process.env.INCLUDE_DORMANT === 'true'
  const targets = filter
    ? CHALLENGES.filter(
        (c) => c.dataSlug === filter || c.slug === filter,
      )
    : CHALLENGES.filter((c) => includeDormant || !c.dormant)
  if (filter && targets.length === 0) {
    console.error(
      `❌ No challenge matches "${filter}". Known: ${CHALLENGES.map((c) => c.dataSlug).join(', ')}`,
    )
    process.exit(1)
  }
  for (const config of targets) await generateChallenge(config)
}

if (
  import.meta.url.startsWith('file:') &&
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  await main()
}
