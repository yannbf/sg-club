// The log-channel protocol: every signup-related event is a single message
// posted to the log channel (#bot-test-logs in test phase), one event per
// line, in the form `TYPE {json}`. This is the only persisted state for the
// whole feature — no database.

import type { SignupChoice } from './custom-id'

export interface ChallengeMeta {
  slug: string
  channel_id: string
  message_id: string
  deadline: number
  start: number
  end: number
  name: string
}

export interface SignupEvent {
  slug: string
  choice: SignupChoice
  discord_id: string
  discord_handle: string
  sg_username: string | null
  guest: boolean
  ts: number
}

export interface ClosedEvent {
  slug: string
  ts: number
}

export function serializeChallenge(meta: ChallengeMeta): string {
  return `CHALLENGE ${JSON.stringify(meta)}`
}

export function serializeSignup(event: SignupEvent): string {
  return `SIGNUP ${JSON.stringify(event)}`
}

export function serializeClosed(event: ClosedEvent): string {
  return `CLOSED ${JSON.stringify(event)}`
}

export type ParsedLogEntry =
  | { type: 'CHALLENGE'; data: ChallengeMeta }
  | { type: 'SIGNUP'; data: SignupEvent }
  | { type: 'CLOSED'; data: ClosedEvent }

/**
 * Tolerant parser — anything that isn't a well-formed protocol line (garbage,
 * human chatter, a bot message from before the protocol existed, etc.)
 * returns null instead of throwing, so callers can just skip it.
 */
export function parseLogLine(content: string): ParsedLogEntry | null {
  const spaceIdx = content.indexOf(' ')
  if (spaceIdx === -1) return null

  const type = content.slice(0, spaceIdx)
  if (type !== 'CHALLENGE' && type !== 'SIGNUP' && type !== 'CLOSED') return null

  const jsonPart = content.slice(spaceIdx + 1)
  let data: unknown
  try {
    data = JSON.parse(jsonPart)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null

  const record = data as Record<string, unknown>
  if (typeof record.slug !== 'string') return null

  if (type === 'CHALLENGE') {
    if (typeof record.channel_id !== 'string' || typeof record.message_id !== 'string') return null
    return { type, data: data as ChallengeMeta }
  }
  if (type === 'SIGNUP') {
    if (typeof record.discord_id !== 'string' || typeof record.ts !== 'number') return null
    return { type, data: data as SignupEvent }
  }
  // CLOSED
  if (typeof record.ts !== 'number') return null
  return { type, data: data as ClosedEvent }
}

export interface RosterEntry {
  discord_id: string
  discord_handle: string
  sg_username: string | null
  guest: boolean
  choice: 'want' | 'have'
}

export interface Roster {
  wanters: RosterEntry[]
  owners: RosterEntry[]
  all: RosterEntry[]
  unresolved: RosterEntry[]
}

/**
 * Dedupes SIGNUP events for a slug by discord_id, keeping the latest event
 * (by `ts`, the source of truth for "log order" — this makes the result
 * independent of whatever order the caller's message list is in, which
 * matters because Discord's message-list API returns newest-first).
 * Users whose latest choice is `out` are dropped entirely.
 */
export function buildRoster(
  logMessages: Array<{ content: string }>,
  slug: string
): Roster {
  const latestByUser = new Map<string, SignupEvent>()

  for (const message of logMessages) {
    const parsed = parseLogLine(message.content)
    if (!parsed || parsed.type !== 'SIGNUP' || parsed.data.slug !== slug) continue

    const event = parsed.data
    const existing = latestByUser.get(event.discord_id)
    if (!existing || event.ts >= existing.ts) {
      latestByUser.set(event.discord_id, event)
    }
  }

  const wanters: RosterEntry[] = []
  const owners: RosterEntry[] = []
  const unresolved: RosterEntry[] = []

  for (const event of latestByUser.values()) {
    if (event.choice === 'out') continue

    const entry: RosterEntry = {
      discord_id: event.discord_id,
      discord_handle: event.discord_handle,
      sg_username: event.sg_username,
      guest: event.guest,
      choice: event.choice,
    }

    if (entry.choice === 'want') wanters.push(entry)
    else owners.push(entry)

    if (entry.guest || entry.sg_username === null) unresolved.push(entry)
  }

  return { wanters, owners, all: [...wanters, ...owners], unresolved }
}
