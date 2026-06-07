import type {
  Giveaway,
  GameData,
  User,
  UserEntry,
  WishlistData,
} from '@/types'

// NOTE: this module is deliberately kept free of runtime `@/` imports (types
// are `import type`, erased at build) so it can also run from a plain Node
// script — see scripts/freeze-spring-cleaning.ts.

/**
 * "Spring cleaning" analysis — surfaces members an admin may want to warn or
 * expel, based on community-health signals. All functions here are pure and
 * return plain serializable objects so the analysis can run at build time on
 * the server and be handed to the client as data.
 *
 * The thresholds below intentionally mirror the scraper's existing
 * `calculateUserWarnings` semantics (see packages/scraper) so the two views
 * agree, while adding a few cross-criteria signals (quality-unplayed wins,
 * proof-of-play, dormant-but-still-taking) that need giveaway/wishlist data.
 */

const MONTH_SECONDS = 30 * 24 * 60 * 60

/**
 * One spring-cleaning edition. Editions are namespaced by year so future
 * cleanings live at their own route (`/spring-cleaning/<slug>`) and never
 * clobber a previous one. Add a new entry here to start the next cleaning.
 *
 * Future work (intentionally not built yet): persist the set of members
 * flagged in an edition so that "was part of a past spring cleaning" can
 * itself become a warning signal on a member's profile.
 */
export interface SpringCleaningEdition {
  /** Calendar year of the cleaning. */
  year: number
  /** URL slug, also the [year] route param. */
  slug: string
  /** Human label, e.g. "Spring Cleaning 2026". */
  label: string
}

export const SPRING_CLEANINGS: SpringCleaningEdition[] = [
  { year: 2026, slug: '2026', label: 'Spring Cleaning 2026' },
]

/** The most recent edition — what the nav and index default to. */
export const LATEST_SPRING_CLEANING =
  SPRING_CLEANINGS[SPRING_CLEANINGS.length - 1]

export function getSpringCleaningEdition(
  slug: string,
): SpringCleaningEdition | undefined {
  return SPRING_CLEANINGS.find((e) => e.slug === slug)
}

/** A won game whose Steam wishlist count is at/above this is "really good quality". */
export const QUALITY_WISHLIST_MIN = 25
/** Won quality games are forgiven if claimed within this window — give them time to play. */
export const QUALITY_LENIENT_MONTHS = 2
/** A member is "established" (worth judging on activity) once seen this long ago. */
export const ESTABLISHED_MONTHS = 6
/** Members who joined the group more recently than this are excluded entirely. */
export const MIN_MEMBERSHIP_MONTHS = 3
/** Gave at least this many high-quality games ⇒ unplayed-quality stays a warning, not expel. */
export const MANY_QUALITY_GIVEN = 3
/** No activity (won/created/entered) in this long ⇒ dormant. */
export const INACTIVE_MONTHS = 4
/** Last full-CV giveaway created longer ago than this ⇒ stopped contributing. */
export const DORMANT_CREATE_MONTHS = 6
/** No (real) full-CV giveaway created in this long ⇒ a standalone warning for anyone. */
export const STALE_CREATE_MONTHS = 5
/** Private/unreadable Steam + at least this many high-quality wins ⇒ escalate to expel. */
export const QUALITY_WINS_HIDDEN_MIN = 2
/** Won or entered within this window ⇒ "still active / still taking". */
export const STILL_ACTIVE_MONTHS = 2
/** A giveaway_ratio at/above this is "great" — a top contributor in good standing. */
export const GREAT_RATIO_MIN = 10
/**
 * A giveaway_ratio below this is "low" — only these members can be flagged as
 * "taking without giving". Net contributors above it have earned their keep.
 */
export const LOW_RATIO_MAX = 2
/** A play rate at/above this is "great" — clearly an engaged player. */
export const GREAT_PLAY_RATE = 66
/** A play rate at/above this (with enough wins) is "incredible" — exemplary. */
export const INCREDIBLE_PLAY_RATE = 90

export type FlagSeverity = 'expel' | 'warn' | 'info'

export type FlagId =
  | 'dormant_creator_still_taking'
  | 'zero_proven_play'
  | 'bad_play_rate'
  | 'private_steam'
  | 'quality_unplayed'
  | 'no_recent_giveaway'
  | 'inactive_member'
  | 'bad_ratio'
  | 'not_on_discord'

/** A single won game referenced inside a flag, with a clickable SteamGifts link. */
export interface FlaggedGame {
  name: string
  /** Full SteamGifts giveaway URL. */
  link: string
  /** Short context shown next to the game, e.g. "53 wishlists · won 5mo ago". */
  note?: string
}

