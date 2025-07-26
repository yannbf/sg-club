/**
 * Delays execution for the specified number of milliseconds
 */
export async function delay(ms: number): Promise<void> {
  if (process.env.VITEST) {
    return
  }
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Formats a timestamp into a human-readable date string
 */
export function formatDate(timestamp: number): string {
  if (timestamp === 0) return 'Never'
  return new Date(timestamp * 1000).toLocaleString()
}

/**
 * Formats playtime in minutes to a human-readable string
 */
export function formatPlaytime(minutes: number): string {
  if (minutes === 0) return '0 minutes'

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  if (hours === 0) {
    return `${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`
  } else if (remainingMinutes === 0) {
    return `${hours} hour${hours === 1 ? '' : 's'}`
  } else {
    return `${hours} hour${hours === 1 ? '' : 's'} ${remainingMinutes} minute${
      remainingMinutes === 1 ? '' : 's'
    }`
  }
}

/**
 * Parses Steam URL to extract app_id or package_id
 */
export function parseSteamUrl(url: string): {
  app_id: number | null
  package_id: number | null
} {
  // Handle Steam app URLs (games)
  const appMatch = url.match(/\/app\/(\d+)/)
  if (appMatch) {
    return { app_id: parseInt(appMatch[1]), package_id: null }
  }

  // Handle Steam sub URLs (packages/bundles)
  const subMatch = url.match(/\/sub\/(\d+)/)
  if (subMatch) {
    return { app_id: null, package_id: parseInt(subMatch[1]) }
  }

  return { app_id: null, package_id: null }
}

/**
 * Generates a consistent numeric ID from a giveaway code
 */
export function generateIdFromCode(code: string): number {
  let hash = 0
  for (let i = 0; i < code.length; i++) {
    const char = code.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash)
}

/**
 * Calculates the time difference in a human-readable format
 */
export function getTimeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - timestamp

  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`
  if (diff < 2592000) return `${Math.floor(diff / 604800)} weeks ago`

  return formatDate(timestamp)
}

/**
 * Validates environment variables and returns them
 */
export function getRequiredEnvVar(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}
