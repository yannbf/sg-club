/**
 * Machine-readable explanation for why a won game has no available stats, so
 * the UI can tell an admin *why* instead of a bare "No stats available".
 * Mirrors the type produced by the scraper. See noStatsReasonLabel().
 */
export type NoStatsReason =
  | 'package_delisted'
  | 'not_in_library'
  | 'library_unavailable'
  | 'no_steam_stats'

/**
 * Friendly, admin-facing explanation for a `NoStatsReason` code. Falls back to
 * a generic line for unknown / legacy records that predate the reason field.
 */
export function noStatsReasonLabel(reason?: NoStatsReason): string {
  switch (reason) {
    case 'package_delisted':
      return 'This giveaway is a delisted Steam package so the game could not be identified.'
    case 'not_in_library':
      return "Resolved to a Steam game, but it isn't in this user's library (they may not own it)."
    case 'library_unavailable':
      return "Could not read this user's game library — their Steam profile is likely private."
    case 'no_steam_stats':
      return 'Steam exposes no achievement stats for this game.'
    default:
      return 'Stats could not be retrieved from Steam.'
  }
}

/**
 * Per-game stats for one title inside a multi-game Steam package (e.g. Kingdom
 * Hearts Integrum bundles three games). The win's top-level play data is the
 * sum across these; this lets the UI expand to show each game.
 */
export interface GameBreakdownEntry {
  app_id: number
  name: string
  owned: boolean
  playtime_minutes: number
  playtime_formatted: string
  achievements_unlocked: number
  achievements_total: number
  achievements_percentage: number
}

export interface User {
  username: string
  profile_url: string
  avatar_url: string
  warnings?: string[]
  stats: {
    total_sent_count: number
    total_sent_value: number
    total_received_count: number
    total_received_value: number
    total_gift_difference: number
    total_value_difference: number
    fcv_sent_count: number
    rcv_sent_count: number
    ncv_sent_count: number
    fcv_received_count: number
    rcv_received_count: number
    ncv_received_count: number
    fcv_gift_difference: number
    giveaway_ratio?: number
    real_total_sent_count: number
    real_total_sent_value: number
    real_total_received_count: number
    real_total_received_value: number
    real_total_gift_difference: number
    real_total_value_difference: number
    shared_sent_count: number
    shared_received_count: number
    last_giveaway_created_at: number | null
    last_giveaway_won_at: number | null
    /**
     * Unix seconds — earliest evidence of group membership, computed from
     * giveaways_created, giveaways_won, and entries on group GAs.
     */
    first_seen_at?: number | null
    total_achievements_percentage?: number
    average_achievements_percentage?: number
    real_total_achievements_percentage?: number
    real_average_achievements_percentage?: number
    has_missing_achievements_data?: boolean
  }
  steam_id: string
  steam_profile_url?: string
  steam_profile_is_private?: boolean
  country_code?: string | null
  /**
   * True when the SteamGifts account no longer exists. Profile + Steam-derived
   * fields may be stubs reconstructed from giveaway data rather than live SG.
   */
  is_deleted_sg_account?: boolean
  /** Unix seconds — SteamGifts account registration date (scraped from SG profile). */
  registered_at?: number
  /** SteamGifts contributor level (typically 0–10, can have decimals). */
  contributor_level?: number
  /**
   * Whether this user is in the community Discord server. Sourced from the
   * manually-maintained public/data/discord_members.json map (keyed by SG
   * username) and merged in at load time. `undefined` means "not yet classified".
   */
  discord_member?: boolean
  giveaways_won?: {
    name: string
    link: string
    cv_status: 'FULL_CV' | 'REDUCED_CV' | 'NO_CV'
    status: string
    end_timestamp: number
    i_played_bro?: boolean
    required_play?: boolean
    required_play_meta?: {
      requirements_met: boolean
      deadline?: string
      deadline_in_months?: number
      additional_notes?: string
    }
    steam_play_data?: {
      owned: boolean
      playtime_minutes: number
      playtime_formatted: string
      achievements_unlocked: number
      achievements_total: number
      achievements_percentage: number
      never_played: boolean
      is_playtime_private: boolean
      has_no_available_stats: boolean
      no_stats_reason?: NoStatsReason
      games_breakdown?: GameBreakdownEntry[]
      last_checked: number
      is_potentially_idling?: boolean
    }
  }[]
  giveaways_created?: {
    name: string
    link: string
    cv_status: 'FULL_CV' | 'REDUCED_CV' | 'NO_CV'
    entries: number
    copies: number
    created_timestamp: number
    end_timestamp: number
    had_winners?: boolean
    winners?: {
      name: string
      winner_username?: string
      status: string
      activated: boolean
    }[]
  }[]
}

export interface UserGroupData {
  lastUpdated: number
  /** Users keyed by steam_id */
  users: Record<string, User>
}

