// Vercel serverless function — plain /api directory support (NOT Next.js
// routing; the website is a static export so this endpoint rides Vercel's
// generic Node.js Function support instead). Uses the plain Node.js
// (req, res) handler signature so we don't need the @vercel/node package.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { waitUntil } from '@vercel/functions'
import { verifyKey } from 'discord-interactions'
import {
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
  editOriginalResponse,
  getAllChannelMessages,
  respondJson,
  sendFollowup,
} from '../_lib/discord-rest.js'
import {
  decodeCustomId,
  encodeModalCustomId,
  validateSlugForCustomId,
  type SignupChoice,
} from '../_lib/custom-id.js'
import { validateChallengeDates } from '../_lib/dates.js'
import {
  buildRoster,
  parseLogLine,
  serializeChallenge,
  serializeSignup,
} from '../_lib/signup-log.js'
import { resolveDiscordUserToSgUsername, validateSgUsername } from '../_lib/identity.js'
import {
  buildAnnouncementEmbed,
  buildChallengeListOutput,
  buildSignupComponents,
} from '../_lib/render.js'

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
  data?: {
    name?: string
    custom_id?: string
    options?: Array<{ name: string; value?: unknown }>
    resolved?: { attachments?: Record<string, { url: string }> }
    components?: Array<{ components?: Array<{ custom_id: string; value?: string }> }>
  }
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

function parseOptions(
  options: Array<{ name: string; value?: unknown }> = []
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const option of options) {
    out[option.name] = option.value
  }
  return out
}

function extractModalValue(interaction: DiscordInteraction, customId: string): string | null {
  for (const row of interaction.data?.components ?? []) {
    for (const component of row.components ?? []) {
      if (component.custom_id === customId) return component.value ?? null
    }
  }
  return null
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
  respondJson(res, 400, { error: 'Unknown command' })
  void host
}

async function handleChallengeSetup(
  interaction: DiscordInteraction,
  res: ServerResponse
): Promise<void> {
  // Ack immediately (ephemeral); the real work continues after the HTTP
  // response via waitUntil — Vercel freezes the invocation as soon as
  // res.end() is called unless the promise is registered there.
  respondJson(res, 200, {
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: MessageFlags.EPHEMERAL },
  })
  waitUntil(finishChallengeSetup(interaction))
}

async function finishChallengeSetup(interaction: DiscordInteraction): Promise<void> {
  const appId = getAppId()
  const token = interaction.token

  try {
    const options = parseOptions(interaction.data?.options)
    const slug = String(options.slug ?? '')
    const name = String(options.name ?? '')
    const intro = String(options.intro ?? '')
    const attachmentId = options.image as string | undefined
    const channelOption = options.channel as string | undefined
    const startInput = String(options.start ?? '')
    const endInput = String(options.end ?? '')
    const deadlineInput = options.signup_deadline ? String(options.signup_deadline) : undefined

    const slugError = validateSlugForCustomId(slug)
    if (slugError) {
      await editOriginalResponse(appId, token, { content: `❌ ${slugError}` })
      return
    }

    const datesResult = validateChallengeDates({
      start: startInput,
      end: endInput,
      signupDeadline: deadlineInput,
    })
    if (!datesResult.ok) {
      await editOriginalResponse(appId, token, { content: `❌ ${datesResult.error}` })
      return
    }

    const targetChannelId = channelOption ?? interaction.channel_id
    if (!targetChannelId) {
      await editOriginalResponse(appId, token, {
        content: '❌ Could not determine a target channel.',
      })
      return
    }

    const imageUrl = attachmentId
      ? interaction.data?.resolved?.attachments?.[attachmentId]?.url
      : undefined

    const embed = buildAnnouncementEmbed({
      name,
      intro,
      imageUrl,
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
      }),
    })

    const link = `https://discord.com/channels/${GUILD_ID}/${targetChannelId}/${announcement.id}`
    await editOriginalResponse(appId, token, { content: `✅ Challenge announced: ${link}` })
  } catch (err) {
    await editOriginalResponse(appId, token, {
      content: `❌ Something went wrong: ${(err as Error).message}`,
    }).catch(() => {})
  }
}

async function handleChallengeList(
  interaction: DiscordInteraction,
  res: ServerResponse
): Promise<void> {
  // Non-ephemeral — the log channel itself isn't visible to non-admins, so
  // there's no leak risk in showing the roster to whoever ran the command.
  respondJson(res, 200, {
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: {},
  })
  waitUntil(finishChallengeList(interaction))
}

async function finishChallengeList(interaction: DiscordInteraction): Promise<void> {
  const appId = getAppId()
  const token = interaction.token

  try {
    const options = parseOptions(interaction.data?.options)
    const slug = String(options.slug ?? '')

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
    const output = buildChallengeListOutput({ name: challengeName, roster })

    await editOriginalResponse(appId, token, {
      embeds: [output.embed],
      content: output.codeblocks[0] ?? '',
    })
    for (const chunk of output.codeblocks.slice(1)) {
      await sendFollowup(appId, token, { content: chunk })
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
}

function choiceLabel(choice: SignupChoice): string {
  return choice === 'want' ? 'wanting the game' : 'already owning the game'
}

function confirmationMessage(sgUsername: string, choice: SignupChoice): string {
  const otherButton = choice === 'want' ? '✅ I already have it' : '🎁 I want the game'
  return `Recorded: **${sgUsername}** — ${choiceLabel(choice)}. Press "${otherButton}" to change your answer, or "❌ Withdraw" to drop out.`
}
