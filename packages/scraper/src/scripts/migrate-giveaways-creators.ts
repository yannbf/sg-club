import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

interface UsernameMappingData {
  lastUpdated: number
  mapping: Record<string, string> // username -> steam_id
  totalUsers: number
}

interface Giveaway {
  id: string
  name: string
  points: number
  copies: number
  app_id: number | null
  package_id: number | null
  link: string
  created_timestamp: number
  start_timestamp: number
  end_timestamp: number
  region_restricted: boolean
  group: boolean
  comment_count: number
  entry_count: number
  creator: string
  event_type: string
  cv_status: string
  creator_username?: string
  creator_steam_id?: string
}

interface GiveawaysData {
  last_updated: string
  giveaways: Giveaway[]
}

/**
 * Script to migrate giveaways.json to add creator_username and creator_steam_id fields.
 * This uses the existing username mapping to look up steam_ids for giveaway creators.
 */
export async function migrateGiveawaysCreators(): Promise<void> {
  const giveawaysPath = '../website/public/data/giveaways.json'
  const mappingPath = '../website/public/data/username_to_steamid_mapping.json'

  try {
    console.log('🔄 Migrating giveaways.json to add creator fields...')

    // Check if mapping file exists
    if (!existsSync(mappingPath)) {
      console.error(`❌ Mapping file not found at ${mappingPath}`)
      console.error('Run generate-username-mapping.ts first')
      process.exit(1)
    }

    // Load the mapping
    const mappingData = readFileSync(mappingPath, 'utf-8')
    const { mapping }: UsernameMappingData = JSON.parse(mappingData)

    console.log(`📋 Loaded mapping for ${Object.keys(mapping).length} users`)

    // Load giveaways data
    const giveawaysRaw = readFileSync(giveawaysPath, 'utf-8')
    const giveawaysData: GiveawaysData = JSON.parse(giveawaysRaw)

    if (!giveawaysData.giveaways || !Array.isArray(giveawaysData.giveaways)) {
      throw new Error('No giveaways array found in giveaways.json')
    }

    console.log(`📋 Processing ${giveawaysData.giveaways.length} giveaways`)

    // Migrate each giveaway
    let migratedCount = 0
    let missingMappingCount = 0

    for (const giveaway of giveawaysData.giveaways) {
      const creatorUsername = giveaway.creator

      // Skip if already migrated
      if (giveaway.creator_username && giveaway.creator_steam_id) {
        continue
      }

      // Look up steam_id for creator
      const creatorSteamId = mapping[creatorUsername]

      if (creatorSteamId) {
        // Replace creator field with creator_username and add creator_steam_id
        delete giveaway.creator
        giveaway.creator_username = creatorUsername
        giveaway.creator_steam_id = creatorSteamId
        migratedCount++
      } else {
        console.warn(
          `⚠️  No steam_id found for creator ${creatorUsername} in giveaway ${giveaway.id}`
        )
        // Still replace creator field even if no steam_id mapping found
        delete giveaway.creator
        giveaway.creator_username = creatorUsername
        missingMappingCount++
      }
    }

    // Update the last_updated timestamp
    giveawaysData.last_updated = new Date().toISOString()

    // Add migration metadata
    ;(giveawaysData as any).migratedCreators = {
      migratedAt: Date.now(),
      totalGiveaways: giveawaysData.giveaways.length,
      migratedGiveaways: migratedCount,
      missingMapping: missingMappingCount,
    }

    // Save the updated file
    writeFileSync(giveawaysPath, JSON.stringify(giveawaysData, null, 2))

    console.log(`✅ Migration completed:`)
    console.log(`   • ${migratedCount} giveaways updated with creator fields`)
    console.log(
      `   • ${missingMappingCount} giveaways have creators not in mapping`
    )
    console.log(`💾 Saved to: ${giveawaysPath}`)
  } catch (error) {
    console.error('❌ Error during giveaways migration:', error)
    process.exit(1)
  }
}

// Run the script if called directly
if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await migrateGiveawaysCreators()
  }
}