export interface Giveaway {
  id: string
  name: string
  points: number
  copies: number
  app_id: number
  package_id?: number
  link: string
  created_timestamp: number
  start_timestamp: number
  end_timestamp: number
  region_restricted: boolean
  invite_only: boolean
  whitelist: boolean
  group: boolean
  contributor_level: number
  comment_count: number
  entry_count: number
  /** steam_id of the creator */
  creator: string
  /** Original username of the creator (for display) */
  creator_username?: string
  cv_status?: 'FULL_CV' | 'REDUCED_CV' | 'NO_CV'
  winners?: {
    /** steam_id of the winner */
    name: string
    /** Original username of the winner (for display) */
    winner_username?: string
    status: string
  }[]
  hasWinners?: boolean
  // New properties
  required_play?: boolean
  is_shared?: boolean
  event_type?: string
  required_play_meta?: {
    requirements_met: boolean
    deadline?: string
    deadline_in_months?: number
    additional_notes?: string
  }
  decreased_ratio_info?: {
    notes?: string
  }
  // Deletion tracking
  deleted?: boolean
  deleted_reason?: string
}

export interface GiveawayGame {
  name: string
  image_url: string
  app_id: number
}

export interface GameData {
  name: string
  app_id: number | null
  package_id: number | null
  price_usd_full: number
  price_usd_reduced: number
  needs_manual_update: boolean
  hltb_main_story_hours: number | null
}

export interface InsightData {
  totalUsers: number
  totalGiveaways: number
  totalGiveawaysFromActiveMembers: number
  totalGiveawaysFromFormerMembers: number
  formerMembers: Array<{ username: string; giveawayCount: number }>
}

export interface SteamPlayData {
  owned: boolean
  playtime_minutes: number
  playtime_formatted: string
  achievements_unlocked: number
  achievements_total: number
  achievements_percentage: number
  never_played: boolean
  is_playtime_private: boolean
  has_no_available_stats?: boolean
  no_stats_reason?: NoStatsReason
  games_breakdown?: GameBreakdownEntry[]
  last_checked: number
}

export type UserEntry = Record<
  string,
  Array<{ link: string; joined_at: number }>
>

export interface SteamIdMapEntry {
  current: string
  previous: Array<{ username: string; changed_at: string }>
  /**
   * True when the SteamGifts account no longer exists (user deleted their account
   * altogether). Their giveaways still appear in scraped data but the SG group page
   * drops them from "Contributors" totals — so we should do the same.
   */
  deleted_sg_account?: boolean
}

export type SteamIdMap = Record<string, SteamIdMapEntry>

export interface WishlistEntry {
  name: string
  app_id: number | null
  package_id: number | null
  steam_url: string
  image_url: string | null
  wishlist_count: number
}

export interface WishlistData {
  last_updated: string
  entries: WishlistEntry[]
}

/** One unlocked achievement counted toward a gaming challenge. */
export interface ChallengeAchievement {
  apiname: string
  displayName: string
  description?: string
  unlocktime: number
}

/** A single item-discovery milestone toward the win condition. */
export interface ChallengeMilestone {
  apiname: string
  label: string
  /** Items required to reach this milestone (e.g. 200/400/700). */
  items: number
  unlocked: boolean
  unlocktime: number | null
}

/** One member's standing in a gaming challenge (e.g. Backpack Hero). */
export interface ChallengeParticipant {
  /** Display name (may differ from the SteamGifts username, e.g. for guests). */
  username: string
  /** SteamGifts username for profile linking; null for non-member guests. */
  sg_username: string | null
  /** True when this participant is not a group member (an invited guest). */
  is_guest: boolean
  steam_id: string
  avatar_url: string
  profile_url: string | null
  owned: boolean
  /** Whether Steam exposed this member's achievement stats (false ⇒ private). */
  stats_available: boolean
  playtime_total_minutes: number
  playtime_2weeks_minutes: number
  baseline_playtime_minutes: number
  /** Playtime accrued since the challenge start (current total − baseline). */
  playtime_challenge_minutes: number
  achievements_total: number
  achievements_unlocked_total: number
  /** Achievements unlocked before the challenge began (with a reliable time). */
  achievements_before_challenge?: number
  /** Achievements gained since the baseline (includes offline/no-time unlocks). */
  achievements_since_baseline?: number
  /** Achievements unlocked after the challenge start. */
  challenge_achievements: ChallengeAchievement[]
  challenge_achievement_count: number
  /**
   * Whether the member has made any challenge progress (playtime OR achievements
   * since the baseline). Resilient to playtime not yet syncing from Steam.
   */
  has_started?: boolean
  /** Item-discovery progression (Discoverer 200 → Expert 400 → Hero 700). */
  milestones: ChallengeMilestone[]
  /** Already had the winning achievement before the challenge began. */
  had_hero_before: boolean
  /** Earned the winning achievement during the challenge. */
  has_hero: boolean
  hero_unlocktime: number | null
  /** The single first member to reach the winning achievement (locked once set). */
  is_winner: boolean
}

/** A group member who owns and has played the game but isn't on the roster. */
export interface ChallengeNonParticipant {
  username: string
  steam_id: string
  avatar_url: string
  profile_url: string | null
  playtime_total_minutes: number
  playtime_2weeks_minutes: number
  achievements_unlocked_total: number
  achievements_total: number
  challenge_achievement_count: number
}

/** Full payload of a generated gaming-challenge data file. */
export interface ChallengeData {
  slug: string
  appId: number
  gameName: string
  heroAchievement: {
    apiname: string
    displayName: string
    description: string
    iconUrl?: string
  }
  startTimestamp: number
  totalAchievements: number
  generatedAt: number
  winnerUsername: string | null
  /** Unix seconds when the winner unlocked the Hero achievement. */
  winnerUnlocktime?: number | null
  participants: ChallengeParticipant[]
  nonParticipants: ChallengeNonParticipant[]
}
