// Vercel serverless function — plain /api directory support (NOT Next.js
// routing; the website is a static export so this endpoint rides Vercel's
// generic Node.js Function support instead). Uses the plain Node.js
// (req, res) handler signature so we don't need the @vercel/node package.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { waitUntil } from '@vercel/functions'
import { verifyKey } from 'discord-interactions'
import {
  ComponentType,
  FORCED_ANNOUNCE_CHANNEL_ID,
  getAppId,
  getLogChannelId,
  getPublicKey,
  GUILD_ID,
  InteractionResponseType,
  InteractionType,
  MessageFlags,
  TextInputStyle,
} from '../_lib/constants.js'
import {
  createMessage,
  editMessage,
  editOriginalResponse,
  getAllChannelMessages,
  getMessage,
  respondJson,
  sendFollowup,
} from '../_lib/discord-rest.js'
import {
  decodeCustomId,
  encodeModalCustomId,
  slugify,
  validateSlugForCustomId,
  type SignupChoice,
} from '../_lib/custom-id.js'
import { parseAdminDate, parseDateRangeField, validateChallengeDates } from '../_lib/dates.js'
import {
  buildRoster,
  collectChallengeIndex,
  parseLogLine,
  serializeArchived,
  serializeChallenge,
  serializeSignup,
  type ChallengeIndexEntry,
} from '../_lib/signup-log.js'
import { resolveDiscordUserToSgUsername, validateSgUsername } from '../_lib/identity.js'
import {
  buildAnnouncementEmbed,
  buildChallengeListMessages,
  buildDisabledComponents,
  buildSignupComponents,
  withUpdatedSignupCounts,
} from '../_lib/render.js'
import {
  buildModReportLines,
  chunkMessage,
  collectGroupWarningFindings,
} from '../_lib/mod-report.js'

// Vercel Function config: raw body needed for Ed25519 signature
// verification, so auto body-parsing is disabled. maxDuration gives the
// deferred-command continuations (which do several sequential Discord REST
// calls) room to finish.
export const config = {
  maxDuration: 60,
  api: { bodyParser: false },
}

interface DiscordUserPayload {
  id: string
  username: string
}

interface DiscordInteraction {
  type: number
  token: string
  channel_id?: string
  member?: { user: DiscordUserPayload }
  user?: DiscordUserPayload
  message?: { id: string; channel_id: string; embeds?: Record<string, unknown>[] }
  data?: {
    name?: string
    custom_id?: string
    options?: Array<{ name: string; value?: unknown }>
    components?: ModalComponentEntry[]
    /** Selected values for a MESSAGE_COMPONENT string-select interaction (e.g. `clist`). */
    values?: string[]
  }
}

/**
 * A modal-submit payload entry. Shapes vary by Discord API version:
 *  - legacy action rows: `{ components: [{ custom_id, value }] }`
 *  - components-v2 Label wrapper (if echoed nested): `{ component: { custom_id, value|values } }`
 *  - components-v2 flat (expected): `{ custom_id, value|values }` directly at the top level
 * `extractModalValue` walks all three shapes tolerantly.
 */
