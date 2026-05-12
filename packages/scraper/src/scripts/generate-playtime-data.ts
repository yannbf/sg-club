import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import {
  groupMemberScraper,
  PLAYTIME_POLICIES,
  resolvePlaytimeMode,
  type PlaytimeMode,
} from '../scrapers/group-members'

/**
 * Allow `--mode=<fresh|medium|backfill|all>` (with optional
 * `--budget=<minutes>`) on the command line, so a single script entry
 * powers every scheduled job and an ad-hoc local backfill.
 *
 * Environment variables PLAYTIME_MODE and PLAYTIME_BUDGET_MINUTES are
 * still honoured (CLI flags simply set them before the scraper runs).
 */
function parseCliFlags(): void {
  for (const arg of process.argv.slice(2)) {
    const eq = arg.indexOf('=')
    if (eq < 0) continue
    const key = arg.slice(0, eq).replace(/^-+/, '').toLowerCase()
    const value = arg.slice(eq + 1)
    if (key === 'mode') process.env.PLAYTIME_MODE = value
    if (key === 'budget' || key === 'budget-minutes')
      process.env.PLAYTIME_BUDGET_MINUTES = value
  }
}

async function generatePlaytimeData(): Promise<void> {
  parseCliFlags()
  const mode: PlaytimeMode = resolvePlaytimeMode()
  const policy = PLAYTIME_POLICIES[mode]
  const budgetRaw = process.env.PLAYTIME_BUDGET_MINUTES
  const budgetMinutes = budgetRaw ? parseInt(budgetRaw, 10) : null

  const usersPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../website/public/data/group_users.json'
  )

  const giveawaysPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../website/public/data/giveaways.json'
  )

  console.log(
    `🎮 Generating playtime data — mode=${mode}` +
      (budgetMinutes ? `, budget=${budgetMinutes}min` : '') +
      ` (age window: ${policy.minAgeDays}–${policy.maxAgeDays ?? '∞'}d,` +
      ` refresh after ${policy.refreshAfterDays}d)`
  )

  const usersJson = JSON.parse(readFileSync(usersPath, 'utf-8'))
  // Internal Map keyed by username for processing (updateSteamPlayData expects username keys)
  const allUsersMap = new Map<string, any>(
    Object.values(usersJson.users).map((u: any) => [u.username, u])
  )

  // Optional DEBUG_USERS filter for local poking (set DEBUG_USERS env or
  // edit this list).
  const DEBUG_USERS: string[] = (process.env.DEBUG_USERS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (DEBUG_USERS.length > 0) {
    console.log('🎮 DEBUG_USERS:', DEBUG_USERS)
    process.env.DEBUG = 'true'
  }
  const usersMap =
    DEBUG_USERS.length === 0
      ? allUsersMap
      : new Map(
          Array.from(allUsersMap.values())
            .filter((u) => DEBUG_USERS.includes(u.username))
            .map((u) => [u.username, u])
        )

  const giveaways = JSON.parse(readFileSync(giveawaysPath, 'utf-8')).giveaways

  // Ensure we do not skip playtime here
  delete process.env.SKIP_STEAM_PLAYTIME
  delete process.env.SKIP_STEAM_API

  await groupMemberScraper.updateSteamPlayData(usersMap as any, giveaways, {
    mode,
    budgetMinutes,
  })

  // Merge updated users back into the full map so we never drop other users
  for (const [username, user] of usersMap.entries()) {
    allUsersMap.set(username, user)
  }

  // Persist back to file keyed by steam_id
  const updatedUsersRecord: Record<string, any> = {}
  for (const user of Array.from(allUsersMap.values())) {
    updatedUsersRecord[user.steam_id] = user
  }

  // Reuse the same save logic path by writing the full object
  const updated = {
    ...usersJson,
    lastUpdated: Date.now(),
    users: updatedUsersRecord,
  }

  writeFileSync(usersPath, JSON.stringify(updated, null, 2))

  console.log(`✅ Playtime data updated (mode=${mode})`)
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await generatePlaytimeData()
  }
}
