export interface User {
  username: string
  profile_url: string
  avatar_url: string
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
  steam_id?: string
  steam_profile_url?: string
  steam_profile_is_private?: boolean
  giveaways_won?: {
    name: string
    link: string
    cv_status: 'FULL_CV' | 'REDUCED_CV' | 'NO_CV'
    status: string
    end_timestamp: number
    steam_play_data?: {
      owned: boolean
      playtime_minutes: number
      playtime_formatted: string
      achievements_unlocked: number
      achievements_total: number
      achievements_percentage: number
      never_played: boolean
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
  users: User[]
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
  creator: {
    username: string
    avatar: string
    role: string
  }
  cv_status?: 'FULL_CV' | 'REDUCED_CV' | 'NO_CV'
  winners?: {
    name: string
    status: string
  }[]
  hasWinners?: boolean
}

export interface InsightData {
  totalUsers: number
  totalGiveaways: number
  totalGiveawaysFromActiveMembers: number
  totalGiveawaysFromFormerMembers: number
  formerMembers: Array<{ username: string; giveawayCount: number }>
}
