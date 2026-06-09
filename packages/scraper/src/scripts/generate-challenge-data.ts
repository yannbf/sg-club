import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'

/**
 * Generates the data file that powers the "Gaming Challenge #1 — Backpack Hero"
 * leaderboard at /events/gaming-challenge-1-backpack-hero.
 *
 * Everything lives in ONE file, public/data/challenge_backpack_hero.json:
 *   - `roster`: the fixed list of { participants, guests } that compete.
 *   - event info (slug, appId, heroAchievement, startTimestamp, …).
 *   - the generated leaderboard (`participants`) and `nonParticipants`.
 * Edit `roster` in that file and re-run to change who competes. Members who own
 * and have played the game but aren't on the roster are surfaced compactly as
 * "non-participants who played".
 *
 * The challenge started at midnight (UTC) 2026-06-08. Only progress made after
 * that instant counts:
 *  - Achievements are filtered by their per-achievement `unlocktime` (precise).
 *  - Playtime is `current_total − baseline`, where the baseline is seeded on
 *    the first run to `playtime_forever − playtime_2weeks` (i.e. play before the
 *    recent window) and then frozen, so the challenge figure is meaningful
 *    immediately and grows correctly on later runs.
 *
 * The winner is whoever unlocks the "Hero" achievement (apiname `ItemHero`,
 * "Discover at least 700 items") during the challenge window.
 *
 * Re-run regularly with: pnpm --filter scraper challenge
 */

const currentDir = dirname(fileURLToPath(import.meta.url))
const rootEnvPath = resolve(currentDir, '../../../../.env')
loadEnv({ path: existsSync(rootEnvPath) ? rootEnvPath : undefined })

const API_KEY = process.env.STEAM_API_KEY
if (!API_KEY) {
  console.error('❌ STEAM_API_KEY not set')
  process.exit(1)
}

const APP_ID = 1970580
const GAME_NAME = 'Backpack Hero'
const HERO_APINAME = 'ItemHero'
// The item-discovery progression toward the win condition (Hero = 700 items).
const MILESTONES = [
  { apiname: 'ItemDiscoverer', label: 'Discoverer', items: 200 },
  { apiname: 'ItemExpert', label: 'Expert', items: 400 },
  { apiname: 'ItemHero', label: 'Hero', items: 700 },
] as const
const HERO_ICON_URL =
  'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/1970580/8a4c1ba13e41f1cadff981bfefe467cae6baa6d3.jpg'
const SLUG = 'gaming-challenge-1-backpack-hero'
const START_TIMESTAMP = Date.UTC(2026, 5, 8) / 1000 // midnight 2026-06-08 UTC

const BASE = 'https://api.steampowered.com'

const dataDir = resolve(currentDir, '../../../website/public/data')
const usersPath = resolve(dataDir, 'group_users.json')
const participantsPath = resolve(dataDir, 'challenge_participants.json')
const outPath = resolve(dataDir, 'challenge_backpack_hero.json')

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

async function getGameSchema(): Promise<
  Record<string, { displayName: string; description?: string }>