interface ModalComponentEntry {
  custom_id?: string
  value?: string
  values?: string[]
  component?: ModalComponentEntry
  components?: ModalComponentEntry[]
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function getInteractionUser(interaction: DiscordInteraction): DiscordUserPayload | undefined {
  return interaction.member?.user ?? interaction.user
}

/** Finds `customId` within a single top-level modal-submit entry, walking whichever nesting shape it has. */
function findModalComponent(
  entry: ModalComponentEntry,
  customId: string
): ModalComponentEntry | undefined {
  if (entry.component) return findModalComponent(entry.component, customId)
  if (entry.components) {
    for (const child of entry.components) {
      const found = findModalComponent(child, customId)
      if (found) return found
    }
    return undefined
  }
  return entry.custom_id === customId ? entry : undefined
}

/** Text inputs carry `value`; selects (e.g. the congrats-channel picker) carry `values` — first entry wins. */
function extractModalValue(interaction: DiscordInteraction, customId: string): string | null {
  for (const entry of interaction.data?.components ?? []) {
    const match = findModalComponent(entry, customId)
    if (match) return match.values?.[0] ?? match.value ?? null
  }
  return null
}

interface AnnouncementLocation {
  id: string
  channel_id: string
  embeds?: Record<string, unknown>[]
}

/**
 * Fire-and-forget refresh of the "Signups so far" field on a challenge's
 * announcement embed. Prefers the message location carried on the
 * interaction itself (button clicks); falls back to the CHALLENGE log entry
 * for interactions that don't carry `.message` (modal submits).
 */
async function updateSignupCounter(
  slug: string,
  interactionMessage?: AnnouncementLocation
): Promise<void> {
  try {
    const messages = await getAllChannelMessages(getLogChannelId(), 2000)
    const roster = buildRoster(messages, slug)

    let channelId = interactionMessage?.channel_id
    let messageId = interactionMessage?.id
    let embed = interactionMessage?.embeds?.[0]

    if (!channelId || !messageId) {
      for (const message of messages) {
        const parsed = parseLogLine(message.content)
        if (parsed?.type === 'CHALLENGE' && parsed.data.slug === slug) {
          channelId = parsed.data.channel_id
          messageId = parsed.data.message_id
          break
        }
      }
    }
    if (!channelId || !messageId) return

    if (!embed) {
      const fetched = await getMessage(channelId, messageId)
      embed = fetched.embeds?.[0]
    }
    if (!embed) return

    const updatedEmbed = withUpdatedSignupCounts(embed, roster.wanters.length, roster.owners.length)
    await editMessage(channelId, messageId, { embeds: [updatedEmbed] })
  } catch (err) {
    console.error(`⚠️ Failed to update signup counter for "${slug}":`, err)
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    respondJson(res, 405, { error: 'Method not allowed' })
    return
  }

  const rawBody = await readRawBody(req)
  const signature = req.headers['x-signature-ed25519']
  const timestamp = req.headers['x-signature-timestamp']

  if (typeof signature !== 'string' || typeof timestamp !== 'string') {
    respondJson(res, 401, { error: 'Missing signature headers' })
    return
  }

  let validSignature = false
  try {
    validSignature = await verifyKey(rawBody, signature, timestamp, getPublicKey())
  } catch {
    validSignature = false
  }
  if (!validSignature) {
    respondJson(res, 401, { error: 'Invalid request signature' })
    return
  }

  let interaction: DiscordInteraction
  try {
    interaction = JSON.parse(rawBody.toString('utf-8'))
  } catch {
    respondJson(res, 400, { error: 'Invalid JSON body' })
    return
  }

  const host = req.headers.host

  switch (interaction.type) {
    case InteractionType.PING:
      respondJson(res, 200, { type: InteractionResponseType.PONG })
      return
    case InteractionType.APPLICATION_COMMAND:
      await handleApplicationCommand(interaction, res, host)
      return
    case InteractionType.MESSAGE_COMPONENT:
      await handleMessageComponent(interaction, res, host)
      return
    case InteractionType.MODAL_SUBMIT:
      await handleModalSubmit(interaction, res, host)
      return
    default:
      respondJson(res, 400, { error: 'Unknown interaction type' })
  }
}

async function handleApplicationCommand(
  interaction: DiscordInteraction,
  res: ServerResponse,
  host?: string
): Promise<void> {
  const commandName = interaction.data?.name
  if (commandName === 'challenge-setup') {
    await handleChallengeSetup(interaction, res)
    return
  }
  if (commandName === 'challenge-list') {
    await handleChallengeList(interaction, res)
    return
  }
  if (commandName === 'challenge-archive') {
    await handleChallengeArchive(interaction, res)
    return
  }
  if (commandName === 'challenge-edit') {
    await handleChallengeEdit(interaction, res)
    return
  }
  if (commandName === 'mod-report') {
    await handleModReport(interaction, res, host)
    return
  }
  respondJson(res, 400, { error: 'Unknown command' })
}

async function handleChallengeSetup(
  interaction: DiscordInteraction,
  res: ServerResponse
): Promise<void> {
  // Discord does not allow deferring an APPLICATION_COMMAND and then opening
  // a modal as a followup — the modal must be the immediate synchronous
  // response, so there's no defer/waitUntil here.
  //
  // Components-v2 modal: every field is a Label (type 18) wrapping its input
  // component, rather than the legacy action-row (type 1) shape. The congrats
  // channel picker lives here as a Channel Select (type 8) instead of being
  // threaded through the slash command's options and the modal custom_id.
  respondJson(res, 200, {
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: 'csetup',
      title: 'New Challenge',
      components: [
        {
          type: ComponentType.LABEL,
          label: 'Challenge name',
          component: {
            type: 4,
            custom_id: 'name',
            style: TextInputStyle.SHORT,
            required: true,
            max_length: 100,
          },
        },
        {
          type: ComponentType.LABEL,
          label: 'Description',
          component: {
            type: 4,
            custom_id: 'description',
            style: TextInputStyle.PARAGRAPH,
            required: true,
            max_length: 2000,
          },
        },
        {
          type: ComponentType.LABEL,
          label: 'Dates (UTC)',
          description: 'August 1 to August 30 - also today to August 4',
          component: {
            type: 4,
            custom_id: 'dates',
            style: TextInputStyle.SHORT,
            required: true,
          },
        },
        {
          type: ComponentType.LABEL,
          label: 'Signup deadline (UTC, optional)',
          description: 'if not specified, same as the moment the event starts',
          component: {
            type: 4,
            custom_id: 'signup_deadline',
            style: TextInputStyle.SHORT,
            required: false,
          },
        },
        {
          type: ComponentType.LABEL,
          label: 'Congrats channel (optional)',
          description: "Where 'X finished the challenge' posts go (default: this channel)",
          component: {
            type: ComponentType.CHANNEL_SELECT,
            custom_id: 'congrats_channel',
            channel_types: [0], // GUILD_TEXT
            required: false,
            min_values: 0,
            max_values: 1,
          },
        },
      ],
    },
  })
}

