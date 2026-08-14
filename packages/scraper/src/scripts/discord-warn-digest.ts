import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkExMemberEntries } from './check-ex-member-entries.js'
import { createMessage } from '../../../website/api/_lib/discord-rest.js'
import { TEST_ANNOUNCE_CHANNEL_ID } from '../../../website/api/_lib/constants.js'
import {
  chunkMessage,
  collectGroupWarningFindings,
  importanceRank,
  PLAY_REQUIRED_CODES,
  renderMemberBlock,
  renderMemberLine,
  type DeepLink,
  type Severity,
} from '../../../website/api/_lib/mod-report.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(__dirname, '../../..', 'website/public/data')
const statePath = path.join(dataDir, 'discord_warn_state.json')

export interface WarnItem {
  fingerprint: string
  memberSgUsername: string
  /** What the member did, e.g. "Unplayed required-play wins". */
  label: string
  /** The specifics behind the label — game names, deadlines. Kept separate
   * from `label` so a section whose header already states the rule can render
   * the specifics alone. */
  detail?: string
  severity: Severity
  /** Underlying finding code — drives the deep link on the member's digest
   * line and the ordering of their findings. Group-warning items carry their
   * warning code; ex-member items carry the `ex_member_entries` pseudo-code
   * (see IMPORTANCE_ORDER). */
  code?: string
}

export interface WarnState {
  items: Record<string, { firstSeen: number }>
}

function loadState(): WarnState {
  if (!existsSync(statePath)) return { items: {} }
  return JSON.parse(readFileSync(statePath, 'utf-8'))
}

function saveState(state: WarnState): void {
  writeFileSync(statePath, JSON.stringify(state, null, 2))
}

/**
 * Ex-members still holding entries in active group-exclusive giveaways.
 * Reuses the core check from check-ex-member-entries.ts (see that file for
 * the full membership-sync-delay rationale) rather than duplicating it.
 * Always error-severity — this is a rule violation, not an advisory.
 *
 * This detector cannot be ported into `mod-report.ts` (and therefore isn't
 * available to /mod-report): beyond ex_members.json it also needs
 * giveaways.json and user_entries.json (a further ~5MB combined), which is
 * too much to fetch on every on-demand command invocation. It stays
 * scraper-only, wired into this weekly digest.
 */
export function exMemberEntriesDetector(): WarnItem[] {
  const flagged = checkExMemberEntries()
  return flagged
    .filter((member) => member.active_entries.length > 0)
    .map((member) => ({
      fingerprint: `ex-member-entries:${member.steam_id}`,
      memberSgUsername: member.username,
      label: 'Left the group but still has entries in group giveaways',
      detail: `${member.active_entries.length} active entr${
        member.active_entries.length === 1 ? 'y' : 'ies'
      }`,
      severity: 'error' as const,
      code: 'ex_member_entries',
    }))
}

/**
 * Surfaces the per-member rule-violation `warnings` the scraper already
 * computes in group-members.ts (calculateUserWarnings) — required-play
 * compliance, play-rate anomalies, and inactivity flags — as digest items.
 * Delegates the actual loading + severity classification to
 * `collectGroupWarningFindings` in mod-report.ts (shared with /mod-report).
 */
export async function groupUserWarningsDetector(): Promise<WarnItem[]> {
  const findings = await collectGroupWarningFindings()
  // Per-game specifics ("Sonic Frontiers (deadline <t:…:R>)") stay out of the
  // fingerprint, which is code-based so a detail change (new game, shifted
  // deadline) doesn't reset firstSeen.
  return findings.map((finding) => ({
    fingerprint: `group-warning:${finding.username}:${finding.code}`,
    memberSgUsername: finding.username,
    label: finding.label,
    detail: finding.detail,
    severity: finding.severity,
    code: finding.code,
  }))
}

const DETECTORS: Array<() => WarnItem[] | Promise<WarnItem[]>> = [
  exMemberEntriesDetector,
  groupUserWarningsDetector,
]

export async function runDetectors(): Promise<WarnItem[]> {
  const results = await Promise.all(
    DETECTORS.map(async (detector) => {
      try {
        return await detector()
      } catch (err) {
        console.error('A warn-digest detector failed:', err)
        return []
      }
    })
  )
  return results.flat()
}

export interface DigestSplit {
  newItems: WarnItem[]
  lingeringItems: Array<WarnItem & { firstSeen: number }>
  prunedFingerprints: string[]
  updatedState: WarnState
}

/**
 * Splits the current findings into "new this week" vs "lingering" (already
 * in state), and prunes state entries whose finding has disappeared. Pure
 * function — no I/O — so new-vs-lingering + pruning behavior is easy to
 * unit test. Operates on ALL findings regardless of severity, so warn-level
 * items keep their firstSeen history even though they're filtered out of
 * the posted digest at render time.
 */
