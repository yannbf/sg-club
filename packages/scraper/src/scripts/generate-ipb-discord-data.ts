import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import type { IpbDiscordData, IpbDiscordUnmatchedThread, IpbDiscordWinEntry } from '../types/ipb-discord.js'
import type { Giveaway, User } from '../types/steamgifts.js'
import { delay } from '../utils/common.js'
import { logError } from '../utils/log-error.js'

/**
 * Matches "I Play Bro" play-verification threads from the Discord forum
 * channel to the group wins they attest to. Members post a thread named
 * after the game they're verifying, and its starter message usually links
 * the SteamGifts giveaway and/or the Steam store/review page.
 *
 * Matching priority per thread:
 *  1. giveaway_link — a SteamGifts giveaway link in the starter message
 *     whose code prefixes a candidate win's `link`. Resolves the winner
 *     directly, independent of the Discord handle mapping.
 *  2. app_link / review_link — a Steam store or review link resolving to an
 *     app_id that matches one of the thread owner's candidate wins.
 *  3. title — fuzzy match between the thread name and the win's name.
 *
 * A thread whose owner can't be resolved, or whose owner has no matching
 * win, falls through to a last-resort cross-user pass — some threads are
 * submitted on behalf of someone else (thread names suffixed e.g.
 * "[TempR]"), so the owner mapping doesn't apply:
 *  4. app_link_unique — same app/review link, but searched across every
 *     member and ex-member's wins instead of just the owner's. Accepted
 *     only if exactly one win across everyone matches.
 *  5. title_unique — same title fuzzy match (with bracketed suffixes like
 *     "[TempR]" stripped first), searched across every member and
 *     ex-member's wins. Accepted only if exactly one win matches.
 *
 * Run with: pnpm --filter scraper ipb-discord
 */

const DISCORD_API_BASE = 'https://discord.com/api/v10'
const GUILD_ID = '1385346341848350810'
const IPB_CHANNEL_ID = '1511044179910856977'
/** Meta threads in the forum that are not play-verification submissions. */
const EXCLUDED_THREAD_IDS = new Set([
  '1511044651703074857', // "I Play, Bro Archive" — pinned index thread
])
const DISCORD_REQUEST_DELAY_MS = 300

const currentDir = dirname(fileURLToPath(import.meta.url))
const rootEnvPath = resolve(currentDir, '../../../../.env')
loadEnv({ path: existsSync(rootEnvPath) ? rootEnvPath : undefined })

const dataDir = resolve(currentDir, '../../../website/public/data')
const giveawaysPath = resolve(dataDir, 'giveaways.json')
const groupUsersPath = resolve(dataDir, 'group_users.json')
const exMembersPath = resolve(dataDir, 'ex_members.json')
const discordMembersPath = resolve(dataDir, 'discord_members.json')
const outputPath = resolve(dataDir, 'ipb_discord.json')

const cacheDir = resolve(currentDir, '../../data')
const usersCachePath = resolve(cacheDir, 'discord-users-cache.json')
const threadsCachePath = resolve(cacheDir, 'discord-threads-cache.json')

// --- Discord REST ---

interface DiscordThread {
  id: string
  name: string
  owner_id: string
  parent_id: string | null
  thread_metadata?: { archive_timestamp: string }
}

interface DiscordMessage {
  id: string
  content: string
  embeds?: Array<{ url?: string }>
}

async function discordRequest<T>(path: string): Promise<T> {
  const result = await discordGet(path)
  if (!result.ok) throw new Error(`Discord API GET ${path} failed: ${result.status}`)
  return result.data as T
}

