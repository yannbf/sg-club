import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { Giveaway } from '../types/steamgifts.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dataDir = path.resolve(__dirname, '../../..', 'website/public/data')

interface GroupUsersData {
  users: Record<string, { username: string; steam_id: string }>
}

interface GiveawaysData {
  giveaways: Giveaway[]
}

type UserEntriesData = Record<
  string,
  Array<{ steam_id: string; joined_at: string }>
>

const username = process.argv[2]
if (!username) {
  console.error('Usage: pnpm --filter scraper get-entries <username>')
  process.exit(1)
}

const groupUsers: GroupUsersData = JSON.parse(
  readFileSync(path.join(dataDir, 'group_users.json'), 'utf-8'),
)
const giveawaysData: GiveawaysData = JSON.parse(
  readFileSync(path.join(dataDir, 'giveaways.json'), 'utf-8'),
)
const userEntries: UserEntriesData = JSON.parse(
  readFileSync(path.join(dataDir, 'user_entries.json'), 'utf-8'),
)

// Find the user's steam_id by username (case-insensitive)
const userEntry = Object.values(groupUsers.users).find(
  (u) => u.username.toLowerCase() === username.toLowerCase(),
)

if (!userEntry) {
  console.error(`User "${username}" not found in group_users.json`)
  process.exit(1)
}

const { steam_id, username: resolvedUsername } = userEntry

// Build a map of giveaway id -> giveaway for fast lookup
const giveawayMap = new Map<string, Giveaway>(
  giveawaysData.giveaways.map((ga) => [ga.id, ga]),
)

// Collect all giveaways the user entered
const results: Array<{ giveaway: Giveaway; won: boolean }> = []

for (const [key, entries] of Object.entries(userEntries)) {
  const entered = entries.some((e) => e.steam_id === steam_id)
  if (!entered) continue

  const gaId = key.split('/')[0]
  const giveaway = giveawayMap.get(gaId)
  if (!giveaway) continue

  const won =
    Array.isArray(giveaway.winners) &&
    giveaway.winners.some(
      (w) =>
        w.winner_username?.toLowerCase() === resolvedUsername.toLowerCase() ||
        w.name === steam_id,
    )

  results.push({ giveaway, won })
}

// Sort by start date descending (most recent first)
results.sort(
  (a, b) =>
    (b.giveaway.start_timestamp ?? 0) - (a.giveaway.start_timestamp ?? 0),
)

const BASE_URL = 'https://www.steamgifts.com/giveaway'

console.log(
  `\nGiveaways entered by ${resolvedUsername} (${results.length} total):\n`,
)

for (const { giveaway, won } of results) {
  const trophy = won ? ' 🏆' : ''
  const link = `${BASE_URL}/${giveaway.link}/`
  console.log(`${trophy || '  '} ${giveaway.name} — ${link}`)
}

if (results.length === 0) {
  console.log('No entries found.')
}
