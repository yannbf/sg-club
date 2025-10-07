import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

interface UserGroupData {
  lastUpdated: number
  users: Record<
    string,
    {
      username: string
      steam_id: string
      [key: string]: any
    }
  >
}

interface UsernameMapping {
  [username: string]: string // username -> steam_id
}

/**
 * Script to create a mapping from username to steam_id for migration purposes.
 * This reads the current group_users.json and creates a mapping file that can be
 * used to migrate other data files from username-based keys to steam_id-based keys.
 */
export async function generateUsernameMapping(): Promise<void> {
  const groupUsersPath = '../website/public/data/group_users.json'
  const mappingPath = '../website/public/data/username_to_steamid_mapping.json'

  try {
    console.log('🔄 Generating username to steam_id mapping...')

    // Read the current group_users.json
    const groupUsersData = readFileSync(groupUsersPath, 'utf-8')
    const parsedData: UserGroupData = JSON.parse(groupUsersData)

    if (!parsedData.users) {
      throw new Error('No users data found in group_users.json')
    }

    // Create mapping from username to steam_id
    const usernameMapping: UsernameMapping = {}

    for (const [username, userData] of Object.entries(parsedData.users)) {
      if (userData.steam_id) {
        usernameMapping[username] = userData.steam_id
      } else {
        console.warn(`⚠️  User ${username} has no steam_id, skipping`)
      }
    }

    // Save the mapping file
    writeFileSync(
      mappingPath,
      JSON.stringify(
        {
          lastUpdated: Date.now(),
          mapping: usernameMapping,
          totalUsers: Object.keys(usernameMapping).length,
        },
        null,
        2
      )
    )

    console.log(
      `✅ Mapping generated successfully with ${
        Object.keys(usernameMapping).length
      } users`
    )
    console.log(`💾 Saved to: ${mappingPath}`)
  } catch (error) {
    console.error('❌ Error generating username mapping:', error)
    process.exit(1)
  }
}

// Run the script if called directly
if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await generateUsernameMapping()
  }
}
