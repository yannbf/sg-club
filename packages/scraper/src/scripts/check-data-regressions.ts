import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Backstop for generators that overwrite proven data with an empty or partial
 * pull (Steam returns an empty library for private profiles and on failed
 * requests). Before a CI job commits, the regenerated files in the working
 * tree are compared with their committed versions in HEAD, and values that must
 * only ever grow are reported when they shrink.
 *
 * Only monotonic values are checked. A row that disappears is not a finding:
 * members leave, giveaways are deleted and rosters are edited. A file that
 * loses most of its rows at once is, since that is a wiped or truncated write.
 *
 * Env:
 *  - DATA_REGRESSION_MODE=fail|warn — fail (default) exits 1 on findings
 *  - ALLOW_DATA_REGRESSION=1 — report findings but always exit 0
 *
 * CLI:
 *  - no args — check every changed data file against HEAD
 *  - --history <N|all> [--file <repo-relative path>] — check consecutive
 *    committed versions of each file; reporting only, always exits 0
 */

export interface Finding {
  file: string
  key: string
  field: string
  from: unknown
  to: unknown
}

export type RegressionMode = 'fail' | 'warn'

/** Share of a total that may disappear before it counts as a mass loss. */
export const MASS_LOSS_THRESHOLD = 0.3
/** Rows lost beyond this share of the previous rows count as a wiped file. */
export const MISSING_ROWS_THRESHOLD = 0.5
/** Files with fewer previous rows than this are too small to judge by share. */
export const MIN_ROWS_FOR_MASS_LOSS = 4

const MAX_PRINTED_FINDINGS = 50

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function expectRecord(value: unknown, what: string): JsonRecord {
  if (!isRecord(value)) throw new Error(`unexpected shape: ${what} is not an object`)
  return value
}

function expectArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`unexpected shape: ${what} is not an array`)
  return value
}

/** Reports a numeric value that went down. Non-numeric values are not compared. */
function checkDecreased(
  findings: Finding[],
  file: string,
  key: string,
  field: string,
  previousValue: unknown,
  nextValue: unknown,
): void {
  const from = asNumber(previousValue)
  const to = asNumber(nextValue)
  if (from !== undefined && to !== undefined && to < from) {
    findings.push({ file, key, field, from, to })
  }
}

/** Reports a boolean field that went from true to false. */
function checkLostFlag(
  findings: Finding[],
  file: string,
  key: string,
  field: string,
  previous: JsonRecord,
  next: JsonRecord,
): void {
  if (previous[field] === true && next[field] === false) {
    findings.push({ file, key, field, from: true, to: false })
  }
}

/** Reports when most previously present rows are gone from the new version. */
function checkRowsPresent(
  findings: Finding[],
  file: string,
  field: string,
  previousKeys: Iterable<string>,
  nextKeys: Set<string>,
): void {
  const previous = [...previousKeys]
  if (previous.length < MIN_ROWS_FOR_MASS_LOSS) return
  const stillPresent = previous.filter((key) => nextKeys.has(key)).length
  const missing = previous.length - stillPresent
  if (missing > previous.length * MISSING_ROWS_THRESHOLD) {
    findings.push({ file, key: '*', field, from: previous.length, to: stillPresent })
  }
}

function indexBy(rows: unknown[], keyOf: (row: JsonRecord) => string | undefined): Map<string, JsonRecord> {
  const index = new Map<string, JsonRecord>()
  for (const row of rows) {
    if (!isRecord(row)) continue
    const key = keyOf(row)
    if (key !== undefined) index.set(key, row)
  }
  return index
}

