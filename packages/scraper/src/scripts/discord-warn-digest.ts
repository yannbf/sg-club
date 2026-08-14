import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkExMemberEntries } from './check-ex-member-entries.js'
import { createMessage } from '../../../website/api/_lib/discord-rest.js'
import { TEST_ANNOUNCE_CHANNEL_ID } from '../../../website/api/_lib/constants.js'
import {
  chunkMessage,
  collectGroupWarningFindings,
  PLAY_REQUIRED_CODES,
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
  category: string
  description: string
  severity: Severity
  /** Underlying finding code — drives the deep link on the member's digest
   * line. Group-warning items carry their warning code; ex-member items
   * carry the `ex_member_entries` pseudo-code (see IMPORTANCE_ORDER). */
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
      category: 'Ex members that still have entries in group giveaways',
      description: `Left the group but still has ${member.active_entries.length} active entr${
        member.active_entries.length === 1 ? 'y' : 'ies'
      } in group-exclusive giveaways.`,
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
  return findings.map((finding) => {
    // Per-game specifics ("Sonic Frontiers (deadline <t:…:R>)") go in the
    // rendered category only — the fingerprint stays code-based so a detail
    // change (new game, shifted deadline) doesn't reset firstSeen.
    const category = finding.detail ? `${finding.label}: ${finding.detail}` : finding.label
    return {
      fingerprint: `group-warning:${finding.username}:${finding.code}`,
      memberSgUsername: finding.username,
      category,
      description: `${finding.username}: ${category}`,
      severity: finding.severity,
      code: finding.code,
    }
  })
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

const HEADER = '**Weekly Mod Digest**'
const UPCOMING_HEADER = '**Required-play deadlines coming up**'
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

export interface MemberFindings {
  username: string
  hasNew: boolean
  findingLines: string[]
  /** Pre-filtered tab the member's line should link to, when their findings
   * warrant one: any required-play finding links to the Won tab with the
   * Play required filter on; an ex-member-entries finding as the member's
   * ONLY finding links to the Entered tab filtered to open giveaways. */
  deepLink?: DeepLink
}

interface MemberAccumulator extends MemberFindings {
  codes: string[]
}

/**
 * Groups the findings a `select` predicate accepts (new + lingering) by
 * member, so each member appears exactly once listing only their selected
 * findings. Members with at least one new finding sort first; both groups
 * sort alphabetically. Findings the predicate rejects are still tracked in
 * state (see splitAndUpdateState), just not rendered in this section.
 */
export function groupFindingsByMember(
  split: DigestSplit,
  select: (item: WarnItem) => boolean
): MemberFindings[] {
  const byUser = new Map<string, MemberAccumulator>()

  const getEntry = (username: string): MemberAccumulator => {
    let entry = byUser.get(username)
    if (!entry) {
      entry = { username, hasNew: false, findingLines: [], codes: [] }
      byUser.set(username, entry)
    }
    return entry
  }

  for (const item of split.newItems) {
    if (!select(item)) continue
    const entry = getEntry(item.memberSgUsername)
    entry.hasNew = true
    entry.findingLines.push(`${item.category} (new)`)
    if (item.code) entry.codes.push(item.code)
  }
  for (const item of split.lingeringItems) {
    if (!select(item)) continue
    const entry = getEntry(item.memberSgUsername)
    entry.findingLines.push(`${item.category} (since <t:${item.firstSeen}:R>)`)
    if (item.code) entry.codes.push(item.code)
  }

  return [...byUser.values()]
    .map(({ codes, ...entry }): MemberFindings => {
      if (codes.some((code) => PLAY_REQUIRED_CODES.has(code))) {
        return { ...entry, deepLink: 'play-required' }
      }
      // Only when ex-member entries is the member's sole finding: mixing in
      // other (non-play-required) findings makes the Entered/Open view too
      // narrow a landing page for the line.
      if (codes.length === entry.findingLines.length && codes.every((c) => c === 'ex_member_entries')) {
        return { ...entry, deepLink: 'entered-open' }
      }
      return entry
    })
    .sort((a, b) => {
      if (a.hasNew !== b.hasNew) return a.hasNew ? -1 : 1
      return a.username.localeCompare(b.username)
    })
}

/**
 * Renders the digest as one or more plain-markdown messages, each ≤1900
 * chars, splitting strictly at bullet boundaries so a member's line never
 * gets cut mid-way. Two sections: current rule violations (error severity),
 * then required-play deadlines about to run out. No emojis anywhere. Returns
 * an empty array when neither section has anything (the caller stays silent).
 */
export function buildDigestMessages(split: DigestSplit): string[] {
  const render = (members: MemberFindings[]): string[] =>
    members.map((member) =>
      renderMemberLine(member.username, member.findingLines, member.deepLink)
    )

  const errorBullets = render(groupFindingsByMember(split, isError))
  // A member can appear in both sections: the deadline line is the actionable
  // "act before this lapses" item, distinct from whatever they're already in
  // violation of.
  const upcomingBullets = render(groupFindingsByMember(split, isUpcomingDeadline))

  if (errorBullets.length === 0 && upcomingBullets.length === 0) return []

  const segments = [HEADER, ...errorBullets]
  if (upcomingBullets.length > 0) segments.push(UPCOMING_HEADER, ...upcomingBullets)
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
