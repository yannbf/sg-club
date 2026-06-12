import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'

/**
 * Generates the data files that power the gaming-challenge leaderboards under
 * /events. Every challenge lives in ONE file, public/data/challenge_<slug>.json,
 * holding the event info, the leaderboard (`participants`) and, for roster-based
 * challenges, the fixed `roster` + the `nonParticipants` who played anyway.
 *
 * Challenges are declared in the CHALLENGES registry below. There are two kinds:
 *
 *  - **achievement** (e.g. Gaming Challenge #1 — Backpack Hero): a single winning
 *    achievement; the FIRST member to unlock it during the window wins. Uses a
 *    fixed `roster` (participants + guests) preserved in the data file.
 *
 *  - **completion** (e.g. Gaming Challenge #2 — Kill The Crows): win by reaching
 *    100% of the game's achievements (whenever — pre-challenge completions count)
 *    AND logging over `minPlaytimeMinutes` of play during the challenge window.
 *    EVERY participant who qualifies wins; there can be many.
 *
 * Either kind can use a `fixed` roster (sign-up list kept in the data file) or
 * be `open` to every group member who owns the game — see ChallengeConfig.
 *
 * Challenge-window playtime is `current_total − baseline`, where the baseline is
 * seeded on the first run to `playtime_forever − playtime_2weeks` (i.e. play
 * before the recent window) and then frozen, so the figure is meaningful
 * immediately and grows correctly on later runs. Achievement timing uses each
 * achievement's `unlocktime`; for completion challenges total achievements count
 * regardless of when they were unlocked.
 *
 * Re-run regularly with: pnpm --filter scraper challenge
 * Generates every registered challenge by default; pass a data-slug
 * (CHALLENGE=kill_the_crows or `… challenge kill_the_crows`) to run just one.
 */

const currentDir = dirname(fileURLToPath(import.meta.url))
const rootEnvPath = resolve(currentDir, '../../../../.env')
loadEnv({ path: existsSync(rootEnvPath) ? rootEnvPath : undefined })

const API_KEY = process.env.STEAM_API_KEY
if (!API_KEY) {
  console.error('❌ STEAM_API_KEY not set')
  process.exit(1)
}

const BASE = 'https://api.steampowered.com'

const dataDir = resolve(currentDir, '../../../website/public/data')
const usersPath = resolve(dataDir, 'group_users.json')
const legacyParticipantsPath = resolve(dataDir, 'challenge_participants.json')

type RosterEntry =
  | string
  | { steam_id?: string; username?: string; displayName?: string }

interface MilestoneConfig {
  apiname: string
  label: string
  /** Items required to reach this milestone (e.g. 200/400/700). */
  items: number
}

/** First member to unlock a single winning achievement wins. */
interface AchievementWin {
  type: 'achievement'
  apiname: string
  displayName: string
  description: string
  iconUrl?: string
  /** Optional progression shown on each row (e.g. Discoverer → Expert → Hero). */
  milestones?: MilestoneConfig[]
}

/**
 * Everyone who reaches 100% of the achievements (whenever — pre-challenge
 * completions count too) AND logs more than `minPlaytimeMinutes` of play during
 * the challenge window wins.
 */
interface CompletionWin {
  type: 'completion'
  /** Unix seconds — the end of the challenge window (exclusive). */
  deadline: number
  /** Minutes of challenge-window playtime required to win (default 0). */
  minPlaytimeMinutes?: number
}

interface ChallengeConfig {
  /** Stored in the output `slug` field; mirrors the event URL slug. */
  slug: string
  /** Short data-file slug → public/data/challenge_<dataSlug>.json. */
  dataSlug: string
  appId: number
  gameName: string
  startTimestamp: number
  /**
   * `fixed`: only the in-file `roster` (participants + guests) competes; other
   * members who own & played are surfaced as `nonParticipants`.
   * `open`: every group member who owns the game competes; no roster, no
   * `nonParticipants`.
   */
  roster: 'fixed' | 'open'
  win: AchievementWin | CompletionWin
}

