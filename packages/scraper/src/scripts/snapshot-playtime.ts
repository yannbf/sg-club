/**
 * Monthly playtime snapshot writer.
 *
 * Captures a compact baseline of every member's playtime/achievements per
 * won giveaway, keyed by steam_id, so the website can chart hours played
 * per month as the delta between consecutive snapshots.
 *
 * The month a snapshot is named after is the month it represents the START
 * of: a snapshot captured on Sep 3 from current live data is the baseline
 * for September (2026-09.json), not August.
 *
 * Run:
 *   pnpm --filter scraper snapshot-playtime
 * Override the represented month (normally only used by the backfill
 * script, which derives historical months from git history instead):
 *   SNAPSHOT_MONTH=2026-07 pnpm --filter scraper snapshot-playtime
 * Overwrite an existing month's file:
 *   FORCE=true pnpm --filter scraper snapshot-playtime
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(currentDir, '../../../..')
const dataDir = resolve(repoRoot, 'packages/website/public/data')
const snapshotsDir = resolve(dataDir, 'playtime_snapshots')

interface SteamPlayData {
  playtime_minutes?: number
  achievements_unlocked?: number
}
interface WonGame {
  link: string
  steam_play_data?: SteamPlayData
}
export interface SnapshotUserLike {
  username?: string
  steam_id?: string
  giveaways_won?: WonGame[]
}
export interface GroupUsersFile {
  users: Record<string, SnapshotUserLike> | SnapshotUserLike[]
}

export type MembersMap = Record<string, Record<string, [number, number]>>

export interface PlaytimeSnapshot {
  captured_at: string
  members: MembersMap
}

/** giveawayId = the short id, i.e. the link segment before the slash. */
export function giveawayIdFromLink(link: string): string {
  return link.split('/')[0]
}

/**
 * Folds a group_users.json / ex_members.json-shaped file into `members`.
 * Every record has carried its own `steam_id` field since the file was
 * first created, even in pre-migration (username-keyed) history, so that
 * field is used directly. `fallbackSteamId` is only consulted for the rare
 * record missing it (e.g. via a username → steam_id lookup table).
 */
export function collectPlaytime(
  usersFile: GroupUsersFile | null | undefined,
  members: MembersMap,
  fallbackSteamId?: (username: string) => string | undefined,
): { unmapped: string[] } {
  const unmapped: string[] = []
  if (!usersFile?.users) return { unmapped }

  const users = Array.isArray(usersFile.users)
    ? usersFile.users
    : Object.values(usersFile.users)

  for (const user of users) {
    const steamId = user.steam_id || (user.username && fallbackSteamId?.(user.username))
    if (!steamId) {
      if (user.username) unmapped.push(user.username)
      continue
    }

    for (const win of user.giveaways_won ?? []) {
      const play = win.steam_play_data
      if (!play) continue
      const giveawayId = giveawayIdFromLink(win.link)
      const memberGames = members[steamId] ?? (members[steamId] = {})
      memberGames[giveawayId] = [play.playtime_minutes ?? 0, play.achievements_unlocked ?? 0]
    }
  }

  return { unmapped }
}

export function buildSnapshot(
  groupUsers: GroupUsersFile | null | undefined,
  exMembers: GroupUsersFile | null | undefined,
  capturedAt: Date,
  fallbackSteamId?: (username: string) => string | undefined,
): { snapshot: PlaytimeSnapshot; unmapped: string[] } {
  const members: MembersMap = {}
  const unmapped = [
    ...collectPlaytime(groupUsers, members, fallbackSteamId).unmapped,
    ...collectPlaytime(exMembers, members, fallbackSteamId).unmapped,
  ]
  return { snapshot: { captured_at: capturedAt.toISOString(), members }, unmapped }
}

export function snapshotPathForMonth(month: string): string {
  return resolve(snapshotsDir, `${month}.json`)
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function writeSnapshotFile(
  month: string,
  snapshot: PlaytimeSnapshot,
  force = false,
): 'written' | 'skipped-exists' {
  mkdirSync(snapshotsDir, { recursive: true })
  const filePath = snapshotPathForMonth(month)
  if (existsSync(filePath) && !force) return 'skipped-exists'
  writeFileSync(filePath, JSON.stringify(snapshot))
  return 'written'
}

export function readGroupUsersFile(path: string): GroupUsersFile | null {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf-8'))
}

/**
 * Called from the data pipeline: captures the current month's baseline the
 * first time it runs after the month starts, then no-ops for the rest of
 * the month. Never overwrites — a later, more complete run of the pipeline
 * within the same month should not disturb the already-captured baseline.
 */
export function captureMonthlySnapshotIfMissing(now = new Date()): void {
  const month = monthKey(now)
  if (existsSync(snapshotPathForMonth(month))) return

  const groupUsers = readGroupUsersFile(resolve(dataDir, 'group_users.json'))
  const exMembers = readGroupUsersFile(resolve(dataDir, 'ex_members.json'))
  const { snapshot, unmapped } = buildSnapshot(groupUsers, exMembers, now)
  const result = writeSnapshotFile(month, snapshot)

  if (result === 'written') {
    const memberCount = Object.keys(snapshot.members).length
    console.log(`📸 Captured playtime_snapshots/${month}.json (${memberCount} members)`)
    if (unmapped.length > 0) {
      console.log(`  ⚠️  ${unmapped.length} users skipped (no steam_id): ${unmapped.join(', ')}`)
    }
  }
}

async function main(): Promise<void> {
  const month = process.env.SNAPSHOT_MONTH || monthKey(new Date())
  const force = process.env.FORCE === 'true'

  const groupUsers = readGroupUsersFile(resolve(dataDir, 'group_users.json'))
  const exMembers = readGroupUsersFile(resolve(dataDir, 'ex_members.json'))
  const { snapshot, unmapped } = buildSnapshot(groupUsers, exMembers, new Date())
  const result = writeSnapshotFile(month, snapshot, force)

  if (result === 'skipped-exists') {
    console.log(
      `🛑 playtime_snapshots/${month}.json already exists — refusing to overwrite (set FORCE=true to override).`,
    )
    return
  }

  const memberCount = Object.keys(snapshot.members).length
  console.log(`✅ Wrote playtime_snapshots/${month}.json (${memberCount} members)`)
  if (unmapped.length > 0) {
    console.log(`⚠️  ${unmapped.length} users skipped (no steam_id): ${unmapped.join(', ')}`)
  }
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await main()
  }
}