async function finishChallengeSetupFromModal(interaction: DiscordInteraction): Promise<void> {
  const appId = getAppId()
  const token = interaction.token

  try {
    const name = extractModalValue(interaction, 'name') ?? ''
    const description = extractModalValue(interaction, 'description') ?? ''
    const datesInput = extractModalValue(interaction, 'dates') ?? ''
    const deadlineRaw = extractModalValue(interaction, 'signup_deadline')
    const deadlineInput = deadlineRaw?.trim() ? deadlineRaw : undefined
    const congratsChannelId = extractModalValue(interaction, 'congrats_channel') ?? undefined

    const slug = slugify(name)
    const slugError = validateSlugForCustomId(slug)
    if (slugError) {
      await editOriginalResponse(appId, token, { content: `❌ ${slugError}` })
      return
    }

    const rangeResult = parseDateRangeField(datesInput)
    if (!rangeResult.ok) {
      await editOriginalResponse(appId, token, { content: `❌ ${rangeResult.error}` })
      return
    }

    const datesResult = validateChallengeDates({
      start: rangeResult.start,
      end: rangeResult.end,
      signupDeadline: deadlineInput,
    })
    if (!datesResult.ok) {
      await editOriginalResponse(appId, token, { content: `❌ ${datesResult.error}` })
      return
    }

    const messages = await getAllChannelMessages(getLogChannelId(), 2000)
    for (const message of messages) {
      const parsed = parseLogLine(message.content)
      if (parsed?.type === 'CHALLENGE' && parsed.data.slug === slug) {
        await editOriginalResponse(appId, token, {
          content: `❌ a challenge with slug ${slug} already exists`,
        })
        return
      }
    }

    // FORCED_ANNOUNCE_CHANNEL_ID overrides the invoking channel once flipped
    // on for production, so a challenge can't land in the wrong place.
    const targetChannelId = FORCED_ANNOUNCE_CHANNEL_ID ?? interaction.channel_id
    if (!targetChannelId) {
      await editOriginalResponse(appId, token, {
        content: '❌ Could not determine a target channel.',
      })
      return
    }

    const embed = buildAnnouncementEmbed({
      name,
      description,
      signupDeadline: datesResult.dates.signupDeadline,
      start: datesResult.dates.start,
      end: datesResult.dates.end,
    })
    const components = buildSignupComponents(slug, datesResult.dates.signupDeadline)

    const announcement = await createMessage(targetChannelId, { embeds: [embed], components })

    await createMessage(getLogChannelId(), {
      content: serializeChallenge({
        slug,
        channel_id: targetChannelId,
        message_id: announcement.id,
        deadline: datesResult.dates.signupDeadline,
        start: datesResult.dates.start,
        end: datesResult.dates.end,
        name,
        ...(congratsChannelId ? { congrats_channel_id: congratsChannelId } : {}),
      }),
    })

    const announcementLink = `https://discord.com/channels/${GUILD_ID}/${targetChannelId}/${announcement.id}`
    const congratsNote = congratsChannelId ? ` Congrats will post in <#${congratsChannelId}>.` : ''
    await editOriginalResponse(appId, token, {
      content: `✅ Challenge announced: ${announcementLink}${congratsNote}`,
    })
  } catch (err) {
    const message = (err as Error).message
    // 50001 Missing Access = the bot can't see/post in this private channel.
    const friendly = message.includes('"code": 50001')
      ? "❌ I can't post in this channel — it's private and the **TGC Bot** role doesn't have access. Add it via Edit Channel → Permissions → Add members or roles, then run /challenge-setup again."
      : `❌ Something went wrong: ${message}`
    await editOriginalResponse(appId, token, { content: friendly }).catch(() => {})
  }
}

// Discord caps a select menu at 25 options.
const CHALLENGE_LIST_PICKER_LIMIT = 25
const CHALLENGE_LIST_SELECT_ID = 'clist'

