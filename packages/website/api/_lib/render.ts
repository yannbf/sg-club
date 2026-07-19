// Builds the Discord message payloads for the announcement (still an embed
// + buttons — the live-updating widget), and plain-markdown content for the
// closed-signups summary and /challenge-list.

import {
  encodeSignupCustomId,
  type SignupChoice,
} from './custom-id.js'
import type { Roster, RosterEntry } from './signup-log.js'
import { ButtonStyle, ComponentType } from './constants.js'
import { chunkMessage } from './mod-report.js'

const EMBED_DESCRIPTION_LIMIT = 4096
const EMBED_FIELD_VALUE_LIMIT = 1024
const CODEBLOCK_CHUNK_LIMIT = 1900 // headroom under Discord's 2000-char message limit

const ACCENT_COLOR = 0x5865f2

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 1)}…`
}

export interface AnnouncementInput {
  name: string
  description: string
  signupDeadline: number
  start: number
  end: number
}

function formatSignupCounts(wantCount: number, haveCount: number): string {
  return `🎁 ${wantCount} want · ✅ ${haveCount} have`
}

const SIGNUP_COUNT_FIELD_NAME = 'Signups so far'

/** Upserts the "Signups so far" field on an existing embed by name, preserving everything else. */
export function withUpdatedSignupCounts(
  embed: Record<string, unknown>,
  wantCount: number,
  haveCount: number
): Record<string, unknown> {
  const existingFields = Array.isArray(embed.fields)
    ? (embed.fields as Array<{ name: string; value: string }>)
    : []
  const value = formatSignupCounts(wantCount, haveCount)
  const idx = existingFields.findIndex((f) => f.name === SIGNUP_COUNT_FIELD_NAME)
  const fields =
    idx === -1
      ? [...existingFields, { name: SIGNUP_COUNT_FIELD_NAME, value }]
      : existingFields.map((f, i) => (i === idx ? { ...f, value } : f))
  return { ...embed, fields }
}

export function buildAnnouncementEmbed(input: AnnouncementInput): Record<string, unknown> {
  const embed: Record<string, unknown> = {
    title: truncate(input.name, 256),
    description: truncate(input.description, EMBED_DESCRIPTION_LIMIT),
    color: ACCENT_COLOR,
    fields: [
      {
        name: 'Signups close',
        value: truncate(
          `<t:${input.signupDeadline}:F> (<t:${input.signupDeadline}:R>)`,
          EMBED_FIELD_VALUE_LIMIT
        ),
      },
      {
        name: 'Challenge',
        value: truncate(`<t:${input.start}:D> → <t:${input.end}:D>`, EMBED_FIELD_VALUE_LIMIT),
      },
      {
        name: SIGNUP_COUNT_FIELD_NAME,
        value: formatSignupCounts(0, 0),
      },
    ],
  }
  return embed
}

interface ActionRowButton {
  type: typeof ComponentType.BUTTON
  style: number
  label: string
  custom_id: string
  disabled?: boolean
}

interface ActionRow {
  type: typeof ComponentType.ACTION_ROW
  components: ActionRowButton[]
}

const BUTTON_SPECS: Array<{ choice: SignupChoice; label: string; style: number }> = [
  { choice: 'want', label: '🎁 I want the game', style: ButtonStyle.SUCCESS },
  { choice: 'have', label: '✅ I already have it', style: ButtonStyle.PRIMARY },
  { choice: 'out', label: '❌ Withdraw', style: ButtonStyle.DANGER },
]

export function buildSignupComponents(slug: string, deadlineEpoch: number): ActionRow[] {
  return [
    {
      type: ComponentType.ACTION_ROW,
      components: BUTTON_SPECS.map((spec) => ({
        type: ComponentType.BUTTON,
        style: spec.style,
        label: spec.label,
        custom_id: encodeSignupCustomId(slug, spec.choice, deadlineEpoch),
      })),
    },
  ]
}

export function buildDisabledComponents(slug: string, deadlineEpoch: number): ActionRow[] {
  const rows = buildSignupComponents(slug, deadlineEpoch)
  return rows.map((row) => ({
    ...row,
    components: row.components.map((component) => ({ ...component, disabled: true })),
  }))
}

// No emoji marker here (per the no-emoji policy on plain-content outputs) —
// a guest/unresolved entry that never got matched to an SG username just
// falls back to their Discord handle.
function nameForEntry(entry: RosterEntry): string {
  return entry.sg_username ?? `@${entry.discord_handle}`
}

/**
 * Splits `names` into as few comma-joined chunks as possible, each
 * ≤`limit` chars, splitting only at comma boundaries so a name is never cut
 * in half. Shared by the codeblock and plain-line renderers below, both of
 * which need this for member lists too long to fit in a single message.
 */
function splitNamesIntoChunks(names: string[], limit: number): string[] {
  const chunks: string[] = []
  let current: string[] = []
  let currentLength = 0
  for (const name of names) {
    const additional = current.length === 0 ? name.length : name.length + 2
    if (currentLength + additional > limit && current.length > 0) {
      chunks.push(current.join(', '))
      current = []
      currentLength = 0
    }
    current.push(name)
    currentLength += additional
  }
  if (current.length > 0) chunks.push(current.join(', '))
  return chunks
}

function chunkedCodeblock(label: string, names: string[]): string[] {
  if (names.length === 0) {
    return [`**${label}** (0):\n\`\`\`\n(none)\n\`\`\``]
  }

  const joined = names.join(', ')
  if (joined.length <= CODEBLOCK_CHUNK_LIMIT) {
    return [`**${label}** (${names.length}):\n\`\`\`\n${joined}\n\`\`\``]
  }

  const chunks = splitNamesIntoChunks(names, CODEBLOCK_CHUNK_LIMIT)
  return chunks.map(
    (chunk, i) => `**${label}** (${names.length}) [${i + 1}/${chunks.length}]:\n\`\`\`\n${chunk}\n\`\`\``
  )
}

