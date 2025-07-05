export interface SteamGameInfo {
  appid: number
  name: string
  playtime_forever: number
  playtime_2weeks?: number
  img_icon_url?: string
  img_logo_url?: string
  has_community_visible_stats?: boolean
}

export interface SteamAchievement {
  apiname: string
  achieved: number
  unlocktime: number
  name?: string
  description?: string
}

export interface SteamGameSchema {
  gameName: string
  gameVersion: string
  availableGameStats: {
    achievements?: Array<{
      name: string
      displayName: string
      description: string
      icon: string
      icongray: string
      hidden: number
    }>
  }
}

export interface PlayerAchievements {
  steamID: string
  gameName: string
  achievements: SteamAchievement[]
  success: boolean
}

export interface OwnedGamesResponse {
  response: {
    game_count: number
    games: SteamGameInfo[]
  }
}

export interface PlayerAchievementsResponse {
  playerstats: PlayerAchievements
}

export interface GameSchemaResponse {
  game: SteamGameSchema
}
