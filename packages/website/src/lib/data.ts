import { Giveaway, UserGroupData, User } from '@/types'

// For build time - import data directly
let buildTimeGiveaways: Giveaway[] | null = null
let buildTimeUsers: UserGroupData | null = null

// Helper to get base URL for data files
function getBaseUrl() {
  if (process.env.NODE_ENV === 'development') {
    return `http://localhost:${process.env.PORT || 3000}`
  }
  return ''
}

async function loadBuildTimeData() {
  if (typeof window !== 'undefined') {
    // Client-side - use fetch
    return {
      giveaways: await fetchGiveaways(),
      users: await fetchUsers(),
    }
  }

  // Server-side during build - import directly
  if (process.env.NODE_ENV === 'development') {
    // In development, always use fetch to avoid fs module issues
    return {
      giveaways: await fetchGiveaways(),
      users: await fetchUsers(),
    }
  }

  try {
    if (!buildTimeGiveaways || !buildTimeUsers) {
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
    }

    return {
      giveaways: buildTimeGiveaways || [],
      users: buildTimeUsers,
    }
  } catch (error) {
    console.error('Error loading build time data:', error)
    return {
      giveaways: [],
      users: null,
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

export async function getAllGiveaways(): Promise<Giveaway[]> {
  const data = await loadBuildTimeData()
  return data.giveaways
}

export async function getAllUsers(): Promise<UserGroupData | null> {
  const data = await loadBuildTimeData()
  return data.users
}

export async function getUser(username: string): Promise<User | null> {
  const userData = await getAllUsers()
  if (!userData) return null

  return userData.users.find((user) => user.username === username) || null
}

export async function getGiveaway(link: string): Promise<Giveaway | null> {
  const giveaways = await getAllGiveaways()
  return giveaways.find((giveaway) => giveaway.link === link) || null
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000
  const diff = timestamp - now
  const absDiff = Math.abs(diff)

  // Define time units in seconds
  const units = [
    { name: 'year', seconds: 31536000 },
    { name: 'month', seconds: 2592000 },
    { name: 'week', seconds: 604800 },
    { name: 'day', seconds: 86400 },
    { name: 'hour', seconds: 3600 },
    { name: 'minute', seconds: 60 },
    { name: 'second', seconds: 1 },
  ]

  // Find the appropriate unit
  for (const unit of units) {
    if (absDiff >= unit.seconds) {
      const value = Math.floor(absDiff / unit.seconds)
      const unitName = value === 1 ? unit.name : unit.name + 's'

      if (diff > 0) {
        return `${value} ${unitName} remaining`
      } else {
        return `${value} ${unitName} ago`
      }
    }
  }

  // Less than a second
  if (diff > 0) {
    return 'Less than a second remaining'
  } else {
    return 'Just now'
  }
}

export function formatPlaytime(minutes: number): string {
  if (minutes === 0) return '0 minutes'

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  if (hours === 0) {
    return `${remainingMinutes} minutes`
  } else if (remainingMinutes === 0) {
    return `${hours} hours`
  } else {
    return `${hours}h ${remainingMinutes}m`
  }
}

export function getCVBadgeColor(cvStatus: string): string {
  switch (cvStatus) {
    case 'FULL_CV':
      return 'bg-green-100 text-green-800'
    case 'REDUCED_CV':
      return 'bg-yellow-100 text-yellow-800'
    case 'NO_CV':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

export function getCVLabel(cvStatus: string): string {
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
