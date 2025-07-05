import { Giveaway, UserGroupData, User } from '@/types'

// For build time - import data directly
let buildTimeGiveaways: Giveaway[] | null = null
let buildTimeUsers: UserGroupData | null = null

async function loadBuildTimeData() {
  if (typeof window !== 'undefined') {
    // Client-side - use fetch
    return {
      giveaways: await fetchGiveaways(),
      users: await fetchUsers(),
    }
  }

  // Server-side during build - import directly
  try {
    if (!buildTimeGiveaways) {
      const fs = await import('fs')
      const path = await import('path')
      const giveawaysPath = path.join(
        process.cwd(),
        '..',
        'data',
        'all_giveaways_html.json'
      )
      const giveawaysData = fs.readFileSync(giveawaysPath, 'utf8')
      buildTimeGiveaways = JSON.parse(giveawaysData)
    }

    if (!buildTimeUsers) {
      const fs = await import('fs')
      const path = await import('path')
      const usersPath = path.join(
        process.cwd(),
        '..',
        'data',
        'group_users.json'
      )
      const usersData = fs.readFileSync(usersPath, 'utf8')
      buildTimeUsers = JSON.parse(usersData)
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
    const response = await fetch('/data/all_giveaways_html.json')
    if (!response.ok) throw new Error('Failed to fetch giveaways')
    return await response.json()
  } catch (error) {
    console.error('Error reading giveaways data:', error)
    return []
  }
}

async function fetchUsers(): Promise<UserGroupData | null> {
  try {
    const response = await fetch('/data/group_users.json')
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
