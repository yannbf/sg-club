import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

interface UserEntry {
  [key: string]: Array<{ link: string; joined_at: number }>
}

/**
 * Script to clean metadata from user_entries.json file.
 * This removes the migratedToSteamId metadata that was accidentally added during migration.
 */
export async function cleanUserEntriesMetadata(): Promise<void> {
  const userEntriesPath = '../website/public/data/user_entries.json'

  try {
    console.log('🔄 Cleaning metadata from user_entries.json...')

    // Load user entries data
    const userEntriesRaw = readFileSync(userEntriesPath, 'utf-8')
    const userEntriesData = JSON.parse(userEntriesRaw)

    if (typeof userEntriesData !== 'object' || userEntriesData === null) {
      throw new Error('user_entries.json data is not an object')
    }

    // Remove metadata keys that aren't giveaway links
    const cleanedData: UserEntry = {}
    for (const [key, value] of Object.entries(userEntriesData)) {
      if (
        key !== 'migratedToSteamId' &&
        !key.startsWith('_') &&
        Array.isArray(value)
      ) {
        cleanedData[key] = value
      }
    }

    // Save the cleaned file
    writeFileSync(userEntriesPath, JSON.stringify(cleanedData, null, 2))

    console.log(`✅ Cleaned user_entries.json - removed metadata`)
    console.log(`💾 Saved to: ${userEntriesPath}`)
  } catch (error) {
    console.error('❌ Error cleaning user entries metadata:', error)
    process.exit(1)
  }
}

// Run the script if called directly
if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await cleanUserEntriesMetadata()
  }
}
