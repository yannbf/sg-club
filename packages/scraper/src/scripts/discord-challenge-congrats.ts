import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMessage, getAllChannelMessages } from '../../../website/api/_lib/discord-rest.js'
import { parseLogLine } from '../../../website/api/_lib/signup-log.js'
import {
  getLogChannelId,
  TEST_ANNOUNCE_CHANNEL_ID,
} from '../../../website/api/_lib/constants.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(__dirname, '../../..', 'website/public/data')
const statePath = path.join(dataDir, 'discord_announce_state.json')

interface Participant {
  username: string
  is_complete: boolean
  completed_before_start: boolean
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

/** A participant qualifies once they've finished the challenge for real (not by having already met it before it started). */
export function qualifyingUsernames(challenge: Pick<ChallengeFile, 'participants'>): string[] {
  return challenge.participants
    .filter((p) => p.is_complete && !p.completed_before_start)
    .map((p) => p.username)
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

async function resolveChannelForSlug(slug: string): Promise<string> {
  try {
    const messages = await getAllChannelMessages(getLogChannelId(), 2000)
    for (const message of messages) {
      const parsed = parseLogLine(message.content)
      if (parsed?.type === 'CHALLENGE' && parsed.data.slug === slug) {
        return parsed.data.channel_id
      }
    }
  } catch (err) {
    console.warn(`⚠️ Could not read log channel to resolve a channel for "${slug}":`, err)
  }
  return process.env.CONGRATS_CHANNEL_ID ?? TEST_ANNOUNCE_CHANNEL_ID
}

/**
 * Scans local challenge_*.json files for newly-completed participants and
 * announces each exactly once, tracked in discord_announce_state.json.
 */
export async function announceNewCompletions(): Promise<void> {
  const challenges = findActiveChallengeFiles()
  const state = loadState()
  let anyNew = false

  for (const challenge of challenges) {
    const qualifying = qualifyingUsernames(challenge)
    const alreadyAnnounced = state.announced[challenge.slug] ?? []
    const newlyCompleted = diffNewCompletions(qualifying, alreadyAnnounced)
    if (newlyCompleted.length === 0) continue

    anyNew = true
    const channelId = await resolveChannelForSlug(challenge.slug)

    for (const username of newlyCompleted) {
      await createMessage(channelId, {
        content: `🎉 **${username}** just finished the **${challenge.gameName}** challenge! Congrats 🐼🎉`,
      })
      // State is saved after every post, not at the end — a crash mid-loop
      // (e.g. rate limiting) must never lead to duplicate announcements on
      // the next run.
      state.announced[challenge.slug] = [...(state.announced[challenge.slug] ?? []), username]
      saveState(state)
      console.log(`🎉 Announced ${username} for ${challenge.slug}`)
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
