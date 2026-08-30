import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import type { Giveaway, SteamIdMap, User } from '../types/steamgifts.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dataDir = path.resolve(__dirname, '../../..', 'website/public/data')
const rootEnvPath = path.resolve(__dirname, '../../../..', '.env')

interface ExMembersData {
  lastUpdated: number
  users: Record<string, User>
}

interface GroupUsersData {
  lastUpdated: number
  users: Record<string, User>
}

interface GiveawaysData {
  giveaways: Giveaway[]
}

type UserEntriesData = Record<
  string,
  Array<{ steam_id: string; joined_at: string }>
>

interface ActiveEntry {
  link: string
  name: string
  end_timestamp: number
  joined_at: number
  // true when the entry was made AFTER the user left the group — actively
  // exploiting the SteamGifts membership-sync delay, not just a stale entry
  entered_after_leaving: boolean
}

export interface FlaggedExMember {
  steam_id: string
  username: string
  profile_url: string
  left_at_timestamp: number
  active_entries: ActiveEntry[]
  // true for a member who was kicked from the Steam group but hasn't synced
  // off SteamGifts yet (see kicked_pending_sync on User); false for a real
  // ex-member SG has already synced out
  pending_sync: boolean
}

interface ExMemberCandidate {
  steam_id: string
  user: User
  // left_at_timestamp for a real ex-member, kick_detected_at for a
  // kicked-but-not-yet-synced one — both unix ms, so they compare the same
  // way against entry.joined_at
  effective_left_at: number
  pending_sync: boolean
}

/**
 * Combines real ex-members with users who are still in SG's group data but
 * were kicked from the Steam group and are just waiting for SG to sync them
 * out. Both cases carry the same exploit — a user shouldn't be in
 * group-exclusive giveaways — so they're checked together.
 */
export function buildExMemberCandidates(
  exMembers: Record<string, User>,
  groupUsers: Record<string, User>,
): ExMemberCandidate[] {
  const candidates: ExMemberCandidate[] = []

  for (const [steamId, user] of Object.entries(exMembers)) {
    candidates.push({
      steam_id: steamId,
      user,
      effective_left_at: user.left_at_timestamp ?? 0,
      pending_sync: false,
    })
  }

  for (const [steamId, user] of Object.entries(groupUsers)) {
    if (!user.kicked_pending_sync) continue
    candidates.push({
      steam_id: steamId,
      user,
      effective_left_at: user.kick_detected_at ?? 0,
      pending_sync: true,
    })
  }

  return candidates
}

const BASE_URL = 'https://www.steamgifts.com/giveaway'
const formatDate = (unixSeconds: number) =>
  new Date(unixSeconds * 1000).toISOString().slice(0, 10)

/**
 * Cross-references ex_members.json with user_entries.json to find ex-members
 * who still have entries in active group-EXCLUSIVE giveaways. SteamGifts takes
 * a while to sync group membership, so departed members can keep (or even add)
 * entries — and win — until they leave each giveaway themselves.
 *
 * Giveaways shared with other groups or a whitelist are skipped: an ex-member
 * may legitimately be entered through one of those.
 */
