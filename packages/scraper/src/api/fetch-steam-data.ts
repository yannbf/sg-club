import 'dotenv/config'
import type {
  SteamGameInfo,
  SteamAchievement,
  SteamGameSchema,
  PlayerAchievements,
  OwnedGamesResponse,
  PlayerAchievementsResponse,
  GameSchemaResponse,
} from '../types/steam.js'
import {
  formatPlaytime,
  formatDate,
  getRequiredEnvVar,
} from '../utils/common.js'
import { logError } from '../utils/log-error.js'

export interface GamePlayData {
  owned: boolean
  playtime_minutes: number
  playtime_formatted: string
  achievements_unlocked: number
  achievements_total: number
  achievements_percentage: number
  never_played: boolean
  is_playtime_private: boolean
}

export interface SteamProfileVisibility {
  is_public: boolean
  visibility_state: number
}

export class SteamGameChecker {
  private readonly baseUrl = 'https://api.steampowered.com'
  private readonly apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  private async fetchSteamAPI(endpoint: string): Promise<any> {
    const requestUrl = `${this.baseUrl}${endpoint}`
    try {
      const response = await fetch(requestUrl)

      if (!response.ok) {
        try {
          const data = (await response.json()) as any
          if (data.playerstats.error) {
            const error = new Error(
              'Steam API request failed: ' + String(data.playerstats.error)
            )
            logError(error, `Error fetching Steam API (${requestUrl})`)
            throw error
          } else {
            throw data
          }
        } catch (error: unknown) {
          logError(error, `Error fetching Steam API (${requestUrl})`)
          throw new Error(
            `Steam API request failed: ${response.status} ${
              response.statusText
            } ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }

      return await response.json()
    } catch (error) {
      const appId = endpoint.split('appid=')[1]
      console.error(
        `❌ Error fetching Steam API (${appId} - ${requestUrl}): ${error}`
      )
      logError(error, `Error fetching Steam API (${appId} - ${requestUrl})`)
      throw error
    }
  }

  private async getOwnedGames(steamId: string): Promise<SteamGameInfo[]> {
    const endpoint = `/IPlayerService/GetOwnedGames/v0001/?key=${this.apiKey}&steamid=${steamId}&format=json&include_appinfo=1&include_played_free_games=1`

    try {
      const data: OwnedGamesResponse = await this.fetchSteamAPI(endpoint)
      return data.response.games || []
    } catch (error) {
      logError(error, `Failed to get owned games for Steam ID ${steamId}`)
      return []
    }
  }

  private async getPlayerAchievements(
    steamId: string,
    appId: number
  ): Promise<SteamAchievement[]> {
    const endpoint = `/ISteamUserStats/GetPlayerAchievements/v0001/?appid=${appId}&key=${this.apiKey}&steamid=${steamId}&format=json`

    try {
      const data: PlayerAchievementsResponse = await this.fetchSteamAPI(
        endpoint
      )

      if (data.playerstats.success) {
        return data.playerstats.achievements || []
      } else {
        logError(
          data.playerstats,
          `Failed to get player achievements for Steam ID ${steamId}`
        )
        return []
      }
    } catch (error) {
      logError(
        error,
        `Failed to get player achievements for Steam ID ${steamId}`
      )
      return []
    }
  }

  private async getGameSchema(appId: number): Promise<SteamGameSchema | null> {
    const endpoint = `/ISteamUserStats/GetSchemaForGame/v2/?key=${this.apiKey}&appid=${appId}&format=json`

    try {
      const data: GameSchemaResponse = await this.fetchSteamAPI(endpoint)
      return data.game
    } catch (error) {
      return null
    }
  }

  public async getPlayerCountryCode(steamID: string): Promise<string | null> {
    const response = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${this.apiKey}&steamids=${steamID}`
    )
    const data = (await response.json()) as {
      response: { players: { loccountrycode: string }[] }
    }
    const user = data.response.players[0]
    if (user?.loccountrycode) {
      return user.loccountrycode.toLowerCase()
    }

    return null
  }

  public async checkProfileVisibility(
    steamId: string
  ): Promise<SteamProfileVisibility> {
    const endpoint = `/ISteamUser/GetPlayerSummaries/v0002/?key=${this.apiKey}&steamids=${steamId}`
    try {
      const data = await this.fetchSteamAPI(endpoint)
      if (data.response.players.length > 0) {
        const player = data.response.players[0]
        const visibility_state = player.communityvisibilitystate
        // 3 is public, anything else is considered private for our purposes
        return { is_public: visibility_state === 3, visibility_state }
      }
      // No player found for ID, assume private
      return { is_public: false, visibility_state: 0 }
    } catch (error) {
      console.error(
        `❌ Failed to get player summaries for Steam ID ${steamId}`,
        error
      )
      return { is_public: false, visibility_state: 0 }
    }
  }

  public async getGamePlayData(
    steamId: string,
    appId: number
  ): Promise<GamePlayData> {
    // Get owned games
    const ownedGames = await this.getOwnedGames(steamId)

    if (ownedGames.length === 0) {
      return {
        owned: false,
        playtime_minutes: 0,
        playtime_formatted: '0 minutes',
        achievements_unlocked: 0,
        achievements_total: 0,
        achievements_percentage: 0,
        never_played: true,
        is_playtime_private: false,
      }
    }

    // Find the specific game
    const gameInfo = ownedGames.find((game) => game.appid === appId)

    if (!gameInfo) {
      return {
        owned: false,
        playtime_minutes: 0,
        playtime_formatted: '0 minutes',
        achievements_unlocked: 0,
        achievements_total: 0,
        achievements_percentage: 0,
        never_played: true,
        is_playtime_private: false,
      }
    }

    // Get achievements
    const achievements = await this.getPlayerAchievements(steamId, appId)
    const unlockedAchievements = achievements.filter((a) => a.achieved === 1)
    const totalAchievements = achievements.length
    const completionPercentage =
      totalAchievements > 0
        ? Number(
            ((unlockedAchievements.length / totalAchievements) * 100).toFixed(1)
          )
        : 0

    return {
      owned: true,
      playtime_minutes: gameInfo.playtime_forever,
      playtime_formatted: formatPlaytime(gameInfo.playtime_forever),
      achievements_unlocked: unlockedAchievements.length,
      achievements_total: totalAchievements,
      achievements_percentage: completionPercentage,
      never_played:
        gameInfo.playtime_forever === 0 && unlockedAchievements.length === 0,
      is_playtime_private:
        gameInfo.playtime_forever === 0 && unlockedAchievements.length > 0,
    }
  }

  public async checkGame(steamId: string, appId: number): Promise<void> {
    console.log(`🔍 Checking game ownership and stats...`)
    console.log(`👤 Steam ID: ${steamId}`)
    console.log(`🎮 App ID: ${appId}`)
    console.log(``)

    // Get owned games
    const ownedGames = await this.getOwnedGames(steamId)

    if (ownedGames.length === 0) {
      console.log(`❌ Could not access user's game library`)
      console.log(
        `   This usually means the user's profile is private or the Steam ID is invalid`
      )
      return
    }

    // Find the specific game
    const gameInfo = ownedGames.find((game) => game.appid === appId)

    if (!gameInfo) {
      console.log(`❌ User does not own this game`)
      console.log(`   Checked ${ownedGames.length} games in their library`)
      return
    }

    // Display game info
    console.log(`✅ Game found: ${gameInfo.name}`)
    console.log(
      `⏱️  Total playtime: ${formatPlaytime(gameInfo.playtime_forever)}`
    )

    if (gameInfo.playtime_2weeks) {
      console.log(
        `📅 Playtime (last 2 weeks): ${formatPlaytime(
          gameInfo.playtime_2weeks
        )}`
      )
    }

    // Get achievements
    console.log(`\n🏆 Checking achievements...`)
    const achievements = await this.getPlayerAchievements(steamId, appId)
    const gameSchema = await this.getGameSchema(appId)

    if (achievements.length === 0) {
      console.log(`   No achievement data available`)
      return
    }

    const unlockedAchievements = achievements.filter((a) => a.achieved === 1)
    const totalAchievements = achievements.length
    const completionPercentage =
      totalAchievements > 0
        ? ((unlockedAchievements.length / totalAchievements) * 100).toFixed(1)
        : '0'

    console.log(
      `   📊 Achievement Progress: ${unlockedAchievements.length}/${totalAchievements} (${completionPercentage}%)`
    )

    if (unlockedAchievements.length > 0) {
      console.log(`\n🎯 Recent Achievements:`)

      // Sort by unlock time (most recent first) and show top 5
      const recentAchievements = unlockedAchievements
        .sort((a, b) => b.unlocktime - a.unlocktime)
        .slice(0, 5)

      for (const achievement of recentAchievements) {
        const schemaAchievement =
          gameSchema?.availableGameStats?.achievements?.find(
            (a) => a.name === achievement.apiname
          )

        const displayName =
          schemaAchievement?.displayName ||
          achievement.name ||
          achievement.apiname
        const description =
          schemaAchievement?.description ||
          achievement.description ||
          'No description'
        const unlockDate = formatDate(achievement.unlocktime)

        console.log(`   🏅 ${displayName}`)
        console.log(`      ${description}`)
        console.log(`      Unlocked: ${unlockDate}`)
        console.log(``)
      }
    }

    // Summary
    console.log(`📋 Summary:`)
    console.log(`   • Game: ${gameInfo.name}`)
    console.log(`   • Owned: Yes`)
    console.log(`   • Playtime: ${formatPlaytime(gameInfo.playtime_forever)}`)
    console.log(
      `   • Achievements: ${unlockedAchievements.length}/${totalAchievements} (${completionPercentage}%)`
    )

    if (gameInfo.playtime_forever === 0) {
      console.log(`   • Status: Never played`)
    } else if (gameInfo.playtime_forever < 60) {
      console.log(`   • Status: Barely played`)
    } else if (gameInfo.playtime_forever < 600) {
      console.log(`   • Status: Played a bit`)
    } else if (gameInfo.playtime_forever < 3000) {
      console.log(`   • Status: Played regularly`)
    } else {
      console.log(`   • Status: Played extensively`)
    }
  }
}

// Export singleton instance
let steamChecker: SteamGameChecker | null = null

export function getSteamChecker(): SteamGameChecker {
  if (!steamChecker) {
    const apiKey = process.env.STEAM_API_KEY
    if (!apiKey) {
      throw new Error(
        'Steam API key not found. Set STEAM_API_KEY environment variable.'
      )
    }
    steamChecker = new SteamGameChecker(apiKey)
  }
  return steamChecker
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.length !== 2) {
    console.log(`Usage: npm run check-steam-game <steamId> <appId>`)
    console.log(`Example: npm run check-steam-game 76561198054649894 570`)
    console.log(``)
    console.log(
      `You need to set your Steam API key in STEAM_API_KEY environment variable`
    )
    console.log(`Get your API key from: https://steamcommunity.com/dev/apikey`)
    process.exit(1)
  }

  const steamId = args[0]
  const appId = parseInt(args[1])

  if (isNaN(appId)) {
    console.error(`❌ Invalid app ID: ${args[1]}`)
    process.exit(1)
  }

  const apiKey = process.env.STEAM_API_KEY
  if (!apiKey) {
    console.error(`❌ Steam API key not found`)
    console.error(`   Set STEAM_API_KEY environment variable`)
    console.error(
      `   Get your API key from: https://steamcommunity.com/dev/apikey`
    )
    process.exit(1)
  }

  const checker = new SteamGameChecker(apiKey)

  try {
    await checker.checkGame(steamId, appId)
  } catch (error) {
    console.error(`❌ Error checking game:`, error)
    process.exit(1)
  }
}

// Run the script only if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
