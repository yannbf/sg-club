import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { backupData } from './backup-data.js'
import type { SteamIdMap } from '../types/steamgifts.js'

const DATA_DIR = '../website/public/data'
const INVESTIGATION_DIR = '../website/investigation'

type UsernameToSteamIdMap = Map<string, string>

function buildUsernameToSteamIdMap(): UsernameToSteamIdMap {
  const map: UsernameToSteamIdMap = new Map()

  // Load group_users.json
  const usersData = JSON.parse(readFileSync(`${DATA_DIR}/group_users.json`, 'utf-8'))
  for (const user of Object.values(usersData.users) as any[]) {
    const steamId = user.steam_id || `username:${user.username}`
    map.set(user.username, steamId)
  }

  // Load ex_members.json
  if (existsSync(`${DATA_DIR}/ex_members.json`)) {
    const exData = JSON.parse(readFileSync(`${DATA_DIR}/ex_members.json`, 'utf-8'))
    for (const user of exData.users as any[]) {
      if (!map.has(user.username)) {
        const steamId = user.steam_id || `username:${user.username}`
        map.set(user.username, steamId)
      }
    }
  }

  return map
}

function resolveSteamId(username: string, map: UsernameToSteamIdMap): string {
  return map.get(username) || username
}

function migrateGroupUsers(): { userCount: number; syntheticCount: number } {
  console.log('\n📋 Migrating group_users.json...')
  const filePath = `${DATA_DIR}/group_users.json`
  const data = JSON.parse(readFileSync(filePath, 'utf-8'))

  const newUsers: Record<string, any> = {}
  let syntheticCount = 0
  const seenSteamIds = new Set<string>()

  for (const user of Object.values(data.users) as any[]) {
    let key: string
    if (user.steam_id) {
      key = user.steam_id
    } else {
      key = `username:${user.username}`
      user.steam_id = key
      syntheticCount++
    }

    if (seenSteamIds.has(key)) {
      console.warn(`  ⚠️  Duplicate steam_id: ${key} (user: ${user.username})`)
      key = `${key}_${user.username}`
      user.steam_id = key
    }
    seenSteamIds.add(key)
    newUsers[key] = user
  }

  writeFileSync(filePath, JSON.stringify({ ...data, users: newUsers }, null, 2))
  console.log(`  ✅ ${Object.keys(newUsers).length} users migrated (${syntheticCount} synthetic keys)`)
  return { userCount: Object.keys(newUsers).length, syntheticCount }
}

function migrateExMembers(): void {
  console.log('\n📋 Migrating ex_members.json...')
  const filePath = `${DATA_DIR}/ex_members.json`
  if (!existsSync(filePath)) {
    console.log('  ⚠️  File not found, skipping')
    return
  }

  const data = JSON.parse(readFileSync(filePath, 'utf-8'))
  let syntheticCount = 0

  // Convert from array to Record<steam_id, User>
  const usersArray = Array.isArray(data.users) ? data.users : Object.values(data.users)
  const usersRecord: Record<string, any> = {}

  for (const user of usersArray as any[]) {
    if (!user.steam_id) {
      user.steam_id = `username:${user.username}`
      syntheticCount++
    }
    usersRecord[user.steam_id] = user
  }

  writeFileSync(filePath, JSON.stringify({ ...data, users: usersRecord }, null, 2))
  console.log(`  ✅ ${Object.keys(usersRecord).length} ex-members processed (${syntheticCount} synthetic keys)`)
}

function migrateGiveaways(map: UsernameToSteamIdMap): { unresolvedCreators: string[]; unresolvedWinners: string[] } {
  console.log('\n📋 Migrating giveaways.json...')
  const filePath = `${DATA_DIR}/giveaways.json`
  const data = JSON.parse(readFileSync(filePath, 'utf-8'))

  const unresolvedCreators: string[] = []
  const unresolvedWinners: string[] = []

  for (const giveaway of data.giveaways) {
    // Store original username for display
    giveaway.creator_username = giveaway.creator
    const creatorSteamId = map.get(giveaway.creator)
    if (creatorSteamId) {
      giveaway.creator = creatorSteamId
    } else {
      unresolvedCreators.push(giveaway.creator)
      // Keep original username as creator if not resolvable
    }

    if (giveaway.winners) {
      for (const winner of giveaway.winners) {
        if (winner.name) {
          winner.winner_username = winner.name
          const winnerSteamId = map.get(winner.name)
          if (winnerSteamId) {
            winner.name = winnerSteamId
          } else {
            unresolvedWinners.push(winner.name)
            // Keep original username if not resolvable
          }
        }
      }
    }
  }

  writeFileSync(filePath, JSON.stringify(data, null, 2))
  const uniqueUnresolvedCreators = [...new Set(unresolvedCreators)]
  const uniqueUnresolvedWinners = [...new Set(unresolvedWinners)]
  console.log(`  ✅ ${data.giveaways.length} giveaways migrated`)
  if (uniqueUnresolvedCreators.length > 0) {
    console.log(`  ⚠️  ${uniqueUnresolvedCreators.length} unresolved creators: ${uniqueUnresolvedCreators.join(', ')}`)
  }
  if (uniqueUnresolvedWinners.length > 0) {
    console.log(`  ⚠️  ${uniqueUnresolvedWinners.length} unresolved winners: ${uniqueUnresolvedWinners.join(', ')}`)
  }
  return { unresolvedCreators: uniqueUnresolvedCreators, unresolvedWinners: uniqueUnresolvedWinners }
}