export function checkExMemberEntries(
  entriesOverride?: UserEntriesData,
): FlaggedExMember[] {
  const exMembers: ExMembersData = JSON.parse(
    readFileSync(path.join(dataDir, 'ex_members.json'), 'utf-8'),
  )
  const groupUsers: GroupUsersData = JSON.parse(
    readFileSync(path.join(dataDir, 'group_users.json'), 'utf-8'),
  )
  const giveawaysData: GiveawaysData = JSON.parse(
    readFileSync(path.join(dataDir, 'giveaways.json'), 'utf-8'),
  )
  const userEntries: UserEntriesData =
    entriesOverride ??
    JSON.parse(readFileSync(path.join(dataDir, 'user_entries.json'), 'utf-8'))

  const now = Math.floor(Date.now() / 1000)
  const giveawayMap = new Map<string, Giveaway>(
    giveawaysData.giveaways.map((ga) => [ga.link, ga]),
  )

  const candidates = buildExMemberCandidates(
    exMembers.users,
    groupUsers.users,
  )

  const flagged: FlaggedExMember[] = []

  for (const { steam_id: steamId, user, effective_left_at, pending_sync } of candidates) {
    const activeEntries: ActiveEntry[] = []

    for (const [link, entries] of Object.entries(userEntries)) {
      const giveaway = giveawayMap.get(link)
      if (!giveaway || giveaway.deleted) continue
      if ((giveaway.end_timestamp ?? 0) <= now) continue
      // Not group-exclusive — the ex-member may have access via another
      // group or a whitelist, so being entered is legitimate
      if (giveaway.is_shared || giveaway.is_whitelist || giveaway.whitelist)
        continue

      const entry = entries.find((e) => e.steam_id === steamId)
      if (!entry) continue

      const joinedAt = Number(entry.joined_at)
      activeEntries.push({
        link,
        name: giveaway.name,
        end_timestamp: giveaway.end_timestamp,
        joined_at: joinedAt,
        entered_after_leaving:
          effective_left_at > 0 && joinedAt * 1000 > effective_left_at,
      })
    }

    if (activeEntries.length === 0) continue

    activeEntries.sort((a, b) => a.end_timestamp - b.end_timestamp)
    flagged.push({
      steam_id: steamId,
      username: user.username,
      profile_url: user.profile_url,
      left_at_timestamp: effective_left_at,
      active_entries: activeEntries,
      pending_sync,
    })
  }

  flagged.sort((a, b) => b.active_entries.length - a.active_entries.length)

  if (flagged.length > 0) {
    const totalEntries = flagged.reduce(
      (sum, m) => sum + m.active_entries.length,
      0,
    )
    console.log(
      `🚨 ${flagged.length} ex-member(s) still have ${totalEntries} entr${totalEntries === 1 ? 'y' : 'ies'} in active group-exclusive giveaways:`,
    )
    for (const member of flagged) {
      const label = member.pending_sync
        ? ' (kicked, not yet synced on SG)'
        : ''
      console.log(
        `   - ${member.username}${label}: ${member.active_entries.map((e) => e.link).join(', ')}`,
      )
    }
    console.log(
      '   Run `pnpm --filter @gusbot/scraper check-ex-member-entries --messages` for chase-up messages.',
    )
  } else {
    console.log(
      '✅ No ex-members with entries in active group-exclusive giveaways.',
    )
  }

  return flagged
}

/**
 * Scrapes the entry pages of all active group-exclusive giveaways directly
 * from SteamGifts, bypassing user_entries.json. Useful when the local data
 * may be stale or was generated before ex-member entries were kept.
 * Requires SG_COOKIE (loaded from the repo root .env).
 */
