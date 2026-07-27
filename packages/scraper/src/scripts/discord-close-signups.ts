import { fileURLToPath } from 'node:url'
// Cross-package relative import — the Discord _lib modules live in the
// website package (api/_lib/) and are reused as-is here rather than
// duplicated. See DISCORD-BOT.md for the rationale.
import {
  createMessage,
  editMessage,
  getAllChannelMessages,
} from '../../../website/api/_lib/discord-rest.js'
import {
  buildRoster,
  collectChallengeIndex,
  serializeClosed,
} from '../../../website/api/_lib/signup-log.js'
import {
  buildClosedSummaryMessages,
  buildDisabledComponents,
} from '../../../website/api/_lib/render.js'
import { getAdminChannelId, getLogChannelId } from '../../../website/api/_lib/constants.js'

/**
 * Reads the signup-log channel, finds every CHALLENGE whose deadline has
 * passed and has no matching CLOSED marker yet, and closes it: posts a
 * summary embed to the challenge's own channel, disables the three signup
 * buttons on the original announcement, then posts the CLOSED marker.
 *
 * Idempotent across runs — a challenge is only processed while it has no
 * CLOSED marker. The marker is posted last so a failure mid-close gets
 * retried on the next run (worst case: a duplicate summary post, never a
 * missed close). Archived challenges are treated like already-closed ones —
 * skipped entirely, no summary post, no CLOSED marker.
 */
/**
 * Instructional nudge posted to the admin channel right after a challenge's
 * signups close — points mods at /raffle for the too-many-requests case.
 * Plain markdown, no emojis (report-style output).
 */
export function buildSignupsClosedAdminNudge(name: string, wantCount: number, haveCount: number): string {
  return (
    `Signups for **${name}** are closed — ${wantCount} want the game, ${haveCount} already have it.\n` +
    `If there are more requests than keys, use /raffle: pick **${name}**, keep the pool on "Want the game", and set the number of winners. ` +
    `Run it in the channel where the winners should be announced (e.g. #challenge-announcements) — the draw result is posted right there, and every draw is logged in the bot log channel.`
  )
}

export async function closeExpiredSignups(): Promise<void> {
  const logChannelId = getLogChannelId()
  const messages = await getAllChannelMessages(logChannelId, 2000)
  const index = collectChallengeIndex(messages)

  const now = Math.floor(Date.now() / 1000)
  const toClose = [...index.values()]
    .filter((entry) => !entry.closed && !entry.archived && entry.meta.deadline <= now)
    .map((entry) => entry.meta)

  if (toClose.length === 0) {
    console.log('✅ No expired signups to close.')
    return
  }

  for (const meta of toClose) {
    console.log(`🔒 Closing signups for "${meta.name}" (${meta.slug})...`)

    const roster = buildRoster(messages, meta.slug)

    const summaryMessages = buildClosedSummaryMessages({
      name: meta.name,
      wanters: roster.wanters,
      owners: roster.owners,
    })
    for (const content of summaryMessages) {
      await createMessage(meta.channel_id, { content, flags: 4 })
    }

    const disabledComponents = buildDisabledComponents(meta.slug, meta.deadline)
    await editMessage(meta.channel_id, meta.message_id, { components: disabledComponents })

    await createMessage(logChannelId, {
      content: serializeClosed({ slug: meta.slug, ts: now }),
    })

    // Best-effort admin nudge AFTER the CLOSED marker — the close itself must
    // never be blocked (or re-run) because the admin channel was unreachable.
    try {
      await createMessage(getAdminChannelId(), {
        content: buildSignupsClosedAdminNudge(
          meta.name,
          roster.wanters.length,
          roster.owners.length
        ),
        flags: 4,
      })
    } catch (err) {
      console.error(`⚠️ Failed to post the signups-closed admin nudge for "${meta.slug}":`, err)
    }

    console.log(
      `✅ Closed "${meta.name}" — ${roster.wanters.length} want, ${roster.owners.length} have.`
    )
  }
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await closeExpiredSignups()
  }
}
