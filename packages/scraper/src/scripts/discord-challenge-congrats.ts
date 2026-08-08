import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createMessage,
  getAllChannelMessages,
  getGuildEmojis,
} from '../../../website/api/_lib/discord-rest.js'
import {
  collectChallengeIndex,
  matchChallengeFile,
  type ChallengeIndexEntry,
  type ChallengeMeta,
} from '../../../website/api/_lib/signup-log.js'
import {
  getLogChannelId,
  GUILD_ID,
  TEST_ANNOUNCE_CHANNEL_ID,
} from '../../../website/api/_lib/constants.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(__dirname, '../../..', 'website/public/data')
const statePath = path.join(dataDir, 'discord_announce_state.json')

/** Prize tier on tiered challenges: Tier 1 = story cleared, Tier 2 = full completion. */
export type WinTier = 'completion' | 'story'

interface Participant {
  username: string
  /**
   * Precomputed by generate-challenge-data.ts:
   * is_complete && meets_playtime && meets_review && !completed_after_deadline.
   * The single source of truth for "qualified" — using anything weaker
   * announced a member who hadn't written their required review yet.
   */
  is_winner: boolean
  /**
   * Tiered challenges only (e.g. Bloody Spell): which prize tier the winner
   * reached. Absent on single-tier challenges.
   */
  win_tier?: WinTier | null
}

interface ChallengeFile {
  slug: string
  gameName: string
  challengeOver: boolean
  participants: Participant[]
}