export function splitAndUpdateState(items: WarnItem[], state: WarnState, now: number): DigestSplit {
  const currentFingerprints = new Set(items.map((item) => item.fingerprint))
  const newItems: WarnItem[] = []
  const lingeringItems: Array<WarnItem & { firstSeen: number }> = []
  const updatedItems: WarnState['items'] = {}

  for (const item of items) {
    const existing = state.items[item.fingerprint]
    if (existing) {
      lingeringItems.push({ ...item, firstSeen: existing.firstSeen })
      updatedItems[item.fingerprint] = existing
    } else {
      newItems.push(item)
      updatedItems[item.fingerprint] = { firstSeen: now }
    }
  }

  const prunedFingerprints = Object.keys(state.items).filter(
    (fingerprint) => !currentFingerprints.has(fingerprint)
  )

  return { newItems, lingeringItems, prunedFingerprints, updatedState: { items: updatedItems } }
}

// Each of these is one chunkMessage segment, so a header can never be
// stranded at the bottom of a message with its list on the next one.
const HEADER = '**Weekly Mod Digest**\nMembers currently breaking a rule:'
const HEADER_NO_VIOLATIONS = '**Weekly Mod Digest**\nNo rule violations this week.'
const UPCOMING_HEADER =
  '**Required-play deadlines coming up**\nNot violations yet — these lapse soon:'
const MAX_MESSAGE_LENGTH = 1900

/**
 * Warn-level codes that still get their own digest section. A play
 * requirement about to run out is the one advisory worth pushing weekly:
 * once it lapses the member is in violation, and by then the digest telling
 * them is too late to act on. Every other warn-level code stays on-demand
 * via /mod-report.
 */
const UPCOMING_DEADLINE_CODES = new Set(['required_play_deadline_within_15_days'])

/** The two section predicates for `groupFindingsByMember`. */
export const isError = (item: WarnItem): boolean => item.severity === 'error'
export const isUpcomingDeadline = (item: WarnItem): boolean =>
  item.code !== undefined && UPCOMING_DEADLINE_CODES.has(item.code)

export interface MemberFinding {
  label: string
  detail?: string
  code?: string
  /** Not present in the previous digest — i.e. this appeared this week. */
  isNew: boolean
}

export interface MemberFindings {
  username: string
  /** Every one of this member's findings appeared this week. */
  allNew: boolean
  /** Oldest `firstSeen` across their findings; absent when `allNew`. */
  onListSince?: number
  findings: MemberFinding[]
  /** Pre-filtered tab the member's line should link to, when their findings
   * warrant one: any required-play finding links to the Won tab with the
   * Play required filter on; an ex-member-entries finding as the member's
   * ONLY finding links to the Entered tab filtered to open giveaways. */
  deepLink?: DeepLink
}

/**
 * Groups the findings a `select` predicate accepts (new + lingering) by
 * member, so each member appears exactly once carrying only their selected
 * findings, most serious first. Members with at least one new finding sort
 * first; both groups sort alphabetically. Findings the predicate rejects are
 * still tracked in state (see splitAndUpdateState), just not in this section.
 */
export function groupFindingsByMember(
  split: DigestSplit,
  select: (item: WarnItem) => boolean
): MemberFindings[] {
  const byUser = new Map<string, MemberFindings>()

  const getEntry = (username: string): MemberFindings => {
    let entry = byUser.get(username)
    if (!entry) {
      entry = { username, allNew: true, findings: [] }
      byUser.set(username, entry)
    }
    return entry
  }

  const add = (item: WarnItem, isNew: boolean, firstSeen?: number) => {
    if (!select(item)) return
    const entry = getEntry(item.memberSgUsername)
    entry.findings.push({ label: item.label, detail: item.detail, code: item.code, isNew })
    if (isNew) return
    entry.allNew = false
    if (firstSeen !== undefined) {
      entry.onListSince =
        entry.onListSince === undefined ? firstSeen : Math.min(entry.onListSince, firstSeen)
    }
  }

  for (const item of split.newItems) add(item, true)
  for (const item of split.lingeringItems) add(item, false, item.firstSeen)

  return [...byUser.values()]
    .map((entry): MemberFindings => {
      entry.findings.sort(
        (a, b) => importanceRank(a.code ?? '') - importanceRank(b.code ?? '')
      )
      const codes = entry.findings.map((f) => f.code).filter((c): c is string => !!c)
      if (codes.some((code) => PLAY_REQUIRED_CODES.has(code))) {
        return { ...entry, deepLink: 'play-required' }
      }
      // Only when ex-member entries is the member's sole finding: mixing in
      // other (non-play-required) findings makes the Entered/Open view too
      // narrow a landing page for the line.
      if (
        codes.length === entry.findings.length &&
        codes.every((c) => c === 'ex_member_entries')
      ) {
        return { ...entry, deepLink: 'entered-open' }
      }
      return entry
    })
    .sort((a, b) => {
      if (a.allNew !== b.allNew) return a.allNew ? -1 : 1
      return a.username.localeCompare(b.username)
    })
}

