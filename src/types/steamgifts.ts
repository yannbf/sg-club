export interface Creator {
  username: string
  avatar: string
  role: string
}

export interface Giveaway {
  id: number
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
  cv_status?: 'FULL_CV' | 'REDUCED_CV' | 'NO_CV'
  // HTML scraping specific fields
  hasWinners?: boolean
  winners?: Array<{
    name: string | null
    status: 'received' | 'not_received' | 'awaiting_feedback'
  }>
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
  }
  giveaways_won?: Array<{
    name: string
    link: string
    cv_status: CVStatus
    status: 'received' | 'not_received' | 'awaiting_feedback'
    end_timestamp: number
    steam_play_data?: SteamPlayData
  }>
  giveaways_created?: Array<{
    name: string
    link: string
    cv_status: CVStatus
    entries: number
    end_timestamp: number
    had_winners?: boolean // Only set if giveaway has ended
    winners?: Array<{
      name: string | null
      status: 'received' | 'not_received' | 'awaiting_feedback'
      activated: boolean // true if name is not null and status is received
    }>
  }>
}

export interface UserGroupData {
  lastUpdated: number
  users: User[]
}

export interface UserStats {
  totalUsers: number
  newUsers: number
  updatedUsers: number
  pagesFetched: number
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
