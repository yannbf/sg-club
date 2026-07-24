import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createMessage,
  getAllChannelMessages,
  getGuildEmojis,
} from '../../../website/api/_lib/discord-rest.js'
import { parseLogLine, type ChallengeMeta } from '../../../website/api/_lib/signup-log.js'
import {
  getLogChannelId,
  GUILD_ID,
  TEST_ANNOUNCE_CHANNEL_ID,
} from '../../../website/api/_lib/constants.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(__dirname, '../../..', 'website/public/data')
const statePath = path.join(dataDir, 'discord_announce_state.json')

interface Participant {
  username: string
  /**
   * Precomputed by generate-challenge-data.ts:
   * is_complete && meets_playtime && meets_review && !completed_after_deadline.
   * The single source of truth for "qualified" — using anything weaker
   * announced a member who hadn't written their required review yet.
   */
  is_winner: boolean
}

interface ChallengeFile {
  slug: string
  gameName: string
  challengeOver: boolean
  participants: Participant[]
}

export interface AnnounceState {
  announced: Record<string, string[]>
}

function loadState(): AnnounceState {
  if (!existsSync(statePath)) return { announced: {} }
  return JSON.parse(readFileSync(statePath, 'utf-8'))
}

function saveState(state: AnnounceState): void {
  writeFileSync(statePath, JSON.stringify(state, null, 2))
}

/**
 * A participant qualifies when the site says so: `is_winner` already encodes
 * completion + playtime + required review + within-deadline (and the frozen
 * winner set once a challenge is over).
 */
export function qualifyingUsernames(challenge: Pick<ChallengeFile, 'participants'>): string[] {
  return challenge.participants.filter((p) => p.is_winner).map((p) => p.username)
}

/**
 * Pure diffing logic: never re-announce a username already recorded for this
 * slug. Kept standalone so it's trivial to unit test independent of the
 * filesystem/Discord calls.
 */
export function diffNewCompletions(qualifying: string[], alreadyAnnounced: string[]): string[] {
  const already = new Set(alreadyAnnounced)
  return qualifying.filter((username) => !already.has(username))
}

function findActiveChallengeFiles(): ChallengeFile[] {
  return readdirSync(dataDir)
    .filter((file) => file.startsWith('challenge_') && file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(path.join(dataDir, file), 'utf-8')) as ChallengeFile)
    .filter((challenge) => challenge.challengeOver === false)
}

const PANDA_EMOJI_NAME = 'pandaparty'
const FALLBACK_EMOJI = '🐼🎉'
const MAX_MESSAGE_LENGTH = 1900

/** Looks up the custom `pandaparty` guild emoji, falling back to the default if it can't be found. */
export async function resolvePandaEmoji(): Promise<string> {
  try {
    const emojis = await getGuildEmojis(GUILD_ID)
    const panda = emojis.find((e) => e.name === PANDA_EMOJI_NAME)
    if (!panda) return FALLBACK_EMOJI
    return panda.animated ? `<a:pandaparty:${panda.id}>` : `<:pandaparty:${panda.id}>`
  } catch (err) {
    console.warn('⚠️ Could not fetch guild emojis; falling back to the default emoji:', err)
    return FALLBACK_EMOJI
  }
}

/** Joins names with commas and a final "and", no Oxford comma. */
export function joinNamesWithAnd(names: string[]): string {
  const bold = names.map((n) => `**${n}**`)
  if (bold.length === 1) return bold[0]
  if (bold.length === 2) return `${bold[0]} and ${bold[1]}`
  return `${bold.slice(0, -1).join(', ')} and ${bold[bold.length - 1]}`
}

/** Builds a single congrats message for a batch of usernames that finished the same challenge. */
export function buildCongratsMessage(usernames: string[], gameName: string, emoji: string): string {
  return `🎉 ${joinNamesWithAnd(usernames)} just finished the **${gameName}** challenge! Congrats ${emoji}`
}

/**
 * Groups usernames into as few batches as possible while keeping each
 * rendered message under MAX_MESSAGE_LENGTH. A single username that alone
 * exceeds the limit still gets its own batch — nobody gets dropped.
 */
export function batchUsernames(usernames: string[], gameName: string, emoji: string): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  for (const username of usernames) {
    const candidate = [...current, username]
    if (current.length > 0 && buildCongratsMessage(candidate, gameName, emoji).length > MAX_MESSAGE_LENGTH) {
      batches.push(current)
      current = [username]
    } else {
      current = candidate
    }
  }
  if (current.length > 0) batches.push(current)
  return batches
}

/**
 * Pure channel-selection logic, split out for testability: a matched
 * challenge posts congrats to its dedicated `congrats_channel_id` when the
 * two-channel split was chosen at setup time, else its `channel_id` like
 * every other challenge message. No match at all (old data, or the log
 * channel couldn't be read) falls back to the env var / test channel.
 */
export function pickCongratsChannel(
  meta: Pick<ChallengeMeta, 'channel_id' | 'congrats_channel_id'> | undefined,
  fallbackChannelId: string
): string {
  if (!meta) return fallbackChannelId
  return meta.congrats_channel_id ?? meta.channel_id
}

async function resolveChannelForSlug(slug: string): Promise<string> {
  const fallbackChannelId = process.env.CONGRATS_CHANNEL_ID ?? TEST_ANNOUNCE_CHANNEL_ID
  try {
    const messages = await getAllChannelMessages(getLogChannelId(), 2000)
    for (const message of messages) {
      const parsed = parseLogLine(message.content)
      if (parsed?.type === 'CHALLENGE' && parsed.data.slug === slug) {
        return pickCongratsChannel(parsed.data, fallbackChannelId)
      }
    }
  } catch (err) {
    console.warn(`⚠️ Could not read log channel to resolve a channel for "${slug}":`, err)
  }
  return fallbackChannelId
}

/**
 * Scans local challenge_*.json files for newly-completed participants and
 * announces each exactly once, tracked in discord_announce_state.json.
 */
export async function announceNewCompletions(): Promise<void> {
  const challenges = findActiveChallengeFiles()
  const state = loadState()
  let anyNew = false
  const emoji = await resolvePandaEmoji()

  for (const challenge of challenges) {
    const qualifying = qualifyingUsernames(challenge)
    const alreadyAnnounced = state.announced[challenge.slug] ?? []
    const newlyCompleted = diffNewCompletions(qualifying, alreadyAnnounced)
    if (newlyCompleted.length === 0) continue

    anyNew = true
    const channelId = await resolveChannelForSlug(challenge.slug)
    const batches = batchUsernames(newlyCompleted, challenge.gameName, emoji)

    for (const batch of batches) {
      await createMessage(channelId, {
        content: buildCongratsMessage(batch, challenge.gameName, emoji),
        flags: 4,
      })
      // State is saved after every batch, not at the end — a crash mid-loop
      // (e.g. rate limiting) must never lead to duplicate announcements on
      // the next run. Worst case on a crash mid-run is a whole batch gets
      // re-sent, same tradeoff the old per-user code had.
      state.announced[challenge.slug] = [...(state.announced[challenge.slug] ?? []), ...batch]
      saveState(state)
      console.log(`🎉 Announced ${batch.join(', ')} for ${challenge.slug}`)
    }
  }

  if (!anyNew) {
    console.log('✅ No new challenge completions to announce.')
  }
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await announceNewCompletions()
  }
}
