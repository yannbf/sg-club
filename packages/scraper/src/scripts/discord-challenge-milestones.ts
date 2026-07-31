import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// Cross-package relative import — see discord-close-signups.ts / DISCORD-BOT.md.
import { createMessage, getAllChannelMessages } from '../../../website/api/_lib/discord-rest.js'
import {
  collectChallengeIndex,
  serializeEnded,
  serializeReminder24,
  type ChallengeMeta,
} from '../../../website/api/_lib/signup-log.js'
import { getAdminChannelId, getLogChannelId } from '../../../website/api/_lib/constants.js'
import { slugify } from '../../../website/api/_lib/custom-id.js'
import { qualifyingUsernames } from './discord-challenge-congrats.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(__dirname, '../../..', 'website/public/data')

const REMINDER_WINDOW_SECONDS = 24 * 60 * 60
const EVENTS_URL = 'https://sg-club.vercel.app/events/'

interface Participant {
  username: string
  /** Precomputed site qualification — see discord-challenge-congrats.ts. */
  is_winner: boolean
}

interface ChallengeFile {
  slug: string
  gameName: string
  participants: Participant[]
  /** True once the file was generated after the challenge deadline — the
   * frozen-results signal the ended admin nudge reports. */
  challengeOver?: boolean
}

/**
 * Reads every local challenge_*.json, regardless of `challengeOver` — unlike
 * discord-challenge-congrats.ts, which skips already-closed challenges (it
 * only cares about newly-qualifying participants), milestones needs the
 * qualified count for a challenge right up to and past its end date.
 */
function loadChallengeFiles(): ChallengeFile[] {
  return readdirSync(dataDir)
    .filter((file) => file.startsWith('challenge_') && file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(path.join(dataDir, file), 'utf-8')) as ChallengeFile)
}

/**
 * Appends " challenge" to `name` unless it already ends with the word
 * "challenge" (case-insensitive, trailing whitespace tolerated) — avoids
 * doubling up into "Test Challenge challenge".
 */
export function challengePhrase(name: string): string {
  const trimmed = name.replace(/\s+$/, '')
  return /challenge$/i.test(trimmed) ? trimmed : `${trimmed} challenge`
}

/**
 * Finds the local challenge_*.json matching a CHALLENGE meta, trying (in
 * order): exact slug match, `slugify(gameName) === meta.slug`,
 * `slugify(meta.name) === json.slug`, then `slugify(meta.name) ===
 * slugify(gameName)`. Returns undefined if nothing matches — callers must
 * not invent a qualified-member count in that case.
 */
export function matchChallengeFile(
  meta: Pick<ChallengeMeta, 'slug' | 'name'>,
  files: ChallengeFile[]
): ChallengeFile | undefined {
  return (
    files.find((f) => f.slug === meta.slug) ??
    files.find((f) => slugify(f.gameName) === meta.slug) ??
    files.find((f) => slugify(meta.name) === f.slug) ??
    files.find((f) => slugify(meta.name) === slugify(f.gameName))
  )
}

/**
 * `Only 24h until the <phrase> is over!`, plus a second sentence with the
 * qualified-member count — omitted entirely (not "0 qualified members") when
 * `qualifiedCount` is null, i.e. no local data file matched this challenge.
 */
export function build24hReminderMessage(name: string, qualifiedCount: number | null): string {
  const headline = `Only 24h until the ${challengePhrase(name)} is over!`
  return qualifiedCount === null ? headline : `${headline} We've got ${qualifiedCount} qualified members so far!`
}

/** `The <phrase> is over! Click [here](<url>) to see the results` — the `(<url>)` form suppresses the link preview. */
export function buildEndedMessage(name: string): string {
  return `The ${challengePhrase(name)} is over! Click [here](<${EVENTS_URL}>) to see the results`
}

// The site's data refresh cron fires at :25 every hour; scraping, committing,
// and the Vercel deploy take up to ~10 more minutes, so results land by :35.
const DATA_REFRESH_MINUTE = 25
const DATA_REFRESH_BUFFER_SECONDS = 10 * 60

/**
 * When the NEXT hourly data refresh's results should be live on the site:
 * the next :25 after `nowSeconds`, plus the scrape+deploy buffer (i.e. that
 * hour's :35). Used by the ended admin nudge so mods get a concrete "check
 * back at" moment instead of guessing the cron cadence.
 */
export function nextResultsReadyTs(nowSeconds: number): number {
  const nowDate = new Date(nowSeconds * 1000)
  const hourStartSeconds =
    Date.UTC(
      nowDate.getUTCFullYear(),
      nowDate.getUTCMonth(),
      nowDate.getUTCDate(),
      nowDate.getUTCHours()
    ) / 1000
  const refreshThisHour = hourStartSeconds + DATA_REFRESH_MINUTE * 60
  const nextRefresh = nowSeconds < refreshThisHour ? refreshThisHour : refreshThisHour + 3600
  return nextRefresh + DATA_REFRESH_BUFFER_SECONDS
}

/**
 * Instructional nudge posted to the admin channel alongside the public
 * "challenge over" notice — points mods at /raffle's pasted-list mode for
 * the prize draw among finishers. Plain markdown, no emojis.
 *
 * `resultsFinal` reflects whether the matched data file was generated AFTER
 * the deadline (`challengeOver: true`): the site data refreshes hourly at
 * :25 while this notice goes out at :50, so results are normally final — but
 * if that refresh failed or lagged, a member finishing in the last minutes
 * could still be missing from the results page, and the nudge must say so
 * rather than let an admin draw from a stale list.
 */
