export interface Creator {
  username: string
  avatar: string
  role: string
}

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
  region_restricted: boolean
  invite_only: boolean
  whitelist: boolean
  group: boolean
  contributor_level: number
  comment_count: number
  entry_count: number
  creator: Creator
  cv_status?: CVStatus
  // HTML scraping specific fields
  hasWinners?: boolean
  winners?: Array<{
    name: string | null
    status: 'received' | 'not_received' | 'awaiting_feedback'
  }>
  // New properties
  required_play?: boolean
  is_shared?: boolean
  is_whitelist?: boolean
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
}

export interface User {
  username: string
  profile_url: string
  avatar_url: string
  steam_id?: string | null
  steam_profile_url?: string | null
  steam_profile_is_private?: boolean
  country_code?: string | null
  stats: UserGiveawaysStats
  giveaways_won?: Array<{
    name: string
    link: string
    cv_status: CVStatus
    status: 'received' | 'not_received' | 'awaiting_feedback'
    end_timestamp: number
    steam_play_data?: SteamPlayData
    required_play: boolean
    is_shared: boolean
    proof_of_play?: boolean
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
    winners?: Array<{
      name: string | null
      status: 'received' | 'not_received' | 'awaiting_feedback'
      activated: boolean // true if name is not null and status is received
    }>
  }>
}

export interface UserGroupData {
  lastUpdated: number
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

export interface GamePrice {
  name: string
  app_id: number | null
  package_id: number | null
  price_usd_full: number
  price_usd_reduced: number
  needs_manual_update: boolean
}
