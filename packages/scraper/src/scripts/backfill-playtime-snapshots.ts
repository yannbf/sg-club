/**
 * One-off historical backfill for monthly playtime snapshots.
 *
 * For each month boundary since group_users.json tracking began, finds the
 * last commit before that boundary that touched the file, extracts it via
 * `git show` (never checks out old commits), and builds that month's
 * baseline snapshot from the historical content.
 *
 * Every record in group_users.json / ex_members.json has carried its own
 * steam_id field since the file was first created — even the pre-migration,
 * username-keyed months (the outer object key became steam_id only later,
 * in the April 2026 migration, but the `steam_id` property on each record
 * was already populated). So no username → steam_id mapping is normally
 * needed; steam_id_map.json (current + previous usernames) is used only as
 * a fallback for a record that is somehow missing it.
 *
 * group_users.json has lived at its current path
 * (packages/website/public/data/group_users.json) since July 6, 2025 (the
 * pnpm-workspace restructure); every month boundary this script targets is
 * well after that, so no path-history handling is needed.
 *
 * Writes files under packages/website/public/data/playtime_snapshots/ and
 * commits nothing.
 *
 * Run:
 *   pnpm --filter scraper backfill-playtime-snapshots
 * Overwrite months that already have a snapshot file:
 *   FORCE=true pnpm --filter scraper backfill-playtime-snapshots
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildSnapshot,
  monthKey,
  snapshotPathForMonth,
  writeSnapshotFile,
  type GroupUsersFile,
} from './snapshot-playtime.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(currentDir, '../../../..')
const dataDir = resolve(repoRoot, 'packages/website/public/data')

const GROUP_USERS_PATH = 'packages/website/public/data/group_users.json'
const EX_MEMBERS_PATH = 'packages/website/public/data/ex_members.json'

// Earliest month we attempt — group_users.json didn't exist until July 5,
// 2025, so June/July 2025 boundaries have no prior commit and are reported
// as skipped rather than hardcoded away.
const FIRST_MONTH = '2025-06'
const FORCE = process.env.FORCE === 'true'

function monthRange(from: string, toExclusive: string): string[] {
  const months: string[] = []
  let [y, m] = from.split('-').map(Number)
  const [toY, toM] = toExclusive.split('-').map(Number)
  while (y < toY || (y === toY && m < toM)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return months
}

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024 * 64,
  }).trim()
}

function lastCommitBefore(isoDate: string, path: string): string | null {
  const out = git(['log', '-1', '--format=%H', `--before=${isoDate}`, '--', path])
  return out || null
}

function commitDate(commit: string): Date {
  return new Date(git(['show', '-s', '--format=%aI', commit]))
}

function showFileAtCommit(commit: string, path: string): GroupUsersFile | null {
  try {
    return JSON.parse(git(['show', `${commit}:${path}`]))
  } catch {
    return null
  }
}

function loadSteamIdMap(): Map<string, string> {
  const map = new Map<string, string>()
  const path = resolve(dataDir, 'steam_id_map.json')
  if (!existsSync(path)) return map
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<
    string,
    { current: string; previous: { username: string; changed_at: string }[] }
  >
  for (const [steamId, entry] of Object.entries(raw)) {
    map.set(entry.current, steamId)
    for (const p of entry.previous) map.set(p.username, steamId)
  }
  return map
}

async function main(): Promise<void> {
  const currentMonth = monthKey(new Date())
  const months = monthRange(FIRST_MONTH, currentMonth) // excludes the current month — task 1 captures that live
  const steamIdMap = loadSteamIdMap()
  const fallbackSteamId = (username: string) => steamIdMap.get(username)

  const written: { month: string; commit: string; date: string; members: number; size: number }[] = []
  const skipped: { month: string; reason: string }[] = []
  const allUnmapped = new Set<string>()

  for (const month of months) {
    const boundaryIso = `${month}-01T00:00:00Z`
    const commit = lastCommitBefore(boundaryIso, GROUP_USERS_PATH)
    if (!commit) {
      skipped.push({ month, reason: 'no commit before this month touching group_users.json' })
      continue
    }

    if (existsSync(snapshotPathForMonth(month)) && !FORCE) {
      skipped.push({ month, reason: 'snapshot file already exists (set FORCE=true to overwrite)' })
      continue
    }

    const groupUsers = showFileAtCommit(commit, GROUP_USERS_PATH)
    if (!groupUsers?.users) {
      skipped.push({ month, reason: `group_users.json unreadable/empty at commit ${commit.slice(0, 7)}` })
      continue
    }
    const exMembers = showFileAtCommit(commit, EX_MEMBERS_PATH)

    const capturedAt = commitDate(commit)
    const { snapshot, unmapped } = buildSnapshot(groupUsers, exMembers, capturedAt, fallbackSteamId)
    for (const u of unmapped) allUnmapped.add(u)

    writeSnapshotFile(month, snapshot, true)
    const size = Buffer.byteLength(JSON.stringify(snapshot))
    const memberCount = Object.keys(snapshot.members).length
    written.push({
      month,
      commit: commit.slice(0, 7),
      date: capturedAt.toISOString().slice(0, 10),
      members: memberCount,
      size,
    })
    console.log(
      `✅ ${month}.json ← commit ${commit.slice(0, 7)} (${capturedAt.toISOString().slice(0, 10)}), ${memberCount} members, ${size} bytes`,
    )
  }

  console.log('\n--- Summary ---')
  console.log(`Written: ${written.length}/${months.length} candidate months`)
  if (skipped.length > 0) {
    console.log(`Skipped: ${skipped.length}`)
    for (const s of skipped) console.log(`  ${s.month}: ${s.reason}`)
  }
  if (allUnmapped.size > 0) {
    console.log(`Unmapped users across all months (no steam_id, no steam_id_map.json match): ${allUnmapped.size}`)
    console.log(`  ${[...allUnmapped].join(', ')}`)
  } else {
    console.log('Unmapped users: 0')
  }
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await main()
  }
}