function truncateLabel(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 1)}…`
}

async function handleChallengeList(
  interaction: DiscordInteraction,
  res: ServerResponse
): Promise<void> {
  // Deferred + ephemeral: the picker itself only needs to be visible to
  // whoever ran the command, and building its options requires a log-channel
  // fetch that can't reliably finish inside Discord's 3s ack window.
  respondJson(res, 200, {
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: MessageFlags.EPHEMERAL },
  })
  waitUntil(finishChallengeListPicker(interaction))
}

/**
 * True when `entry` is still running: its end hasn't passed and no `ENDED`
 * marker has been posted for it. Used to split the `/challenge-list` picker
 * into ongoing/ended sections.
 */
function isOngoing(entry: ChallengeIndexEntry, nowSeconds: number): boolean {
  return entry.meta.end > nowSeconds && !entry.ended
}

/** Builds the "Pick a challenge:" ephemeral select menu (or a "no challenges" message). */
async function finishChallengeListPicker(interaction: DiscordInteraction): Promise<void> {
  const appId = getAppId()
  const token = interaction.token

  try {
    const messages = await getAllChannelMessages(getLogChannelId(), 2000)
    const index = collectChallengeIndex(messages)
    const nowSeconds = Math.floor(Date.now() / 1000)

    // Archived challenges never appear in the picker. Among the rest,
    // ongoing challenges are listed first (newest-first), then ended ones
    // (newest-first) — Map iteration order already matches newest-first
    // insertion order (see collectChallengeIndex), so no extra sort is
    // needed within each group.
    const entries = [...index.values()].filter((entry) => !entry.archived)
    const ongoing = entries.filter((entry) => isOngoing(entry, nowSeconds))
    const ended = entries.filter((entry) => !isOngoing(entry, nowSeconds))
    const challenges = [...ongoing, ...ended].slice(0, CHALLENGE_LIST_PICKER_LIMIT)

    if (challenges.length === 0) {
      await editOriginalResponse(appId, token, { content: 'No challenges found.' })
      return
    }

    await editOriginalResponse(appId, token, {
      content: 'Pick a challenge:',
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.STRING_SELECT,
              custom_id: CHALLENGE_LIST_SELECT_ID,
              options: challenges.map((entry) => ({
                label: truncateLabel(entry.meta.name, 100),
                value: entry.meta.slug,
                description: `${isOngoing(entry, nowSeconds) ? 'ongoing' : 'ended'} · ${entry.meta.slug}`,
              })),
            },
          ],
        },
      ],
    })
  } catch (err) {
    await editOriginalResponse(appId, token, {
      content: `❌ ${(err as Error).message}`,
    }).catch(() => {})
  }
}

/** MESSAGE_COMPONENT entry for the `clist` string-select — renders the roster for the chosen slug. */
async function handleChallengeListSelect(
  interaction: DiscordInteraction,
  res: ServerResponse
): Promise<void> {
  const slug = interaction.data?.values?.[0]

  // Non-ephemeral — the log channel itself isn't visible to non-admins, so
  // there's no leak risk in showing the roster to whoever ran the command.
  respondJson(res, 200, {
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: {},
  })
  if (slug) waitUntil(finishChallengeList(interaction, slug))
}

async function finishChallengeList(interaction: DiscordInteraction, slug: string): Promise<void> {
  const appId = getAppId()
  const token = interaction.token

  try {
    const messages = await getAllChannelMessages(getLogChannelId(), 2000)

    let challengeName = slug
    for (const message of messages) {
      const parsed = parseLogLine(message.content)
      if (parsed?.type === 'CHALLENGE' && parsed.data.slug === slug) {
        challengeName = parsed.data.name
        break
      }
    }

    const roster = buildRoster(messages, slug)
    const chunks = buildChallengeListMessages({ name: challengeName, roster })

    await editOriginalResponse(appId, token, { content: chunks[0] ?? '_No signups yet._', flags: 4 })
    for (const chunk of chunks.slice(1)) {
      await sendFollowup(appId, token, { content: chunk, flags: 4 })
    }
  } catch (err) {
    await editOriginalResponse(appId, token, {
      content: `❌ ${(err as Error).message}`,
    }).catch(() => {})
  }
}

const CHALLENGE_ARCHIVE_SELECT_ID = 'carch'

async function handleChallengeArchive(
  interaction: DiscordInteraction,
  res: ServerResponse
): Promise<void> {
  // Same rationale as /challenge-list: the picker only needs to be visible
  // to whoever ran the command, and building it requires a log-channel
  // fetch that can't reliably finish inside Discord's 3s ack window.
  respondJson(res, 200, {
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: MessageFlags.EPHEMERAL },
  })
  waitUntil(finishChallengeArchivePicker(interaction))
}

/** Builds the "Pick a challenge to archive:" ephemeral select menu (or a "no challenges" message). */
async function finishChallengeArchivePicker(interaction: DiscordInteraction): Promise<void> {
  const appId = getAppId()
  const token = interaction.token

  try {
    const messages = await getAllChannelMessages(getLogChannelId(), 2000)
    const index = collectChallengeIndex(messages)

    // Every non-archived challenge is eligible — ongoing or ended — newest
    // re-announce/newest slug first, capped at the picker limit.
    const challenges = [...index.values()]
      .filter((entry) => !entry.archived)
      .slice(0, CHALLENGE_LIST_PICKER_LIMIT)

    if (challenges.length === 0) {
      await editOriginalResponse(appId, token, { content: 'No challenges to archive.' })
      return
    }

    await editOriginalResponse(appId, token, {
      content: 'Pick a challenge to archive:',
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.STRING_SELECT,
              custom_id: CHALLENGE_ARCHIVE_SELECT_ID,
              options: challenges.map((entry) => ({
                label: truncateLabel(entry.meta.name, 100),
                value: entry.meta.slug,
                description: entry.meta.slug,
              })),
            },
          ],
        },
      ],
    })
  } catch (err) {
    await editOriginalResponse(appId, token, {
      content: `❌ ${(err as Error).message}`,
    }).catch(() => {})
  }
}

/** MESSAGE_COMPONENT entry for the `carch` string-select — posts the ARCHIVED marker for the chosen slug. */
async function handleChallengeArchiveSelect(
  interaction: DiscordInteraction,
  res: ServerResponse
): Promise<void> {
  const slug = interaction.data?.values?.[0]

  // Deferred update of the same ephemeral picker message — the marker post
  // is a log-channel write that can't reliably finish inside the 3s window.
  respondJson(res, 200, {
    type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE,
    data: {},
  })
  if (slug) waitUntil(finishChallengeArchive(interaction, slug))
}

async function finishChallengeArchive(interaction: DiscordInteraction, slug: string): Promise<void> {
  const appId = getAppId()
  const token = interaction.token

  try {
    const messages = await getAllChannelMessages(getLogChannelId(), 2000)
    const index = collectChallengeIndex(messages)
    const entry = index.get(slug)
    const name = entry?.meta.name ?? slug

    await createMessage(getLogChannelId(), {
      content: serializeArchived({ slug, ts: Math.floor(Date.now() / 1000) }),
    })

    // Best-effort: disable the live widget so it can't be clicked anymore.
    // Never let this block the archive itself — the announcement may have
    // been deleted, or the bot may lack access, and the ARCHIVED marker
    // above is already what actually defines "archived".
    if (entry) {
      try {
        await editMessage(entry.meta.channel_id, entry.meta.message_id, {
          components: buildDisabledComponents(slug, entry.meta.deadline),
        })
      } catch (err) {
        console.error(`⚠️ Failed to disable signup buttons for archived challenge "${slug}":`, err)
      }
    }

    await editOriginalResponse(appId, token, {
      content: `Archived **${name}**. It will no longer appear in lists or bot activity, and its signup buttons are disabled. If the announcement was posted by mistake you can delete the message manually. (Un-archive by deleting the ARCHIVED line in the log channel.)`,
      components: [],
    })
  } catch (err) {
    await editOriginalResponse(appId, token, {
      content: `❌ ${(err as Error).message}`,
    }).catch(() => {})
  }
}

const CHALLENGE_EDIT_SELECT_ID = 'cedit'

async function handleChallengeEdit(
  interaction: DiscordInteraction,
  res: ServerResponse
): Promise<void> {
  // Same rationale as /challenge-list and /challenge-archive: the picker
  // only needs to be visible to whoever ran the command, and building it
  // requires a log-channel fetch that can't reliably finish inside
  // Discord's 3s ack window.
  respondJson(res, 200, {
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: MessageFlags.EPHEMERAL },
  })
  waitUntil(finishChallengeEditPicker(interaction))
}

/** Builds the "Pick a challenge to edit:" ephemeral select menu (or a "no challenges" message). */
async function finishChallengeEditPicker(interaction: DiscordInteraction): Promise<void> {
  const appId = getAppId()
  const token = interaction.token

  try {
    const messages = await getAllChannelMessages(getLogChannelId(), 2000)
    const index = collectChallengeIndex(messages)
    const nowSeconds = Math.floor(Date.now() / 1000)

    // Same ordering as /challenge-list: every non-archived challenge is
    // eligible (ongoing or ended), ongoing first, each group newest-first.
    const entries = [...index.values()].filter((entry) => !entry.archived)
    const ongoing = entries.filter((entry) => isOngoing(entry, nowSeconds))
    const ended = entries.filter((entry) => !isOngoing(entry, nowSeconds))
    const challenges = [...ongoing, ...ended].slice(0, CHALLENGE_LIST_PICKER_LIMIT)

    if (challenges.length === 0) {
      await editOriginalResponse(appId, token, { content: 'No challenges to edit.' })
      return
    }

    await editOriginalResponse(appId, token, {
      content: 'Pick a challenge to edit:',
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.STRING_SELECT,
              custom_id: CHALLENGE_EDIT_SELECT_ID,
              options: challenges.map((entry) => ({
                label: truncateLabel(entry.meta.name, 100),
                value: entry.meta.slug,
                description: `${isOngoing(entry, nowSeconds) ? 'ongoing' : 'ended'} · ${entry.meta.slug}`,
              })),
            },
          ],
        },
      ],
    })
  } catch (err) {
    await editOriginalResponse(appId, token, {
      content: `❌ ${(err as Error).message}`,
    }).catch(() => {})
  }
}

/**
 * MESSAGE_COMPONENT entry for the `cedit` string-select — opens the edit
 * modal for the chosen slug. Same constraint as /challenge-setup's modal:
 * Discord doesn't allow deferring a component interaction and then opening a
 * modal as a followup, so this must respond synchronously with no fetches
 * beforehand. The slug is threaded through via the modal's custom_id
 * (`cemod|<slug>`) since the modal itself carries no other state.
 */
async function handleChallengeEditSelect(
  interaction: DiscordInteraction,
  res: ServerResponse
): Promise<void> {
  const slug = interaction.data?.values?.[0]
  if (!slug) {
    respondJson(res, 400, { error: 'Missing slug' })
    return
  }

  respondJson(res, 200, {
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: `cemod|${slug}`,
      title: 'Edit Challenge',
      components: [
        {
          type: ComponentType.LABEL,
          label: 'Challenge name',
          description: 'Leave empty to keep the current name',
          component: {
            type: 4,
            custom_id: 'name',
            style: TextInputStyle.SHORT,
            required: false,
            max_length: 100,
          },
        },
        {
          type: ComponentType.LABEL,
          label: 'Description',
          description: 'Leave empty to keep the current description',
          component: {
            type: 4,
            custom_id: 'description',
            style: TextInputStyle.PARAGRAPH,
            required: false,
            max_length: 2000,
          },
        },
        {
          type: ComponentType.LABEL,
          label: 'Dates (UTC)',
          description: 'e.g. August 1 to August 30 — empty keeps current',
          component: {
            type: 4,
            custom_id: 'dates',
            style: TextInputStyle.SHORT,
            required: false,
          },
        },
        {
          type: ComponentType.LABEL,
          label: 'Signup deadline (UTC)',
          description: 'Empty keeps current (or the default if dates change)',
          component: {
            type: 4,
            custom_id: 'signup_deadline',
            style: TextInputStyle.SHORT,
            required: false,
          },
        },
        {
          type: ComponentType.LABEL,
          label: 'Congrats channel',
          description: 'Empty keeps the current pick',
          component: {
            type: ComponentType.CHANNEL_SELECT,
            custom_id: 'congrats_channel',
            channel_types: [0], // GUILD_TEXT
            required: false,
            min_values: 0,
            max_values: 1,
          },
        },
      ],
    },
  })
}

export interface ChallengeEditModalInputs {
  name: string
  description: string
  dates: string
  signupDeadline: string
  congratsChannelId: string
}

export interface ChallengeEditExisting {
  name: string
  start: number
  end: number
  deadline: number
  congrats_channel_id?: string
}

export interface ChallengeEditResolved {
  name: string
  /** New description text, or `undefined` to keep whatever's already on the
   * live embed — this function has no Discord access, so the caller reads
   * the current description off the fetched embed itself when this is
   * `undefined`. */
  description?: string
  start: number
  end: number
  deadline: number
  congrats_channel_id?: string
  /** Friendly labels for what changed, in field order. Empty means every
   * field was left blank. */
  changed: string[]
}

export type ChallengeEditResolution =
  | { ok: true; resolved: ChallengeEditResolved }
  | { ok: false; error: string }

/**
 * Pure merge-decision for /challenge-edit: given the raw (possibly-empty)
 * modal inputs and the challenge's current meta, decides which fields
 * actually change and what the resolved values are. No Discord I/O, so it's
 * unit-testable without mocking anything — `finishChallengeEdit` below is
 * the thin Discord-facing wrapper around this.
 */
export function resolveChallengeEdit(
  inputs: ChallengeEditModalInputs,
  existing: ChallengeEditExisting,
  now: number = Date.now()
): ChallengeEditResolution {
  const changed: string[] = []

  const name = inputs.name.trim() ? inputs.name : existing.name
  if (inputs.name.trim()) changed.push('name')

  const description = inputs.description.trim() ? inputs.description : undefined
  if (description !== undefined) changed.push('description')

  let start = existing.start
  let end = existing.end
  let deadline = existing.deadline

  const datesGiven = Boolean(inputs.dates.trim())
  const deadlineGiven = Boolean(inputs.signupDeadline.trim())

  if (datesGiven) {
    // Same validation path as /challenge-setup: parseDateRangeField splits
    // the combined field, validateChallengeDates parses+validates each side
    // (and re-derives the deadline default if none was given here either).
    const rangeResult = parseDateRangeField(inputs.dates)
    if (!rangeResult.ok) return { ok: false, error: rangeResult.error }

    const datesResult = validateChallengeDates(
      {
        start: rangeResult.start,
        end: rangeResult.end,
        signupDeadline: deadlineGiven ? inputs.signupDeadline : undefined,
      },
      now
    )
    if (!datesResult.ok) return { ok: false, error: datesResult.error }

    start = datesResult.dates.start
    end = datesResult.dates.end
    deadline = datesResult.dates.signupDeadline
    changed.push('dates')
  } else if (deadlineGiven) {
    // No new dates, so the existing start can't be re-validated through
    // validateChallengeDates (it only accepts date *strings*, and re-parsing
    // an already-running challenge's start as a fresh string would wrongly
    // re-trigger its "start must be today or later" rule). Parse the
    // deadline directly instead and enforce the one deadline-specific rule
    // validateChallengeDates has, with the same message.
    const deadlineResult = parseAdminDate(inputs.signupDeadline, now)
    if (!deadlineResult.ok) return { ok: false, error: `signup_deadline: ${deadlineResult.error}` }
    // Mirrors validateChallengeDates: before the start, an explicit deadline
    // must be ≤ start. But an already-running challenge legitimately keeps
    // signups open past its start (the immediate-start DEFAULT deadline is
    // the end date), so there the only hard bound is the end.
    const notStarted = existing.start > Math.floor(now / 1000)
    if (notStarted && deadlineResult.epochSeconds > existing.start) {
      return { ok: false, error: 'Signup deadline must be at or before the start date.' }
    }
    if (!notStarted && deadlineResult.epochSeconds > existing.end) {
      return { ok: false, error: 'Signup deadline must be at or before the end date.' }
    }
    deadline = deadlineResult.epochSeconds
    changed.push('signup deadline')
  }

  const congratsGiven = Boolean(inputs.congratsChannelId.trim())
  const congrats_channel_id = congratsGiven ? inputs.congratsChannelId : existing.congrats_channel_id
  if (congratsGiven) changed.push('congrats channel')

  return { ok: true, resolved: { name, description, start, end, deadline, congrats_channel_id, changed } }
}

async function finishChallengeEdit(interaction: DiscordInteraction, slug: string): Promise<void> {
  const appId = getAppId()
  const token = interaction.token

  try {
    const messages = await getAllChannelMessages(getLogChannelId(), 2000)
    const index = collectChallengeIndex(messages)
    const entry = index.get(slug)
    if (!entry || entry.archived) {
      await editOriginalResponse(appId, token, {
        content: `❌ Challenge "${slug}" not found (it may have been archived).`,
      })
      return
    }
    const meta = entry.meta

    const inputs: ChallengeEditModalInputs = {
      name: extractModalValue(interaction, 'name') ?? '',
      description: extractModalValue(interaction, 'description') ?? '',
      dates: extractModalValue(interaction, 'dates') ?? '',
      signupDeadline: extractModalValue(interaction, 'signup_deadline') ?? '',
      congratsChannelId: extractModalValue(interaction, 'congrats_channel') ?? '',
    }

    const resolution = resolveChallengeEdit(inputs, {
      name: meta.name,
      start: meta.start,
      end: meta.end,
      deadline: meta.deadline,
      congrats_channel_id: meta.congrats_channel_id,
    })
    if (!resolution.ok) {
      await editOriginalResponse(appId, token, { content: `❌ ${resolution.error}` })
      return
    }

    const { resolved } = resolution
    if (resolved.changed.length === 0) {
      await editOriginalResponse(appId, token, {
        content: 'Nothing to change — all fields were left empty.',
      })
      return
    }

    const fetchedMessage = await getMessage(meta.channel_id, meta.message_id)
    const currentEmbed = fetchedMessage.embeds?.[0] ?? {}
    const currentDescription = typeof currentEmbed.description === 'string' ? currentEmbed.description : ''
    const description = resolved.description ?? currentDescription

    let embed = buildAnnouncementEmbed({
      name: resolved.name,
      description,
      signupDeadline: resolved.deadline,
      start: resolved.start,
      end: resolved.end,
    })
    // Restore the live signup counts rather than resetting the footer to
    // 0/0 — buildAnnouncementEmbed always starts a fresh embed at 0/0.
    const roster = buildRoster(messages, slug)
    embed = withUpdatedSignupCounts(embed, roster.wanters.length, roster.owners.length)

    // The deadline is baked into the button custom_ids, so components must
    // be re-sent whenever it changed — sending them unconditionally is
    // simpler and harmless. Edits never reopen signups: once CLOSED, the
    // widget stays disabled regardless of what else was edited.
    const components = entry.closed
      ? buildDisabledComponents(slug, resolved.deadline)
      : buildSignupComponents(slug, resolved.deadline)

    await editMessage(meta.channel_id, meta.message_id, { embeds: [embed], components })

    await createMessage(getLogChannelId(), {
      content: serializeChallenge({
        slug,
        channel_id: meta.channel_id,
        message_id: meta.message_id,
        deadline: resolved.deadline,
        start: resolved.start,
        end: resolved.end,
        name: resolved.name,
        ...(resolved.congrats_channel_id ? { congrats_channel_id: resolved.congrats_channel_id } : {}),
      }),
    })

    const announcementLink = `https://discord.com/channels/${GUILD_ID}/${meta.channel_id}/${meta.message_id}`
    await editOriginalResponse(appId, token, {
      content: `✅ Updated **${resolved.name}** — changed: ${resolved.changed.join(', ')}. ${announcementLink}`,
    })
  } catch (err) {
    const message = (err as Error).message
    // 50001 Missing Access = the bot can't see/post in this private channel.
    const friendly = message.includes('"code": 50001')
      ? "❌ I can't edit that announcement — it's private and the **TGC Bot** role doesn't have access. Add it via Edit Channel → Permissions → Add members or roles, then try again."
      : `❌ Something went wrong: ${message}`
    await editOriginalResponse(appId, token, { content: friendly }).catch(() => {})
  }
}

