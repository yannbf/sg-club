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
  }
  steam_id?: string
  steam_profile_url?: string
  steam_profile_is_private?: boolean
  country_code?: string | null
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
      last_checked: number
    }
  }[]
  giveaways_created?: {
    name: string
    link: string
    cv_status: 'FULL_CV' | 'REDUCED_CV' | 'NO_CV'
    entries: number
    copies: number
    end_timestamp: number
    had_winners?: boolean
    winners?: {
      name: string
      status: string
      activated: boolean
    }[]
  }[]
}

export interface UserGroupData {
  lastUpdated: number
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
  creator: string
  cv_status?: 'FULL_CV' | 'REDUCED_CV' | 'NO_CV'
  winners?: {
    name: string
    status: string
  }[]
  hasWinners?: boolean
  // New properties
  required_play?: boolean
  is_shared?: boolean
  required_play_meta?: {
    requirements_met: boolean
    deadline?: string
    deadline_in_months?: number
    additional_notes?: string
  }
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
  last_checked: number
}

export type UserEntry = Record<
  string,
  Array<{ link: string; joined_at: number }>
>