async function fetchLiveEntries(): Promise<UserEntriesData> {
  loadEnv({ path: rootEnvPath })
  if (!process.env.SG_COOKIE) {
    console.error(
      `❌ SG_COOKIE not set (looked in ${rootEnvPath}) — cannot fetch live entries.`,
    )
    process.exit(1)
  }

  // Imported lazily so the default (file-based) mode never needs env vars
  const { groupGiveawaysScraper } = await import(
    '../scrapers/group-giveaways'
  )

  const giveawaysData: GiveawaysData = JSON.parse(
    readFileSync(path.join(dataDir, 'giveaways.json'), 'utf-8'),
  )
  const steamIdMapData: SteamIdMap = JSON.parse(
    readFileSync(path.join(dataDir, 'steam_id_map.json'), 'utf-8'),
  )
  const usernameToSteamId = new Map<string, string>()
  for (const [steamId, entry] of Object.entries(steamIdMapData)) {
    usernameToSteamId.set(entry.current, steamId)
    for (const prev of entry.previous) {
      usernameToSteamId.set(prev.username, steamId)
    }
  }

  const now = Math.floor(Date.now() / 1000)
  const targets = giveawaysData.giveaways.filter(
    (g) =>
      g.end_timestamp > now &&
      !g.deleted &&
      !g.is_shared &&
      !g.is_whitelist &&
      !g.whitelist &&
      g.entry_count > 0,
  )
  console.log(
    `🔄 Fetching live entries for ${targets.length} active group-exclusive giveaways...`,
  )

  const liveEntries: UserEntriesData = {}
  for (const giveaway of targets) {
    const entries = await groupGiveawaysScraper.fetchDetailedEntries(
      giveaway.link,
    )
    liveEntries[giveaway.link] = entries.map((e) => ({
      steam_id: usernameToSteamId.get(e.username) ?? e.username,
      joined_at: e.joined_at,
    }))
    await delay(1000)
  }
  return liveEntries
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function buildChaseUpMessage(member: FlaggedExMember): string {
  const gaLines = member.active_entries
    .map(
      (e) =>
        `- [${e.name}](${BASE_URL}/${e.link}/) (ends ${formatDate(e.end_timestamp)})`,
    )
    .join('\n')
  const count = member.active_entries.length
  const departureLine = member.pending_sync
    ? `Our records show you were removed from the group on ${formatDate(member.left_at_timestamp / 1000)}`
    : `Our records show you left the group on ${formatDate(member.left_at_timestamp / 1000)}`

  return `Hi ${member.username},

${departureLine}, but you still have entries in ${count} active group giveaway${count === 1 ? '' : 's'}. Since group giveaways are reserved for current members, please remove your entries from the following:

${gaLines}

If the entries are still there when these giveaways end and you win, the win will be reported to SteamGifts support as a rule violation. Thanks for understanding!`
}

async function runCli(): Promise<void> {
  const args = process.argv.slice(2)
  const showMessages = args.includes('--messages')
  const live = args.includes('--live')
  const usernameFilter = args.find((a) => !a.startsWith('--'))?.toLowerCase()

  const entriesOverride = live ? await fetchLiveEntries() : undefined
  const flagged = checkExMemberEntries(entriesOverride)
  const results = usernameFilter
    ? flagged.filter((f) => f.username.toLowerCase() === usernameFilter)
    : flagged

  if (usernameFilter && results.length === 0) {
    console.log(
      `No active entries found for ex-member "${usernameFilter}" (or not an ex-member).`,
    )
    return
  }

  console.log()
  for (const member of results) {
    const exploiting = member.active_entries.filter(
      (e) => e.entered_after_leaving,
    ).length
    const exploitTag =
      exploiting > 0 ? ` 🚨 ${exploiting} entered AFTER leaving` : ''
    const statusLabel = member.pending_sync
      ? `kicked, not yet synced on SG, detected ${formatDate(member.left_at_timestamp / 1000)}`
      : `left ${formatDate(member.left_at_timestamp / 1000)}`
    console.log(
      `${member.username} (${statusLabel}) — ${member.active_entries.length} active entr${member.active_entries.length === 1 ? 'y' : 'ies'}${exploitTag}`,
    )
    for (const entry of member.active_entries) {
      const marker = entry.entered_after_leaving ? '🚨' : '  '
      console.log(
        `  ${marker} ${entry.name} — ${BASE_URL}/${entry.link}/ (ends ${formatDate(entry.end_timestamp)})`,
      )
    }
    console.log()
  }

  if (showMessages || usernameFilter) {
    for (const member of results) {
      console.log('─'.repeat(60))
      console.log(`📨 Chase-up message for ${member.username}:`)
      console.log(
        `   https://www.steamgifts.com${member.profile_url.replace(/\/$/, '')}\n`,
      )
      console.log(buildChaseUpMessage(member))
      console.log()
    }
  }
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await runCli()
  }
}