async function handleModReport(
  interaction: DiscordInteraction,
  res: ServerResponse,
  host?: string
): Promise<void> {
  // Non-ephemeral, same rationale as /challenge-list — no leak risk since
  // the report only summarizes data already public on member pages.
  respondJson(res, 200, {
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: {},
  })
  waitUntil(finishModReport(interaction, host))
}

async function finishModReport(interaction: DiscordInteraction, host?: string): Promise<void> {
  const appId = getAppId()
  const token = interaction.token

  try {
    const findings = await collectGroupWarningFindings(host)
    const chunks = chunkMessage(buildModReportLines(findings))

    await editOriginalResponse(appId, token, { content: chunks[0] ?? '_No findings._', flags: 4 })
    for (const chunk of chunks.slice(1)) {
      await sendFollowup(appId, token, { content: chunk, flags: 4 })
    }
  } catch (err) {
    await editOriginalResponse(appId, token, {
      content: `❌ ${(err as Error).message}`,
    }).catch(() => {})
  }
}

/**
 * Core invariant: a click after the deadline records nothing and never
 * touches the log channel. Kept as a standalone, synchronously-checkable
 * function so it's trivial to unit test.
 */
export function isPastDeadline(deadlineEpoch: number, nowSeconds: number): boolean {
  return nowSeconds > deadlineEpoch
}

