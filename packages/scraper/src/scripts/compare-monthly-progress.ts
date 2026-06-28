/**
 * Monthly progress report — games completed & playtime accumulated in a period.
 *
 * Compares a BASELINE snapshot of group_users.json (captured at the start of the
 * period, e.g. the last commit of the previous month) against the CURRENT
 * group_users.json, and reports, per member and in totality:
 *
 *   • games COMPLETED during the period
 *   • playing HOURS accumulated during the period
 *   • which completions were 100%-achievement vs HLTB-time (or both)
 *
 * "Completed" means EITHER of:
 *   - 100% of the game's Steam achievements unlocked, OR
 *   - playtime ≥ the game's HowLongToBeat "main story" hours.
 *
 * A game counts as "completed in the period" when it is completed in the current
 * snapshot but was NOT completed in the baseline snapshot. Playtime accumulated
 * is the per-game delta (current − baseline), summed per member; games won during
 * the period (absent at baseline) contribute their full current playtime.
 *
 * The dataset is per-member WON giveaways (group_users.json → giveaways_won[] →
 * steam_play_data). HLTB hours come from game_data.json, matched by game name.
 *
 * Reusable: it's purely snapshot-vs-snapshot, so re-running on a later date with
 * the SAME baseline widens the window automatically. Capture a baseline with:
 *   git show <commit>:packages/website/public/data/group_users.json \
 *     > packages/scraper/snapshots/group_users_<YYYY-MM-DD>.json
 *
 * Run:
 *   pnpm --filter scraper monthly-progress
 * Override via env:
 *   BASELINE_SNAPSHOT=packages/scraper/snapshots/group_users_2026-05-31.json
 *   PERIOD_LABEL="June 1 – July 4, 2026"
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(currentDir, '../../../..')
const dataDir = resolve(repoRoot, 'packages/website/public/data')

const BASELINE_SNAPSHOT = resolve(
  repoRoot,
  process.env.BASELINE_SNAPSHOT ||
    'packages/scraper/snapshots/group_users_2026-05-31.json',
)
const PERIOD_LABEL = process.env.PERIOD_LABEL || 'June 1 – July 4, 2026'
const outDir = resolve(repoRoot, 'packages/scraper/data')

interface SteamPlayData {
  owned?: boolean
  playtime_minutes?: number
  achievements_unlocked?: number
  achievements_total?: number
  achievements_percentage?: number
}
interface WonGame {
  name: string
  steam_play_data?: SteamPlayData
}
interface User {
  username: string
  steam_id: string
  giveaways_won?: WonGame[]
}
interface GroupUsers {
  lastUpdated?: number
  users: Record<string, User>
}
interface GameData {
  name: string
  app_id: number
  hltb_main_story_hours?: number | null
}

const norm = (s: string): string =>
  (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

function loadUsers(path: string): GroupUsers {
  if (!existsSync(path)) {
    console.error(`❌ File not found: ${path}`)
    process.exit(1)
  }
  return JSON.parse(readFileSync(path, 'utf-8'))
}

/** HLTB main-story hours by normalized game name (0/undefined when unknown). */
function buildHltbMap(): Map<string, number> {
  const games: GameData[] = JSON.parse(
    readFileSync(resolve(dataDir, 'game_data.json'), 'utf-8'),
  )
  const map = new Map<string, number>()
  for (const g of games) {
    if (g.hltb_main_story_hours && g.hltb_main_story_hours > 0)
      map.set(norm(g.name), g.hltb_main_story_hours)
  }
  return map
}

const has100 = (p?: SteamPlayData): boolean =>
  !!p &&
  (p.achievements_total ?? 0) > 0 &&
  (p.achievements_unlocked ?? 0) >= (p.achievements_total ?? 0)

const meetsHltb = (p: SteamPlayData | undefined, hltbHours?: number): boolean =>
  !!p && !!hltbHours && (p.playtime_minutes ?? 0) >= hltbHours * 60

const isCompleted = (p?: SteamPlayData, hltbHours?: number): boolean =>
  has100(p) || meetsHltb(p, hltbHours)

