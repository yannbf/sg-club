import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkExMemberEntries } from './check-ex-member-entries.js'
import { createMessage } from '../../../website/api/_lib/discord-rest.js'
import { TEST_ANNOUNCE_CHANNEL_ID } from '../../../website/api/_lib/constants.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(__dirname, '../../..', 'website/public/data')
const statePath = path.join(dataDir, 'discord_warn_state.json')

export interface WarnItem {
  fingerprint: string
  memberSgUsername: string
  category: string
  description: string
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
    }))
}

const WARNING_LABELS: Record<string, string> = {
  unplayed_required_play_giveaways: 'Unplayed required-play win(s)',
  illegal_entered_required_play_giveaways: 'Entered required-play GA despite unmet requirement',
  illegal_entered_any_giveaways: 'Entered a giveaway while ineligible',
  required_plays_need_review: 'Required-play win(s) need review',
  required_play_deadline_within_15_days: 'Required-play deadline within 15 days',
  required_play_deadline_expired: 'Required-play deadline expired',
  zero_play_rate_with_wins: 'Zero play rate despite wins',
  low_play_rate_many_wins: 'Low play rate with many wins',
  inactive_play_but_active: 'Inactive playtime but active on SG',
  no_giveaway_created_in_6_months: 'No giveaway created in 6 months',
}

interface GroupUser {
  username: string
  steam_id: string
  warnings?: string[]
}

interface GroupUsersData {
  users: Record<string, GroupUser>
}

/**
 * Surfaces the per-member rule-violation `warnings` the scraper already
 * computes in group-members.ts (calculateUserWarnings) — required-play
 * compliance, play-rate anomalies, and inactivity flags — as digest items.
 */
export function groupUserWarningsDetector(): WarnItem[] {
  const groupUsersPath = path.join(dataDir, 'group_users.json')
  const groupUsers: GroupUsersData = JSON.parse(readFileSync(groupUsersPath, 'utf-8'))

  const items: WarnItem[] = []
  for (const user of Object.values(groupUsers.users)) {
    for (const code of user.warnings ?? []) {
      const label = WARNING_LABELS[code] ?? code
      items.push({
        fingerprint: `group-warning:${user.steam_id}:${code}`,
        memberSgUsername: user.username,
        category: label,
        description: `${user.username}: ${label}`,
      })
    }
  }
  return items
}

const DETECTORS: Array<() => WarnItem[]> = [exMemberEntriesDetector, groupUserWarningsDetector]

export function runDetectors(): WarnItem[] {
  return DETECTORS.flatMap((detector) => {
    try {
      return detector()
    } catch (err) {
      console.error('⚠️ A warn-digest detector failed:', err)
      return []
    }
  })
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
 * unit test.
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

const SITE_BASE = 'https://sg-club.vercel.app'
const HEADER = '📋 **Weekly Mod Digest**'
const MAX_MESSAGE_LENGTH = 1900

export interface MemberFindings {
  username: string
  hasNew: boolean
  findingLines: string[]
}

/**
 * Groups all findings (new + lingering) by member so each member appears
 * exactly once, with every finding merged onto their entry. Members with at
 * least one new finding sort first; both groups sort alphabetically.
 */
export function groupFindingsByMember(split: DigestSplit): MemberFindings[] {
  const byUser = new Map<string, MemberFindings>()

  const getEntry = (username: string): MemberFindings => {
    let entry = byUser.get(username)
    if (!entry) {
      entry = { username, hasNew: false, findingLines: [] }
      byUser.set(username, entry)
    }
    return entry
  }

  for (const item of split.newItems) {
    const entry = getEntry(item.memberSgUsername)
    entry.hasNew = true
    entry.findingLines.push(`🆕 ${item.category}`)
  }
  for (const item of split.lingeringItems) {
    const entry = getEntry(item.memberSgUsername)
    entry.findingLines.push(`⏳ ${item.category} (since <t:${item.firstSeen}:R>)`)
  }

  return [...byUser.values()].sort((a, b) => {
    if (a.hasNew !== b.hasNew) return a.hasNew ? -1 : 1
    return a.username.localeCompare(b.username)
  })
}

function memberBulletLine(member: MemberFindings): string {
  const url = `${SITE_BASE}/users/${member.username}/`
  // <url> suppresses Discord's link-preview embed — without it every linked
  // member spawns a site-preview card under the digest.
  return `- [${member.username}](<${url}>) — ${member.findingLines.join(' · ')}`
}

/**
 * Renders the grouped findings as one or more plain-markdown messages, each
 * ≤1900 chars, splitting strictly at bullet boundaries so a member's line
 * never gets cut mid-way. The header appears only on the first message.
 */
export function buildDigestMessages(split: DigestSplit): string[] {
  const bullets = groupFindingsByMember(split).map(memberBulletLine)
  if (bullets.length === 0) return []

  const messages: string[] = []
  let current: string[] = []

  const currentText = (withHeader: boolean) =>
    (withHeader ? `${HEADER}\n` : '') + current.join('\n')

  for (const bullet of bullets) {
    const isFirstMessage = messages.length === 0
    const prospective = [...current, bullet]
    const prospectiveText = (isFirstMessage ? `${HEADER}\n` : '') + prospective.join('\n')
    if (current.length > 0 && prospectiveText.length > MAX_MESSAGE_LENGTH) {
      messages.push(currentText(isFirstMessage))
      current = [bullet]
    } else {
      current = prospective
    }
  }
  if (current.length > 0) {
    messages.push(currentText(messages.length === 0))
  }
  return messages
}

/**
 * Runs every detector, diffs against discord_warn_state.json, and posts a
 * digest message — unless there are zero findings, in which case it stays
 * silent and doesn't touch state.
 */
export async function postWarnDigest(): Promise<void> {
  const state = loadState()
  const items = runDetectors()
  const now = Math.floor(Date.now() / 1000)
  const split = splitAndUpdateState(items, state, now)

  if (items.length === 0) {
    console.log('✅ No warn-digest findings — staying silent.')
    return
  }

  const channelId = process.env.WARN_CHANNEL_ID ?? TEST_ANNOUNCE_CHANNEL_ID
  for (const content of buildDigestMessages(split)) {
    await createMessage(channelId, { content })
  }

  saveState(split.updatedState)
  console.log(
    `📋 Posted warn digest: ${split.newItems.length} new, ${split.lingeringItems.length} lingering, ${split.prunedFingerprints.length} pruned.`
  )
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await postWarnDigest()
  }
}
