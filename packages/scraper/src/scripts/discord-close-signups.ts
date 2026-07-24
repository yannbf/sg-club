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
import { getLogChannelId } from '../../../website/api/_lib/constants.js'

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