async function handleMessageComponent(
  interaction: DiscordInteraction,
  res: ServerResponse,
  host?: string
): Promise<void> {
  const customId = interaction.data?.custom_id

  // Routed independently of decodeCustomId (which only understands the
  // `su|`/`sg|` signup formats) since `clist`/`carch`/`cedit` aren't
  // pipe-delimited ids.
  if (customId === CHALLENGE_LIST_SELECT_ID) {
    await handleChallengeListSelect(interaction, res)
    return
  }
  if (customId === CHALLENGE_ARCHIVE_SELECT_ID) {
    await handleChallengeArchiveSelect(interaction, res)
    return
  }
  if (customId === CHALLENGE_EDIT_SELECT_ID) {
    await handleChallengeEditSelect(interaction, res)
    return
  }

  const decoded = customId ? decodeCustomId(customId) : null
  if (!decoded || decoded.kind !== 'button') {
    respondJson(res, 400, { error: 'Unknown component' })
    return
  }

  const { slug, choice, deadlineEpoch } = decoded
  const nowSeconds = Math.floor(Date.now() / 1000)

  if (isPastDeadline(deadlineEpoch, nowSeconds)) {
    respondJson(res, 200, {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        flags: MessageFlags.EPHEMERAL,
        content: `Signups closed <t:${deadlineEpoch}:R> — sorry!`,
      },
    })
    return
  }

  const discordUser = getInteractionUser(interaction)
  const discordId = discordUser?.id ?? ''
  const discordHandle = discordUser?.username ?? ''

  if (choice === 'out') {
    await createMessage(getLogChannelId(), {
      content: serializeSignup({
        slug,
        choice: 'out',
        discord_id: discordId,
        discord_handle: discordHandle,
        sg_username: null,
        guest: false,
        ts: nowSeconds,
      }),
    })
    respondJson(res, 200, {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { flags: MessageFlags.EPHEMERAL, content: "You've been withdrawn." },
    })
    waitUntil(updateSignupCounter(slug, interaction.message))
    return
  }

  const sgUsername = await resolveDiscordUserToSgUsername(discordHandle, host)

  if (sgUsername) {
    await createMessage(getLogChannelId(), {
      content: serializeSignup({
        slug,
        choice,
        discord_id: discordId,
        discord_handle: discordHandle,
        sg_username: sgUsername,
        guest: false,
        ts: nowSeconds,
      }),
    })
    respondJson(res, 200, {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        flags: MessageFlags.EPHEMERAL,
        content: confirmationMessage(sgUsername, choice),
      },
    })
    waitUntil(updateSignupCounter(slug, interaction.message))
    return
  }

  // Unresolved Discord account — ask for their SG username via a modal.
  respondJson(res, 200, {
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: encodeModalCustomId(slug, choice, deadlineEpoch),
      title: 'What is your SteamGifts username?',
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: 'sg_username',
              style: TextInputStyle.SHORT,
              label: 'SteamGifts username',
              placeholder: 'e.g. yannbf',
              required: true,
              max_length: 40,
            },
          ],
        },
      ],
    },
  })
}

