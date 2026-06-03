import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import type {
  SteamGameInfo,
  SteamAchievement,
  SteamGameSchema,
  PlayerAchievements,
  OwnedGamesResponse,
  PlayerAchievementsResponse,
  GameSchemaResponse,
  SteamAppDetailsResponse,
  SteamPackageDetailsResponse,
} from '../types/steam.js'
import type {
  NoStatsReason,
  GameBreakdownEntry,
} from '../types/steamgifts.js'
import {
  formatPlaytime,
  formatDate,
  getRequiredEnvVar,
  normalizeGameName,
} from '../utils/common.js'
import { logError } from '../utils/log-error.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const rootEnvPath = resolve(currentDir, '../../../../.env')

if (existsSync(rootEnvPath)) {
  loadEnv({ path: rootEnvPath })
} else {
  loadEnv()
}

export type { NoStatsReason, GameBreakdownEntry } from '../types/steamgifts.js'

export interface GamePlayData {
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
  // Present only for multi-game packages — per-title stats summed above.
  games_breakdown?: GameBreakdownEntry[]
}

export interface SteamProfileVisibility {
  is_public: boolean
  visibility_state: number
}

const API_KEY = process.env.STEAM_API_KEY
if (!API_KEY) {
  console.error(`❌ Steam API key not found`)
  console.error(`   Set STEAM_API_KEY environment variable`)
  console.error(
    `   Get your API key from: https://steamcommunity.com/dev/apikey`,
  )
  process.exit(1)
}

export class SteamGameChecker {
  private readonly baseUrl = 'https://api.steampowered.com'
  private readonly apiKey: string
  private readonly noStatsCache: Map<
    number,
    { ts: number; reason: NoStatsReason }
  > = new Map()
  private readonly TWO_WEEKS_IN_MS = 14 * 24 * 60 * 60 * 1000

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  private async fetchSteamAPI(endpoint: string): Promise<any> {
    const requestUrl = `${this.baseUrl}${endpoint}`
    try {
      const response = await fetch(requestUrl)

      if (!response.ok) {
        // Parse the body if it's a typed Steam error; some endpoints
        // return JSON like { playerstats: { error: "..." } } on 400.
        let payload: any = null
        try {
          payload = await response.json()
        } catch {
          /* not JSON */
        }

        if (payload?.playerstats?.error) {
          const errorType = String(payload.playerstats.error)
          const err = new Error('Steam API request failed: ' + errorType)

          if (errorType.includes('Requested app has no stats')) {
            err.name = 'NoStatsError'
          } else if (errorType.includes('Profile is not public')) {
            err.name = 'ProfileNotPublicError'
          }
          // Named errors are *expected* states (game has no
          // achievements, profile is private, etc.) — caller maps them
          // to `has_no_available_stats`. Don't log them to stderr;
          // they're not failures.
          throw err
        }

        throw new Error(
          `Steam API request failed: ${response.status} ${response.statusText}`,
        )
      }

      return await response.json()
    } catch (error) {
      // Only surface UNEXPECTED errors to the log. Known stat-less /
      // private-profile responses are routine and would otherwise drown
      // out anything actually wrong.
      const name = error instanceof Error ? error.name : ''
      if (name !== 'NoStatsError' && name !== 'ProfileNotPublicError') {
        // Extract just the appid digits — endpoint.split('appid=')[1]
        // captures everything after it, including the key. Don't leak.
        const appIdMatch = endpoint.match(/appid=(\d+)/)
        const appId = appIdMatch ? appIdMatch[1] : 'unknown'
        const safeUrl = requestUrl.replace(/key=[^&]+/, 'key=***')
        const message =
          error instanceof Error ? error.message : String(error)
        console.error(`❌ Steam API error (appid=${appId}): ${message}`)
        logError(error, `Error fetching Steam API (${appId} - ${safeUrl})`)
      }
      throw error
    }
  }

