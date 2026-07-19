// Builds the Discord message payloads (embeds + components) for the
// announcement, the closed-signups summary, and /challenge-list.

import {
  encodeSignupCustomId,
  type SignupChoice,
} from './custom-id.js'
import type { Roster, RosterEntry } from './signup-log.js'
import { ButtonStyle, ComponentType } from './constants.js'

const EMBED_DESCRIPTION_LIMIT = 4096
const EMBED_FIELD_VALUE_LIMIT = 1024
const CODEBLOCK_CHUNK_LIMIT = 1900 // headroom under Discord's 2000-char message limit

const ACCENT_COLOR = 0x5865f2
const CLOSED_COLOR = 0x2b2d31
const WARN_COLOR = 0xed4245

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

function nameForEntry(entry: RosterEntry): string {
  const base = entry.sg_username ?? `@${entry.discord_handle}`
  return entry.guest || entry.sg_username === null ? `⚠️${base}` : base
}

function namesLine(entries: RosterEntry[]): string {
  return entries.length > 0 ? entries.map(nameForEntry).join(', ') : '_none_'
}

export function buildClosedSummaryEmbed(input: {
  name: string
  wanters: RosterEntry[]
  owners: RosterEntry[]
}): Record<string, unknown> {
  return {
    title: `🔒 Signups closed — ${truncate(input.name, 230)}`,
    color: CLOSED_COLOR,
    fields: [
      {
        name: `🎁 Want the game (${input.wanters.length})`,
        value: truncate(namesLine(input.wanters), EMBED_FIELD_VALUE_LIMIT),
      },
      {
        name: `✅ Already have it (${input.owners.length})`,
        value: truncate(namesLine(input.owners), EMBED_FIELD_VALUE_LIMIT),
      },
    ],
  }
}

function chunkedCodeblock(label: string, names: string[]): string[] {
  if (names.length === 0) {
    return [`**${label}** (0):\n\`\`\`\n(none)\n\`\`\``]
  }

  const joined = names.join(', ')
  if (joined.length <= CODEBLOCK_CHUNK_LIMIT) {
    return [`**${label}** (${names.length}):\n\`\`\`\n${joined}\n\`\`\``]
  }

  // Split on comma boundaries so we never cut a username in half.
  const chunks: string[] = []
  let current: string[] = []
  let currentLength = 0
  for (const name of names) {
    const additional = current.length === 0 ? name.length : name.length + 2
    if (currentLength + additional > CODEBLOCK_CHUNK_LIMIT && current.length > 0) {
      chunks.push(current.join(', '))
      current = []
      currentLength = 0
    }
    current.push(name)
    currentLength += additional
  }
  if (current.length > 0) chunks.push(current.join(', '))

  return chunks.map(
    (chunk, i) => `**${label}** (${names.length}) [${i + 1}/${chunks.length}]:\n\`\`\`\n${chunk}\n\`\`\``
  )
}

export interface ChallengeListOutput {
  embed: Record<string, unknown>
  codeblocks: string[]
}

export function buildChallengeListOutput(input: {
  name: string
  roster: Roster
}): ChallengeListOutput {
  const { roster } = input
  const descriptionLines = [
    `🎁 Want: **${roster.wanters.length}**`,
    `✅ Have: **${roster.owners.length}**`,
    `Total: **${roster.all.length}**`,
  ]
  if (roster.unresolved.length > 0) {
    descriptionLines.push(`⚠️ Unresolved/guest: **${roster.unresolved.length}**`)
  }

  const embed = {
    title: `📋 ${truncate(input.name, 230)} — Signups`,
    description: descriptionLines.join('\n'),
    color: roster.unresolved.length > 0 ? WARN_COLOR : ACCENT_COLOR,
  }

  const codeblocks = [
    ...chunkedCodeblock('Want the game', roster.wanters.map(nameForEntry)),
    ...chunkedCodeblock('All participants', roster.all.map(nameForEntry)),
  ]

  return { embed, codeblocks }
}