/**
 * The challenge registry. Add a challenge here, create its event entry in
 * packages/website/src/lib/events.ts, and wire the data file into CI.
 */
const CHALLENGES: ChallengeConfig[] = [
  {
    slug: 'gaming-challenge-1-backpack-hero',
    dataSlug: 'backpack_hero',
    appId: 1970580,
    gameName: 'Backpack Hero',
    startTimestamp: Date.UTC(2026, 5, 8) / 1000, // midnight 2026-06-08 UTC
    roster: 'fixed',
    win: {
      type: 'achievement',
      apiname: 'ItemHero',
      displayName: 'Hero',
      description: 'Discover at least 700 items',
      iconUrl:
        'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/1970580/8a4c1ba13e41f1cadff981bfefe467cae6baa6d3.jpg',
      // The item-discovery progression toward the win condition (Hero = 700).
      milestones: [
        { apiname: 'ItemDiscoverer', label: 'Discoverer', items: 200 },
        { apiname: 'ItemExpert', label: 'Expert', items: 400 },
        { apiname: 'ItemHero', label: 'Hero', items: 700 },
      ],
    },
  },
  {
    slug: 'gaming-challenge-2-kill-the-crows',
    dataSlug: 'kill_the_crows',
    appId: 2441270,
    gameName: 'Kill The Crows',
    startTimestamp: Date.UTC(2026, 5, 11) / 1000, // midnight 2026-06-11 UTC
    roster: 'fixed',
    win: {
      type: 'completion',
      // Challenge window ends 30 June (deadline = July 1 00:00 UTC).
      deadline: Date.UTC(2026, 6, 1) / 1000,
      // Winners must also log over 2h of play during the window.
      minPlaytimeMinutes: 120,
    },
  },
]

interface Member {
  username: string
  steam_id: string
  avatar_url?: string
  steam_profile_url?: string | null
}

interface UnlockedAchievement {
  apiname: string
  displayName: string
  description?: string
  unlocktime: number
}