/** Like discordRequest but surfaces a 404 as a typed miss instead of throwing. */
async function discordGet(
  path: string,
): Promise<{ ok: true; data: unknown } | { ok: false; status: number }> {
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) throw new Error('DISCORD_BOT_TOKEN is not set')

  for (;;) {
    const res = await fetch(`${DISCORD_API_BASE}${path}`, {
      headers: { Authorization: `Bot ${token}` },
    })

    if (res.status === 429) {
      const body = (await res.json().catch(() => ({}))) as { retry_after?: number }
      const waitMs = Math.ceil((body.retry_after ?? 1) * 1000) + 250
      await delay(waitMs)
      continue
    }

    if (res.status === 404) return { ok: false, status: 404 }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Discord API GET ${path} failed: ${res.status} ${body}`)
    }

    return { ok: true, data: await res.json() }
  }
}

async function fetchActiveIpbThreads(): Promise<DiscordThread[]> {
  const result = await discordRequest<{ threads: DiscordThread[] }>(
    `/guilds/${GUILD_ID}/threads/active`,
  )
  return result.threads.filter((t) => t.parent_id === IPB_CHANNEL_ID)
}

async function fetchArchivedIpbThreads(): Promise<DiscordThread[]> {
  const threads: DiscordThread[] = []
  let before: string | undefined

  for (;;) {
    const params = new URLSearchParams({ limit: '100' })
    if (before) params.set('before', before)

    await delay(DISCORD_REQUEST_DELAY_MS)
    const page = await discordRequest<{ threads: DiscordThread[]; has_more: boolean }>(
      `/channels/${IPB_CHANNEL_ID}/threads/archived/public?${params.toString()}`,
    )

    threads.push(...page.threads)
    if (!page.has_more || page.threads.length === 0) break

    const last = page.threads[page.threads.length - 1]
    const nextBefore = last.thread_metadata?.archive_timestamp
    if (!nextBefore) break
    before = nextBefore
  }

  return threads
}

async function fetchUsername(userId: string): Promise<string | null> {
  try {
    const user = await discordRequest<{ username: string }>(`/users/${userId}`)
    return user.username
  } catch (error) {
    logError(error, `Failed to fetch Discord username for user ${userId}`)
    return null
  }
}

/**
 * A forum thread's starter message shares the thread's id. Falls back to the
 * oldest message in the thread (by id) if the direct lookup 404s — covers
 * threads where Discord didn't carry the id over (e.g. very old threads).
 */
async function fetchStarterMessage(threadId: string): Promise<DiscordMessage | null> {
  const direct = await discordGet(`/channels/${threadId}/messages/${threadId}`)
  if (direct.ok) return direct.data as DiscordMessage

  await delay(DISCORD_REQUEST_DELAY_MS)
  const fallback = await discordGet(`/channels/${threadId}/messages?limit=5&after=0`)
  if (!fallback.ok) return null
  const messages = fallback.data as DiscordMessage[]
  if (messages.length === 0) return null
  return messages.reduce((oldest, m) => (BigInt(m.id) < BigInt(oldest.id) ? m : oldest))
}

// --- Caches ---

interface DiscordUserCacheEntry {
  fetched_at: string
  username: string
}

interface DiscordThreadCacheEntry {
  fetched_at: string
  content: string
  embed_urls: string[]
}

function loadJsonCache<T>(path: string): Record<string, T> {
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8'))
    } catch (error) {
      console.warn(`⚠️  Could not parse existing cache at ${path}, starting fresh:`, error)
    }
  }
  return {}
}

function saveJsonCache<T>(path: string, cache: Record<string, T>): void {
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true })
  writeFileSync(path, JSON.stringify(cache, null, 2))
}

// --- Name normalization / matching ---

function normalizeGameName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^the /, '')
}

/** Strips bracketed suffixes (e.g. "[TempR]", marking a submission made on someone else's behalf). */
function stripBracketSuffix(name: string): string {
  return name.replace(/\[[^\]]*\]/g, ' ')
}

function namesMatch(threadName: string, ...candidates: (string | undefined)[]): boolean {
  const normalizedThread = normalizeGameName(threadName)
  if (!normalizedThread) return false

  for (const candidate of candidates) {
    if (!candidate) continue
    const normalizedCandidate = normalizeGameName(candidate)
    if (!normalizedCandidate) continue
    if (
      normalizedThread === normalizedCandidate ||
      normalizedThread.includes(normalizedCandidate) ||
      normalizedCandidate.includes(normalizedThread)
    ) {
      return true
    }
  }
  return false
}

// --- Link extraction from starter message content ---

const GIVEAWAY_LINK_RE = /giveaway\/([A-Za-z0-9]{5})\//g
const STORE_LINK_RE = /store\.steampowered\.com\/app\/(\d+)/g
const REVIEW_LINK_RE =
  /(https?:\/\/steamcommunity\.com\/(?:id\/[^/\s)>\]]+|profiles\/\d+)\/recommended\/(\d+))/g

interface ExtractedSignals {
  giveawayCodes: string[]
  storeAppIds: number[]
  reviewLinks: Array<{ appId: number; url: string }>
}

function extractSignals(content: string, embedUrls: string[]): ExtractedSignals {
  const text = `${content} ${embedUrls.join(' ')}`

  const giveawayCodes = [...text.matchAll(GIVEAWAY_LINK_RE)].map((m) => m[1])
  const storeAppIds = [...text.matchAll(STORE_LINK_RE)].map((m) => Number(m[1]))
  const reviewLinks = [...text.matchAll(REVIEW_LINK_RE)].map((m) => ({
    appId: Number(m[2]),
    url: m[1],
  }))

  return { giveawayCodes, storeAppIds, reviewLinks }
}

const DISCORD_EPOCH_MS = 1420070400000n

/** Derives a Discord snowflake's creation time (the thread's created-at). */
function snowflakeToIsoTimestamp(id: string): string {
  const timestampMs = (BigInt(id) >> 22n) + DISCORD_EPOCH_MS
  return new Date(Number(timestampMs)).toISOString()
}

// --- Matching ---

interface CandidateWin {
  link: string
  name: string
  giveawayName: string | undefined
  /** Whether this win already carries `i_played_bro` or `required_play`. */
  flagged: boolean
}

interface ThreadMatch {
  steamId: string
  link: string
  matchedBy: 'giveaway_link' | 'app_link' | 'review_link' | 'title' | 'app_link_unique' | 'title_unique'
  reviewUrl?: string
}

/** A win, together with the identity needed to search for it across every user. */
interface AllUsersWinRef {
  steamId: string
  link: string
  name: string
  giveawayName: string | undefined
}

/**
 * Cross-user last resort: same app/review-link signal as `matchThread`
 * steps 2/2b, but searched across every member and ex-member's wins
 * instead of just the thread owner's. Accepted only when exactly one win
 * anywhere matches — ambiguity is left unmatched rather than guessed at.
 */
function findAppLinkUniqueMatch(
  signals: ExtractedSignals,
  allWinRefs: AllUsersWinRef[],
  giveawayByLink: Map<string, Giveaway>,
): AllUsersWinRef | null {
  const appIds = new Set<number>([
    ...signals.storeAppIds,
    ...signals.reviewLinks.map((r) => r.appId),
  ])
  if (appIds.size === 0) return null

  const matches = allWinRefs.filter((w) => {
    const appId = giveawayByLink.get(w.link)?.app_id
    return appId != null && appIds.has(appId)
  })

  const uniqueKeys = new Set(matches.map((m) => `${m.steamId}::${m.link}`))
  return uniqueKeys.size === 1 ? matches[0] : null
}

/**
 * Cross-user last resort: same fuzzy title match as `matchThread` step 3,
 * but searched across every member and ex-member's wins instead of just
 * the thread owner's, with bracketed suffixes (e.g. "[TempR]", marking a
 * submission made on someone else's behalf) stripped first. Accepted only
 * when exactly one win anywhere matches.
 */
function findTitleUniqueMatch(
  threadName: string,
  allWinRefs: AllUsersWinRef[],
): AllUsersWinRef | null {
  const strippedName = stripBracketSuffix(threadName)
  const matches = allWinRefs.filter((w) => namesMatch(strippedName, w.name, w.giveawayName))

  const uniqueKeys = new Set(matches.map((m) => `${m.steamId}::${m.link}`))
  return uniqueKeys.size === 1 ? matches[0] : null
}

function matchThread(
  thread: DiscordThread,
  signals: ExtractedSignals,
  codeToWins: Map<string, Array<{ steamId: string; link: string }>>,
  ownerSteamId: string | undefined,
  ownerCandidateWins: CandidateWin[] | undefined,
  giveawayByLink: Map<string, Giveaway>,
): ThreadMatch[] {
  // 1. Giveaway link — exact, resolves the winner independent of the owner mapping.
  for (const code of signals.giveawayCodes) {
    const hits = codeToWins.get(code)
    if (hits && hits.length > 0) {
      return hits.map((h) => ({ steamId: h.steamId, link: h.link, matchedBy: 'giveaway_link' }))
    }
  }

  if (!ownerSteamId || !ownerCandidateWins) return []

  // 2. Steam review link (also carries a review_url worth recording).
  for (const review of signals.reviewLinks) {
    const win = ownerCandidateWins.find(
      (w) => giveawayByLink.get(w.link)?.app_id === review.appId,
    )
    if (win) {
      return [
        { steamId: ownerSteamId, link: win.link, matchedBy: 'review_link', reviewUrl: review.url },
      ]
    }
  }

  // 2b. Steam store link.
  for (const appId of signals.storeAppIds) {
    const win = ownerCandidateWins.find((w) => giveawayByLink.get(w.link)?.app_id === appId)
    if (win) return [{ steamId: ownerSteamId, link: win.link, matchedBy: 'app_link' }]
  }

  // 3. Title fuzzy match, last resort.
  const titleMatches = ownerCandidateWins.filter((w) =>
    namesMatch(thread.name, w.name, w.giveawayName),
  )
  if (titleMatches.length > 0) {
    return titleMatches.map((w) => ({ steamId: ownerSteamId, link: w.link, matchedBy: 'title' }))
  }

  return []
}

// --- Main pipeline ---

export async function generateIpbDiscordData(): Promise<void> {
  console.log('🚀 Starting I Play Bro Discord matching...')

  const giveawaysJson = JSON.parse(readFileSync(giveawaysPath, 'utf-8'))
  const giveaways: Giveaway[] = giveawaysJson.giveaways ?? []
  const giveawayByLink = new Map<string, Giveaway>()
  for (const g of giveaways) giveawayByLink.set(g.link, g)

  const groupUsersJson = JSON.parse(readFileSync(groupUsersPath, 'utf-8'))
  const exMembersJson = existsSync(exMembersPath)
    ? JSON.parse(readFileSync(exMembersPath, 'utf-8'))
    : { users: {} }

  const memberUsers: Record<string, User> = groupUsersJson.users ?? {}
  const exMemberUsers: Record<string, User> = exMembersJson.users ?? {}

  const discordMembersJson = JSON.parse(readFileSync(discordMembersPath, 'utf-8'))
  const handles: Record<string, string> = discordMembersJson.handles ?? {}

  // Discord username (lowercased) -> SG username.
  const discordUsernameToSgUsername = new Map<string, string>()
  for (const [sgUsername, discordHandle] of Object.entries(handles)) {
    discordUsernameToSgUsername.set(discordHandle.toLowerCase(), sgUsername)
  }

  // SG username -> steamId, checked in members first, then ex-members.
  const sgUsernameToSteamId = new Map<string, string>()
  for (const [steamId, user] of Object.entries(memberUsers)) {
    if (user.username) sgUsernameToSteamId.set(user.username, steamId)
  }
  for (const [steamId, user] of Object.entries(exMemberUsers)) {
    if (user.username && !sgUsernameToSteamId.has(user.username)) {
      sgUsernameToSteamId.set(user.username, steamId)
    }
  }

  // steamId -> candidate wins. All non-deleted wins are candidates: the
  // i_played_bro flag is set by a mod only after verifying, so a thread
  // matching an unflagged win is precisely a pending verification.
  const allUsers: Record<string, User> = { ...memberUsers, ...exMemberUsers }
  const candidateWinsBySteamId = new Map<string, CandidateWin[]>()
  for (const [steamId, user] of Object.entries(allUsers)) {
    const wins: CandidateWin[] = (user.giveaways_won ?? [])
      .filter((w) => !w.deleted)
      .map((w) => ({
        link: w.link,
        name: w.name,
        giveawayName: giveawayByLink.get(w.link)?.name,
        flagged: Boolean(w.required_play || w.i_played_bro),
      }))
    if (wins.length > 0) candidateWinsBySteamId.set(steamId, wins)
  }

  function findCandidateWin(steamId: string, link: string): CandidateWin | undefined {
    return candidateWinsBySteamId.get(steamId)?.find((w) => w.link === link)
  }

  // Flattened wins across every member and ex-member, for the last-resort
  // cross-user matching passes.
  const allWinRefs: AllUsersWinRef[] = []
  for (const [steamId, wins] of candidateWinsBySteamId) {
    for (const w of wins) {
      allWinRefs.push({ steamId, link: w.link, name: w.name, giveawayName: w.giveawayName })
    }
  }

  // giveaway code (first path segment of a win's link) -> owning wins.
  const codeToWins = new Map<string, Array<{ steamId: string; link: string }>>()
  for (const [steamId, wins] of candidateWinsBySteamId) {
    for (const w of wins) {
      const code = w.link.split('/')[0]
      const list = codeToWins.get(code) ?? []
      list.push({ steamId, link: w.link })
      codeToWins.set(code, list)
    }
  }

  // --- Fetch Discord threads ---
  console.log('📡 Fetching active threads...')
  const activeThreads = await fetchActiveIpbThreads()
  await delay(DISCORD_REQUEST_DELAY_MS)

  console.log('📡 Fetching archived threads...')
  const archivedThreads = await fetchArchivedIpbThreads()

  const allThreads = [...activeThreads, ...archivedThreads]
  console.log(
    `📥 Fetched ${allThreads.length} thread(s) (${activeThreads.length} active, ${archivedThreads.length} archived)`,
  )

  // --- Resolve owner usernames (cached) ---
  const usersCache = loadJsonCache<DiscordUserCacheEntry>(usersCachePath)
  const ownerIds = new Set(allThreads.map((t) => t.owner_id))
  let fetchedUsernames = 0

  for (const ownerId of ownerIds) {
    if (usersCache[ownerId]) continue
    const username = await fetchUsername(ownerId)
    if (username) {
      usersCache[ownerId] = { fetched_at: new Date().toISOString(), username }
      fetchedUsernames++
    }
    await delay(DISCORD_REQUEST_DELAY_MS)
  }
  saveJsonCache(usersCachePath, usersCache)
  console.log(`👤 Resolved ${ownerIds.size} distinct thread owner(s), ${fetchedUsernames} freshly fetched`)

  // --- Fetch starter messages (cached permanently — submissions don't change) ---
  const threadsCache = loadJsonCache<DiscordThreadCacheEntry>(threadsCachePath)
  let fetchedMessages = 0

  for (const thread of allThreads) {
    if (threadsCache[thread.id]) continue
    const message = await fetchStarterMessage(thread.id)
    threadsCache[thread.id] = {
      fetched_at: new Date().toISOString(),
      content: message?.content ?? '',
      embed_urls: (message?.embeds ?? []).map((e) => e.url).filter((u): u is string => !!u),
    }
    fetchedMessages++
    await delay(DISCORD_REQUEST_DELAY_MS)
  }
  saveJsonCache(threadsCachePath, threadsCache)
  console.log(`💬 Resolved ${allThreads.length} starter message(s), ${fetchedMessages} freshly fetched`)

  // --- Match threads to wins ---
  const unmatchedThreads: IpbDiscordUnmatchedThread[] = []
  const matchCountsByType: Record<ThreadMatch['matchedBy'], number> = {
    giveaway_link: 0,
    app_link: 0,
    review_link: 0,
    title: 0,
    app_link_unique: 0,
    title_unique: 0,
  }

  // Keep only the newest thread per (steamId, matched win link).
  const bestMatchForWin = new Map<
    string,
    { thread: DiscordThread; match: ThreadMatch; ownerDiscordName: string }
  >()

  for (const thread of allThreads) {
    if (EXCLUDED_THREAD_IDS.has(thread.id)) continue
    const url = `https://discord.com/channels/${GUILD_ID}/${thread.id}`
    const ownerUsername = usersCache[thread.owner_id]?.username

    const sgUsername = ownerUsername
      ? discordUsernameToSgUsername.get(ownerUsername.toLowerCase())
      : undefined
    const ownerSteamId = sgUsername ? sgUsernameToSteamId.get(sgUsername) : undefined
    const ownerCandidateWins = ownerSteamId ? candidateWinsBySteamId.get(ownerSteamId) : undefined

    const cached = threadsCache[thread.id]
    const signals = extractSignals(cached?.content ?? '', cached?.embed_urls ?? [])

    let matches = matchThread(
      thread,
      signals,
      codeToWins,
      ownerSteamId,
      ownerCandidateWins,
      giveawayByLink,
    )

    // Last resort: some threads are submitted on behalf of someone other
    // than the thread owner, so the owner mapping above never applies.
    // Search across every member and ex-member's wins instead, accepting
    // only an unambiguous (exactly one) match.
    if (matches.length === 0) {
      const appLinkMatch = findAppLinkUniqueMatch(signals, allWinRefs, giveawayByLink)
      if (appLinkMatch) {
        matches = [
          { steamId: appLinkMatch.steamId, link: appLinkMatch.link, matchedBy: 'app_link_unique' },
        ]
      } else {
        const titleMatch = findTitleUniqueMatch(thread.name, allWinRefs)
        if (titleMatch) {
          matches = [
            { steamId: titleMatch.steamId, link: titleMatch.link, matchedBy: 'title_unique' },
          ]
        }
      }
    }

    if (matches.length === 0) {
      unmatchedThreads.push({
        thread_id: thread.id,
        name: thread.name,
        url,
        owner_discord_name: ownerUsername ?? thread.owner_id,
      })
      continue
    }

    for (const match of matches) {
      matchCountsByType[match.matchedBy]++
      const key = `${match.steamId}::${match.link}`
      const existing = bestMatchForWin.get(key)
      if (!existing || BigInt(thread.id) > BigInt(existing.thread.id)) {
        bestMatchForWin.set(key, {
          thread,
          match,
          ownerDiscordName: ownerUsername ?? thread.owner_id,
        })
      }
    }
  }

  const wins: Record<string, IpbDiscordWinEntry> = {}
  for (const [key, { thread, match, ownerDiscordName }] of bestMatchForWin) {
    wins[key] = {
      thread_id: thread.id,
      url: `https://discord.com/channels/${GUILD_ID}/${thread.id}`,
      thread_name: thread.name,
      matched_by: match.matchedBy,
      ...(match.reviewUrl ? { review_url: match.reviewUrl } : {}),
      owner_discord_name: ownerDiscordName,
      thread_created_at: snowflakeToIsoTimestamp(thread.id),
      win_flagged: findCandidateWin(match.steamId, match.link)?.flagged ?? false,
    }
  }

  const output: IpbDiscordData = {
    last_updated: new Date().toISOString(),
    wins,
    unmatched_threads: unmatchedThreads,
  }

  writeFileSync(outputPath, JSON.stringify(output, null, 2))

  console.log(
    `✅ Done — ${allThreads.length} threads fetched, ${Object.keys(wins).length} wins matched, ${unmatchedThreads.length} unmatched threads`,
  )
  console.log(
    `   matched_by breakdown — giveaway_link: ${matchCountsByType.giveaway_link}, app_link: ${matchCountsByType.app_link}, review_link: ${matchCountsByType.review_link}, title: ${matchCountsByType.title}, app_link_unique: ${matchCountsByType.app_link_unique}, title_unique: ${matchCountsByType.title_unique}`,
  )
  console.log(`💾 Saved to ${outputPath}`)
}

if (
  import.meta.url.startsWith('file:') &&
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  await generateIpbDiscordData()
}
