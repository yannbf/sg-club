import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { groupMemberScraper } from '../scrapers/group-members.js'
import type { User } from '../types/steamgifts.js'
import { delay } from '../utils/common.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dataDir = path.resolve(__dirname, '../../..', 'website/public/data')
const rootEnvPath = path.resolve(__dirname, '../../../..', '.env')
loadEnv({ path: rootEnvPath })

interface GroupUsersFile {
  lastUpdated: number
  users: Record<string, User>
}

/**
 * Standalone "last online" refresh: re-scrapes ONLY each member's SG profile
 * page to update last_online_at (plus registered_at / contributor_level,
 * which ride along on the same page), then writes group_users.json back —
 * no giveaway/Steam-API work, so it finishes in minutes. Users checked
 * within the last 20h are skipped so an interrupted or partially-failed run
 * can be rerun cheaply, picking up only what's missing; FORCE=1 refreshes
 * everyone regardless.
 */
async function refreshLastOnline(): Promise<void> {
  const filePath = path.join(dataDir, 'group_users.json')
  const data = JSON.parse(readFileSync(filePath, 'utf-8')) as GroupUsersFile

  const FRESH_MS = 20 * 60 * 60 * 1000
  const force = process.env.FORCE === '1'
  const users = Object.values(data.users).filter(
    (u) =>
      u.profile_url &&
      (force ||
        u.last_online_checked_at == null ||
        Date.now() - u.last_online_checked_at > FRESH_MS),
  )
  console.log(`🕒 Refreshing "last online" for ${users.length} users...`)

  let refreshed = 0
  let failed = 0
  for (const [i, user] of users.entries()) {
    try {
      const info = await groupMemberScraper.fetchUserSteamInfo(user)
      // fetchUserSteamInfo swallows fetch errors and returns nulls; a parsed
      // last_online_at is the only reliable success signal, so only then is
      // the check stamped (same rule as the in-pipeline refresh pass).
      if (info.last_online_at != null) {
        user.last_online_at = info.last_online_at
        user.last_online_checked_at = Date.now()
        refreshed++
      } else {
        failed++
        console.warn(`⚠️  [${i + 1}/${users.length}] No "Last Online" parsed for ${user.username}`)
      }
      if (info.registered_at != null) user.registered_at = info.registered_at
      if (info.contributor_level != null) user.contributor_level = info.contributor_level
      if ((i + 1) % 20 === 0 || i === users.length - 1) {
        console.log(`  [${i + 1}/${users.length}] ...`)
      }
      await delay(400)
    } catch (error) {
      failed++
      console.warn(`⚠️  [${i + 1}/${users.length}] Error refreshing ${user.username}:`, error)
    }
  }

  writeFileSync(filePath, JSON.stringify(data, null, 2))
  console.log(`✅ Done: ${refreshed} refreshed, ${failed} failed. Wrote ${filePath}`)
}

await refreshLastOnline()
