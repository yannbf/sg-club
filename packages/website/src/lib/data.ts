import { Giveaway, UserGroupData, User, GameData, UserEntry, SteamIdMap, WishlistData, ChallengeData, GameInsightsData } from '@/types'
import type { SpringCleaningSnapshot } from '@/lib/spring-cleaning'

// For build time - import data directly
let buildTimeGiveaways: Giveaway[] | null = null
let buildTimeUsers: UserGroupData | null = null
let buildTimeUserEntries: UserEntry | null = null
let buildTimeGameData: GameData[] | null = null
let buildTimeSteamIdMap: SteamIdMap | null = null
let buildTimeExMembers: UserGroupData | null = null
let buildTimeDiscordData: DiscordData | null = null

// Helper to get base URL for data files
function getBaseUrl() {
  if (process.env.NODE_ENV === 'development') {
    return `http://localhost:${process.env.PORT || 3000}`
  }
  return ''
}

// turns { "ga_link": [{ steam_id: "765...", joined_at: 1716796800 }] }
// into { "765...": [{ link: "ga_link", joined_at: 1716796800 }] } (pivoted by steam_id)
type InputData = Record<string, { steam_id: string; joined_at: number }[]>

function processUserEntries(input: InputData): UserEntry {
  const output: UserEntry = {}

  for (const [link, userEntries] of Object.entries(input)) {
    for (const entry of userEntries) {
      const { steam_id, joined_at } = entry

      if (!output[steam_id]) {
        output[steam_id] = []
      }

      output[steam_id].push({ link, joined_at })
    }
  }

  return output
}

async function loadBuildTimeData() {
  if (typeof window !== 'undefined') {
    // Client-side - use fetch
    return {
      giveaways: await fetchGiveaways(),
      users: await fetchUsers(),
      userEntries: await fetchUserEntries(),
      gameData: await fetchGameData(),
    }
  }

  // Server-side during build - import directly
  if (process.env.NODE_ENV === 'development') {
    // In development, always use fetch to avoid fs module issues
    return {
      giveaways: await fetchGiveaways(),
      users: await fetchUsers(),
      userEntries: await fetchUserEntries(),
      gameData: await fetchGameData(),
    }
  }

  try {
    if (
      !buildTimeGiveaways ||
      !buildTimeUsers ||
      !buildTimeGameData ||
      !buildTimeUserEntries
    ) {
      // Only import fs and path when we're definitely on the server
      const { readFileSync } = await import('fs')
      const { join } = await import('path')

      if (!buildTimeGiveaways) {
        const giveawaysPath = join(
          process.cwd(),
          'public',
          'data',
          'giveaways.json'
        )
        const giveawaysData = readFileSync(giveawaysPath, 'utf8')
        const parsed = JSON.parse(giveawaysData)
        buildTimeGiveaways = parsed.giveaways || []
      }

      if (!buildTimeUsers) {
        const usersPath = join(
          process.cwd(),
          'public',
          'data',
          'group_users.json'
        )
        const usersData = readFileSync(usersPath, 'utf8')
        buildTimeUsers = JSON.parse(usersData)
      }

      if (!buildTimeGameData) {
        const gameDataPath = join(
          process.cwd(),
          'public',
          'data',
          'game_data.json'
        )
        const gameData = readFileSync(gameDataPath, 'utf8')
        buildTimeGameData = JSON.parse(gameData)
      }

      if (!buildTimeUserEntries) {
        const usersPath = join(
          process.cwd(),
          'public',
          'data',
          'user_entries.json'
        )
        const entriesData = readFileSync(usersPath, 'utf8')
        buildTimeUserEntries = processUserEntries(JSON.parse(entriesData))
      }
    }

    return {
      giveaways: buildTimeGiveaways || [],
      users: buildTimeUsers,
      userEntries: buildTimeUserEntries,
      gameData: buildTimeGameData || [],
    }
  } catch (error) {
    console.error('Error loading build time data:', error)
    return {
      giveaways: [],
      users: null,
      userEntries: null,
      gameData: [],
    }
  }
}

// Client-side fetch functions
async function fetchGiveaways(): Promise<Giveaway[]> {
  try {
    const baseUrl = getBaseUrl()
    const response = await fetch(`${baseUrl}/data/giveaways.json`)
    if (!response.ok) throw new Error('Failed to fetch giveaways')
    const data = await response.json()
    return data.giveaways || []
  } catch (error) {
    console.error('Error reading giveaways data:', error)
    return []
  }
}

async function fetchLastUpdated(): Promise<string | null> {
  try {
    const baseUrl = getBaseUrl()
    const response = await fetch(`${baseUrl}/data/giveaways.json`)
    if (!response.ok) throw new Error('Failed to fetch giveaways')
    const data = await response.json()
    return data.last_updated || null
  } catch (error) {
    console.error('Error reading giveaways data:', error)
    return null
  }
}