const withDetail = (finding: MemberFinding): string =>
  finding.detail ? `${finding.label}: ${finding.detail}` : finding.label

/**
 * One member's violations: a bullet naming them and how long they've been on
 * the list, with each finding as its own sub-bullet.
 *
 * The headline is what makes the timing legible. "unresolved since <date>"
 * says what the duration measures — the previous "(since …)" suffix hung off
 * a finding with nothing saying since *what*. An individual finding is only
 * marked new when the member themselves isn't, where it genuinely means
 * "this one got added to an existing problem".
 */
function renderViolations(member: MemberFindings): string {
  const headline =
    member.allNew || member.onListSince === undefined
      ? 'new this week'
      : `unresolved since <t:${member.onListSince}:R>`
  const lines = member.findings.map((finding) =>
    !member.allNew && finding.isNew ? `${withDetail(finding)} (new this week)` : withDetail(finding)
  )
  return renderMemberBlock(member.username, headline, lines, member.deepLink)
}

/**
 * One member's upcoming deadlines, on a single line. The section header
 * already says what the rule is, so only the specifics (game + deadline)
 * are rendered — and no new/unresolved marker, since the deadline itself is
 * the only timing that matters here.
 */
function renderUpcomingDeadlines(member: MemberFindings): string {
  const texts = member.findings.map((finding) => finding.detail!)
  return renderMemberLine(member.username, texts, member.deepLink)
}

/**
 * Upcoming-deadline members, dropping any finding we can't name a game for.
 *
 * A detail-less deadline finding means the stored warning in group_users.json
 * and the deadlines recomputed here disagree — the stored one is left over
 * from a scrape that read the deadline differently. The recomputation is the
 * fresher answer, and "deadline within 15 days" with no game attached is
 * nothing a mod can act on, so it waits for the next scrape to clear.
 *
 * Sorted by name only: this section shows no new/unresolved marker, so the
 * new-first ordering the violations use would look arbitrary here.
 */
function upcomingDeadlineMembers(split: DigestSplit): MemberFindings[] {
  return groupFindingsByMember(split, isUpcomingDeadline)
    .map((member) => ({
      ...member,
      findings: member.findings.filter((finding) => finding.detail),
    }))
    .filter((member) => member.findings.length > 0)
    .sort((a, b) => a.username.localeCompare(b.username))
}

/**
 * Renders the digest as one or more plain-markdown messages, each ≤1900
 * chars, splitting strictly at segment boundaries so a member's findings
 * never get cut in half. Two sections: current rule violations (error
 * severity), then required-play deadlines about to run out. No emojis
 * anywhere. Returns an empty array when neither section has anything (the
 * caller stays silent).
 */
export function buildDigestMessages(split: DigestSplit): string[] {
  const violations = groupFindingsByMember(split, isError).map(renderViolations)
  // A member can appear in both sections: the deadline line is the actionable
  // "act before this lapses" item, distinct from whatever they're already in
  // violation of.
  const upcoming = upcomingDeadlineMembers(split).map(renderUpcomingDeadlines)

  if (violations.length === 0 && upcoming.length === 0) return []

  const segments =
    violations.length > 0 ? [HEADER, ...violations] : [HEADER_NO_VIOLATIONS]
  if (upcoming.length > 0) segments.push(UPCOMING_HEADER, ...upcoming)
  return chunkMessage(segments, MAX_MESSAGE_LENGTH)
}

/**
 * Runs every detector, diffs against discord_warn_state.json (tracking ALL
 * findings, including warn-level, so nothing loses its firstSeen history),
 * and posts the digest — staying silent (but still saving state) when
 * neither section has anything to report.
 */
export async function postWarnDigest(): Promise<void> {
  const state = loadState()
  const items = await runDetectors()
  const now = Math.floor(Date.now() / 1000)
  const split = splitAndUpdateState(items, state, now)
  const messages = buildDigestMessages(split)

  if (messages.length === 0) {
    console.log('No reportable warn-digest findings — staying silent.')
  } else {
    const channelId = process.env.WARN_CHANNEL_ID ?? TEST_ANNOUNCE_CHANNEL_ID
    for (const content of messages) {
      await createMessage(channelId, { content, flags: 4 })
    }
    console.log(
      `Posted warn digest: ${split.newItems.length} new, ${split.lingeringItems.length} lingering, ${split.prunedFingerprints.length} pruned (all severities tracked; errors + upcoming deadlines rendered).`
    )
  }

  saveState(split.updatedState)
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await postWarnDigest()
  }
}
