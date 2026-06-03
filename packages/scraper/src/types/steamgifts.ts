/**
 * Machine-readable explanation for why a won game has no available stats, so
 * the UI can tell an admin *why* instead of a bare "No stats available".
 */
export type NoStatsReason =
  | 'package_delisted' // sub→app + title match both failed (package unlisted)
  | 'not_in_library' // resolved to a real app, but the user doesn't own it
  | 'library_unavailable' // couldn't read the library (private profile / empty)
  | 'no_steam_stats' // owned, but Steam exposes no achievement stats

export interface Giveaway {
  id: string
  name: string
  points: number
  copies: number
  app_id: number | null
  package_id: number | null
  link: string
  created_timestamp: number
  start_timestamp: number
  end_timestamp: number
  region_restricted?: boolean
  invite_only?: boolean
  whitelist?: boolean
  group: boolean
  comment_count?: number
  entry_count: number
  /** steam_id of the creator (resolved from username at scrape time) */
  creator: string
  /** Original username of the creator (for display purposes) */
  creator_username?: string
  cv_status?: CVStatus
  // HTML scraping specific fields
  hasWinners?: boolean
  winners?: Array<{
    /** steam_id of the winner (resolved from username at scrape time), or null */
    name: string | null
    /** Original username of the winner (for display purposes) */
    winner_username?: string
    status: 'received' | 'not_received' | 'awaiting_feedback'
  }>
  // New properties
  required_play?: boolean
  is_shared?: boolean
  is_whitelist?: boolean
  event_type?: string
  decreased_ratio_info?: {
    notes?: string
  }
  // Deletion tracking
  deleted?: boolean
  deleted_reason?: string
}

export interface Group {
  name: string
  url: string
}

export interface SteamGiftsResponse {
  success: boolean
  page: number
  per_page: number
  group: Group
  results: Giveaway[]
}

export interface SteamPlayData {
  owned: boolean
  playtime_minutes: number
  playtime_formatted: string
  achievements_unlocked: number
  achievements_total: number
  achievements_percentage: number
  never_played: boolean
  last_checked?: number // Timestamp when this data was last fetched
  has_no_available_stats?: boolean
  no_stats_reason?: NoStatsReason
  is_potentially_idling?: boolean
}

export interface User {
  username: string
  profile_url: string
  avatar_url: string
  steam_id: string
  steam_profile_url?: string | null
  steam_profile_is_private?: boolean
  country_code?: string | null
  stats: UserGiveawaysStats
  warnings?: string[]
  left_at_timestamp?: number
  /**
   * True when the SteamGifts account no longer exists. The user is preserved
   * (typically in ex_members) so their historical giveaways stay attributed,
   * but their profile_url / avatar_url / Steam-API-derived fields may be
   * stubs reconstructed from giveaway data instead of live SG data.
   */
  is_deleted_sg_account?: boolean
  /** Unix seconds — when the user registered on SteamGifts (from their SG profile page). */
  registered_at?: number
  /** SteamGifts contributor level (typically 0–10, can have decimals). */
  contributor_level?: number
  /**
   * Unix ms — most recent time we observed the member's total playtime
   * increase on ANY tracked game (set by the daily playtime job). Best-effort
   * proxy for "last time the member actually played something". Only populated
   * going forward; absent for members whose playtime hasn't risen since
   * tracking began, so treat `undefined`/`null` as "unknown", not "inactive".
   */
  last_played_at?: number | null
  giveaways_won?: Array<{
    name: string
    link: string
    cv_status: CVStatus
    status: 'received' | 'not_received' | 'awaiting_feedback'
    end_timestamp: number
    steam_play_data?: SteamPlayData
    required_play: boolean
    is_shared: boolean
    i_played_bro?: boolean
    required_play_meta?: {
      requirements_met: boolean
      deadline?: string
      deadline_in_months?: number
      additional_notes?: string
    }
  }>
  giveaways_created?: Array<{
    name: string
    link: string
    cv_status: CVStatus
    entries: number
    copies: number
    created_timestamp: number
    end_timestamp: number
    had_winners?: boolean // Only set if giveaway has ended
    required_play: boolean
    is_shared: boolean
    i_played_bro?: boolean
    required_play_meta?: {
      requirements_met: boolean
      deadline?: string
      deadline_in_months?: number
      additional_notes?: string
    }
    winners?: Array<{
      name: string | null
      winner_username?: string
      status: 'received' | 'not_received' | 'awaiting_feedback'
      activated: boolean // true if name is not null and status is received
    }>
  }>
}

export interface UserGroupData {
  lastUpdated: number
  /** Users keyed by steam_id */
  users: Record<string, User>
}

export interface ExMemberData {
  lastUpdated: number
  /** Ex-members keyed by steam_id */
  users: Record<string, User>
}

export interface UserStats {
  totalUsers: number
  newUsers: number
  updatedUsers: number
  pagesFetched: number
}

export interface UserGiveawaysStats {
  giveaways_created: number
  giveaways_with_no_entries: number
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
  // Real values
  real_total_sent_value: number
  real_total_received_value: number
  real_total_value_difference: number
  real_total_sent_count: number
  real_total_received_count: number
  real_total_gift_difference: number
  // Shared giveaways
  shared_sent_count: number
  shared_received_count: number
  // Other stats
  last_giveaway_created_at: number | null
  last_giveaway_won_at: number | null
  /**
   * Unix seconds — earliest evidence of group membership, computed from the
   * oldest of: giveaways_created (created_timestamp), giveaways_won
   * (end_timestamp), and entries on group GAs (joined_at). Best-effort proxy
   * for when the user joined the group, since SG doesn't expose join dates.
   */
  first_seen_at?: number | null
  total_achievements_percentage?: number
  average_achievements_percentage?: number
  real_total_achievements_percentage?: number
  real_average_achievements_percentage?: number
  has_missing_achievements_data?: boolean
}

// CV Status related interfaces
export interface BundleGame {
  name: string
  app_id: number
  package_id: number | null
  reduced_value_timestamp: number | null
  no_value_timestamp: number | null
}

export interface BundleGamesResponse {
  success: boolean
  page: number
  per_page: number
  results: BundleGame[]
}

export type CVStatus = 'FULL_CV' | 'REDUCED_CV' | 'NO_CV'

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

export interface GamePrice {
  name: string
  app_id: number | null
  package_id: number | null
  price_usd_full: number
  price_usd_reduced: number
  needs_manual_update: boolean
  hltb_main_story_hours: number | null
}