async function fetchUsers(): Promise<UserGroupData | null> {
  try {
    const baseUrl = getBaseUrl()
    const response = await fetch(`${baseUrl}/data/group_users.json`)
    if (!response.ok) throw new Error('Failed to fetch users')
    return await response.json()
  } catch (error) {
    console.error('Error reading users data:', error)
    return null
  }
}

async function fetchUserEntries(): Promise<UserEntry | null> {
  try {
    const baseUrl = getBaseUrl()
    const response = await fetch(`${baseUrl}/data/user_entries.json`)
    if (!response.ok) throw new Error('Failed to fetch users')
    const data = await response.json()
    return processUserEntries(data)
  } catch (error) {
    console.error('Error reading users data:', error)
    return null
  }
}

async function fetchGameData(): Promise<GameData[]> {
  try {
    const baseUrl = getBaseUrl()
    const response = await fetch(`${baseUrl}/data/game_data.json`)
    if (!response.ok) throw new Error('Failed to fetch game data')
    return await response.json()
  } catch (error) {
    console.error('Error reading game data:', error)
    return []
  }
}

async function fetchExMembers(): Promise<UserGroupData | null> {
  try {
    const baseUrl = getBaseUrl()
    const response = await fetch(`${baseUrl}/data/ex_members.json`)
    if (!response.ok) throw new Error('Failed to fetch ex members')
    return await response.json()
  } catch (error) {
    console.error('Error reading ex members data:', error)
    return null
  }
}

async function fetchSteamIdMap(): Promise<SteamIdMap> {
  try {
    const baseUrl = getBaseUrl()
    const response = await fetch(`${baseUrl}/data/steam_id_map.json`)
    if (!response.ok) throw new Error('Failed to fetch steam ID map')
    return await response.json()
  } catch (error) {
    console.error('Error reading steam ID map:', error)
    return {}
  }
}

/** Returns a map of steam_id → username history entry */
export async function getSteamIdMap(): Promise<SteamIdMap> {
  if (typeof window !== 'undefined' || process.env.NODE_ENV === 'development') {
    return await fetchSteamIdMap()
  }

  try {
    if (!buildTimeSteamIdMap) {
      const { readFileSync } = await import('fs')
      const { join } = await import('path')
      const mapPath = join(process.cwd(), 'public', 'data', 'steam_id_map.json')
      buildTimeSteamIdMap = JSON.parse(readFileSync(mapPath, 'utf8'))
    }
    return buildTimeSteamIdMap || {}
  } catch (error) {
    console.error('Error loading steam ID map:', error)
    return {}
  }
}

interface DiscordData {
  /** SteamGifts username → whether they are in the Discord server. */
  members: Record<string, boolean>
  /** SteamGifts username → Discord username (stable handle, not server name). */
  handles: Record<string, string>
}

async function fetchDiscordData(): Promise<DiscordData> {
  try {
    const baseUrl = getBaseUrl()
    const response = await fetch(`${baseUrl}/data/discord_members.json`)
    if (!response.ok) throw new Error('Failed to fetch discord members')
    const data = await response.json()
    return { members: data.members || {}, handles: data.handles || {} }
  } catch (error) {
    console.error('Error reading discord members data:', error)
    return { members: {}, handles: {} }
  }
}

/** Returns the Discord membership + handle maps, keyed by SteamGifts username. */
export async function getDiscordData(): Promise<DiscordData> {
  if (typeof window !== 'undefined' || process.env.NODE_ENV === 'development') {
    return await fetchDiscordData()
  }

  try {
    if (!buildTimeDiscordData) {
      const { readFileSync } = await import('fs')
      const { join } = await import('path')
      const filePath = join(
        process.cwd(),
        'public',
        'data',
        'discord_members.json'
      )
      const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
      buildTimeDiscordData = {
        members: parsed.members || {},
        handles: parsed.handles || {},
      }
    }
    return buildTimeDiscordData
  } catch (error) {
    console.error('Error loading discord members:', error)
    return { members: {}, handles: {} }
  }
}

/** Returns a map of SteamGifts username → whether they are in the Discord server. */
export async function getDiscordMembers(): Promise<Record<string, boolean>> {
  return (await getDiscordData()).members
}

/**
 * Returns a copy of `data` with each user's `discord_member` and
 * `discord_handle` set from the (case-insensitive) username-keyed maps. Users
 * absent from the maps keep both undefined ("not yet classified").
 */