/** Same idea as chunkedCodeblock but as a plain (no-codeblock) label line. */
function chunkedNamesLine(label: string, names: string[]): string[] {
  if (names.length === 0) {
    return [`${label} (0): _none_`]
  }

  const joined = names.join(', ')
  if (joined.length <= CODEBLOCK_CHUNK_LIMIT) {
    return [`${label} (${names.length}): ${joined}`]
  }

  const chunks = splitNamesIntoChunks(names, CODEBLOCK_CHUNK_LIMIT)
  return chunks.map((chunk, i) => `${label} (${names.length}) [${i + 1}/${chunks.length}]: ${chunk}`)
}

/**
 * Plain-markdown closed-signups summary, chunked into ≤1900-char messages.
 * The full name lists are kept (split at comma boundaries if a single list
 * would overflow a message). Emoji-free.
 */
export function buildClosedSummaryMessages(input: {
  name: string
  wanters: RosterEntry[]
  owners: RosterEntry[]
}): string[] {
  const segments = [
    `**Signups closed — ${truncate(input.name, 230)}**`,
    ...chunkedNamesLine('Want the game', input.wanters.map(nameForEntry)),
    ...chunkedNamesLine('Already have it', input.owners.map(nameForEntry)),
  ]
  return chunkMessage(segments, CODEBLOCK_CHUNK_LIMIT)
}

/**
 * Plain-markdown /challenge-list output, chunked into ≤1900-char messages.
 * Want/Have keep their codeblocks (for easy copy-paste); unresolved/guest
 * entries get their own plain list rather than an inline marker. Emoji-free.
 */
export function buildChallengeListMessages(input: { name: string; roster: Roster }): string[] {
  const { roster } = input

  const segments = [
    `**${truncate(input.name, 230)} — signups**`,
    ...chunkedCodeblock('Want the game', roster.wanters.map(nameForEntry)),
    ...chunkedCodeblock('Already have it', roster.owners.map(nameForEntry)),
    ...chunkedNamesLine('Unresolved/guests', roster.unresolved.map(nameForEntry)),
    `Total: ${roster.all.length}`,
  ]

  return chunkMessage(segments, CODEBLOCK_CHUNK_LIMIT)
}
