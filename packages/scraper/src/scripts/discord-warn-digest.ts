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
  /** Underlying finding code (group-warning items only) — drives the
   * play-required deep link on the member's digest line. */
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
      category: 'Ex-member entries',
      description: `Left the group but still has ${member.active_entries.length} active entr${
        member.active_entries.length === 1 ? 'y' : 'ies'
      } in group-exclusive giveaways.`,
      severity: 'error' as const,
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
  return findings.map((finding) => ({
    fingerprint: `group-warning:${finding.username}:${finding.code}`,
    memberSgUsername: finding.username,
    category: finding.label,
    description: `${finding.username}: ${finding.label}`,
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

const HEADER = '**Weekly Mod Digest**'
const MAX_MESSAGE_LENGTH = 1900

export interface MemberFindings {
  username: string
  hasNew: boolean
  findingLines: string[]
  /** True when any of the member's error findings is required-play related —
   * their line links straight to the Won tab with the filter on. */
  deepLinkPlayRequired: boolean
}

/**
 * Groups error-severity findings only (new + lingering) by member, so each
 * member with at least one error finding appears exactly once, listing only
 * their error findings — warn-level findings are tracked in state (see
 * splitAndUpdateState) but never rendered here. Members with at least one
 * new error finding sort first; both groups sort alphabetically.
 */
export function groupErrorFindingsByMember(split: DigestSplit): MemberFindings[] {
  const byUser = new Map<string, MemberFindings>()

  const getEntry = (username: string): MemberFindings => {
    let entry = byUser.get(username)
    if (!entry) {
      entry = { username, hasNew: false, findingLines: [], deepLinkPlayRequired: false }
      byUser.set(username, entry)
    }
    return entry
  }
  const markPlayRequired = (entry: MemberFindings, item: WarnItem): void => {
    if (item.code && PLAY_REQUIRED_CODES.has(item.code)) entry.deepLinkPlayRequired = true
  }

  for (const item of split.newItems) {
    if (item.severity !== 'error') continue
    const entry = getEntry(item.memberSgUsername)
    entry.hasNew = true
    entry.findingLines.push(`${item.category} (new)`)
    markPlayRequired(entry, item)
  }
  for (const item of split.lingeringItems) {
    if (item.severity !== 'error') continue
    const entry = getEntry(item.memberSgUsername)
    entry.findingLines.push(`${item.category} (since <t:${item.firstSeen}:R>)`)
    markPlayRequired(entry, item)
  }

  return [...byUser.values()].sort((a, b) => {
    if (a.hasNew !== b.hasNew) return a.hasNew ? -1 : 1
    return a.username.localeCompare(b.username)
  })
}

/**
 * Renders the error-only grouped findings as one or more plain-markdown
 * messages, each ≤1900 chars, splitting strictly at bullet boundaries so a
 * member's line never gets cut mid-way. The header appears only on the
 * first message. No emojis anywhere. Returns an empty array when there are
 * zero error-level findings (the caller stays silent in that case).
 */
export function buildDigestMessages(split: DigestSplit): string[] {
  const bullets = groupErrorFindingsByMember(split).map((member) =>
    renderMemberLine(member.username, member.findingLines, member.deepLinkPlayRequired)
  )
  if (bullets.length === 0) return []
  return chunkMessage([HEADER, ...bullets], MAX_MESSAGE_LENGTH)
}

/**
 * Runs every detector, diffs against discord_warn_state.json (tracking ALL
 * findings, including warn-level, so nothing loses its firstSeen history),
 * and posts a digest of error-level findings only — staying silent (but
 * still saving state) when there are none.
 */
export async function postWarnDigest(): Promise<void> {
  const state = loadState()
  const items = await runDetectors()
  const now = Math.floor(Date.now() / 1000)
  const split = splitAndUpdateState(items, state, now)
  const messages = buildDigestMessages(split)

  if (messages.length === 0) {
    console.log('No error-level warn-digest findings — staying silent.')
  } else {
    const channelId = process.env.WARN_CHANNEL_ID ?? TEST_ANNOUNCE_CHANNEL_ID
    for (const content of messages) {
      await createMessage(channelId, { content, flags: 4 })
    }
    console.log(
      `Posted warn digest: ${split.newItems.length} new, ${split.lingeringItems.length} lingering, ${split.prunedFingerprints.length} pruned (all severities tracked; errors only rendered).`
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