export interface UserFlag {
  id: FlagId
  severity: FlagSeverity
  /** One-line headline for the flag, e.g. "Net receiver (ratio -4.20)". */
  label: string
  /** Optional longer explanation. */
  detail?: string
  /** Optional inline games supporting the flag. */
  games?: FlaggedGame[]
  /** Contribution to the user's overall priority score. */
  weight: number
}

export interface PlayRate {
  played: number
  total: number
  percentage: number
  /** Wins with no Steam stats available (delisted, not in library, private, etc.). */
  noStatsCount: number
}

/** The good parts of a member — shown alongside flags so admins judge fairly. */
export interface UserHighlights {
  /** Short positive badges, e.g. "100% play rate (12 wins)" or "Top contributor". */
  badges: string[]
  /** Full-CV giveaways this member has created (their "giving"). */
  createdCount: number
  /** Group events they made giveaways for, with how many per event. */
  events: Array<{ label: string; count: number }>
  /** High-quality games they gave away (created GAs for), best first. */
  qualityGiven: FlaggedGame[]
  /** Won games the member self-marked "I played, bro". */
  playedBroCount: number
  /** Proof-of-play (PLAY-REQUIRED) wins they fulfilled vs. didn't. */
  requiredPlay: { played: number; notPlayed: number }
}

/** A named, linked, dated giveaway reference for a member's recent activity. */
export interface RecentGiveaway {
  name: string
  /** Full SteamGifts giveaway URL. */
  link: string
  /** Unix seconds. */
  at: number
}

export interface AnalyzedUser {
  username: string
  steam_id: string
  avatar_url: string
  discord_member?: boolean
  ratio: number
  playRate: PlayRate
  isDeleted?: boolean
  /** Unix seconds — first evidence of TGC group membership (not SG registration). */
  memberSince: number | null
  /** Unix seconds — most recent giveaway won, created, or entered. */
  lastActiveAt: number | null
  /** Most recent counting full-CV giveaway they created (entries > 0, not deleted). */
  lastCreated: RecentGiveaway | null
  /** Most recent giveaway they won. */
  lastWon: RecentGiveaway | null
  /** Most recent giveaway they entered. */
  lastEntered: RecentGiveaway | null
  /** The member's positive contributions, for balanced judgement. */
  highlights: UserHighlights
  /** Highest-severity classification across this user's flags. */
  classification: 'expel' | 'warn'
  /** Sum of flag weights — higher means a stronger cleanup candidate. */
  score: number
  flags: UserFlag[]
}

export interface SectionResult {
  id: FlagId
  title: string
  description: string
  severity: FlagSeverity
  users: Array<{
    username: string
    steam_id: string
    avatar_url: string
    discord_member?: boolean
    detail: string
    games?: FlaggedGame[]
  }>
}

export interface SpringCleaningResult {
  totalAnalyzed: number
  generatedAt: number | null
  expel: AnalyzedUser[]
  warn: AnalyzedUser[]
  sections: SectionResult[]
  counts: Record<FlagId, number>
}

/**
 * A frozen edition: the full analysis result captured at a point in time, so an
 * old cleaning can always be revisited exactly as it was detected — even after
 * members leave or fix their stats. Written by scripts/freeze-spring-cleaning.ts
 * to public/data/spring-cleaning/<slug>.json and read by the edition page.
 */
export interface SpringCleaningSnapshot {
  edition: SpringCleaningEdition
  /** Unix seconds when the snapshot was frozen. */
  generatedAt: number
  /** group_users.json `lastUpdated` (ms) of the source data at freeze time. */
  sourceLastUpdated: number | null
  result: SpringCleaningResult
}

const FLAG_WEIGHT: Record<FlagId, number> = {
  dormant_creator_still_taking: 5,
  zero_proven_play: 4,
  bad_play_rate: 4,
  quality_unplayed: 3,
  inactive_member: 3,
  no_recent_giveaway: 2,
  private_steam: 2,
  bad_ratio: 2,
  not_on_discord: 1,
}

const SECTION_META: Record<
  FlagId,
  { title: string; description: string; severity: FlagSeverity }