function annotateDiscordMembership(
  data: UserGroupData,
  discord: DiscordData
): UserGroupData {
  const memberLookup = new Map(
    Object.entries(discord.members).map(([name, value]) => [
      name.toLowerCase(),
      value,
    ])
  )
  const handleLookup = new Map(
    Object.entries(discord.handles).map(([name, value]) => [
      name.toLowerCase(),
      value,
    ])
  )
  const users = Object.fromEntries(
    Object.entries(data.users).map(([steamId, user]) => [
      steamId,
      {
        ...user,
        discord_member: memberLookup.get(user.username.toLowerCase()),
        discord_handle: handleLookup.get(user.username.toLowerCase()),
      },
    ])
  )
  return { ...data, users }
}

export async function getAllGiveaways(): Promise<Giveaway[]> {
  const data = await loadBuildTimeData()
  return data.giveaways
}

export async function getAllUsers(): Promise<UserGroupData | null> {
  // TODO: Undo this later
  const disallowList = ['CupcakeDollykins']
  const data = await loadBuildTimeData()
  if (!data.users || !data.users.users) return data.users

  // Create a shallow copy to not mutate original data (keys are steam_ids)
  const filteredUsers = Object.fromEntries(
    Object.entries(data.users.users).filter(
      ([, user]) => !disallowList.includes(user.username)
    )
  )

  const discord = await getDiscordData()
  return annotateDiscordMembership(
    {
      ...data.users,
      users: filteredUsers,
    },
    discord
  )
}

export async function getExMembers(): Promise<UserGroupData | null> {
  let exMembers: UserGroupData | null

  if (typeof window !== 'undefined' || process.env.NODE_ENV === 'development') {
    exMembers = await fetchExMembers()
  } else {
    if (!buildTimeExMembers) {
      try {
        const { readFileSync } = await import('fs')
        const { join } = await import('path')
        const filePath = join(process.cwd(), 'public', 'data', 'ex_members.json')
        buildTimeExMembers = JSON.parse(readFileSync(filePath, 'utf8'))
      } catch (error) {
        console.error('Error loading ex members:', error)
        return null
      }
    }
    exMembers = buildTimeExMembers
  }

  if (!exMembers) return null

  const discord = await getDiscordData()
  return annotateDiscordMembership(exMembers, discord)
}

export async function getAllUsersAsArray(): Promise<User[]> {
  const data = await loadBuildTimeData()
  if (!data.users) {
    return []
  }
  return Object.values(data.users.users)
}

export async function getGameData(): Promise<GameData[]> {
  const data = await loadBuildTimeData()
  return data.gameData
}

export async function getUser(username: string): Promise<{ user: User; isExMember: boolean } | null> {
  const lowerUsername = username.toLowerCase()

  // Search active members first
  const userData = await getAllUsers()
  if (userData) {
    const matchingUser = Object.values(userData.users).find(
      (user) => user.username.toLowerCase() === lowerUsername
    )
    if (matchingUser) return { user: matchingUser, isExMember: false }
  }

  // Then search ex-members
  const exData = await getExMembers()
  if (exData) {
    const matchingExMember = Object.values(exData.users).find(
      (user) => user.username.toLowerCase() === lowerUsername
    )
    if (matchingExMember) return { user: matchingExMember, isExMember: true }
  }

  // Finally, check if this is a previous username via steam_id_map
  const steamIdMap = await getSteamIdMap()
  for (const [steamId, entry] of Object.entries(steamIdMap)) {
    const isPreviousName = entry.previous.some(
      (p) => p.username.toLowerCase() === lowerUsername
    )
    if (isPreviousName) {
      // Find the user by steam_id in active or ex-members
      if (userData) {
        const user = userData.users[steamId]
        if (user) return { user, isExMember: false }
      }
      if (exData) {
        const user = exData.users[steamId]
        if (user) return { user, isExMember: true }
      }
    }
  }

  return null
}

export async function getUserEntries(): Promise<UserEntry | null> {
  const data = await loadBuildTimeData()
  return data.userEntries || null
}

export async function getGiveaway(link: string): Promise<Giveaway | null> {
  const giveaways = await getAllGiveaways()
  return giveaways.find((giveaway) => giveaway.link === link) || null
}