export interface AnnounceState {
  announced: Record<string, string[]>
  /**
   * Tiered challenges: the tier each username was last announced at, keyed by
   * slug. Lets a story-tier winner get one more congrats when they upgrade to
   * full completion. Absent for single-tier challenges and in old state files.
   */
  tiers?: Record<string, Record<string, WinTier>>
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

/** One pending congrats: a fresh win, or a story→completion tier upgrade. */
export interface TierAnnouncement {
  username: string
  /** The winner's current tier; null on single-tier challenges. */
  tier: WinTier | null
  /** Previously congratulated at the story tier, now at full completion. */
  upgraded: boolean
}

/**
 * Tier-aware diff: everything `diffNewCompletions` announces, plus one extra
 * announcement for winners previously congratulated at the story tier who have
 * since upgraded to full completion. Never re-announces a same-tier winner.
 */
export function diffTierAnnouncements(
  participants: Participant[],
  alreadyAnnounced: string[],
  announcedTiers: Record<string, WinTier>,
): TierAnnouncement[] {
  const already = new Set(alreadyAnnounced)
  const out: TierAnnouncement[] = []
  for (const p of participants) {
    if (!p.is_winner) continue
    const tier = p.win_tier ?? null
    if (!already.has(p.username)) {
      out.push({ username: p.username, tier, upgraded: false })
    } else if (tier === 'completion' && announcedTiers[p.username] === 'story') {
      out.push({ username: p.username, tier, upgraded: true })
    }
  }
  return out
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
 * Builds one congrats message for a batch of tier announcements. Single-tier
 * challenges (every tier null) keep the classic `buildCongratsMessage` shape.
 * Tiered batches get tier-specific phrasing, and a batch mixing both tiers is
 * grouped into ONE message with a line per tier (Tier 1 = story cleared,
 * Tier 2 = full completion).
 */
export function buildTieredCongratsMessage(
  announcements: TierAnnouncement[],
  gameName: string,
  emoji: string,
): string {
  const story = announcements.filter((a) => a.tier === 'story')
  const completion = announcements.filter((a) => a.tier === 'completion')
  if (story.length === 0 && completion.length === 0) {
    return buildCongratsMessage(
      announcements.map((a) => a.username),
      gameName,
      emoji,
    )
  }

  const storyNames = story.map((a) => a.username)
  const completionNames = completion.map((a) => a.username)
  if (story.length > 0 && completion.length > 0) {
    return [
      `🎉 **${gameName}** challenge update! ${emoji}`,
      `🥇 Tier 1 — story cleared: ${joinNamesWithAnd(storyNames)}`,
      `🏆 Tier 2 — full completion: ${joinNamesWithAnd(completionNames)}`,
    ].join('\n')
  }
  if (completion.length > 0) {
    return completion.every((a) => a.upgraded)
      ? `🏆 ${joinNamesWithAnd(completionNames)} upgraded their **${gameName}** win to Tier 2 — full completion! Congrats ${emoji}`
      : `🏆 ${joinNamesWithAnd(completionNames)} reached 100% of **${gameName}** — a Tier 2 win! Congrats ${emoji}`
  }
  return `🥇 ${joinNamesWithAnd(storyNames)} cleared the story of **${gameName}** — a Tier 1 win! Congrats ${emoji}`
}

/**
 * Groups tier announcements into as few messages as possible while keeping
 * each rendered message under MAX_MESSAGE_LENGTH — same greedy strategy as
 * `batchUsernames`, over the tier-aware message builder.
 */
export function batchAnnouncements(
  announcements: TierAnnouncement[],
  gameName: string,
  emoji: string,
): TierAnnouncement[][] {
  const batches: TierAnnouncement[][] = []
  let current: TierAnnouncement[] = []
  for (const announcement of announcements) {
    const candidate = [...current, announcement]
    if (
      current.length > 0 &&
      buildTieredCongratsMessage(candidate, gameName, emoji).length > MAX_MESSAGE_LENGTH
    ) {
      batches.push(current)
      current = [announcement]
    } else {
      current = candidate
    }
  }
  if (current.length > 0) batches.push(current)
  return batches
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

/**
 * Finds the log-channel index entry for a local challenge file. An exact
 * slug match wins; otherwise the same fuzzy rules as `matchChallengeFile`
 * apply, because the Discord-side slug comes from whatever name an admin
 * typed into /challenge-setup (e.g. "bloody-spell") while data files use
 * hardcoded slugs like "gaming-challenge-4-bloody-spell".
 */
export function findChallengeEntry(
  file: { slug: string; gameName: string },
  index: Map<string, ChallengeIndexEntry>
): ChallengeIndexEntry | undefined {
  return (
    index.get(file.slug) ??
    [...index.values()].find((entry) => matchChallengeFile(entry.meta, [file]) !== undefined)
  )
}

/**
 * Pure routing decision, split out for testability: `null` means the
 * matched challenge carries an `ARCHIVED` marker and congrats posting
 * should be skipped entirely for it. Otherwise resolves to the channel via
 * `pickCongratsChannel` (a matched-but-not-archived meta, or the fallback
 * when no meta matched at all).
 */
export function resolveCongratsChannel(
  file: { slug: string; gameName: string },
  index: Map<string, ChallengeIndexEntry>,
  fallbackChannelId: string
): string | null {
  const entry = findChallengeEntry(file, index)
  if (entry?.archived) return null
  return pickCongratsChannel(entry?.meta, fallbackChannelId)
}

async function resolveChannelForChallenge(
  challenge: Pick<ChallengeFile, 'slug' | 'gameName'>
): Promise<string | null> {
  const fallbackChannelId = process.env.CONGRATS_CHANNEL_ID ?? TEST_ANNOUNCE_CHANNEL_ID
  try {
    const messages = await getAllChannelMessages(getLogChannelId(), 2000)
    const index = collectChallengeIndex(messages)
    if (!findChallengeEntry(challenge, index)) {
      console.warn(
        `⚠️ No CHALLENGE log entry matched "${challenge.slug}" ("${challenge.gameName}") — congrats will post to the fallback channel ${fallbackChannelId}.`
      )
    }
    return resolveCongratsChannel(challenge, index, fallbackChannelId)
  } catch (err) {
    // A transient Discord error here must NOT fall back — that once posted a
    // congrats to the test channel (and recorded it as announced) just
    // because a log-channel read 503'd. Skip the challenge this run; the
    // pending completions are still un-announced, so the next hourly run
    // retries with a working channel lookup.
    console.warn(
      `⚠️ Could not read log channel to resolve a channel for "${challenge.slug}" — skipping congrats this run:`,
      err
    )
    return null
  }
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
    const alreadyAnnounced = state.announced[challenge.slug] ?? []
    const announcedTiers = state.tiers?.[challenge.slug] ?? {}
    const pending = diffTierAnnouncements(
      challenge.participants,
      alreadyAnnounced,
      announcedTiers,
    )
    if (pending.length === 0) continue

    const channelId = await resolveChannelForChallenge(challenge)
    if (channelId === null) {
      // Archived challenge, or the log channel couldn't be read (see
      // resolveChannelForChallenge) — either way nothing is recorded as
      // announced, so a transient failure retries next run.
      console.log(`⏭️ Skipping congrats for "${challenge.slug}" — archived or channel unresolved.`)
      continue
    }

    anyNew = true
    const batches = batchAnnouncements(pending, challenge.gameName, emoji)

    for (const batch of batches) {
      await createMessage(channelId, {
        content: buildTieredCongratsMessage(batch, challenge.gameName, emoji),
        flags: 4,
      })
      // State is saved after every batch, not at the end — a crash mid-loop
      // (e.g. rate limiting) must never lead to duplicate announcements on
      // the next run. Worst case on a crash mid-run is a whole batch gets
      // re-sent, same tradeoff the old per-user code had.
      const announcedSet = new Set(state.announced[challenge.slug] ?? [])
      for (const a of batch) announcedSet.add(a.username)
      state.announced[challenge.slug] = [...announcedSet]
      for (const a of batch) {
        if (a.tier == null) continue
        state.tiers ??= {}
        state.tiers[challenge.slug] ??= {}
        state.tiers[challenge.slug][a.username] = a.tier
      }
      saveState(state)
      console.log(
        `🎉 Announced ${batch
          .map((a) => `${a.username}${a.tier ? ` (${a.tier}${a.upgraded ? ', upgraded' : ''})` : ''}`)
          .join(', ')} for ${challenge.slug}`,
      )
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
