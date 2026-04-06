import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { groupMemberScraper } from '../scrapers/group-members'

async function generatePlaytimeData(): Promise<void> {
  const usersPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../website/public/data/group_users.json'
  )

  const giveawaysPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../website/public/data/giveaways.json'
  )

  console.log('🎮 Generating playtime data only...')

  const usersJson = JSON.parse(readFileSync(usersPath, 'utf-8'))
  // Internal Map keyed by username for processing (updateSteamPlayData expects username keys)
  const allUsersMap = new Map<string, any>(
    Object.values(usersJson.users).map((u: any) => [u.username, u])
  )

  // filter users to update
  const DEBUG_USERS: string[] = [
    // 'gus09'
  ]

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

  await groupMemberScraper.updateSteamPlayData(usersMap as any, giveaways)

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

  console.log('✅ Playtime data updated')
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await generatePlaytimeData()
  }
}