export function formatPlaytime(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} minutes`
  }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (remainingMinutes === 0) {
    return `${hours} hours`
  }
  return `${hours}h ${remainingMinutes}m`
}

export function getCVBadgeColor(
  cvStatus: string,
  hasDecreasedRatio?: boolean
): string {
  if (hasDecreasedRatio) {
    return 'bg-accent-purple/20 text-accent-purple'
  }
  switch (cvStatus) {
    case 'FULL_CV':
      return 'bg-accent-green/20 text-accent-green'
    case 'REDUCED_CV':
      return 'bg-accent-yellow/20 text-accent-yellow'
    case 'NO_CV':
      return 'bg-accent-red/20 text-accent-red'
    default:
      return 'bg-muted/20 text-muted-foreground'
  }
}

export function getCVLabel(
  cvStatus: string,
  hasDecreasedRatio?: boolean
): string {
  if (hasDecreasedRatio) {
    return 'Decreased Ratio'
  }
  switch (cvStatus) {
    case 'FULL_CV':
      return 'Full CV'
    case 'REDUCED_CV':
      return 'Reduced CV'
    case 'NO_CV':
      return 'No CV'
    default:
      return 'Unknown'
  }
}

export async function getWishlist(): Promise<WishlistData | null> {
  if (typeof window !== 'undefined' || process.env.NODE_ENV === 'development') {
    try {
      const baseUrl = getBaseUrl()
      const response = await fetch(`${baseUrl}/data/wishlist.json`)
      if (!response.ok) throw new Error('Failed to fetch wishlist')
      return await response.json()
    } catch (error) {
      console.error('Error reading wishlist data:', error)
      return null
    }
  }

  try {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const filePath = join(process.cwd(), 'public', 'data', 'wishlist.json')
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (error) {
    console.error('Error loading wishlist:', error)
    return null
  }
}

/**
 * Loads per-game Steam review/price/ownership rollups for the wishlist "game
 * insights" popover, from public/data/game_insights.json. Written by a
 * sibling scraper pipeline; returns null if the file doesn't exist yet or
 * fails to parse, so callers can hide the feature gracefully.
 */
export async function getGameInsights(): Promise<GameInsightsData | null> {
  if (typeof window !== 'undefined' || process.env.NODE_ENV === 'development') {
    try {
      const baseUrl = getBaseUrl()
      const response = await fetch(`${baseUrl}/data/game_insights.json`)
      if (!response.ok) return null
      return await response.json()
    } catch {
      return null
    }
  }

  try {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const filePath = join(process.cwd(), 'public', 'data', 'game_insights.json')
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Loads a frozen spring-cleaning edition snapshot (or null if not yet frozen).
 * Snapshots live in public/data/spring-cleaning/<slug>.json and are written by
 * `pnpm freeze-spring-cleaning`.
 */
export async function getSpringCleaningSnapshot(
  slug: string
): Promise<SpringCleaningSnapshot | null> {
  if (typeof window !== 'undefined' || process.env.NODE_ENV === 'development') {
    try {
      const baseUrl = getBaseUrl()
      const response = await fetch(`${baseUrl}/data/spring-cleaning/${slug}.json`)
      if (!response.ok) return null
      return await response.json()
    } catch {
      return null
    }
  }

  try {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const filePath = join(
      process.cwd(),
      'public',
      'data',
      'spring-cleaning',
      `${slug}.json`
    )
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Loads a gaming-challenge data file (e.g. the Backpack Hero leaderboard) from
 * public/data/challenge_<slug>.json. Returns null if it hasn't been generated.
 * Slug here is the short data-file slug (e.g. "backpack-hero"), not the event
 * URL slug. Generated by `pnpm --filter scraper challenge`.
 */
export async function getChallengeData(
  slug: string
): Promise<ChallengeData | null> {
  const fileName = `challenge_${slug.replace(/-/g, '_')}.json`

  if (typeof window !== 'undefined' || process.env.NODE_ENV === 'development') {
    try {
      const baseUrl = getBaseUrl()
      const response = await fetch(`${baseUrl}/data/${fileName}`)
      if (!response.ok) return null
      return await response.json()
    } catch {
      return null
    }
  }

  try {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const filePath = join(process.cwd(), 'public', 'data', fileName)
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

export async function getLastUpdated(): Promise<string | null> {
  if (typeof window !== 'undefined' || process.env.NODE_ENV === 'development') {
    // Client-side or development - use fetch
    return await fetchLastUpdated()
  }

  // Server-side during build - read directly from file
  try {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const giveawaysPath = join(
      process.cwd(),
      'public',
      'data',
      'giveaways.json'
    )
    const giveawaysData = readFileSync(giveawaysPath, 'utf8')
    const parsed = JSON.parse(giveawaysData)
    return parsed.last_updated || null
  } catch (error) {
    console.error('Error reading giveaways last updated:', error)
    return null
  }
}

export function formatLastUpdated(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()

  // Format: dd/mm/yyyy, hh:mm
  const formatted =
    date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }) +
    ', ' +
    date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })

  // Calculate time difference
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  let relativeTime = ''
  if (diffDays > 0) {
    relativeTime = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
  } else if (diffHours > 0) {
    relativeTime = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
  } else if (diffMinutes > 0) {
    relativeTime = `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`
  } else {
    relativeTime = 'just now'
  }

  return `${formatted} (${relativeTime})`
}