  private async getOwnedGames(steamId: string): Promise<SteamGameInfo[]> {
    const endpoint = `/IPlayerService/GetOwnedGames/v0001/?key=${this.apiKey}&steamid=${steamId}&format=json&include_appinfo=1&include_played_free_games=0`

    try {
      const data: OwnedGamesResponse = await this.fetchSteamAPI(endpoint)
      return data.response.games || []
    } catch (error) {
      logError(error, `Failed to get owned games for Steam ID ${steamId}`)
      return []
    }
  }

  private async getOwnedGamesCached(
    steamId: string,
  ): Promise<SteamGameInfo[]> {
    const cached = this.ownedGamesCache.get(steamId)
    if (cached) return cached
    const games = await this.getOwnedGames(steamId)
    this.ownedGamesCache.set(steamId, games)
    return games
  }

  /**
   * Fallback identity resolution: match a giveaway title against the names
   * in the user's own Steam library (include_appinfo=1 gives us names). Used
   * when sub→app resolution fails for a delisted/region-locked package — a
   * title match still answers "do they own it?" and recovers playtime.
   */
  private async matchOwnedGameByName(
    steamId: string,
    name: string,
  ): Promise<number | null> {
    const target = normalizeGameName(name)
    if (!target) return null
    const ownedGames = await this.getOwnedGamesCached(steamId)

    // Exact normalized match is the strong signal — prefer it.
    const exact = ownedGames.find((g) => normalizeGameName(g.name) === target)
    if (exact) return exact.appid

    // SteamGifts truncates long giveaway titles (e.g. "Atelier Ryza 2: Lost
    // Legends & the Se..."), so the stored name is a *prefix* of the real one
    // and never equals it exactly. When the title is truncated, fall back to a
    // prefix match — but only accept it when it resolves to a single owned
    // game, so an ambiguous stub can't grab the wrong title.
    const isTruncated = /(\.{3}|…)\s*$/.test(name.trim())
    if (isTruncated && target.length >= 6) {
      const prefixMatches = ownedGames.filter((g) =>
        normalizeGameName(g.name).startsWith(target),
      )
      if (prefixMatches.length === 1) {
        console.log(
          `[INFO] Matched truncated title "${name}" to owned game "${prefixMatches[0].name}" by prefix`,
        )
        return prefixMatches[0].appid
      }
    }

    return null
  }

