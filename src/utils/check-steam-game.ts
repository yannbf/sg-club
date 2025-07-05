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
import { formatPlaytime, formatDate, getRequiredEnvVar } from './common.js'

export {} // Make this file a module

class SteamGameChecker {
  private readonly baseUrl = 'https://api.steampowered.com'
  private readonly apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  private async fetchSteamAPI(endpoint: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`)

      if (!response.ok) {
        throw new Error(
          `Steam API request failed: ${response.status} ${response.statusText}`
        )
      }

      return await response.json()
    } catch (error) {
      console.error(`❌ Error fetching Steam API: ${error}`)
      throw error
    }
  }

  private async getOwnedGames(steamId: string): Promise<SteamGameInfo[]> {
    const endpoint = `/IPlayerService/GetOwnedGames/v0001/?key=${this.apiKey}&steamid=${steamId}&format=json&include_appinfo=1&include_played_free_games=1`

    try {
      const data: OwnedGamesResponse = await this.fetchSteamAPI(endpoint)
      return data.response.games || []
    } catch (error) {
      console.error(`❌ Failed to get owned games for Steam ID ${steamId}`)
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
        console.log(
          `⚠️  Achievement data not available (profile private or no achievements)`
        )
        return []
      }
    } catch (error) {
      console.log(`⚠️  Could not fetch achievements: ${error}`)
      return []
    }
  }

  private async getGameSchema(appId: number): Promise<SteamGameSchema | null> {
    const endpoint = `/ISteamUserStats/GetSchemaForGame/v2/?key=${this.apiKey}&appid=${appId}&format=json`

    try {
      const data: GameSchemaResponse = await this.fetchSteamAPI(endpoint)
      return data.game
    } catch (error) {
      console.log(`⚠️  Could not fetch game schema: ${error}`)
      return null
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

// Run the script
await main()