export function buildEndedAdminNudge(name: string, resultsFinal: boolean, nowSeconds: number): string {
  const readyTs = nextResultsReadyTs(nowSeconds)
  const freshness = resultsFinal
    ? 'The results page is final — safe to copy the qualified list.'
    : `Heads-up: the results data has NOT refreshed past the deadline yet. It should be final <t:${readyTs}:R> (<t:${readyTs}:t>) — wait until then before copying the qualified list, or a last-minute finisher could be missed.`
  return (
    `The ${challengePhrase(name)} just ended. For the prize draw, copy the qualified members from ` +
    `[the results page](<${EVENTS_URL}>) and use /raffle with "Paste a list of names…" plus the number of winners. ` +
    `Run it in the channel where the winners should be announced (e.g. #challenge-announcements) — the draw result is posted right there, and every draw is logged in the bot log channel.\n` +
    freshness
  )
}

/**
 * True when `meta` is within (but not past) the 24h window before its end,
 * and hasn't been reminded yet. Challenges whose TOTAL duration is 24h or
 * less never get the reminder — they're born inside the window, and a "24h
 * left" warning that fires the moment a short challenge is created is noise
 * (found live with a ~15h test challenge).
 */
export function needsReminder(
  meta: Pick<ChallengeMeta, 'slug' | 'start' | 'end'>,
  remindedSlugs: Set<string>,
  nowSeconds: number
): boolean {
  if (remindedSlugs.has(meta.slug)) return false
  if (meta.end - meta.start <= REMINDER_WINDOW_SECONDS) return false
  const secondsToEnd = meta.end - nowSeconds
  return secondsToEnd <= REMINDER_WINDOW_SECONDS && secondsToEnd > 0
}

/** True when `meta`'s end has passed and the "challenge over" notice hasn't gone out yet. */
export function needsEndedNotice(meta: Pick<ChallengeMeta, 'slug' | 'end'>, endedSlugs: Set<string>, nowSeconds: number): boolean {
  return meta.end <= nowSeconds && !endedSlugs.has(meta.slug)
}

/**
 * Reads the signup-log channel once, finds every CHALLENGE that's within 24h
 * of its end (and not yet reminded) or already past its end (and not yet
 * marked ENDED), and posts the corresponding milestone message to the
 * challenge's own channel, then logs the marker.
 *
 * Idempotent across runs via the REMINDER24/ENDED markers, which are posted
 * AFTER the channel message — a crash mid-run risks a duplicate post on
 * retry, never a missed one. Archived challenges are skipped entirely — no
 * reminder, no ended notice, no marker.
 */
export async function postChallengeMilestones(): Promise<void> {
  const logChannelId = getLogChannelId()
  const messages = await getAllChannelMessages(logChannelId, 2000)
  const index = collectChallengeIndex(messages)

  const remindedSlugs = new Set(
    [...index.entries()].filter(([, entry]) => entry.reminded).map(([slug]) => slug)
  )
  const endedSlugs = new Set(
    [...index.entries()].filter(([, entry]) => entry.ended).map(([slug]) => slug)
  )
  const challenges: ChallengeMeta[] = [...index.values()]
    .filter((entry) => !entry.archived)
    .map((entry) => entry.meta)

  const nowSeconds = Math.floor(Date.now() / 1000)
  const challengeFiles = loadChallengeFiles()
  let anyPosted = false

  for (const meta of challenges) {
    if (needsReminder(meta, remindedSlugs, nowSeconds)) {
      const file = matchChallengeFile(meta, challengeFiles)
      let qualifiedCount: number | null = null
      if (file) {
        qualifiedCount = qualifyingUsernames(file).length
      } else {
        console.log(
          `ℹ️ No local data file matched "${meta.name}" (${meta.slug}) — posting the 24h reminder without a qualified-member count.`
        )
      }

      await createMessage(meta.channel_id, {
        content: build24hReminderMessage(meta.name, qualifiedCount),
        flags: 4,
      })
      await createMessage(logChannelId, { content: serializeReminder24({ slug: meta.slug, ts: nowSeconds }) })
      anyPosted = true
      console.log(`⏰ Posted 24h reminder for "${meta.name}" (${meta.slug}).`)
    }

    if (needsEndedNotice(meta, endedSlugs, nowSeconds)) {
      await createMessage(meta.channel_id, { content: buildEndedMessage(meta.name), flags: 4 })
      await createMessage(logChannelId, { content: serializeEnded({ slug: meta.slug, ts: nowSeconds }) })
      // Best-effort admin nudge AFTER the ENDED marker — the notice itself
      // must never be blocked (or duplicated on retry) because the admin
      // channel was unreachable. `challengeOver` on the matched data file
      // proves the results were generated after the deadline (see
      // buildEndedAdminNudge); a missing file counts as not-final.
      try {
        const file = matchChallengeFile(meta, challengeFiles)
        await createMessage(getAdminChannelId(), {
          content: buildEndedAdminNudge(meta.name, file?.challengeOver === true, nowSeconds),
          flags: 4,
        })
      } catch (err) {
        console.error(`⚠️ Failed to post the challenge-over admin nudge for "${meta.slug}":`, err)
      }
      anyPosted = true
      console.log(`🏁 Posted "challenge over" notice for "${meta.name}" (${meta.slug}).`)
    }
  }

  if (!anyPosted) {
    console.log('✅ No milestones to post.')
  }
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await postChallengeMilestones()
  }
}