function migrateUserEntries(map: UsernameToSteamIdMap): void {
  console.log('\n📋 Migrating user_entries.json...')
  const filePath = `${DATA_DIR}/user_entries.json`
  const data = JSON.parse(readFileSync(filePath, 'utf-8'))

  const newData: Record<string, { steam_id: string; joined_at: string }[]> = {}
  for (const [gaLink, entries] of Object.entries(data) as [string, any[]][]) {
    newData[gaLink] = entries.map((entry: any) => ({
      steam_id: resolveSteamId(entry.username, map),
      joined_at: entry.joined_at,
    }))
  }

  writeFileSync(filePath, JSON.stringify(newData, null, 2))
  console.log(`  ✅ User entries migrated`)
}

function migrateGiveawayLeavers(map: UsernameToSteamIdMap): void {
  console.log('\n📋 Migrating giveaway_leavers.json...')
  const filePath = `${INVESTIGATION_DIR}/giveaway_leavers.json`
  if (!existsSync(filePath)) {
    console.log('  ⚠️  File not found, skipping')
    return
  }

  const data = JSON.parse(readFileSync(filePath, 'utf-8'))
  const newData: Record<string, any[]> = {}

  for (const [username, entries] of Object.entries(data) as [string, any[]][]) {
    const steamId = resolveSteamId(username, map)
    newData[steamId] = entries
  }

  writeFileSync(filePath, JSON.stringify(newData, null, 2))
  console.log(`  ✅ ${Object.keys(newData).length} leaver entries migrated`)
}

export function migrate(): void {
  console.log('🚀 Starting migration to steam_id...\n')

  // Step 1: Backup
  console.log('Step 1: Creating backup...')
  backupData()

  // Step 2: Build lookup map from pre-migration data
  console.log('\nStep 2: Building username → steam_id map...')
  const map = buildUsernameToSteamIdMap()
  console.log(`  📊 ${map.size} username mappings built`)

  const usersWithSteamId = [...map.values()].filter(v => !v.startsWith('username:')).length
  const usersWithSynthetic = map.size - usersWithSteamId
  console.log(`  ✅ ${usersWithSteamId} users with real steam_id`)
  console.log(`  ⚠️  ${usersWithSynthetic} users with synthetic key`)

  // Step 3: Migrate each data file
  console.log('\nStep 3: Migrating data files...')
  migrateGroupUsers()
  migrateExMembers()
  migrateGiveaways(map)
  migrateUserEntries(map)
  migrateGiveawayLeavers(map)

  // Step 4: Generate steam_id → username history lookup map
  console.log('\nStep 4: Generating steam_id_map.json...')

  // Build a map of steam_id → current username from group_users (post-migration)
  const currentUsersData = JSON.parse(readFileSync(`${DATA_DIR}/group_users.json`, 'utf-8'))
  const currentUsernamesBySteamId = new Map<string, string>()
  for (const user of Object.values(currentUsersData.users) as any[]) {
    currentUsernamesBySteamId.set(user.steam_id, user.username)
  }
  // Also include ex-members
  if (existsSync(`${DATA_DIR}/ex_members.json`)) {
    const exData = JSON.parse(readFileSync(`${DATA_DIR}/ex_members.json`, 'utf-8'))
    const exUsers = Array.isArray(exData.users) ? exData.users : Object.values(exData.users)
    for (const user of exUsers as any[]) {
      if (!currentUsernamesBySteamId.has(user.steam_id)) {
        currentUsernamesBySteamId.set(user.steam_id, user.username)
      }
    }
  }

  const steamIdMap: SteamIdMap = {}
  for (const [steamId, currentUsername] of currentUsernamesBySteamId) {
    steamIdMap[steamId] = { current: currentUsername, previous: [] }
  }

  // Collect ALL usernames ever seen in giveaway data (post-migration has creator_username/winner_username)
  const migratedGiveaways = JSON.parse(readFileSync(`${DATA_DIR}/giveaways.json`, 'utf-8'))
  const allSeenUsernames = new Set<string>()
  for (const ga of migratedGiveaways.giveaways || []) {
    if (ga.creator_username) allSeenUsernames.add(ga.creator_username)
    for (const w of ga.winners || []) {
      if (w.winner_username) allSeenUsernames.add(w.winner_username)
    }
  }

  // Cross-reference: if an old username resolves to a steam_id but differs from current username
  let nameChangesDetected = 0
  for (const oldUsername of allSeenUsernames) {
    const steamId = map.get(oldUsername)
    if (!steamId) continue
    const entry = steamIdMap[steamId]
    if (!entry) continue
    if (entry.current !== oldUsername && !entry.previous.some(p => p.username === oldUsername)) {
      entry.previous.push({ username: oldUsername, changed_at: new Date().toISOString() })
      nameChangesDetected++
      console.log(`  🔄 Name change detected: "${oldUsername}" → "${entry.current}" (${steamId})`)
    }
  }

  writeFileSync(`${DATA_DIR}/steam_id_map.json`, JSON.stringify(steamIdMap, null, 2))
  console.log(`  ✅ ${Object.keys(steamIdMap).length} entries written to steam_id_map.json`)
  if (nameChangesDetected > 0) {
    console.log(`  🔄 ${nameChangesDetected} username changes recorded`)
  }

  console.log('\n✅ Migration complete!')
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    migrate()
  }
}