> = {
  dormant_creator_still_taking: {
    title: 'Taking without giving',
    description:
      'Stopped creating giveaways long ago, yet still winning and/or entering recently — the classic freeloader pattern.',
    severity: 'expel',
  },
  zero_proven_play: {
    title: '0% proven play (proof-of-play)',
    description:
      'Has multiple PLAY-REQUIRED wins but has fulfilled none of them. This is a direct rule violation.',
    severity: 'expel',
  },
  bad_play_rate: {
    title: 'Bad play rate',
    description:
      'Owns wins but has little or no evidence of actually playing them. Based on Steam playtime; wins with no available stats are noted and lower the confidence.',
    severity: 'warn',
  },
  private_steam: {
    title: 'Private Steam — unverifiable',
    description:
      'Steam library/playtime is hidden, so play activity cannot be verified. Hiding stats is worth a warning — and worse when it conceals high-quality wins.',
    severity: 'warn',
  },
  no_recent_giveaway: {
    title: 'No recent giveaway created',
    description: `Has not created a counting full-CV giveaway in over ${STALE_CREATE_MONTHS} months (giveaways with no entries or that were deleted don't count).`,
    severity: 'warn',
  },
  quality_unplayed: {
    title: 'Won great games, never played',
    description: `Claimed highly-wishlisted games (≥${QUALITY_WISHLIST_MIN} wishlists) and never launched them. Recent wins (under ${QUALITY_LENIENT_MONTHS} months) are forgiven.`,
    severity: 'warn',
  },
  inactive_member: {
    title: 'Inactive long-time member',
    description: `Joined the group over ${ESTABLISHED_MONTHS} months ago (by first group activity, not SG registration) but has no giveaway won, created, or entered in over ${INACTIVE_MONTHS} months.`,
    severity: 'warn',
  },
  bad_ratio: {
    title: 'Net receiver (bad ratio)',
    description: 'Receives substantially more value than they send.',
    severity: 'warn',
  },
  not_on_discord: {
    title: 'Not on Discord',
    description:
      'Confirmed absent from the community Discord server. A soft signal — combine with other flags.',
    severity: 'info',
  },
}

const sgGiveawayUrl = (link: string) =>
  `https://www.steamgifts.com/giveaway/${link}`

function monthsAgo(timestampSec: number, nowSec: number): number {
  return (nowSec - timestampSec) / MONTH_SECONDS
}

function formatMonths(months: number): string {
  if (months < 1) return 'under a month ago'
  const rounded = Math.round(months)
  if (rounded < 12) return `${rounded}mo ago`
  const years = (months / 12).toFixed(1)
  return `${years}y ago`
}