function idOf(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

// --- group_users.json -------------------------------------------------------

function indexUsers(data: unknown): Map<string, JsonRecord> {
  const users = expectRecord(expectRecord(data, 'group_users').users, 'group_users.users')
  const index = new Map<string, JsonRecord>()
  for (const [recordKey, user] of Object.entries(users)) {
    if (!isRecord(user)) continue
    index.set(idOf(user.steam_id) ?? recordKey, user)
  }
  return index
}

function indexWins(user: JsonRecord): Map<string, JsonRecord> {
  return indexBy(Array.isArray(user.giveaways_won) ? user.giveaways_won : [], (win) => idOf(win.link))
}

export function checkGroupUsers(previous: unknown, next: unknown, file = 'group_users.json'): Finding[] {
  const findings: Finding[] = []
  const previousUsers = indexUsers(previous)
  const nextUsers = indexUsers(next)

  checkRowsPresent(findings, file, 'users_present', previousUsers.keys(), new Set(nextUsers.keys()))

  for (const [steamId, previousUser] of previousUsers) {
    const nextUser = nextUsers.get(steamId)
    if (!nextUser) continue
    const nextWins = indexWins(nextUser)
    for (const [link, previousWin] of indexWins(previousUser)) {
      const nextWin = nextWins.get(link)
      if (!nextWin) continue
      const key = `${steamId}::${link}`
      const previousPlay = previousWin.steam_play_data
      if (!isRecord(previousPlay)) continue
      const nextPlay = nextWin.steam_play_data
      if (!isRecord(nextPlay)) {
        findings.push({ file, key, field: 'steam_play_data', from: 'present', to: 'missing' })
        continue
      }
      for (const field of ['playtime_minutes', 'achievements_unlocked'] as const) {
        checkDecreased(findings, file, key, `steam_play_data.${field}`, previousPlay[field], nextPlay[field])
      }
    }
  }
  return findings
}

// --- challenge_*.json -------------------------------------------------------

const CHALLENGE_COUNTERS = ['playtime_total_minutes', 'achievements_unlocked_total'] as const
const CHALLENGE_FLAGS = ['owned', 'is_complete', 'is_winner', 'wrote_review'] as const

function indexChallengeRows(data: JsonRecord, field: string): Map<string, JsonRecord> {
  return indexBy(expectArray(data[field], `challenge.${field}`), (row) => idOf(row.steam_id))
}

export function checkChallenge(previous: unknown, next: unknown, file = 'challenge.json'): Finding[] {
  const findings: Finding[] = []
  const previousData = expectRecord(previous, 'challenge')
  const nextData = expectRecord(next, 'challenge')

  const previousParticipants = indexChallengeRows(previousData, 'participants')
  const nextParticipants = indexChallengeRows(nextData, 'participants')
  // An edited roster replaces the participant set on purpose.
  if (JSON.stringify(previousData.roster ?? null) === JSON.stringify(nextData.roster ?? null)) {
    checkRowsPresent(
      findings,
      file,
      'participants_present',
      previousParticipants.keys(),
      new Set(nextParticipants.keys()),
    )
  }

  for (const [steamId, previousRow] of previousParticipants) {
    const nextRow = nextParticipants.get(steamId)
    if (!nextRow) continue
    for (const field of CHALLENGE_COUNTERS) checkDecreased(findings, file, steamId, field, previousRow[field], nextRow[field])
    for (const field of CHALLENGE_FLAGS) checkLostFlag(findings, file, steamId, field, previousRow, nextRow)
  }

  // Challenges that never listed non-participants have nothing to compare.
  if (Array.isArray(previousData.nonParticipants) && Array.isArray(nextData.nonParticipants)) {
    const nextRows = indexChallengeRows(nextData, 'nonParticipants')
    for (const [steamId, previousRow] of indexChallengeRows(previousData, 'nonParticipants')) {
      const nextRow = nextRows.get(steamId)
      if (!nextRow) continue
      for (const field of CHALLENGE_COUNTERS) checkDecreased(findings, file, steamId, field, previousRow[field], nextRow[field])
    }
  }
  return findings
}

// --- beaten_games.json ------------------------------------------------------

/**
 * Identity of the marker a verdict was computed against. A win's `beaten` is
 * only comparable across versions while this is unchanged.
 */
function markerIdentity(game: unknown): string | undefined {
  if (!isRecord(game) || !isRecord(game.marker)) return undefined
  const alternatives = Array.isArray(game.marker.any_of_apinames) ? [...game.marker.any_of_apinames].sort() : null
  return JSON.stringify([game.marker.apiname ?? null, alternatives])
}

export function checkBeaten(previous: unknown, next: unknown, file = 'beaten_games.json'): Finding[] {
  const findings: Finding[] = []
  const previousData = expectRecord(previous, 'beaten_games')
  const nextData = expectRecord(next, 'beaten_games')
  const previousWins = expectRecord(previousData.wins, 'beaten_games.wins')
  const nextWins = expectRecord(nextData.wins, 'beaten_games.wins')
  const previousGames = expectRecord(previousData.games, 'beaten_games.games')
  const nextGames = expectRecord(nextData.games, 'beaten_games.games')

  checkRowsPresent(findings, file, 'wins_present', Object.keys(previousWins), new Set(Object.keys(nextWins)))

  for (const [key, previousWin] of Object.entries(previousWins)) {
    const nextWin = nextWins[key]
    if (!isRecord(previousWin) || !isRecord(nextWin)) continue
    if (previousWin.beaten !== true || nextWin.beaten === true) continue
    // Win keys are `<steamId>::<appId>` and games are keyed by `<appId>`.
    const appId = key.slice(key.indexOf('::') + 2)
    const previousMarker = markerIdentity(previousGames[appId])
    const nextMarker = markerIdentity(nextGames[appId])
    if (previousMarker === undefined || nextMarker === undefined || previousMarker !== nextMarker) continue
    findings.push({ file, key, field: 'beaten', from: true, to: nextWin.beaten ?? null })
  }
  return findings
}

// --- game_insights.json -----------------------------------------------------

function countPairs(games: JsonRecord, field: 'owners' | 'wanters'): number {
  let total = 0
  for (const game of Object.values(games)) {
    if (isRecord(game) && Array.isArray(game[field])) total += game[field].length
  }
  return total
}

export function checkGameInsights(previous: unknown, next: unknown, file = 'game_insights.json'): Finding[] {
  const findings: Finding[] = []
  const previousData = expectRecord(previous, 'game_insights')
  const nextData = expectRecord(next, 'game_insights')
  const previousGames = expectRecord(previousData.games, 'game_insights.games')
  const nextGames = expectRecord(nextData.games, 'game_insights.games')

  const previousRoster = asNumber(previousData.total_members)
  const nextRoster = asNumber(nextData.total_members)
  // A smaller roster legitimately removes that share of the pairs.
  const rosterRatio =
    previousRoster !== undefined && nextRoster !== undefined && previousRoster > 0
      ? Math.min(1, nextRoster / previousRoster)
      : 1

  for (const field of ['owners', 'wanters'] as const) {
    const from = countPairs(previousGames, field)
    const to = countPairs(nextGames, field)
    if (from > 0 && to < from * rosterRatio * (1 - MASS_LOSS_THRESHOLD)) {
      findings.push({ file, key: '*', field: `${field}_pairs`, from, to })
    }
  }

  for (const field of ['members_with_library_data', 'members_with_wishlist_data'] as const) {
    const from = asNumber(previousData[field])
    const to = asNumber(nextData[field])
    if (from !== undefined && to !== undefined && from > 0 && to < from * (1 - MASS_LOSS_THRESHOLD)) {
      findings.push({ file, key: '*', field, from, to })
    }
  }
  return findings
}

// --- dispatch ---------------------------------------------------------------

const GROUP_USERS_FILE = 'group_users.json'
const BEATEN_FILE = 'beaten_games.json'
const GAME_INSIGHTS_FILE = 'game_insights.json'
const CHALLENGE_FILE_PATTERN = /^challenge_.+\.json$/

const DATA_DIR_FROM_REPO_ROOT = 'packages/website/public/data'

type Check = (previous: unknown, next: unknown, file: string) => Finding[]

function checkFor(file: string): Check | undefined {
  const name = basename(file)
  if (name === GROUP_USERS_FILE) return checkGroupUsers
  if (name === BEATEN_FILE) return checkBeaten
  if (name === GAME_INSIGHTS_FILE) return checkGameInsights
  if (CHALLENGE_FILE_PATTERN.test(name)) return checkChallenge
  return undefined
}

export interface CheckOutcome {
  findings: Finding[]
  /** Set when the check could not run; the caller reports it without failing. */
  error?: string
}

/**
 * Runs the check matching `file` on two parsed versions. Never throws: a
 * malformed or unexpectedly shaped file is reported through `error`.
 */
export function checkData(file: string, previous: unknown, next: unknown): CheckOutcome {
  const check = checkFor(file)
  if (!check) return { findings: [], error: `no check for ${file}` }
  try {
    return { findings: check(previous, next, file) }
  } catch (error) {
    return { findings: [], error: error instanceof Error ? error.message : String(error) }
  }
}

/** Same as {@link checkData} for raw file contents. */
export function checkSerialized(file: string, previousText: string, nextText: string): CheckOutcome {
  let previous: unknown
  let next: unknown
  try {
    previous = JSON.parse(previousText)
    next = JSON.parse(nextText)
  } catch (error) {
    return { findings: [], error: `malformed JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  return checkData(file, previous, next)
}

export function formatFinding(finding: Finding): string {
  const show = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value))
  return `${finding.file} ${finding.key} ${finding.field}: ${show(finding.from)} -> ${show(finding.to)}`
}

export function resolveMode(env: Record<string, string | undefined>): RegressionMode {
  return env.DATA_REGRESSION_MODE?.trim().toLowerCase() === 'warn' ? 'warn' : 'fail'
}

export interface ExitDecision {
  exitCode: 0 | 1
  mode: RegressionMode
  /** Level of the GitHub Actions annotation summarising a file's findings. */
  annotation: 'error' | 'warning'
}

export function decideExit(findingCount: number, env: Record<string, string | undefined>): ExitDecision {
  const mode = resolveMode(env)
  const allowed = env.ALLOW_DATA_REGRESSION === '1'
  const failing = mode === 'fail' && !allowed
  return {
    exitCode: failing && findingCount > 0 ? 1 : 0,
    mode,
    annotation: failing ? 'error' : 'warning',
  }
}

// --- git + CLI --------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(currentDir, '../../../..')

function git(args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  })
  return { status: result.status, stdout: result.stdout ?? '' }
}

function showAt(revision: string, path: string): string | null {
  const result = git(['show', `${revision}:${path}`])
  return result.status === 0 ? result.stdout : null
}

function knownDataFiles(): string[] {
  const dataDir = resolve(repoRoot, DATA_DIR_FROM_REPO_ROOT)
  const challenges = existsSync(dataDir)
    ? readdirSync(dataDir)
        .filter((name) => CHALLENGE_FILE_PATTERN.test(name))
        .sort()
    : []
  return [GROUP_USERS_FILE, BEATEN_FILE, GAME_INSIGHTS_FILE, ...challenges].map(
    (name) => `${DATA_DIR_FROM_REPO_ROOT}/${name}`,
  )
}

function warn(message: string): void {
  console.log(`::warning::data regression check: ${message}`)
}

/** Checks every changed data file against HEAD and returns the findings. */
export function runAgainstHead(env: Record<string, string | undefined>): number {
  let total = 0
  for (const path of knownDataFiles()) {
    try {
      if (!existsSync(resolve(repoRoot, path))) continue
      const diff = git(['diff', '--quiet', 'HEAD', '--', path])
      if (diff.status === 0) continue
      if (diff.status !== 1) {
        warn(`${path}: git diff failed, skipped`)
        continue
      }
      const committed = showAt('HEAD', path)
      if (committed === null) continue
      const outcome = checkSerialized(path, committed, readFileSync(resolve(repoRoot, path), 'utf8'))
      if (outcome.error) {
        warn(`${path}: ${outcome.error}, skipped`)
        continue
      }
      reportFindings(path, outcome.findings, env)
      total += outcome.findings.length
    } catch (error) {
      warn(`${path}: ${error instanceof Error ? error.message : String(error)}, skipped`)
    }
  }
  return total
}

function reportFindings(path: string, findings: Finding[], env: Record<string, string | undefined>): void {
  if (findings.length === 0) return
  const { annotation } = decideExit(findings.length, env)
  for (const finding of findings.slice(0, MAX_PRINTED_FINDINGS)) console.log(formatFinding(finding))
  if (findings.length > MAX_PRINTED_FINDINGS) {
    console.log(`... ${findings.length - MAX_PRINTED_FINDINGS} more finding(s) not shown`)
  }
  console.log(`::${annotation}::${path}: ${findings.length} value(s) regressed against HEAD`)
}

interface HistoryCommit {
  sha: string
  date: string
}

function commitsTouching(path: string, limit: number | null): HistoryCommit[] {
  // One extra commit supplies the older side of the oldest pair checked.
  const count = limit === null ? [] : ['-n', String(limit + 1)]
  const result = git(['log', '--format=%H%x09%cI', ...count, '--', path])
  if (result.status !== 0) return []
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, date] = line.split('\t')
      return { sha, date }
    })
}

/** Walks consecutive committed versions of `path`, oldest pair first. */
export function runHistory(path: string, limit: number | null): void {
  const commits = commitsTouching(path, limit)
  let pairs = 0
  let pairsWithFindings = 0
  let totalFindings = 0
  const started = Date.now()

  let older: { value: unknown } | null = null
  for (let i = commits.length - 1; i >= 0; i--) {
    const { sha, date } = commits[i]
    const label = `${sha.slice(0, 8)} ${date}`
    const text = showAt(sha, path)
    let current: { value: unknown } | null = null
    if (text !== null) {
      try {
        current = { value: JSON.parse(text) }
      } catch (error) {
        console.log(`${label} ${path}: malformed JSON, skipped (${error instanceof Error ? error.message : error})`)
      }
    }
    if (current && older) {
      const outcome = checkData(path, older.value, current.value)
      pairs++
      if (outcome.error) {
        console.log(`${label} ${path}: ${outcome.error}`)
      } else if (outcome.findings.length > 0) {
        pairsWithFindings++
        totalFindings += outcome.findings.length
        for (const finding of outcome.findings) console.log(`${label} ${formatFinding(finding)}`)
      }
    }
    older = current
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(
    `${path}: ${pairs} pair(s) checked, ${pairsWithFindings} with findings, ${totalFindings} finding(s), ${seconds}s`,
  )
}

function parseHistoryArgs(argv: string[]): { limit: number | null; file?: string } | null {
  const at = argv.indexOf('--history')
  if (at === -1) return null
  const value = argv[at + 1]
  const limit = value === 'all' ? null : Number(value)
  if (limit !== null && !(Number.isInteger(limit) && limit > 0)) {
    throw new Error('--history expects a positive integer or "all"')
  }
  const fileAt = argv.indexOf('--file')
  return { limit, file: fileAt === -1 ? undefined : argv[fileAt + 1] }
}

export function main(argv: string[], env: Record<string, string | undefined>): number {
  try {
    const history = parseHistoryArgs(argv)
    if (history) {
      const files = history.file ? [history.file] : knownDataFiles()
      for (const file of files) runHistory(file, history.limit)
      return 0
    }
    return decideExit(runAgainstHead(env), env).exitCode
  } catch (error) {
    warn(error instanceof Error ? error.message : String(error))
    return 0
  }
}

if (import.meta.url.startsWith('file:') && process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), process.env)
}
