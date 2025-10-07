import { Giveaway, UserGroupData, User, GameData, UserEntry } from '@/types'

// For build time - import data directly
let buildTimeGiveaways: Giveaway[] | null = null
let buildTimeUsers: UserGroupData | null = null
let buildTimeUserEntries: UserEntry | null = null
let buildTimeGameData: GameData[] | null = null

// Helper to get base URL for data files
function getBaseUrl() {
  if (typeof window !== 'undefined') {
    // Client-side - use relative URLs
    return ''
  }
  if (process.env.NODE_ENV === 'development') {
    return `http://localhost:${process.env.PORT || 3000}`
  }
  // Production build - use relative URLs
  return ''
}

// Helper to build data URLs
function buildDataUrl(filename: string): string {
  const baseUrl = getBaseUrl()
  if (baseUrl) {
    return `${baseUrl}/data/${filename}`
  }
  return `data/${filename}` // Remove leading slash for relative URLs
}

// turns { "ga_id1": [{ user: "user1", joined_at: 1716796800 }, { user: "user2", joined_at: 1716796800 }] }
// into { "user1": [{ link: "ga_id1", joined_at: 1716796800 }], "user2": [{ link: "ga_id1", joined_at: 1716796800 }] }
// Note: Now supports both username and steam_id based entries
type InputData = Record<
  string,
  { username?: string; steam_id?: string; joined_at: number }[]
>

function processUserEntries(input: InputData): UserEntry {
  const output: UserEntry = {}

  for (const [link, userEntries] of Object.entries(input)) {
    // Ensure userEntries is an array
    if (!Array.isArray(userEntries)) {
      console.warn(
        `userEntries for link ${link} is not an array:`,
        typeof userEntries,
        userEntries
      )
      continue
    }

    for (const entry of userEntries) {
      // Ensure entry has the expected structure
      if (!entry || typeof entry !== 'object') {
        console.warn(`Invalid entry for link ${link}:`, entry)
        continue
      }

      // Use steam_id if available, otherwise fall back to username
      const userId = entry.steam_id || entry.username

      if (!userId) {
        console.warn(`Entry missing both username and steam_id:`, entry)
        continue
      }

      if (!output[userId]) {
        output[userId] = []
      }

      output[userId].push({ link, joined_at: entry.joined_at })
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
    const response = await fetch(buildDataUrl('giveaways.json'))
    if (!response.ok) throw new Error('Failed to fetch giveaways')
    const data = await response.json()

    // Ensure data is an object and has giveaways array
    if (
      typeof data !== 'object' ||
      data === null ||
      !Array.isArray(data.giveaways)
    ) {
      console.warn('giveaways.json data is not valid:', typeof data, data)
      return []
    }

    return data.giveaways
  } catch (error) {
    console.error('Error reading giveaways data:', error)
    return []
  }
}

async function fetchLastUpdated(): Promise<string | null> {
  try {
    const response = await fetch(buildDataUrl('giveaways.json'))
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
    const response = await fetch(buildDataUrl('group_users.json'))
    if (!response.ok) throw new Error('Failed to fetch users')
    const data = await response.json()

    // Ensure data is an object before returning
    if (typeof data !== 'object' || data === null) {
      console.warn('group_users.json data is not an object:', typeof data, data)
      return null
    }

    return data as UserGroupData
  } catch (error) {
    console.error('Error reading users data:', error)
    return null
  }
}

async function fetchUserEntries(): Promise<UserEntry | null> {
  try {
    const response = await fetch(buildDataUrl('user_entries.json'))
    if (!response.ok) throw new Error('Failed to fetch users')
    const data = await response.json()

    // Ensure data is an object before processing
    if (typeof data !== 'object' || data === null) {
      console.warn(
        'user_entries.json data is not an object:',
        typeof data,
        data
      )
      return null
    }

    return processUserEntries(data as InputData)
  } catch (error) {
    console.error('Error reading users data:', error)
    return null
  }
}

async function fetchGameData(): Promise<GameData[]> {
  try {
    const response = await fetch(buildDataUrl('game_data.json'))
    if (!response.ok) throw new Error('Failed to fetch game data')
    const data = await response.json()

    // Ensure data is an array
    if (!Array.isArray(data)) {
      console.warn('game_data.json data is not an array:', typeof data, data)
      return []
    }

    return data
  } catch (error) {
    console.error('Error reading game data:', error)
    return []
  }
}

export async function getAllGiveaways(): Promise<Giveaway[]> {
  const data = await loadBuildTimeData()
  return data.giveaways
}

export async function getAllUsers(): Promise<UserGroupData | null> {
  const data = await loadBuildTimeData()
  return data.users
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

export async function getUser(identifier: string): Promise<User | null> {
  const userData = await getAllUsers()
  if (!userData) return null

  // Check if identifier is a steam_id (numeric) or username (text)
  const isSteamId = /^\d+$/.test(identifier)

  if (isSteamId) {
    // Direct steam_id lookup
    return userData.users[identifier] || null
  } else {
    // Username lookup - find by username field within user objects
    const matchingUser = Object.values(userData.users).find(
      (user) => user.username?.toLowerCase() === identifier.toLowerCase()
    )
    return matchingUser || null
  }
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