  /**
   * Resolve a Steam package (sub) to *all* of its game apps, with names. A
   * package can bundle several distinct games (e.g. Kingdom Hearts Integrum =
   * 3 games), and we want to track playtime across every one of them, not just
   * the first. Returns [] when the package can't be resolved at all (delisted).
   */
  public async getGameAppsForSubId(
    subId: number,
  ): Promise<{ appId: number; name: string }[]> {
    const packageDetailsUrl = `https://store.steampowered.com/api/packagedetails/?packageids=${subId}`

    try {
      const packageResponse = await fetch(packageDetailsUrl)
      if (!packageResponse.ok) {
        logError(
          new Error(`HTTP error! status: ${packageResponse.status}`),
          `Failed to fetch package details for subId ${subId}`,
        )
        return []
      }

      const packageData =
        (await packageResponse.json()) as SteamPackageDetailsResponse
      const packageDetails = packageData[subId]

      if (!packageDetails?.success || !packageDetails.data) {
        const errorMessage = `Package details request was not successful or missing data for subId ${packageDetailsUrl}`
        logError(new Error(errorMessage), errorMessage)
        return []
      }

      const apps = packageDetails.data.apps
      const games: { appId: number; name: string }[] = []

      for (const app of apps) {
        const appDetailsUrl = `https://store.steampowered.com/api/appdetails/?appids=${app.id}`
        try {
          // Delay to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 1000))
          const appResponse = await fetch(appDetailsUrl)

          if (!appResponse.ok) {
            logError(
              new Error(`HTTP error! status: ${appResponse.status}`),
              `Failed to fetch app details for appId ${app.id} (from subId ${subId})`,
            )
            continue // Try next app
          }

          const appData = (await appResponse.json()) as SteamAppDetailsResponse
          const appDetails = appData[String(app.id)]

          if (
            appDetails?.success &&
            appDetails.data &&
            appDetails.data.type === 'game'
          ) {
            games.push({
              appId: appDetails.data.steam_appid,
              name: appDetails.data.name ?? app.name ?? `App ${app.id}`,
            })
          }
        } catch (error) {
          logError(
            error,
            `Error processing app details for appId ${app.id} (from subId ${subId})`,
          )
        }
      }

      if (games.length > 0) {
        console.log(
          `[INFO] Resolved subID ${subId} to ${games.length} game app(s): ${games
            .map((g) => g.appId)
            .join(', ')}`,
        )
        return games
      }

      // No member resolved as type:'game' — every appdetails probe failed
      // (delisted / region-locked) or the package is all DLC/soundtracks.
      // The package DOES list apps, so fall back to the first member, which
      // is almost always the base game. Recovers ownership/playtime and a
      // thumbnail instead of treating the whole package as unidentifiable.
      const fallback = apps[0]
      if (fallback) {
        console.log(
          `[INFO] No type:'game' member for subID ${subId}; falling back to first app member ${fallback.id}`,
        )
        return [{ appId: fallback.id, name: fallback.name ?? `App ${fallback.id}` }]
      }
    } catch (error) {
      console.log(error, `Failed to get appId from subId ${subId}`)
      logError(error, `Failed to get appId from subId ${subId}`)
    }

    console.log(`[INFO] No game appID found for subID ${subId}`)
    return []
  }

  /**
   * Back-compat single-app resolver: returns the first game app of a package
   * (used where only one appId is needed, e.g. price/thumbnail lookups).
   */
  public async getAppIdForSubId(subId: number): Promise<number | null> {
    const games = await this.getGameAppsForSubId(subId)
    return games[0]?.appId ?? null
  }

  private async getPlayerAchievements(
    steamId: string,
    appId: number,
  ): Promise<SteamAchievement[] | null> {
    const endpoint = `/ISteamUserStats/GetPlayerAchievements/v0001/?appid=${appId}&key=${this.apiKey}&steamid=${steamId}&format=json`

    try {
      const data: PlayerAchievementsResponse =
        await this.fetchSteamAPI(endpoint)

      if (data.playerstats.success) {
        return data.playerstats.achievements || []
      } else {
        logError(
          data.playerstats,
          `Failed to get player achievements for Steam ID ${steamId}`,
        )
        return []
      }
    } catch (error) {
      logError(
        error,
        `Failed to get player achievements for Steam ID ${steamId}`,
      )
      if (
        error instanceof Error &&
        (error.name === 'NoStatsError' ||
          error.name === 'ProfileNotPublicError' ||
          error.message.includes('Requested app has no stats') ||
          error.message.includes('Profile is not public'))
      ) {
        return null
      }
      return []
    }
  }

  private async getGameSchema(appId: number): Promise<SteamGameSchema | null> {
    const endpoint = `/ISteamUserStats/GetSchemaForGame/v2/?key=${this.apiKey}&appid=${appId}&format=json`

    try {
      const data: GameSchemaResponse = await this.fetchSteamAPI(endpoint)
      return data.game
    } catch (error) {
      logError(error, `Failed to get game schema for appId ${appId}`)
      return null
    }
  }