async function handleModalSubmit(
  interaction: DiscordInteraction,
  res: ServerResponse,
  host?: string
): Promise<void> {
  const customId = interaction.data?.custom_id

  if (customId === 'csetup') {
    respondJson(res, 200, {
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: { flags: MessageFlags.EPHEMERAL },
    })
    waitUntil(finishChallengeSetupFromModal(interaction))
    return
  }

  // Routed independently of decodeCustomId (pipe-delimited but not the
  // `sg|` signup-modal shape it understands) — same rationale as `cedit`
  // above for MESSAGE_COMPONENT.
  if (customId?.startsWith('cemod|')) {
    const slug = customId.slice('cemod|'.length)
    respondJson(res, 200, {
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: { flags: MessageFlags.EPHEMERAL },
    })
    waitUntil(finishChallengeEdit(interaction, slug))
    return
  }

  const decoded = customId ? decodeCustomId(customId) : null
  if (!decoded || decoded.kind !== 'modal') {
    respondJson(res, 400, { error: 'Unknown modal' })
    return
  }

  const { slug, choice, deadlineEpoch } = decoded
  const nowSeconds = Math.floor(Date.now() / 1000)

  if (isPastDeadline(deadlineEpoch, nowSeconds)) {
    respondJson(res, 200, {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        flags: MessageFlags.EPHEMERAL,
        content: `Signups closed <t:${deadlineEpoch}:R> — sorry!`,
      },
    })
    return
  }

  const inputValue = extractModalValue(interaction, 'sg_username')
  const discordUser = getInteractionUser(interaction)
  const discordId = discordUser?.id ?? ''
  const discordHandle = discordUser?.username ?? ''

  const canonical = inputValue ? await validateSgUsername(inputValue, host) : null
  const guest = canonical === null

  // Guests keep the name they typed (marked unresolved via the guest flag) so
  // an admin has something to verify against instead of a blank.
  const claimed = inputValue?.trim() || null

  await createMessage(getLogChannelId(), {
    content: serializeSignup({
      slug,
      choice: choice as SignupChoice,
      discord_id: discordId,
      discord_handle: discordHandle,
      sg_username: canonical ?? claimed,
      guest,
      ts: nowSeconds,
    }),
  })

  const displayName = canonical ?? inputValue ?? 'unknown'
  const content = guest
    ? `Recorded: **${displayName}** — ${choiceLabel(choice as SignupChoice)} — recorded as guest — an admin will verify.`
    : confirmationMessage(displayName, choice as SignupChoice)

  respondJson(res, 200, {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: MessageFlags.EPHEMERAL, content },
  })
  waitUntil(updateSignupCounter(slug, interaction.message))
}

function choiceLabel(choice: SignupChoice): string {
  return choice === 'want' ? 'wanting the game' : 'already owning the game'
}

function confirmationMessage(sgUsername: string, choice: SignupChoice): string {
  const otherButton = choice === 'want' ? '✅ I already have it' : '🎁 I want the game'
  return `Recorded: **${sgUsername}** — ${choiceLabel(choice)}. Press "${otherButton}" to change your answer, or "✕ Withdraw" to drop out.`
}
