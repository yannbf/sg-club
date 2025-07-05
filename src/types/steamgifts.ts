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

export interface User {
  username: string
  profile_url: string
  avatar_url: string
  sent_count: number
  sent_value: number
  received_count: number
  received_value: number
  gift_difference: number
  value_difference: number
  steam_id?: string | null
  steam_profile_url?: string | null
  giveaways_won?: Array<{
    name: string
    link: string
    cv_status: CVStatus
    status: 'received' | 'not_received' | 'awaiting_feedback'
  }>
  giveaways_created?: Array<{
    name: string
    link: string
    cv_status: CVStatus
    entries: number
    had_winners: boolean
    winners?: Array<{
      name: string | null
      status: 'received' | 'not_received' | 'awaiting_feedback'
      activated: boolean // true if name is not null and status is received
    }>
  }>
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