  public async getPlayerCountryCode(steamID: string): Promise<string | null> {
    const response = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${this.apiKey}&steamids=${steamID}`,
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
    steamId: string,
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
      const errorMessage = `Failed to get player summaries for Steam ID ${steamId}`
      logError(error, errorMessage)
      console.error(errorMessage)
      return { is_public: false, visibility_state: 0 }
    }
  }

  private ownedGamesCache: Map<string, SteamGameInfo[]> = new Map()

  public async getGamePlayData(
    steamId: string,
    appOrSubId: number,
    type: 'app' | 'sub' = 'app',
    name?: string,
  ): Promise<GamePlayData> {
    // Check cache first
    const cached = this.noStatsCache.get(appOrSubId)
    if (cached && Date.now() - cached.ts < this.TWO_WEEKS_IN_MS) {
      console.log(
        `[INFO] Game with appId ${appOrSubId} is in the 'no stats' cache. Skipping.`,
      )
      return this.noStatsResult(cached.reason)
    }

    // Resolve the target to a concrete list of game apps. For an 'app'
    // giveaway that's the single app; for a 'sub' (package) it can be several
    // distinct games (e.g. Kingdom Hearts Integrum bundles three).
    let games: { appId: number; name?: string }[]

    if (type === 'sub') {
      console.log(`[INFO] Resolving subId ${appOrSubId} to its game app(s)`)
      const resolved = await this.getGameAppsForSubId(appOrSubId)

      if (resolved.length > 0) {
        games = resolved
      } else {
        // Sub→app resolution failed (delisted / region-only / partial
        // package). Before giving up, try matching the giveaway title against
        // the user's own Steam library — that directly answers "do they own
        // it?" even when the store no longer lists the package.
        const matchedAppId = name
          ? await this.matchOwnedGameByName(steamId, name)
          : null

        if (matchedAppId) {
          console.log(
            `[INFO] Recovered appId ${matchedAppId} for subId ${appOrSubId} by title match ("${name}")`,
          )
          games = [{ appId: matchedAppId, name }]
        } else {
          // Genuinely unidentifiable. Cache the negative result so future runs
          // skip this sub for the standard 2-week no-stats window.
          console.log(
            `[INFO] No app found for subId ${appOrSubId}; marking as no-stats`,
          )
          this.noStatsCache.set(appOrSubId, {
            ts: Date.now(),
            reason: 'package_delisted',
          })
          return this.noStatsResult('package_delisted')
        }
      }
    } else {
      games = [{ appId: appOrSubId }]
    }

    return this.aggregatePlayData(steamId, games)
  }

  /** Canonical "no stats" result with a machine-readable reason. */
  private noStatsResult(reason: NoStatsReason): GamePlayData {
    return {
      owned: false,
      playtime_minutes: 0,
      playtime_formatted: '0 minutes',
      achievements_unlocked: 0,
      achievements_total: 0,
      achievements_percentage: 0,
      never_played: true,
      is_playtime_private: false,
      has_no_available_stats: true,
      no_stats_reason: reason,
    }
  }

  /**
   * Compute play data across one or more game apps and SUM it into a single
   * result. For a single-game giveaway this is just that game; for a
   * multi-game package the playtime and achievements are summed, the win counts
   * as played if *any* member was played, and a per-title `games_breakdown` is
   * attached so the UI can expand the detail.
   */
  private async aggregatePlayData(
    steamId: string,
    games: { appId: number; name?: string }[],
  ): Promise<GamePlayData> {
    const ownedGames = await this.getOwnedGamesCached(steamId)

    if (ownedGames.length === 0) {
      // Empty library — private profile or genuinely no games.
      return this.noStatsResult('library_unavailable')
    }

    const multi = games.length > 1
    const breakdown: GameBreakdownEntry[] = []
    let totalPlaytime = 0
    let totalUnlocked = 0
    let totalAchievements = 0
    let ownedAny = false
    let anyStats = false
    let anyPlayed = false

    for (const { appId, name } of games) {
      const gameInfo = ownedGames.find((g) => g.appid === appId)
      const owned = Boolean(gameInfo)
      const playtime = gameInfo?.playtime_forever ?? 0

      let entryUnlocked = 0
      let entryTotal = 0

      if (gameInfo) {
        ownedAny = true
        totalPlaytime += playtime

        const achievements = await this.getPlayerAchievements(steamId, appId)
        if (achievements) {
          anyStats = true
          entryUnlocked = achievements.filter((a) => a.achieved === 1).length
          entryTotal = achievements.length
          totalUnlocked += entryUnlocked
          totalAchievements += entryTotal
          // Preserve existing semantics: with achievement stats, "played"
          // means at least one achievement unlocked; without, it's playtime.
          if (entryUnlocked > 0) anyPlayed = true
        } else if (playtime > 0) {
          anyPlayed = true
        }
      }

      breakdown.push({
        app_id: appId,
        name: name ?? gameInfo?.name ?? `App ${appId}`,
        owned,
        playtime_minutes: playtime,
        playtime_formatted: formatPlaytime(playtime),
        achievements_unlocked: entryUnlocked,
        achievements_total: entryTotal,
        achievements_percentage:
          entryTotal > 0
            ? Number(((entryUnlocked / entryTotal) * 100).toFixed(1))
            : 0,
      })
    }

    if (!ownedAny) {
      // Resolved to real app(s), but none are in this user's library.
      return {
        ...this.noStatsResult('not_in_library'),
        ...(multi ? { games_breakdown: breakdown } : {}),
      }
    }

    const percentage =
      totalAchievements > 0
        ? Number(((totalUnlocked / totalAchievements) * 100).toFixed(1))
        : 0

    const result: GamePlayData = {
      owned: true,
      playtime_minutes: totalPlaytime,
      playtime_formatted: formatPlaytime(totalPlaytime),
      achievements_unlocked: totalUnlocked,
      achievements_total: totalAchievements,
      achievements_percentage: percentage,
      never_played: !anyPlayed,
      is_playtime_private: totalPlaytime === 0 && totalUnlocked > 0,
    }

    if (!anyStats) {
      // Owned (playtime is valid) but Steam exposes no achievement stats.
      result.has_no_available_stats = true
      result.no_stats_reason = 'no_steam_stats'
    }

    if (multi) {
      result.games_breakdown = breakdown
    }

    return result
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
        `   This usually means the user's profile is private or the Steam ID is invalid`,
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
      `⏱️  Total playtime: ${formatPlaytime(gameInfo.playtime_forever)}`,
    )