> {
  const url = `${BASE}/ISteamUserStats/GetSchemaForGame/v2/?key=${API_KEY}&appid=${APP_ID}&format=json`
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

async function getOwnedGame(steamId: string): Promise<{
  owned: boolean
  total: number
  twoWeeks: number
}> {
  const url = `${BASE}/IPlayerService/GetOwnedGames/v0001/?key=${API_KEY}&steamid=${steamId}&format=json&include_appinfo=0&include_played_free_games=1`
  try {
    const data = await getJson(url)
    const resp = data.response ?? {}
    const game = (resp.games ?? []).find((g: any) => g.appid === APP_ID)
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
): Promise<{ achieved: { apiname: string; unlocktime: number }[]; total: number } | null> {
  const url = `${BASE}/ISteamUserStats/GetPlayerAchievements/v0001/?appid=${APP_ID}&key=${API_KEY}&steamid=${steamId}&format=json`
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

/** Builds the achievement view (challenge subset + hero status) for a steam id. */
async function fetchProgress(
  steamId: string,
  schema: Record<string, { displayName: string; description?: string }>,
) {
  const game = await getOwnedGame(steamId)
  const ach = game.owned ? await getAchievements(steamId) : null

  const challengeAch: UnlockedAchievement[] = (ach?.achieved ?? [])
    .filter((a) => a.unlocktime >= START_TIMESTAMP)
    .map((a) => ({
      apiname: a.apiname,
      displayName: schema[a.apiname]?.displayName ?? a.apiname,
      description: schema[a.apiname]?.description,
      unlocktime: a.unlocktime,
    }))
    .sort((a, b) => a.unlocktime - b.unlocktime)

  const heroEntry = (ach?.achieved ?? []).find((a) => a.apiname === HERO_APINAME)
  const hadHeroBefore = Boolean(
    heroEntry && heroEntry.unlocktime > 0 && heroEntry.unlocktime < START_TIMESTAMP,
  )
  const heroDuring = challengeAch.find((a) => a.apiname === HERO_APINAME)

  // Item-discovery progression (Discoverer → Expert → Hero). Item counts are
  // account-cumulative, so we report each milestone's current unlock status.
  const milestones = MILESTONES.map((m) => {
    const entry = (ach?.achieved ?? []).find((a) => a.apiname === m.apiname)
    return {
      apiname: m.apiname,
      label: m.label,
      items: m.items,
      unlocked: Boolean(entry),
      unlocktime: entry?.unlocktime ?? null,
    }
  })

  // Achievements unlocked *before* the challenge, with a reliable timestamp,
  // form the baseline. Anything the account has beyond that count — post-start
  // unlocks AND unlocks that synced without a usable unlocktime (e.g. earned in
  // Steam Deck offline mode) — is treated as challenge progress. This is what
  // keeps an actively-playing member from being shown as "yet to start" when
  // Steam hands us achievements with a missing/zero unlock time.
  const baselineAchievements = (ach?.achieved ?? []).filter(
    (a) => a.unlocktime > 0 && a.unlocktime < START_TIMESTAMP,
  ).length

  return {
    game,
    stats_available: ach !== null,
    achievements_total: ach?.total ?? 35,
    achievements_unlocked_total: ach?.achieved.length ?? 0,
    achievements_before_challenge: baselineAchievements,
    challenge_achievements: challengeAch,
    challenge_achievement_count: challengeAch.length,
    milestones,
    had_hero_before: hadHeroBefore,
    has_hero: Boolean(heroDuring),
    hero_unlocktime: heroDuring?.unlocktime ?? null,
  }
}

async function main(): Promise<void> {
  console.log(`🏆 Generating challenge data for "${GAME_NAME}" (app ${APP_ID})`)
  console.log(`   Start: ${new Date(START_TIMESTAMP * 1000).toISOString()}`)

  const usersJson = JSON.parse(readFileSync(usersPath, 'utf-8'))
  const members: Member[] = Object.values(usersJson.users)
  const bySteamId = new Map(members.map((m) => [m.steam_id, m]))
  const byUsername = new Map(members.map((m) => [m.username.toLowerCase(), m]))

  // The single data file holds everything: the roster (participants + guests),
  // the event info, and the generated leaderboard. We read the prior file for
  // both the frozen baselines AND the roster, then write it all back.
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

  // Roster lives under `roster` in the data file. Fall back to the legacy
  // challenge_participants.json once, to migrate older setups.
  type RosterEntry = string | { steam_id?: string; username?: string; displayName?: string }
  let roster: { participants: RosterEntry[]; guests: RosterEntry[] } | null =
    prior?.roster ?? null
  if (!roster && existsSync(participantsPath)) {
    const legacy = JSON.parse(readFileSync(participantsPath, 'utf-8'))
    roster = { participants: legacy.participants ?? [], guests: legacy.guests ?? [] }
    console.log('   Migrated roster from legacy challenge_participants.json')
  }
  if (!roster) {
    console.error(
      `❌ No roster found. Add a "roster": { "participants": [...], "guests": [...] } block to ${outPath}`,
    )
    process.exit(1)
  }

  const rawEntries: RosterEntry[] = [
    ...(roster.participants ?? []),
    ...(roster.guests ?? []),
  ]

  // Resolve every roster entry to a concrete steam id + identity.
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
      console.warn(`⚠️  Could not resolve participant "${usernameHint ?? JSON.stringify(entry)}" — skipping`)
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
      // Guest: pull identity from Steam.
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

  console.log(`   ${resolved.length} participant(s) on the roster`)

  const schema = await getGameSchema()
  const rosterIds = new Set(resolved.map((r) => r.steam_id))

  // --- Participants ---
  const participants = []
  let i = 0
  for (const r of resolved) {
    i++
    process.stderr.write(`\r   roster [${i}/${resolved.length}] ${r.display_name.padEnd(22)}`)
    const p = await fetchProgress(r.steam_id, schema)
    const baseline = priorBaselines.has(r.steam_id)
      ? priorBaselines.get(r.steam_id)!
      : Math.max(0, p.game.total - p.game.twoWeeks) // seed: play before the recent window

    const playtimeChallengeMinutes = Math.max(0, p.game.total - baseline)
    // Achievements gained since the pre-challenge baseline (includes offline
    // unlocks with no usable unlocktime). A member has "started" if they've made
    // any progress — playtime OR achievements — so a player who's clearly
    // unlocking achievements isn't bucketed as "yet to start" just because their
    // playtime hasn't synced from Steam yet.
    const achievementsSinceBaseline = Math.max(
      0,
      p.achievements_unlocked_total - p.achievements_before_challenge,
    )
    const hasStarted =
      playtimeChallengeMinutes > 0 || achievementsSinceBaseline > 0

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
      milestones: p.milestones,
      had_hero_before: p.had_hero_before,
      has_hero: p.has_hero,
      hero_unlocktime: p.hero_unlocktime,
      is_winner: false,
    })
  }
  process.stderr.write('\n')

  // --- Non-participants who own and have played the game ---
  const nonParticipants = []
  let j = 0
  const others = members.filter((m) => !rosterIds.has(m.steam_id))
  for (const m of others) {
    j++
    process.stderr.write(`\r   others [${j}/${others.length}] ${m.username.padEnd(22)}`)
    const p = await fetchProgress(m.steam_id, schema)
    if (!p.game.owned || p.game.total <= 0) continue // only those who actually played
    nonParticipants.push({
      username: m.username,
      steam_id: m.steam_id,
      avatar_url: m.avatar_url ?? '',
      profile_url:
        m.steam_profile_url ?? `https://steamcommunity.com/profiles/${m.steam_id}`,
      playtime_total_minutes: p.game.total,
      playtime_2weeks_minutes: p.game.twoWeeks,
      achievements_unlocked_total: p.achievements_unlocked_total,
      achievements_total: p.achievements_total,
      challenge_achievement_count: p.challenge_achievement_count,
    })
  }
  process.stderr.write('\n')

  // Non-participants are sorted by achievements (most-complete first), then by
  // total playtime as a tiebreaker.
  nonParticipants.sort(
    (a, b) =>
      b.achievements_unlocked_total - a.achievements_unlocked_total ||
      b.playtime_total_minutes - a.playtime_total_minutes,
  )

  // The winner is the FIRST roster member to unlock the Hero achievement during
  // the challenge. Once decided it's locked — members who reach it later don't
  // become winners and don't get pinned to the top of the board.
  const heroAchievers = participants
    .filter((p) => p.has_hero && p.hero_unlocktime != null)
    .sort((a, b) => (a.hero_unlocktime ?? 0) - (b.hero_unlocktime ?? 0))
  const winner = heroAchievers[0] ?? null
  for (const p of participants) {
    ;(p as { is_winner?: boolean }).is_winner = winner
      ? p.steam_id === winner.steam_id
      : false
  }

  // Leaderboard order: the winner is pinned to #1; everyone else is ranked by
  // challenge achievements, then challenge playtime, then total completion.
  participants.sort((a, b) => {
    const aw = (a as { is_winner?: boolean }).is_winner ? 1 : 0
    const bw = (b as { is_winner?: boolean }).is_winner ? 1 : 0
    if (aw !== bw) return bw - aw
    if (b.challenge_achievement_count !== a.challenge_achievement_count)
      return b.challenge_achievement_count - a.challenge_achievement_count
    if (b.playtime_challenge_minutes !== a.playtime_challenge_minutes)
      return b.playtime_challenge_minutes - a.playtime_challenge_minutes
    return b.achievements_unlocked_total - a.achievements_unlocked_total
  })

  const output = {
    slug: SLUG,
    appId: APP_ID,
    gameName: GAME_NAME,
    heroAchievement: {
      apiname: HERO_APINAME,
      displayName: schema[HERO_APINAME]?.displayName ?? 'Hero',
      description:
        schema[HERO_APINAME]?.description ?? 'Discover at least 700 items',
      iconUrl: HERO_ICON_URL,
    },
    startTimestamp: START_TIMESTAMP,
    totalAchievements: Object.keys(schema).length || 35,
    // The roster config (participants + guests) is preserved in-file so this is
    // the single source of truth — edit it here and re-run.
    roster,
    generatedAt: Date.now(),
    winnerUsername: winner?.username ?? null,
    winnerUnlocktime: winner?.hero_unlocktime ?? null,
    participants,
    nonParticipants,
  }

  writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(
    `✅ Wrote ${participants.length} participant(s) + ${nonParticipants.length} non-participant(s) to ${outPath}` +
      (winner ? ` — 🥇 winner: ${winner.username}` : ' — no winner yet'),
  )
}

if (
  import.meta.url.startsWith('file:') &&
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  await main()
}