/** Short absolute date, e.g. "12 Jun 2025". */
function formatShortDate(tsSec: number): string {
  return new Date(tsSec * 1000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** Turns a snake_case event key ("may_event_2026") into a label ("May Event 2026"). */
export function formatEventLabel(eventType: string): string {
  return eventType
    .split('_')
    .map((word) => {
      if (word === 'rpg') return 'RPG'
      if (/^\d+$/.test(word)) return word
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

interface Lookups {
  giveawayByLink: Map<string, Giveaway>
  /** wishlist count for a won/created giveaway, via app_id then name. */
  wishlistFor: (link: string, name: string) => number
}

/**
 * Builds the giveaway-by-link map and the wishlist lookups (app_id/name →
 * wishlist count) used by the quality and contribution checks.
 */
function buildLookups(
  giveaways: Giveaway[],
  wishlist: WishlistData | null,
): Lookups {
  const giveawayByLink = new Map<string, Giveaway>()
  for (const g of giveaways) giveawayByLink.set(g.link, g)

  const appToWishlist = new Map<number, number>()
  const nameToWishlist = new Map<string, number>()
  for (const e of wishlist?.entries ?? []) {
    if (e.app_id != null) appToWishlist.set(e.app_id, e.wishlist_count)
    nameToWishlist.set(e.name.toLowerCase(), e.wishlist_count)
  }

  const wishlistFor = (link: string, name: string): number => {
    const appId = giveawayByLink.get(link)?.app_id
    if (appId != null && appToWishlist.has(appId)) {
      return appToWishlist.get(appId)!
    }
    return nameToWishlist.get(name.toLowerCase()) ?? 0
  }

  return { giveawayByLink, wishlistFor }
}

/** Latest joined_at across this user's entered giveaways, in unix seconds. */
function lastEnteredAt(
  steamId: string,
  userEntries: UserEntry | null,
): number | null {
  const entries = userEntries?.[steamId]
  if (!entries || entries.length === 0) return null
  return entries.reduce((max, e) => Math.max(max, e.joined_at), 0)
}

/**
 * Pure play-rate over a user's wins. "Played" means Steam shows non-zero
 * playtime (achievements are NOT required). Wins with no available stats are
 * counted in the denominator but tracked separately so the UI can caveat them.
 */
export function computePlayRate(user: User): PlayRate {
  const won = user.giveaways_won ?? []
  const total = won.length
  const noStatsCount = won.filter(
    (g) => !g.steam_play_data || g.steam_play_data.has_no_available_stats,
  ).length
  const played = won.filter(
    (g) =>
      g.steam_play_data &&
      !g.steam_play_data.never_played &&
      !g.steam_play_data.has_no_available_stats,
  ).length
  return {
    played,
    total,
    percentage: total > 0 ? Math.round((played / total) * 100) : 0,
    noStatsCount,
  }
}

/** Runs every criterion against one user and returns the flags + highlights. */
function analyzeUser(
  user: User,
  ctx: {
    nowSec: number
    userEntries: UserEntry | null
    lookups: Lookups
  },
): {
  flags: UserFlag[]
  highlights: UserHighlights
  recent: {
    lastCreated: RecentGiveaway | null
    lastWon: RecentGiveaway | null
    lastEntered: RecentGiveaway | null
  }
} {
  const { nowSec, userEntries, lookups } = ctx
  const { giveawayByLink, wishlistFor: wishlistCountFor } = lookups
  const flags: UserFlag[] = []
  const won = user.giveaways_won ?? []
  const created = user.giveaways_created ?? []
  const ratio = user.stats.giveaway_ratio ?? 0

  const firstSeen = user.stats.first_seen_at ?? null
  const establishedFor = (months: number) =>
    firstSeen == null || firstSeen <= nowSec - months * MONTH_SECONDS

  const lastWon = user.stats.last_giveaway_won_at ?? null
  const lastEntered = lastEnteredAt(user.steam_id, userEntries)

  // A created giveaway only "counts" if people actually entered it and it wasn't
  // deleted — a 0-entry or deleted GA contributed nothing to anyone.
  const isRealCreated = (g: NonNullable<User['giveaways_created']>[number]) =>
    g.entries > 0 && !giveawayByLink.get(g.link)?.deleted
  const realCreated = created.filter(isRealCreated)
  const createdFcv = realCreated.filter((g) => g.cv_status === 'FULL_CV')
  const lastFcvCreatedGa = [...createdFcv].sort(
    (a, b) => b.created_timestamp - a.created_timestamp,
  )[0]
  const lastFcvCreated = lastFcvCreatedGa?.created_timestamp ?? null
  // Last activity uses real created GAs (a deleted/0-entry GA isn't activity).
  const lastRealCreatedAt =
    realCreated.length > 0
      ? Math.max(...realCreated.map((g) => g.created_timestamp))
      : null
  const lastActivity = Math.max(
    lastWon ?? 0,
    lastRealCreatedAt ?? 0,
    lastEntered ?? 0,
  )

  const recentlyActive =
    (lastWon != null && lastWon >= nowSec - STILL_ACTIVE_MONTHS * MONTH_SECONDS) ||
    (lastEntered != null &&
      lastEntered >= nowSec - STILL_ACTIVE_MONTHS * MONTH_SECONDS)

  // --- 1. Taking without giving (low-ratio members only) -------------------
  const dormantCreator =
    establishedFor(ESTABLISHED_MONTHS) &&
    (lastFcvCreated == null ||
      lastFcvCreated < nowSec - DORMANT_CREATE_MONTHS * MONTH_SECONDS)
  // Only a low-ratio member "takes without giving" — net contributors are exempt.
  const dormantFired = dormantCreator && recentlyActive && ratio < LOW_RATIO_MAX
  if (dormantFired) {
    const createdNote =
      lastFcvCreated == null
        ? 'Never created a full-CV giveaway'
        : `Last created a full-CV giveaway ${formatMonths(monthsAgo(lastFcvCreated, nowSec))}`
    // Surface their actual taking: are they winning, or just entering and losing?
    const wonRecently =
      lastWon != null && lastWon >= nowSec - STILL_ACTIVE_MONTHS * MONTH_SECONDS
    const takingNote = wonRecently
      ? 'still winning giveaways.'
      : 'still entering giveaways — but no recent wins.'

    const lastWonGame = [...won].sort(
      (a, b) => b.end_timestamp - a.end_timestamp,
    )[0]
    const lastEnteredEntry = (userEntries?.[user.steam_id] ?? [])
      .slice()
      .sort((a, b) => b.joined_at - a.joined_at)[0]

    const games: FlaggedGame[] = []
    if (lastFcvCreatedGa) {
      games.push({
        name: lastFcvCreatedGa.name,
        link: sgGiveawayUrl(lastFcvCreatedGa.link),
        note: `last created · ${formatMonths(monthsAgo(lastFcvCreatedGa.created_timestamp, nowSec))}`,
      })
    }
    if (lastWonGame) {
      games.push({
        name: lastWonGame.name,
        link: sgGiveawayUrl(lastWonGame.link),
        note: `last won · ${formatMonths(monthsAgo(lastWonGame.end_timestamp, nowSec))}`,
      })
    }
    if (lastEnteredEntry) {
      const enteredName =
        giveawayByLink.get(lastEnteredEntry.link)?.name ?? 'a giveaway'
      games.push({
        name: enteredName,
        link: sgGiveawayUrl(lastEnteredEntry.link),
        note: `last entered · ${formatMonths(monthsAgo(lastEnteredEntry.joined_at, nowSec))}`,
      })
    }

    flags.push({
      id: 'dormant_creator_still_taking',
      severity: 'expel',
      label: 'Stopped giving but still taking',
      detail: lastWonGame
        ? `${createdNote}, but ${takingNote}`
        : `${createdNote}, but ${takingNote} Has never won a giveaway in the group.`,
      games,
      weight: FLAG_WEIGHT.dormant_creator_still_taking,
    })
  }

  // --- 1b. No recent giveaway created (anyone) -----------------------------
  // A standalone warning when a member hasn't created a counting full-CV GA in
  // a while. Skipped if the stronger "taking without giving" flag already fired.
  const staleCreate =
    lastFcvCreated == null
      ? establishedFor(STALE_CREATE_MONTHS)
      : lastFcvCreated < nowSec - STALE_CREATE_MONTHS * MONTH_SECONDS
  if (staleCreate && !dormantFired) {
    flags.push({
      id: 'no_recent_giveaway',
      severity: 'warn',
      label:
        lastFcvCreated == null
          ? 'No counting full-CV giveaway created yet'
          : `Last full-CV giveaway created ${formatMonths(monthsAgo(lastFcvCreated, nowSec))}`,
      detail:
        lastFcvCreated == null
          ? "Hasn't created a full-CV giveaway with entries that wasn't later deleted."
          : `Over ${STALE_CREATE_MONTHS} months since their last counting full-CV giveaway.`,
      games: lastFcvCreatedGa
        ? [
            {
              name: lastFcvCreatedGa.name,
              link: sgGiveawayUrl(lastFcvCreatedGa.link),
              note: `last created · ${formatMonths(monthsAgo(lastFcvCreatedGa.created_timestamp, nowSec))}`,
            },
          ]
        : undefined,
      weight: FLAG_WEIGHT.no_recent_giveaway,
    })
  }

  // --- 2. Proof-of-play: 0% proven -----------------------------------------
  const requiredWins = won.filter((g) => g.required_play)
  const provenWins = requiredWins.filter(
    (g) => g.required_play_meta?.requirements_met,
  )
  if (requiredWins.length >= 2 && provenWins.length === 0) {
    flags.push({
      id: 'zero_proven_play',
      severity: 'expel',
      label: `0% proven play (0/${requiredWins.length} PLAY-REQUIRED wins fulfilled)`,
      detail: 'Has not fulfilled a single proof-of-play requirement.',
      games: requiredWins.slice(0, 6).map((g) => ({
        name: g.name,
        link: sgGiveawayUrl(g.link),
        note: `won ${formatMonths(monthsAgo(g.end_timestamp, nowSec))}`,
      })),
      weight: FLAG_WEIGHT.zero_proven_play,
    })
  }

  // --- 3. Private Steam profile / bad play rate ----------------------------
  const playRate = computePlayRate(user)
  const playLabel = `${playRate.percentage}% play rate — ${playRate.played} out of ${playRate.total} wins played`
  const noStatsNote =
    playRate.noStatsCount > 0
      ? `Note: ${playRate.noStatsCount} of ${playRate.total} wins have no Steam stats available, so the true rate may be higher.`
      : undefined

  // "Private" covers an explicitly private profile AND the case where most wins
  // come back as `library_unavailable` (a private library by another name).
  const unreadableWins = won.filter(
    (g) => g.steam_play_data?.no_stats_reason === 'library_unavailable',
  )
  const isPrivateSteam =
    !!user.steam_profile_is_private ||
    (won.length > 0 && unreadableWins.length >= Math.ceil(won.length / 2))

  // High-quality wins we can't verify were ever played — worse than plain hiding.
  const hiddenQualityWins = won
    .map((g) => ({ g, wc: wishlistCountFor(g.link, g.name) }))
    .filter(({ wc }) => wc >= QUALITY_WISHLIST_MIN)
    .sort((a, b) => b.wc - a.wc)

  if (isPrivateSteam) {
    const worse = hiddenQualityWins.length >= QUALITY_WINS_HIDDEN_MIN
    flags.push({
      id: 'private_steam',
      severity: worse ? 'expel' : 'warn',
      label: worse
        ? `Private Steam hiding ${hiddenQualityWins.length} high-quality wins`
        : 'Private Steam — play activity unverifiable',
      detail: worse
        ? "Library is private, so we can't confirm these valuable wins were ever played — hiding stats while holding high-quality wins is a red flag."
        : 'Steam library/playtime is hidden, so a true play rate cannot be measured. Hiding stats is itself worth a warning.',
      games: worse
        ? hiddenQualityWins.slice(0, 8).map(({ g, wc }) => ({
            name: g.name,
            link: sgGiveawayUrl(g.link),
            note: `${wc} wishlists · won ${formatMonths(monthsAgo(g.end_timestamp, nowSec))}`,
          }))
        : undefined,
      weight: worse ? FLAG_WEIGHT.bad_play_rate : FLAG_WEIGHT.private_steam,
    })
  } else if (
    playRate.total > 2 &&
    playRate.total - playRate.noStatsCount > 0 &&
    establishedFor(2)
  ) {
    // Need at least one win with usable stats — otherwise we'd be claiming a
    // play rate with no visibility at all.
    let severity: FlagSeverity | null = null
    if (playRate.percentage === 0) {
      severity = 'expel'
    } else if (playRate.total > 7 && playRate.percentage < 10) {
      severity = 'expel'
    } else if (playRate.percentage < 33) {
      severity = 'warn'
    }
    if (severity) {
      // Lower confidence (severity + weight) when many wins simply lack stats.
      const lowConfidence =
        playRate.noStatsCount / playRate.total >= 0.3
      const baseWeight =
        severity === 'expel'
          ? FLAG_WEIGHT.bad_play_rate
          : Math.round(FLAG_WEIGHT.bad_play_rate / 2)
      flags.push({
        id: 'bad_play_rate',
        severity: lowConfidence ? 'warn' : severity,
        label: playLabel,
        detail: noStatsNote,
        weight: Math.max(1, baseWeight - (playRate.noStatsCount > 0 ? 1 : 0)),
      })
    }
  }

  // --- 4. Won great games, never played ------------------------------------
  const qualityUnplayed = won
    .map((g) => ({ g, wc: wishlistCountFor(g.link, g.name) }))
    .filter(({ g, wc }) => {
      if (wc < QUALITY_WISHLIST_MIN) return false
      const sp = g.steam_play_data
      // Only accuse when Steam actually proves it unplayed (stats must exist).
      if (!sp || sp.has_no_available_stats) return false
      if (!sp.never_played) return false
      // Lenient: forgive recent wins.
      return monthsAgo(g.end_timestamp, nowSec) >= QUALITY_LENIENT_MONTHS
    })
    .sort((a, b) => b.wc - a.wc)
  // Skip when Steam is private (unverifiable), or when an otherwise engaged
  // player merely skipped a couple of titles.
  const engagedPlayer = playRate.percentage >= GREAT_PLAY_RATE
  const skipQuality =
    isPrivateSteam || (engagedPlayer && qualityUnplayed.length <= 2)
  if (qualityUnplayed.length > 0 && !skipQuality) {
    flags.push({
      id: 'quality_unplayed',
      severity: qualityUnplayed.length >= 3 ? 'expel' : 'warn',
      label: `${qualityUnplayed.length} great game${qualityUnplayed.length > 1 ? 's' : ''} won but never played`,
      games: qualityUnplayed.slice(0, 8).map(({ g, wc }) => ({
        name: g.name,
        link: sgGiveawayUrl(g.link),
        note: `${wc} wishlists · won ${formatMonths(monthsAgo(g.end_timestamp, nowSec))}`,
      })),
      weight:
        FLAG_WEIGHT.quality_unplayed +
        Math.min(qualityUnplayed.length - 1, 2),
    })
  }

  // --- 5. Inactive long-time member ----------------------------------------
  if (
    establishedFor(ESTABLISHED_MONTHS) &&
    (lastActivity === 0 ||
      lastActivity < nowSec - INACTIVE_MONTHS * MONTH_SECONDS)
  ) {
    const joinedNote =
      firstSeen != null
        ? `Joined the group ${formatMonths(monthsAgo(firstSeen, nowSec))}. `
        : ''
    const activityNote =
      lastActivity === 0
        ? 'No recorded giveaway activity.'
        : `Last activity (won/created/entered) ${formatMonths(monthsAgo(lastActivity, nowSec))}.`
    flags.push({
      id: 'inactive_member',
      severity: 'warn',
      label: 'Inactive long-time member',
      detail: `${joinedNote}${activityNote}`,
      weight: FLAG_WEIGHT.inactive_member,
    })
  }

  // --- 6. Bad ratio (net receiver) -----------------------------------------
  // A "receiver" is a member whose weighted wins outstrip their gifts (ratio ≤ -1).
  if (ratio <= -1) {
    const severe = ratio <= -3
    flags.push({
      id: 'bad_ratio',
      severity: severe ? 'expel' : 'warn',
      label: `Net receiver (ratio ${ratio.toFixed(2)})`,
      detail: severe
        ? 'Receives far more value than they contribute.'
        : 'Receives more value than they contribute.',
      weight: severe ? FLAG_WEIGHT.bad_ratio + 1 : FLAG_WEIGHT.bad_ratio,
    })
  }

  // --- 7. Not on Discord ----------------------------------------------------
  if (user.discord_member === false) {
    flags.push({
      id: 'not_on_discord',
      severity: 'info',
      label: 'Not on Discord',
      weight: FLAG_WEIGHT.not_on_discord,
    })
  }

  // --- Positive signals (badges) -------------------------------------------
  const badges: string[] = []
  if (ratio >= GREAT_RATIO_MIN) {
    badges.push(`Top contributor (ratio ${ratio.toFixed(2)})`)
  }
  if (!isPrivateSteam && playRate.total >= 5 && playRate.percentage === 100) {
    badges.push(`100% play rate (${playRate.total} wins)`)
  } else if (
    !isPrivateSteam &&
    playRate.total >= 5 &&
    playRate.percentage >= GREAT_PLAY_RATE
  ) {
    badges.push(`Great play rate (${playRate.percentage}%)`)
  }

  // --- Contributions (events run, quality games gifted) --------------------
  // Only real giveaways count (entries > 0, not deleted) — createdFcv is already
  // filtered above; events likewise ignore dead/deleted giveaways.
  const eventCounts = new Map<string, number>()
  for (const g of realCreated) {
    const eventType = giveawayByLink.get(g.link)?.event_type
    if (eventType) eventCounts.set(eventType, (eventCounts.get(eventType) ?? 0) + 1)
  }
  const events = [...eventCounts.entries()]
    .map(([type, count]) => ({ label: formatEventLabel(type), count }))
    .sort((a, b) => b.count - a.count)

  const qualityGiven: FlaggedGame[] = createdFcv
    .map((g) => ({ g, wc: wishlistCountFor(g.link, g.name) }))
    .filter(({ wc }) => wc >= QUALITY_WISHLIST_MIN)
    .sort((a, b) => b.wc - a.wc)
    // De-dupe repeat giveaways of the same title.
    .filter(
      ({ g }, i, arr) =>
        arr.findIndex((x) => x.g.name === g.name) === i,
    )
    .slice(0, 8)
    .map(({ g, wc }) => ({
      name: g.name,
      link: sgGiveawayUrl(g.link),
      note: `${wc} wishlists · gifted ${formatShortDate(g.created_timestamp)}`,
    }))

  // Proof-of-play engagement: "I played, bro" marks and PLAY-REQUIRED outcomes.
  const playedBroCount = won.filter((g) => g.i_played_bro).length
  const requiredWonAll = won.filter((g) => g.required_play)
  const requiredPlayed = requiredWonAll.filter(
    (g) => g.required_play_meta?.requirements_met,
  ).length

  const highlights: UserHighlights = {
    badges,
    createdCount: createdFcv.length,
    events,
    qualityGiven,
    playedBroCount,
    requiredPlay: {
      played: requiredPlayed,
      notPlayed: requiredWonAll.length - requiredPlayed,
    },
  }

  // A member who has gifted many high-quality games gets the benefit of the
  // doubt on hoarding a few of their own wins — downgrade expel → warn.
  if (qualityGiven.length >= MANY_QUALITY_GIVEN) {
    const qualityFlag = flags.find((f) => f.id === 'quality_unplayed')
    if (qualityFlag && qualityFlag.severity === 'expel') {
      qualityFlag.severity = 'warn'
      qualityFlag.detail =
        `Kept at warning — this member has gifted ${qualityGiven.length} high-quality games of their own.`
    }
  }

  // A high-ratio member with great contributions is in good standing. They can
  // still be surfaced — but ONLY for being inactive / dropping off, a low play
  // rate, or a hard rule break (proof-of-play). Everything else (unplayed
  // quality wins, no Discord, etc.) is forgiven for these members.
  const incrediblePlayer =
    !isPrivateSteam &&
    playRate.total >= 5 &&
    playRate.percentage >= INCREDIBLE_PLAY_RATE
  const greatContributions =
    highlights.createdCount >= 12 || highlights.events.length >= 2
  const strongMember =
    ratio >= GREAT_RATIO_MIN || incrediblePlayer || greatContributions

  const ALLOWED_WHEN_STRONG: ReadonlySet<FlagId> = new Set([
    'inactive_member',
    'no_recent_giveaway',
    'bad_play_rate',
    'private_steam',
    'zero_proven_play',
  ])
  const finalFlags = strongMember
    ? flags.filter((f) => ALLOWED_WHEN_STRONG.has(f.id))
    : flags

  // Recent-activity references for the card header (counting GAs only for created).
  const lastWonGame = [...won].sort(
    (a, b) => b.end_timestamp - a.end_timestamp,
  )[0]
  const lastEnteredEntry = (userEntries?.[user.steam_id] ?? [])
    .slice()
    .sort((a, b) => b.joined_at - a.joined_at)[0]
  const recent = {
    lastCreated: lastFcvCreatedGa
      ? {
          name: lastFcvCreatedGa.name,
          link: sgGiveawayUrl(lastFcvCreatedGa.link),
          at: lastFcvCreatedGa.created_timestamp,
        }
      : null,
    lastWon: lastWonGame
      ? {
          name: lastWonGame.name,
          link: sgGiveawayUrl(lastWonGame.link),
          at: lastWonGame.end_timestamp,
        }
      : null,
    lastEntered: lastEnteredEntry
      ? {
          name:
            giveawayByLink.get(lastEnteredEntry.link)?.name ?? 'a giveaway',
          link: sgGiveawayUrl(lastEnteredEntry.link),
          at: lastEnteredEntry.joined_at,
        }
      : null,
  }

  return { flags: finalFlags, highlights, recent }
}

/**
 * Runs the full spring-cleaning analysis over the active member set.
 * Pure — pass already-loaded data in.
 */
export function analyzeSpringCleaning(
  users: User[],
  giveaways: Giveaway[],
  _gameData: GameData[],
  wishlist: WishlistData | null,
  userEntries: UserEntry | null,
  options: { nowSec?: number } = {},
): SpringCleaningResult {
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000)
  const lookups = buildLookups(giveaways, wishlist)

  const analyzed: AnalyzedUser[] = []
  let eligibleCount = 0
  for (const user of users) {
    // Only spring-clean members who have been around long enough. A known
    // join date within the window excludes them; unknown dates are allowed
    // through (most are long-standing members predating the field).
    const firstSeen = user.stats.first_seen_at ?? null
    if (
      firstSeen != null &&
      firstSeen > nowSec - MIN_MEMBERSHIP_MONTHS * MONTH_SECONDS
    ) {
      continue
    }
    eligibleCount++

    const { flags, highlights, recent } = analyzeUser(user, {
      nowSec,
      userEntries,
      lookups,
    })
    if (flags.length === 0) continue
    const score = flags.reduce((sum, f) => sum + f.weight, 0)
    const hasExpel = flags.some((f) => f.severity === 'expel')
    // A pile of warn-level signals also escalates to an expel recommendation.
    const warnCount = flags.filter((f) => f.severity === 'warn').length
    const classification: 'expel' | 'warn' =
      hasExpel || score >= 8 || warnCount >= 3 ? 'expel' : 'warn'
    analyzed.push({
      username: user.username,
      steam_id: user.steam_id,
      avatar_url: user.avatar_url,
      discord_member: user.discord_member,
      ratio: user.stats.giveaway_ratio ?? 0,
      playRate: computePlayRate(user),
      isDeleted: user.is_deleted_sg_account,
      memberSince: firstSeen,
      lastActiveAt:
        Math.max(
          user.stats.last_giveaway_won_at ?? 0,
          user.stats.last_giveaway_created_at ?? 0,
          lastEnteredAt(user.steam_id, userEntries) ?? 0,
        ) || null,
      lastCreated: recent.lastCreated,
      lastWon: recent.lastWon,
      lastEntered: recent.lastEntered,
      highlights,
      classification,
      score,
      flags: flags.sort((a, b) => b.weight - a.weight),
    })
  }

  analyzed.sort((a, b) => b.score - a.score || a.username.localeCompare(b.username))

  const expel = analyzed.filter((u) => u.classification === 'expel')
  const warn = analyzed.filter((u) => u.classification === 'warn')

  // Build per-criterion sections.
  const sectionOrder: FlagId[] = [
    'dormant_creator_still_taking',
    'zero_proven_play',
    'bad_play_rate',
    'private_steam',
    'quality_unplayed',
    'no_recent_giveaway',
    'inactive_member',
    'bad_ratio',
    'not_on_discord',
  ]
  const counts = {} as Record<FlagId, number>
  const sections: SectionResult[] = sectionOrder.map((id) => {
    const meta = SECTION_META[id]
    const usersForFlag = analyzed
      .map((u) => ({ u, flag: u.flags.find((f) => f.id === id) }))
      .filter((x): x is { u: AnalyzedUser; flag: UserFlag } => x.flag != null)
      .sort((a, b) => b.u.score - a.u.score)
    counts[id] = usersForFlag.length
    return {
      id,
      title: meta.title,
      description: meta.description,
      severity: meta.severity,
      users: usersForFlag.map(({ u, flag }) => ({
        username: u.username,
        steam_id: u.steam_id,
        avatar_url: u.avatar_url,
        discord_member: u.discord_member,
        detail: flag.detail ? `${flag.label} — ${flag.detail}` : flag.label,
        games: flag.games,
      })),
    }
  })

  return {
    totalAnalyzed: eligibleCount,
    generatedAt: nowSec,
    expel,
    warn,
    sections,
    counts,
  }
}