    if (gameInfo.playtime_2weeks) {
      console.log(
        `📅 Playtime (last 2 weeks): ${formatPlaytime(
          gameInfo.playtime_2weeks,
        )}`,
      )
    }

    // Get achievements
    console.log(`\n🏆 Checking achievements...`)
    const achievements = await this.getPlayerAchievements(steamId, appId)
    const gameSchema = await this.getGameSchema(appId)

    if (achievements === null) {
      console.log(`   No achievement data available for this game on Steam`)
      return
    }

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
      `   📊 Achievement Progress: ${unlockedAchievements.length}/${totalAchievements} (${completionPercentage}%)`,
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
            (a) => a.name === achievement.apiname,
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
      `   • Achievements: ${unlockedAchievements.length}/${totalAchievements} (${completionPercentage}%)`,
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

  public async setHasNoAvailableStats(appId: number): Promise<void> {
    this.noStatsCache.set(appId, { ts: Date.now(), reason: 'no_steam_stats' })
    console.log(
      `[INFO] Game with appId ${appId} has been flagged as having no available stats.`,
    )
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.length !== 2) {
    console.log(`Usage: npm run check-steam-game <steamId> <appId>`)
    console.log(`Example: npm run check-steam-game 76561198054649894 570`)
    console.log(``)
    console.log(
      `You need to set your Steam API key in STEAM_API_KEY environment variable`,
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

  const checker = new SteamGameChecker(API_KEY!)

  try {
    await checker.checkGame(steamId, appId)
  } catch (error) {
    console.error(`❌ Error checking game:`, error)
    process.exit(1)
  }
}

export const steamChecker = new SteamGameChecker(API_KEY)

// Run the script only if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