interface CompletedGame {
  name: string
  via_achievements: boolean
  via_hltb: boolean
  achievements_unlocked: number
  achievements_total: number
  achievements_percentage: number
  playtime_minutes: number
  hltb_main_story_hours: number | null
}
interface UserReport {
  username: string
  steam_id: string
  games_completed_in_period: number
  hours_played_in_period: number
  completed_via_achievements: number
  completed_via_hltb_only: number
  completed_games: CompletedGame[]
}

function main(): void {
  const baseline = loadUsers(BASELINE_SNAPSHOT)
  const current = loadUsers(resolve(dataDir, 'group_users.json'))
  const hltb = buildHltbMap()

  // Baseline: per steam_id → (normalized game name → play data).
  const baselineBySteamId = new Map<string, Map<string, SteamPlayData>>()
  for (const u of Object.values(baseline.users)) {
    const m = new Map<string, SteamPlayData>()
    for (const w of u.giveaways_won ?? [])
      if (w.steam_play_data) m.set(norm(w.name), w.steam_play_data)
    baselineBySteamId.set(u.steam_id, m)
  }

  const reports: UserReport[] = []
  for (const u of Object.values(current.users)) {
    const base = baselineBySteamId.get(u.steam_id) ?? new Map()
    let hoursMinutes = 0
    const completed: CompletedGame[] = []

    for (const w of u.giveaways_won ?? []) {
      const cur = w.steam_play_data
      if (!cur) continue
      const key = norm(w.name)
      const hltbHours = hltb.get(key)
      const basePlay = base.get(key)

      // Playtime accumulated this period = per-game delta (≥ 0).
      const delta =
        (cur.playtime_minutes ?? 0) - (basePlay?.playtime_minutes ?? 0)
      if (delta > 0) hoursMinutes += delta

      // Completed in period = complete now, but not complete at baseline.
      const completedNow = isCompleted(cur, hltbHours)
      const completedBefore = isCompleted(basePlay, hltbHours)
      if (completedNow && !completedBefore) {
        completed.push({
          name: w.name,
          via_achievements: has100(cur),
          via_hltb: meetsHltb(cur, hltbHours),
          achievements_unlocked: cur.achievements_unlocked ?? 0,
          achievements_total: cur.achievements_total ?? 0,
          achievements_percentage: cur.achievements_percentage ?? 0,
          playtime_minutes: cur.playtime_minutes ?? 0,
          hltb_main_story_hours: hltbHours ?? null,
        })
      }
    }

    completed.sort((a, b) => b.playtime_minutes - a.playtime_minutes)
    reports.push({
      username: u.username,
      steam_id: u.steam_id,
      games_completed_in_period: completed.length,
      hours_played_in_period: Math.round((hoursMinutes / 60) * 10) / 10,
      completed_via_achievements: completed.filter((c) => c.via_achievements)
        .length,
      completed_via_hltb_only: completed.filter(
        (c) => c.via_hltb && !c.via_achievements,
      ).length,
      completed_games: completed,
    })
  }

  // Rank: most games completed, then most hours.
  reports.sort(
    (a, b) =>
      b.games_completed_in_period - a.games_completed_in_period ||
      b.hours_played_in_period - a.hours_played_in_period,
  )

  const totals = {
    members_total: reports.length,
    members_with_a_completion: reports.filter(
      (r) => r.games_completed_in_period > 0,
    ).length,
    games_completed: reports.reduce(
      (s, r) => s + r.games_completed_in_period,
      0,
    ),
    games_completed_via_achievements: reports.reduce(
      (s, r) => s + r.completed_via_achievements,
      0,
    ),
    games_completed_via_hltb_only: reports.reduce(
      (s, r) => s + r.completed_via_hltb_only,
      0,
    ),
    hours_played: Math.round(
      reports.reduce((s, r) => s + r.hours_played_in_period, 0),
    ),
  }

  // --- Console report ---
  console.log(`\n📊 Monthly progress — ${PERIOD_LABEL}`)
  console.log(
    `   Baseline: ${BASELINE_SNAPSHOT.replace(repoRoot + '/', '')}` +
      (baseline.lastUpdated
        ? ` (snapshot ${new Date(baseline.lastUpdated).toISOString().slice(0, 10)})`
        : ''),
  )
  console.log(
    `   Current:  group_users.json` +
      (current.lastUpdated
        ? ` (snapshot ${new Date(current.lastUpdated).toISOString().slice(0, 10)})`
        : ''),
  )
  console.log(
    `\n   Completed = 100% achievements OR playtime ≥ HLTB main story.\n`,
  )
  console.log('   ── Totals ──────────────────────────────────────────')
  console.log(`   Members:                       ${totals.members_total}`)
  console.log(
    `   Members who completed ≥1 game: ${totals.members_with_a_completion}`,
  )
  console.log(`   Games completed (total):       ${totals.games_completed}`)
  console.log(
    `     ↳ via 100% achievements:     ${totals.games_completed_via_achievements}`,
  )
  console.log(
    `     ↳ via HLTB time only:        ${totals.games_completed_via_hltb_only}`,
  )
  console.log(`   Hours played (total):          ${totals.hours_played}h\n`)

  console.log(
    '   ── Per member (completed ≥1) ───────────────────────',
  )
  console.log(
    '   ' +
      'Member'.padEnd(22) +
      'Done'.padStart(5) +
      '  ' +
      '100%'.padStart(5) +
      '  ' +
      'HLTB'.padStart(5) +
      '  ' +
      'Hours'.padStart(7),
  )
  const tag = (c: CompletedGame): string =>
    c.via_achievements && c.via_hltb
      ? '100% + HLTB'
      : c.via_achievements
        ? `100% (${c.achievements_unlocked}/${c.achievements_total})`
        : `HLTB ${c.hltb_main_story_hours}h (${Math.round(c.playtime_minutes / 60)}h played)`
  for (const r of reports.filter((r) => r.games_completed_in_period > 0)) {
    console.log(
      '   ' +
        r.username.slice(0, 22).padEnd(22) +
        String(r.games_completed_in_period).padStart(5) +
        '  ' +
        String(r.completed_via_achievements).padStart(5) +
        '  ' +
        String(r.completed_via_hltb_only).padStart(5) +
        '  ' +
        (r.hours_played_in_period + 'h').padStart(7),
    )
    for (const c of r.completed_games)
      console.log(`       • ${c.name} — ${tag(c)}`)
  }

  // --- File outputs ---
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const report = {
    period_label: PERIOD_LABEL,
    generated_at: new Date().toISOString(),
    baseline_snapshot: BASELINE_SNAPSHOT.replace(repoRoot + '/', ''),
    baseline_snapshot_date: baseline.lastUpdated
      ? new Date(baseline.lastUpdated).toISOString()
      : null,
    current_snapshot_date: current.lastUpdated
      ? new Date(current.lastUpdated).toISOString()
      : null,
    completion_rule:
      '100% Steam achievements OR playtime >= HLTB main story hours',
    totals,
    members: reports,
  }
  const jsonPath = resolve(outDir, 'monthly-progress-report.json')
  writeFileSync(jsonPath, JSON.stringify(report, null, 2))

  const csvPath = resolve(outDir, 'monthly-progress-report.csv')
  const gameLabel = (c: CompletedGame): string =>
    `${c.name} [${
      c.via_achievements && c.via_hltb
        ? '100%+HLTB'
        : c.via_achievements
          ? '100%'
          : 'HLTB'
    }]`
  const rows = [
    'username,games_completed,via_achievements,via_hltb_only,hours_played,games',
    ...reports.map(
      (r) =>
        `${JSON.stringify(r.username)},${r.games_completed_in_period},${r.completed_via_achievements},${r.completed_via_hltb_only},${r.hours_played_in_period},${JSON.stringify(r.completed_games.map(gameLabel).join('; '))}`,
    ),
  ]
  writeFileSync(csvPath, rows.join('\n') + '\n')

  console.log(
    `\n✅ Wrote ${jsonPath.replace(repoRoot + '/', '')} and ${csvPath.replace(
      repoRoot + '/',
      '',
    )}\n`,
  )
}

main()
