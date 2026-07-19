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

const EMBED_FIELD_VALUE_LIMIT = 1024
const MAX_EMBED_FIELDS = 25

/**
 * Splits lines into as many ≤1024-char fields as needed ("<name>", then
 * "<name> (cont.)") — Discord silently rejects longer field values, and a
 * hard slice would silently drop members from the digest.
 */
function chunkIntoFields(name: string, lines: string[]): Array<{ name: string; value: string }> {
  const fields: Array<{ name: string; value: string }> = []
  let current: string[] = []
  let currentLength = 0

  for (const line of lines) {
    if (currentLength + line.length + 1 > EMBED_FIELD_VALUE_LIMIT && current.length > 0) {
      fields.push({ name: fields.length === 0 ? name : `${name} (cont.)`, value: current.join('\n') })
      current = []
      currentLength = 0
    }
    current.push(line)
    currentLength += line.length + 1
  }
  if (current.length > 0) {
    fields.push({ name: fields.length === 0 ? name : `${name} (cont.)`, value: current.join('\n') })
  }
  return fields
}

function buildDigestEmbeds(split: DigestSplit): Array<Record<string, unknown>> {
  const fields: Array<{ name: string; value: string }> = []

  if (split.newItems.length > 0) {
    fields.push(
      ...chunkIntoFields(
        `🆕 New this week (${split.newItems.length})`,
        split.newItems.map((item) => `**${item.memberSgUsername}** — ${item.category}`)
      )
    )
  }
  if (split.lingeringItems.length > 0) {
    fields.push(
      ...chunkIntoFields(
        `⏳ Lingering (${split.lingeringItems.length})`,
        split.lingeringItems.map(
          (item) =>
            `**${item.memberSgUsername}** — ${item.category} (since <t:${item.firstSeen}:R>)`
        )
      )
    )
  }

  // An embed holds at most 25 fields / 6000 chars; spread across several
  // embeds when a digest is huge (25 fields of ≤1024 chars can exceed 6000).
  const embeds: Array<Record<string, unknown>> = []
  for (let i = 0; i < fields.length; i += 5) {
    embeds.push({
      title: embeds.length === 0 ? '📋 Weekly Mod Digest' : '📋 Weekly Mod Digest (cont.)',
      color: 0xed4245,
      fields: fields.slice(i, i + 5),
    })
  }
  return embeds.slice(0, MAX_EMBED_FIELDS)
}

/**
 * Runs every detector, diffs against discord_warn_state.json, and posts a
 * digest embed — unless there are zero findings, in which case it stays
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
  // One embed per message — the 6000-char embed limit applies to the whole
  // message, so batching embeds together can exceed it on big digests.
  for (const embed of buildDigestEmbeds(split)) {
    await createMessage(channelId, { embeds: [embed] })
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