interface ResolvedParticipant {
  steam_id: string
  display_name: string
  sg_username: string | null
  avatar_url: string
  profile_url: string | null
  is_guest: boolean
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function getGameSchema(
  appId: number,
): Promise<Record<string, { displayName: string; description?: string }>> {
  const url = `${BASE}/ISteamUserStats/GetSchemaForGame/v2/?key=${API_KEY}&appid=${appId}&format=json`
  const map: Record<string, { displayName: string; description?: string }> = {}
  try {
    const data = await getJson(url)
    for (const a of data.game?.availableGameStats?.achievements ?? []) {
      map[a.name] = {
        displayName: a.displayName || a.name,
        description: a.description,
      }
    }
  } catch (e) {
    console.warn('⚠️  Could not fetch game schema:', String(e))
  }
  return map
}

async function getPlayerSummary(
  steamId: string,
): Promise<{ name: string; avatar: string; profile: string } | null> {
  const url = `${BASE}/ISteamUser/GetPlayerSummaries/v0002/?key=${API_KEY}&steamids=${steamId}`
  try {
    const data = await getJson(url)
    const p = data.response?.players?.[0]
    if (!p) return null
    return {
      name: p.personaname ?? steamId,
      avatar: p.avatarfull ?? '',
      profile: p.profileurl ?? `https://steamcommunity.com/profiles/${steamId}`,
    }
  } catch {
    return null
  }
}

async function getOwnedGame(
  steamId: string,
  appId: number,
): Promise<{ owned: boolean; total: number; twoWeeks: number }> {
  const url = `${BASE}/IPlayerService/GetOwnedGames/v0001/?key=${API_KEY}&steamid=${steamId}&format=json&include_appinfo=0&include_played_free_games=1`
  try {
    const data = await getJson(url)
    const resp = data.response ?? {}
    const game = (resp.games ?? []).find((g: any) => g.appid === appId)
    if (!game) return { owned: false, total: 0, twoWeeks: 0 }
    return {
      owned: true,
      total: game.playtime_forever ?? 0,
      twoWeeks: game.playtime_2weeks ?? 0,
    }
  } catch {
    return { owned: false, total: 0, twoWeeks: 0 }
  }
}

async function getAchievements(
  steamId: string,
  appId: number,
): Promise<{ achieved: { apiname: string; unlocktime: number }[]; total: number } | null> {
  const url = `${BASE}/ISteamUserStats/GetPlayerAchievements/v0001/?appid=${appId}&key=${API_KEY}&steamid=${steamId}&format=json`
  try {
    const data = await getJson(url)
    const ps = data.playerstats ?? {}
    if (!ps.success) return null
    const list = ps.achievements ?? []
    return {
      achieved: list
        .filter((a: any) => a.achieved === 1)
        .map((a: any) => ({ apiname: a.apiname, unlocktime: a.unlocktime })),
      total: list.length,
    }
  } catch {
    return null
  }
}

/** Generic per-player view: ownership, playtime, and achievement progress. */
async function fetchPlayer(
  steamId: string,
  config: ChallengeConfig,
  schema: Record<string, { displayName: string; description?: string }>,
  schemaTotal: number,
) {
  const start = config.startTimestamp
  const game = await getOwnedGame(steamId, config.appId)
  const ach = game.owned ? await getAchievements(steamId, config.appId) : null
  const achieved = ach?.achieved ?? []

  const challengeAch: UnlockedAchievement[] = achieved
    .filter((a) => a.unlocktime >= start)
    .map((a) => ({
      apiname: a.apiname,
      displayName: schema[a.apiname]?.displayName ?? a.apiname,
      description: schema[a.apiname]?.description,
      unlocktime: a.unlocktime,
    }))
    .sort((a, b) => a.unlocktime - b.unlocktime)

  // Achievements unlocked *before* the challenge, with a reliable timestamp,
  // form the baseline. Anything the account has beyond that count — post-start
  // unlocks AND unlocks that synced without a usable unlocktime (e.g. earned in
  // Steam Deck offline mode) — is treated as challenge progress. This keeps an
  // actively-playing member from being shown as "yet to start" when Steam hands
  // us achievements with a missing/zero unlock time.
  const baselineAchievements = achieved.filter(
    (a) => a.unlocktime > 0 && a.unlocktime < start,
  ).length

  const unlockedTotal = achieved.length
  const achievementsTotal = ach?.total || schemaTotal

  return {
    game,
    achieved,
    stats_available: ach !== null,
    achievements_total: achievementsTotal,
    achievements_unlocked_total: unlockedTotal,
    achievements_before_challenge: baselineAchievements,
    challenge_achievements: challengeAch,
    challenge_achievement_count: challengeAch.length,
  }
}

type PlayerProgress = Awaited<ReturnType<typeof fetchPlayer>>

/** Achievement-challenge win view (Hero + item-discovery milestones). */
function achievementWinFields(p: PlayerProgress, config: ChallengeConfig) {
  const win = config.win as AchievementWin
  const start = config.startTimestamp
  const heroEntry = p.achieved.find((a) => a.apiname === win.apiname)
  const hadHeroBefore = Boolean(
    heroEntry && heroEntry.unlocktime > 0 && heroEntry.unlocktime < start,
  )
  const heroDuring = p.challenge_achievements.find(
    (a) => a.apiname === win.apiname,
  )

  // Item counts are account-cumulative, so report each milestone's current
  // unlock status rather than filtering by the challenge window.
  const milestones = (win.milestones ?? []).map((m) => {
    const entry = p.achieved.find((a) => a.apiname === m.apiname)
    return {
      apiname: m.apiname,
      label: m.label,
      items: m.items,
      unlocked: Boolean(entry),
      unlocktime: entry?.unlocktime ?? null,
    }
  })

  return {
    milestones,
    had_hero_before: hadHeroBefore,
    has_hero: Boolean(heroDuring),
    hero_unlocktime: heroDuring?.unlocktime ?? null,
  }
}

/**
 * Completion-challenge win view. A winner has BOTH: 100% of the achievements
 * (whenever reached — pre-challenge completions count) AND more than the
 * required playtime logged during the challenge window.
 */
function completionWinFields(
  p: PlayerProgress,
  config: ChallengeConfig,
  playtimeChallengeMinutes: number,
) {
  const win = config.win as CompletionWin
  const start = config.startTimestamp
  const minPlaytime = win.minPlaytimeMinutes ?? 0
  const isComplete =
    p.stats_available &&
    p.achievements_total > 0 &&
    p.achievements_unlocked_total >= p.achievements_total
  // The 100% moment is when the final achievement unlocked = the latest
  // unlocktime across the account's unlocks.
  const lastUnlock = p.achieved.reduce(
    (max, a) => (a.unlocktime > max ? a.unlocktime : max),
    0,
  )
  const completedAt = isComplete && lastUnlock > 0 ? lastUnlock : null
  const completedBeforeStart = Boolean(
    isComplete && completedAt != null && completedAt < start,
  )
  const meetsPlaytime = playtimeChallengeMinutes > minPlaytime
  const isWinner = isComplete && meetsPlaytime

  return {
    is_complete: isComplete,
    completed_at: completedAt,
    completed_before_start: completedBeforeStart,
    meets_playtime: meetsPlaytime,
    is_winner: isWinner,
  }
}

/** Resolve a fixed roster (participants + guests) to concrete steam identities. */
async function resolveFixedRoster(
  roster: { participants: RosterEntry[]; guests: RosterEntry[] },
  bySteamId: Map<string, Member>,
  byUsername: Map<string, Member>,
): Promise<ResolvedParticipant[]> {
  const rawEntries: RosterEntry[] = [
    ...(roster.participants ?? []),
    ...(roster.guests ?? []),
  ]
  const resolved: ResolvedParticipant[] = []
  const seen = new Set<string>()
  for (const entry of rawEntries) {
    let steamId: string | undefined
    let displayName: string | undefined
    let usernameHint: string | undefined

    if (typeof entry === 'string') {
      usernameHint = entry
      steamId = byUsername.get(entry.toLowerCase())?.steam_id
    } else {
      steamId = entry.steam_id
      displayName = entry.displayName
      usernameHint = entry.username
      if (!steamId && entry.username)
        steamId = byUsername.get(entry.username.toLowerCase())?.steam_id
    }

    if (!steamId) {
      console.warn(
        `⚠️  Could not resolve participant "${usernameHint ?? JSON.stringify(entry)}" — skipping`,
      )
      continue
    }
    if (seen.has(steamId)) continue
    seen.add(steamId)

    const member = bySteamId.get(steamId)
    if (member) {
      resolved.push({
        steam_id: steamId,
        display_name: displayName ?? member.username,
        sg_username: member.username,
        avatar_url: member.avatar_url ?? '',
        profile_url:
          member.steam_profile_url ??
          `https://steamcommunity.com/profiles/${steamId}`,
        is_guest: false,
      })
    } else {
      const summary = await getPlayerSummary(steamId)
      resolved.push({
        steam_id: steamId,
        display_name: displayName ?? summary?.name ?? steamId,
        sg_username: null,
        avatar_url: summary?.avatar ?? '',
        profile_url:
          summary?.profile ?? `https://steamcommunity.com/profiles/${steamId}`,
        is_guest: true,
      })
    }
  }
  return resolved
}

async function generateChallenge(config: ChallengeConfig): Promise<void> {
  const outPath = resolve(dataDir, `challenge_${config.dataSlug}.json`)
  console.log(
    `\n🏆 Generating "${config.gameName}" (app ${config.appId}, ${config.win.type})`,
  )
  console.log(`   Start: ${new Date(config.startTimestamp * 1000).toISOString()}`)
  if (config.win.type === 'completion')
    console.log(
      `   Deadline: ${new Date(config.win.deadline * 1000).toISOString()}`,
    )

  const usersJson = JSON.parse(readFileSync(usersPath, 'utf-8'))
  const members: Member[] = Object.values(usersJson.users)
  const bySteamId = new Map(members.map((m) => [m.steam_id, m]))
  const byUsername = new Map(members.map((m) => [m.username.toLowerCase(), m]))

  // Read the prior file for the frozen baselines (and, for fixed rosters, the
  // roster itself), then write it all back.
  let prior: any = null
  if (existsSync(outPath)) {
    try {
      prior = JSON.parse(readFileSync(outPath, 'utf-8'))
    } catch {
      /* ignore corrupt prior file */
    }
  }

  const priorBaselines = new Map<string, number>()
  for (const p of prior?.participants ?? []) {
    if (typeof p.baseline_playtime_minutes === 'number')
      priorBaselines.set(p.steam_id, p.baseline_playtime_minutes)
  }

  // --- Resolve who competes ---
  let roster: { participants: RosterEntry[]; guests: RosterEntry[] } | null = null
  let resolved: ResolvedParticipant[]
  if (config.roster === 'fixed') {
    roster = prior?.roster ?? null
    if (!roster && existsSync(legacyParticipantsPath)) {
      const legacy = JSON.parse(readFileSync(legacyParticipantsPath, 'utf-8'))
      roster = { participants: legacy.participants ?? [], guests: legacy.guests ?? [] }
      console.log('   Migrated roster from legacy challenge_participants.json')
    }
    if (!roster) {
      console.error(
        `❌ No roster found. Add a "roster": { "participants": [...], "guests": [...] } block to ${outPath}`,
      )
      return
    }
    resolved = await resolveFixedRoster(roster, bySteamId, byUsername)
  } else {
    // Open challenge: every group member is a candidate; non-owners are dropped
    // after the ownership fetch below.
    resolved = members.map((m) => ({
      steam_id: m.steam_id,
      display_name: m.username,
      sg_username: m.username,
      avatar_url: m.avatar_url ?? '',
      profile_url:
        m.steam_profile_url ?? `https://steamcommunity.com/profiles/${m.steam_id}`,
      is_guest: false,
    }))
  }

  const schema = await getGameSchema(config.appId)
  const schemaTotal = Object.keys(schema).length || 0
  const rosterIds = new Set(resolved.map((r) => r.steam_id))

  // --- Participants ---
  const participants = []
  let i = 0
  for (const r of resolved) {
    i++
    process.stderr.write(
      `\r   roster [${i}/${resolved.length}] ${r.display_name.padEnd(22)}`,
    )
    const p = await fetchPlayer(r.steam_id, config, schema, schemaTotal)
    // In an open challenge you can only compete if you own the game.
    if (config.roster === 'open' && !p.game.owned) continue

    const baseline = priorBaselines.has(r.steam_id)
      ? priorBaselines.get(r.steam_id)!
      : Math.max(0, p.game.total - p.game.twoWeeks) // seed: play before the recent window

    const playtimeChallengeMinutes = Math.max(0, p.game.total - baseline)
    const achievementsSinceBaseline = Math.max(
      0,
      p.achievements_unlocked_total - p.achievements_before_challenge,
    )
    // "Started" depends on the challenge kind:
    //  - completion (cumulative race toward 100%): any achievements OR playtime
    //    at all, since progress made before the start still counts toward the
    //    win condition.
    //  - achievement (clean slate): only progress made since the start.
    const hasStarted =
      config.win.type === 'completion'
        ? p.achievements_unlocked_total > 0 || p.game.total > 0
        : playtimeChallengeMinutes > 0 || achievementsSinceBaseline > 0

    const winFields =
      config.win.type === 'achievement'
        ? achievementWinFields(p, config)
        : completionWinFields(p, config, playtimeChallengeMinutes)

    participants.push({
      username: r.display_name,
      sg_username: r.sg_username,
      steam_id: r.steam_id,
      avatar_url: r.avatar_url,
      profile_url: r.profile_url,
      is_guest: r.is_guest,
      owned: p.game.owned,
      stats_available: p.stats_available,
      playtime_total_minutes: p.game.total,
      playtime_2weeks_minutes: p.game.twoWeeks,
      baseline_playtime_minutes: baseline,
      playtime_challenge_minutes: playtimeChallengeMinutes,
      achievements_total: p.achievements_total,
      achievements_unlocked_total: p.achievements_unlocked_total,
      achievements_before_challenge: p.achievements_before_challenge,
      achievements_since_baseline: achievementsSinceBaseline,
      challenge_achievements: p.challenge_achievements,
      challenge_achievement_count: p.challenge_achievement_count,
      has_started: hasStarted,
      ...winFields,
    })
  }
  process.stderr.write('\n')

  // --- Non-participants who own and have played (fixed rosters only) ---
  const nonParticipants = []
  if (config.roster === 'fixed') {
    const others = members.filter((m) => !rosterIds.has(m.steam_id))
    let j = 0
    for (const m of others) {
      j++
      process.stderr.write(
        `\r   others [${j}/${others.length}] ${m.username.padEnd(22)}`,
      )
      const p = await fetchPlayer(m.steam_id, config, schema, schemaTotal)
      if (!p.game.owned || p.game.total <= 0) continue // only those who actually played
      nonParticipants.push({
        username: m.username,
        steam_id: m.steam_id,
        avatar_url: m.avatar_url ?? '',
        profile_url:
          m.steam_profile_url ??
          `https://steamcommunity.com/profiles/${m.steam_id}`,
        playtime_total_minutes: p.game.total,
        playtime_2weeks_minutes: p.game.twoWeeks,
        achievements_unlocked_total: p.achievements_unlocked_total,
        achievements_total: p.achievements_total,
        challenge_achievement_count: p.challenge_achievement_count,
      })
    }
    process.stderr.write('\n')
    nonParticipants.sort(
      (a, b) =>
        b.achievements_unlocked_total - a.achievements_unlocked_total ||
        b.playtime_total_minutes - a.playtime_total_minutes,
    )
  }

  // --- Winners ---
  let winners: typeof participants
  if (config.win.type === 'achievement') {
    // FIRST roster member to unlock the winning achievement during the window.
    // Once decided it's locked — later achievers don't become winners.
    const achievers = participants
      .filter((p) => p.has_hero && p.hero_unlocktime != null)
      .sort((a, b) => (a.hero_unlocktime ?? 0) - (b.hero_unlocktime ?? 0))
    const winner = achievers[0] ?? null
    for (const p of participants)
      p.is_winner = winner ? p.steam_id === winner.steam_id : false
    winners = winner ? [winner] : []
  } else {
    // EVERY member who qualified (100% + enough challenge-window play), ordered
    // by when they reached 100% (members with no usable 100% timestamp last).
    winners = participants
      .filter((p) => p.is_winner)
      .sort(
        (a, b) =>
          (a.completed_at ?? Number.POSITIVE_INFINITY) -
          (b.completed_at ?? Number.POSITIVE_INFINITY),
      )
  }

  // --- Leaderboard order ---
  if (config.win.type === 'achievement') {
    // Winner pinned to #1; everyone else by challenge achievements, then
    // challenge playtime, then total completion.
    participants.sort((a, b) => {
      const aw = a.is_winner ? 1 : 0
      const bw = b.is_winner ? 1 : 0
      if (aw !== bw) return bw - aw
      if (b.challenge_achievement_count !== a.challenge_achievement_count)
        return b.challenge_achievement_count - a.challenge_achievement_count
      if (b.playtime_challenge_minutes !== a.playtime_challenge_minutes)
        return b.playtime_challenge_minutes - a.playtime_challenge_minutes
      return b.achievements_unlocked_total - a.achievements_unlocked_total
    })
  } else {
    // Winners (100% + enough challenge play) first, earliest finisher #1. Then
    // members who actually engaged with the challenge (played or unlocked
    // something during the window) rank above those who didn't — so a longtime
    // owner sitting on lots of pre-challenge achievements but no challenge-window
    // play sinks to the bottom, alongside the people who never started. Within
    // each group: closeness to 100%, then challenge-window playtime.
    const engaged = (x: (typeof participants)[number]) =>
      x.playtime_challenge_minutes > 0 ||
      (x.achievements_since_baseline ?? 0) > 0
    participants.sort((a, b) => {
      const aw = a.is_winner ? 1 : 0
      const bw = b.is_winner ? 1 : 0
      if (aw !== bw) return bw - aw
      if (aw && bw)
        return (
          (a.completed_at ?? Number.POSITIVE_INFINITY) -
          (b.completed_at ?? Number.POSITIVE_INFINITY)
        )
      const ae = engaged(a) ? 1 : 0
      const be = engaged(b) ? 1 : 0
      if (ae !== be) return be - ae
      if (b.achievements_unlocked_total !== a.achievements_unlocked_total)
        return b.achievements_unlocked_total - a.achievements_unlocked_total
      if (b.playtime_challenge_minutes !== a.playtime_challenge_minutes)
        return b.playtime_challenge_minutes - a.playtime_challenge_minutes
      return b.playtime_total_minutes - a.playtime_total_minutes
    })
  }

  const firstWinner = winners[0] ?? null
  const output: Record<string, unknown> = {
    slug: config.slug,
    appId: config.appId,
    gameName: config.gameName,
    winType: config.win.type,
    startTimestamp: config.startTimestamp,
    totalAchievements: schemaTotal || (prior?.totalAchievements ?? 0),
    generatedAt: Date.now(),
    winnerUsername: firstWinner?.username ?? null,
    participants,
    nonParticipants,
  }

  if (config.win.type === 'achievement') {
    const win = config.win
    output.heroAchievement = {
      apiname: win.apiname,
      displayName: schema[win.apiname]?.displayName ?? win.displayName,
      description: schema[win.apiname]?.description ?? win.description,
      iconUrl: win.iconUrl,
    }
    output.winnerUnlocktime =
      (firstWinner as { hero_unlocktime?: number | null })?.hero_unlocktime ?? null
  } else {
    output.deadline = config.win.deadline
    output.minPlaytimeMinutes = config.win.minPlaytimeMinutes ?? 0
    output.winnerUnlocktime =
      (firstWinner as { completed_at?: number | null })?.completed_at ?? null
    output.winnerUsernames = winners.map((w) => w.username)
  }

  // Preserve the roster in-file so it's the single source of truth.
  if (config.roster === 'fixed') output.roster = roster

  writeFileSync(outPath, JSON.stringify(output, null, 2))
  const winnerNote =
    config.win.type === 'achievement'
      ? firstWinner
        ? ` — 🥇 winner: ${firstWinner.username}`
        : ' — no winner yet'
      : winners.length
        ? ` — 🏅 ${winners.length} qualified: ${winners.map((w) => w.username).join(', ')}`
        : ' — no qualifiers yet'
  console.log(
    `✅ Wrote ${participants.length} participant(s)` +
      (nonParticipants.length
        ? ` + ${nonParticipants.length} non-participant(s)`
        : '') +
      ` to ${outPath}${winnerNote}`,
  )
}

async function main(): Promise<void> {
  // Optional filter: `CHALLENGE=kill_the_crows` env or first CLI arg. Matches a
  // challenge's dataSlug or slug. With no filter, generate every challenge.
  const filter = (process.env.CHALLENGE || process.argv[2] || '').trim()
  const targets = filter
    ? CHALLENGES.filter(
        (c) => c.dataSlug === filter || c.slug === filter,
      )
    : CHALLENGES
  if (filter && targets.length === 0) {
    console.error(
      `❌ No challenge matches "${filter}". Known: ${CHALLENGES.map((c) => c.dataSlug).join(', ')}`,
    )
    process.exit(1)
  }
  for (const config of targets) await generateChallenge(config)
}

if (
  import.meta.url.startsWith('file:') &&
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  await main()
}
