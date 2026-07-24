import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeModalCustomId, encodeSignupCustomId, slugify } from '../_lib/custom-id.js'
import { serializeArchived, serializeChallenge } from '../_lib/signup-log.js'
import { isPastDeadline } from './interactions.js'

// Outside the real Vercel runtime waitUntil is a no-op that doesn't track
// the promise, so tests capture the registered promises and drain them
// explicitly (see drainWaitUntil). vi.hoisted keeps the mock fn out of the
// factory's temporal dead zone.
const waitUntilMock = vi.hoisted(() => vi.fn())
vi.mock('@vercel/functions', () => ({ waitUntil: waitUntilMock }))

vi.mock('discord-interactions', () => ({
  verifyKey: vi.fn(async () => true),
}))

vi.mock('../_lib/discord-rest', async () => {
  const actual =
    await vi.importActual<typeof import('../_lib/discord-rest')>('../_lib/discord-rest')
  return {
    ...actual,
    createMessage: vi.fn(async () => ({
      id: 'msg1',
      channel_id: 'c1',
      content: '',
      timestamp: '',
    })),
    editMessage: vi.fn(async () => ({
      id: 'msg1',
      channel_id: 'c1',
      content: '',
      timestamp: '',
    })),
    getMessage: vi.fn(async () => ({
      id: 'msg1',
      channel_id: 'c1',
      content: '',
      timestamp: '',
      embeds: [{ fields: [] }],
    })),
    getChannelMessages: vi.fn(async () => []),
    getAllChannelMessages: vi.fn(async () => []),
    editOriginalResponse: vi.fn(async () => {}),
    sendFollowup: vi.fn(async () => {}),
  }
})

vi.mock('../_lib/identity', () => ({
  resolveDiscordUserToSgUsername: vi.fn(async () => 'yannbf'),
  validateSgUsername: vi.fn(async () => 'yannbf'),
}))

// Only `collectGroupWarningFindings` needs mocking (it goes through
// loadDataFile/data.ts, which has no host to fetch from in tests) — the
// rendering functions (buildModReportLines, chunkMessage) run for real so
// the assertions below exercise the actual production formatting.
vi.mock('../_lib/mod-report', async () => {
  const actual = await vi.importActual<typeof import('../_lib/mod-report')>('../_lib/mod-report')
  return {
    ...actual,
    collectGroupWarningFindings: vi.fn(async () => []),
  }
})

process.env.DISCORD_PUBLIC_KEY = 'test-public-key'
process.env.DISCORD_APP_ID = 'test-app-id'
process.env.DISCORD_BOT_TOKEN = 'test-bot-token'

// Imported after env vars + mocks are set up.
const { default: handler } = await import('./interactions')
const discordRest = await import('../_lib/discord-rest')
const identity = await import('../_lib/identity')
const modReport = await import('../_lib/mod-report')

function makeReq(bodyObj: unknown): IncomingMessage {
  const chunk = Buffer.from(JSON.stringify(bodyObj))
  const req = {
    method: 'POST',
    headers: {
      'x-signature-ed25519': 'sig',
      'x-signature-timestamp': 'ts',
      host: 'example.com',
    },
    async *[Symbol.asyncIterator]() {
      yield chunk
    },
  }
  return req as unknown as IncomingMessage
}

function makeRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(key: string, value: string) {
      this.headers[key] = value
    },
    end(payload?: string) {
      this.body = payload ? JSON.parse(payload) : undefined
    },
  }
  return res as unknown as ServerResponse & { body: unknown; statusCode: number }
}

const PAST_DEADLINE = 1
const FUTURE_DEADLINE = Math.floor(Date.now() / 1000) + 100_000

/** Drains promises registered via waitUntil so fire-and-forget work finishes before assertions. */
async function drainWaitUntil(): Promise<void> {
  await Promise.all(waitUntilMock.mock.calls.map(([p]) => p as Promise<unknown>))
}

describe('isPastDeadline', () => {
  it('is true once now exceeds the deadline', () => {
    expect(isPastDeadline(1000, 1001)).toBe(true)
  })
  it('is false at or before the deadline', () => {
    expect(isPastDeadline(1000, 1000)).toBe(false)
    expect(isPastDeadline(1000, 999)).toBe(false)
  })
})

describe('MESSAGE_COMPONENT button clicks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('CORE INVARIANT: a click after the deadline records nothing', async () => {
    const customId = encodeSignupCustomId('neo-cab', 'want', PAST_DEADLINE)
    const req = makeReq({
      type: 3,
      token: 'tok',
      channel_id: 'chan1',
      member: { user: { id: 'd1', username: 'yannbf' } },
      data: { custom_id: customId },
    })
    const res = makeRes()

    await handler(req, res)

    expect(discordRest.createMessage).not.toHaveBeenCalled()
    expect(res.body).toMatchObject({
      type: 4,
      data: { content: expect.stringContaining('Signups closed') },
    })
  })

  it('logs a SIGNUP and confirms when the deadline has not passed and identity resolves', async () => {
    const customId = encodeSignupCustomId('neo-cab', 'want', FUTURE_DEADLINE)
    const req = makeReq({
      type: 3,
      token: 'tok',
      channel_id: 'chan1',
      member: { user: { id: 'd1', username: 'yannbf' } },
      data: { custom_id: customId },
    })
    const res = makeRes()

    await handler(req, res)

    expect(discordRest.createMessage).toHaveBeenCalledTimes(1)
    const [, payload] = vi.mocked(discordRest.createMessage).mock.calls[0]
    expect(payload.content).toContain('"choice":"want"')
    expect(payload.content).toContain('"sg_username":"yannbf"')
    expect(res.body).toMatchObject({
      type: 4,
      data: { content: expect.stringContaining('Recorded: **yannbf**') },
    })
  })

  it('withdraws without needing identity resolution', async () => {
    const customId = encodeSignupCustomId('neo-cab', 'out', FUTURE_DEADLINE)
    const req = makeReq({
      type: 3,
      token: 'tok',
      channel_id: 'chan1',
      member: { user: { id: 'd1', username: 'yannbf' } },
      data: { custom_id: customId },
    })
    const res = makeRes()

    await handler(req, res)

    expect(discordRest.createMessage).toHaveBeenCalledTimes(1)
    const [, payload] = vi.mocked(discordRest.createMessage).mock.calls[0]
    expect(payload.content).toContain('"choice":"out"')
    expect(res.body).toMatchObject({
      data: { content: "You've been withdrawn." },
    })
  })

  it('shows a modal when the Discord account cannot be resolved', async () => {
    vi.mocked(identity.resolveDiscordUserToSgUsername).mockResolvedValueOnce(null)
    const customId = encodeSignupCustomId('neo-cab', 'have', FUTURE_DEADLINE)
    const req = makeReq({
      type: 3,
      token: 'tok',
      channel_id: 'chan1',
      member: { user: { id: 'd1', username: 'unknown-user' } },
      data: { custom_id: customId },
    })
    const res = makeRes()

    await handler(req, res)

    expect(discordRest.createMessage).not.toHaveBeenCalled()
    expect(res.body).toMatchObject({ type: 9 })
  })

  it('refreshes the signup counter after a resolved want/have click', async () => {
    const customId = encodeSignupCustomId('neo-cab', 'want', FUTURE_DEADLINE)
    const req = makeReq({
      type: 3,
      token: 'tok',
      channel_id: 'chan1',
      member: { user: { id: 'd1', username: 'yannbf' } },
      message: { id: 'ann1', channel_id: 'chan1', embeds: [{ fields: [] }] },
      data: { custom_id: customId },
    })
    const res = makeRes()

    await handler(req, res)
    await drainWaitUntil()

    expect(discordRest.editMessage).toHaveBeenCalledTimes(1)
    const [, , payload] = vi.mocked(discordRest.editMessage).mock.calls[0]
    // getAllChannelMessages is mocked to return [] regardless of the just-posted
    // SIGNUP, so the rebuilt roster (and thus the counter) is still zero here —
    // what's under test is that the counter update targets embed.footer.text.
    const embeds = payload.embeds as Array<{ footer?: { text: string } }>
    expect(embeds[0].footer?.text).toBe('🎁 0 want · ✅ 0 have')
  })

  it('refreshes the signup counter after a withdrawal', async () => {
    const customId = encodeSignupCustomId('neo-cab', 'out', FUTURE_DEADLINE)
    const req = makeReq({
      type: 3,
      token: 'tok',
      channel_id: 'chan1',
      member: { user: { id: 'd1', username: 'yannbf' } },
      message: { id: 'ann1', channel_id: 'chan1', embeds: [{ fields: [] }] },
      data: { custom_id: customId },
    })
    const res = makeRes()

    await handler(req, res)
    await drainWaitUntil()

    expect(discordRest.editMessage).toHaveBeenCalledTimes(1)
    const [, , payload] = vi.mocked(discordRest.editMessage).mock.calls[0]
    const embeds = payload.embeds as Array<{ footer?: { text: string } }>
    expect(embeds[0].footer?.text).toBe('🎁 0 want · ✅ 0 have')
  })
})

describe('MODAL_SUBMIT', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('CORE INVARIANT: a modal submitted after the deadline records nothing', async () => {
    const customId = encodeModalCustomId('neo-cab', 'want', PAST_DEADLINE)
    const req = makeReq({
      type: 5,
      token: 'tok',
      member: { user: { id: 'd1', username: 'yannbf' } },
      data: {
        custom_id: customId,
        components: [{ components: [{ custom_id: 'sg_username', value: 'yannbf' }] }],
      },
    })
    const res = makeRes()

    await handler(req, res)

    expect(discordRest.createMessage).not.toHaveBeenCalled()
    expect(res.body).toMatchObject({
      data: { content: expect.stringContaining('Signups closed') },
    })
  })

  it('logs a guest signup and says an admin will verify when the SG username is unrecognized', async () => {
    vi.mocked(identity.validateSgUsername).mockResolvedValueOnce(null)
    const customId = encodeModalCustomId('neo-cab', 'want', FUTURE_DEADLINE)
    const req = makeReq({
      type: 5,
      token: 'tok',
      member: { user: { id: 'd1', username: 'randomguy' } },
      data: {
        custom_id: customId,
        components: [{ components: [{ custom_id: 'sg_username', value: 'TotallyMadeUp' }] }],
      },
    })
    const res = makeRes()

    await handler(req, res)

    expect(discordRest.createMessage).toHaveBeenCalledTimes(1)
    const [, payload] = vi.mocked(discordRest.createMessage).mock.calls[0]
    expect(payload.content).toContain('"guest":true')
    // The typed name is preserved (guest flag marks it unverified) so admins
    // have something to check against.
    expect(payload.content).toContain('"sg_username":"TotallyMadeUp"')
    expect(res.body).toMatchObject({
      data: { content: expect.stringContaining('recorded as guest') },
    })
  })

  it('logs a resolved guest signup when the SG username matches a group member', async () => {
    const customId = encodeModalCustomId('neo-cab', 'have', FUTURE_DEADLINE)
    const req = makeReq({
      type: 5,
      token: 'tok',
      member: { user: { id: 'd1', username: 'randomguy' } },
      data: {
        custom_id: customId,
        components: [{ components: [{ custom_id: 'sg_username', value: 'yannbf' }] }],
      },
    })
    const res = makeRes()

    await handler(req, res)

    const [, payload] = vi.mocked(discordRest.createMessage).mock.calls[0]
    expect(payload.content).toContain('"guest":false')
    expect(payload.content).toContain('"sg_username":"yannbf"')
  })

  it('refreshes the signup counter after a guest-modal signup (no .message on the interaction)', async () => {
    // Modal-submit interactions typically lack `.message`, so this exercises
    // the CHALLENGE-log fallback (getAllChannelMessages -> getMessage).
    vi.mocked(discordRest.getAllChannelMessages).mockResolvedValueOnce([
      {
        id: 'log1',
        channel_id: 'logc',
        content: serializeChallenge({
          slug: 'neo-cab',
          channel_id: 'chan1',
          message_id: 'ann1',
          deadline: 1,
          start: 1,
          end: 2,
          name: 'Neo Cab',
        }),
        timestamp: '',
      },
    ])
    const customId = encodeModalCustomId('neo-cab', 'have', FUTURE_DEADLINE)
    const req = makeReq({
      type: 5,
      token: 'tok',
      member: { user: { id: 'd1', username: 'randomguy' } },
      data: {
        custom_id: customId,
        components: [{ components: [{ custom_id: 'sg_username', value: 'yannbf' }] }],
      },
    })
    const res = makeRes()

    await handler(req, res)
    await drainWaitUntil()

    expect(discordRest.getMessage).toHaveBeenCalledWith('chan1', 'ann1')
    expect(discordRest.editMessage).toHaveBeenCalledTimes(1)
    const [, , payload] = vi.mocked(discordRest.editMessage).mock.calls[0]
    const embeds = payload.embeds as Array<{ footer?: { text: string } }>
    expect(embeds[0].footer?.text).toBe('🎁 0 want · ✅ 0 have')
  })
})

describe('APPLICATION_COMMAND challenge-setup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('responds immediately with a MODAL and 5 Label-wrapped components, without deferring', async () => {
    const req = makeReq({
      type: 2,
      token: 'tok',
      channel_id: 'chan1',
      member: { user: { id: 'd1', username: 'yannbf' } },
      data: { name: 'challenge-setup' },
    })
    const res = makeRes()

    await handler(req, res)

    expect(res.body).toMatchObject({
      type: 9,
      data: { custom_id: 'csetup' },
    })
    const body = res.body as {
      data: { components: Array<{ type: number; label: string; component: { custom_id: string; type: number } }> }
    }
    // Components-v2: every field is a Label (type 18) wrapping its input component.
    expect(body.data.components).toHaveLength(5)
    expect(body.data.components.every((c) => c.type === 18)).toBe(true)
    const customIds = body.data.components.map((c) => c.component.custom_id)
    expect(customIds).toEqual(['name', 'description', 'dates', 'signup_deadline', 'congrats_channel'])

    // The congrats-channel field is a Channel Select (type 8), text-channels only.
    const congratsChannel = body.data.components.find((c) => c.component.custom_id === 'congrats_channel')!
    expect(congratsChannel.component.type).toBe(8)
    expect(congratsChannel.component).toMatchObject({ channel_types: [0], required: false })

    expect(discordRest.createMessage).not.toHaveBeenCalled()
  })
})

describe('MODAL_SUBMIT challenge-setup (csetup)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeCsetupReq(overrides: {
    name?: string
    description?: string
    dates?: string
    signup_deadline?: string
    customId?: string
  }): IncomingMessage {
    const fields = {
      name: 'Neo Cab',
      description: 'A great challenge',
      // Relative offsets so this fixture is never accidentally in the past
      // relative to the real clock (validateChallengeDates now rejects a
      // start before today) — "+1d" anchors off midnight UTC of "now",
      // "+30d" anchors off the parsed start per parseAdminDate's anchoring.
      dates: '+1d → +30d',
      signup_deadline: '',
      customId: 'csetup',
      ...overrides,
    }
    return makeReq({
      type: 5,
      token: 'tok',
      channel_id: 'chan1',
      member: { user: { id: 'd1', username: 'yannbf' } },
      data: {
        custom_id: fields.customId,
        components: [
          { components: [{ custom_id: 'name', value: fields.name }] },
          { components: [{ custom_id: 'description', value: fields.description }] },
          { components: [{ custom_id: 'dates', value: fields.dates }] },
          { components: [{ custom_id: 'signup_deadline', value: fields.signup_deadline }] },
        ],
      },
    })
  }

  it('announces the challenge, logs it, and reports success', async () => {
    const req = makeCsetupReq({})
    const res = makeRes()

    await handler(req, res)
    // Deferred ephemeral ack.
    expect(res.body).toMatchObject({
      type: 5,
      data: { flags: 1 << 6 },
    })

    await drainWaitUntil()

    expect(discordRest.createMessage).toHaveBeenCalledTimes(2)
    const [announcementChannel, announcementPayload] = vi.mocked(discordRest.createMessage).mock
      .calls[0]
    expect(announcementChannel).toBe('chan1')

    const embed = (announcementPayload.embeds as Array<Record<string, unknown>>)[0]!
    expect(embed.image).toEqual({ url: 'https://sg-club.vercel.app/game-challenge-banner.png' })
    const fields = embed.fields as Array<{ name: string; value: string; inline?: boolean }>
    expect(fields.find((f) => f.name === 'Signups close')).toMatchObject({ inline: true })
    expect(fields.find((f) => f.name === 'Challenge')).toMatchObject({ inline: true })

    const components = announcementPayload.components as Array<{
      components: Array<{ label: string; style: number; url?: string; custom_id?: string }>
    }>
    const buttons = components[0]!.components
    expect(buttons).toHaveLength(4)
    const linkButton = buttons.find((b) => b.style === 5)
    expect(linkButton).toMatchObject({
      label: 'View Event',
      url: 'https://sg-club.vercel.app/events/',
    })
    expect(linkButton?.custom_id).toBeUndefined()
    const withdrawButton = buttons.find((b) => b.label.includes('Withdraw'))
    expect(withdrawButton?.label).toBe('✕ Withdraw')

    const [, logPayload] = vi.mocked(discordRest.createMessage).mock.calls[1]
    const expectedSlug = slugify('Neo Cab')
    expect(logPayload.content).toContain(`"slug":"${expectedSlug}"`)
    expect(logPayload.content).not.toContain('"link"')

    expect(discordRest.editOriginalResponse).toHaveBeenCalledWith(
      'test-app-id',
      'tok',
      expect.objectContaining({ content: expect.stringContaining('✅ Challenge announced:') })
    )
  })

  it('omits congrats_channel_id from the log and the confirmation mention when no channel was picked (legacy action-row shape)', async () => {
    const req = makeCsetupReq({})
    const res = makeRes()

    await handler(req, res)
    await drainWaitUntil()

    const [, logPayload] = vi.mocked(discordRest.createMessage).mock.calls[1]
    expect(logPayload.content).not.toContain('congrats_channel_id')

    expect(discordRest.editOriginalResponse).toHaveBeenCalledWith(
      'test-app-id',
      'tok',
      expect.objectContaining({ content: expect.not.stringContaining('Congrats will post') })
    )
  })

  // Components-v2 modal submits nest each field's value differently from the
  // legacy action-row shape `makeCsetupReq` builds above: top-level entries
  // carry `custom_id` directly (text inputs: `value`; the channel select:
  // `values`), instead of `data.components[].components[].value`.
  function makeCsetupReqV2(overrides: {
    dates?: string
    congratsChannelId?: string
  }): IncomingMessage {
    const dates = overrides.dates ?? '+1d → +30d'
    const components: Array<Record<string, unknown>> = [
      { custom_id: 'name', value: 'Neo Cab' },
      { custom_id: 'description', value: 'A great challenge' },
      { custom_id: 'dates', value: dates },
      { custom_id: 'signup_deadline', value: '' },
      {
        custom_id: 'congrats_channel',
        values: overrides.congratsChannelId ? [overrides.congratsChannelId] : [],
      },
    ]
    return makeReq({
      type: 5,
      token: 'tok',
      channel_id: 'chan1',
      member: { user: { id: 'd1', username: 'yannbf' } },
      data: { custom_id: 'csetup', components },
    })
  }

  it('parses the components-v2 flat payload shape (no channel picked)', async () => {
    const req = makeCsetupReqV2({})
    const res = makeRes()

    await handler(req, res)
    await drainWaitUntil()

    expect(discordRest.createMessage).toHaveBeenCalledTimes(2)
    const [, logPayload] = vi.mocked(discordRest.createMessage).mock.calls[1]
    expect(logPayload.content).not.toContain('congrats_channel_id')
    expect(discordRest.editOriginalResponse).toHaveBeenCalledWith(
      'test-app-id',
      'tok',
      expect.objectContaining({ content: expect.stringContaining('✅ Challenge announced:') })
    )
  })

  it('reads the congrats channel from the v2 Channel Select, records congrats_channel_id in the log, and mentions the channel in the confirmation', async () => {
    const req = makeCsetupReqV2({ congratsChannelId: 'congrats-chan-1' })
    const res = makeRes()

    await handler(req, res)
    await drainWaitUntil()

    expect(discordRest.createMessage).toHaveBeenCalledTimes(2)
    const [, logPayload] = vi.mocked(discordRest.createMessage).mock.calls[1]
    expect(logPayload.content).toContain('"congrats_channel_id":"congrats-chan-1"')

    expect(discordRest.editOriginalResponse).toHaveBeenCalledWith(
      'test-app-id',
      'tok',
      expect.objectContaining({
        content: expect.stringContaining('Congrats will post in <#congrats-chan-1>'),
      })
    )
  })

  it.each([
    ['an arrow', '+1d → +30d'],
    ['an ASCII arrow', '+1d -> +30d'],
    ["the word 'to'", '+1d to +30d'],
  ])('parses the dates field split on %s', async (_label, dates) => {
    const req = makeCsetupReq({ dates })
    const res = makeRes()

    await handler(req, res)
    await drainWaitUntil()

    expect(discordRest.createMessage).toHaveBeenCalledTimes(2)
    expect(discordRest.editOriginalResponse).toHaveBeenCalledWith(
      'test-app-id',
      'tok',
      expect.objectContaining({ content: expect.stringContaining('✅ Challenge announced:') })
    )
  })

  it('rejects a duplicate slug without posting anything', async () => {
    vi.mocked(discordRest.getAllChannelMessages).mockResolvedValueOnce([
      {
        id: 'log1',
        channel_id: 'logc',
        content: serializeChallenge({
          slug: 'neo-cab',
          channel_id: 'chan0',
          message_id: 'ann0',
          deadline: 1,
          start: 1,
          end: 2,
          name: 'Neo Cab (old)',
        }),
        timestamp: '',
      },
    ])
    const req = makeCsetupReq({ name: 'Neo Cab' })
    const res = makeRes()

    await handler(req, res)
    await drainWaitUntil()

    expect(discordRest.createMessage).not.toHaveBeenCalled()
    expect(discordRest.editOriginalResponse).toHaveBeenCalledWith(
      'test-app-id',
      'tok',
      expect.objectContaining({ content: expect.stringContaining('already exists') })
    )
  })

  it('surfaces a friendly error when the dates field has no recognizable separator', async () => {
    const req = makeCsetupReq({ dates: '2026-01-01 2026-02-01' })
    const res = makeRes()

    await handler(req, res)
    await drainWaitUntil()

    expect(discordRest.createMessage).not.toHaveBeenCalled()
    expect(discordRest.editOriginalResponse).toHaveBeenCalledWith(
      'test-app-id',
      'tok',
      expect.objectContaining({ content: expect.stringContaining('❌') })
    )
  })

  it('surfaces a friendly error for a bad date on one side of the range', async () => {
    const req = makeCsetupReq({ dates: 'not-a-date → 2026-02-01' })
    const res = makeRes()

    await handler(req, res)
    await drainWaitUntil()

    expect(discordRest.createMessage).not.toHaveBeenCalled()
    expect(discordRest.editOriginalResponse).toHaveBeenCalledWith(
      'test-app-id',
      'tok',
      expect.objectContaining({ content: expect.stringContaining('❌') })
    )
  })

})

describe('APPLICATION_COMMAND mod-report', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeModReportReq(): IncomingMessage {
    return makeReq({
      type: 2,
      token: 'tok',
      channel_id: 'chan1',
      member: { user: { id: 'd1', username: 'yannbf' } },
      data: { name: 'mod-report' },
    })
  }

  it('defers non-ephemerally, then edits the original response with the rendered report', async () => {
    vi.mocked(modReport.collectGroupWarningFindings).mockResolvedValueOnce([
      {
        username: 'alice',
        code: 'required_play_deadline_expired',
        label: 'Required-play deadline expired',
        severity: 'error',
      },
      {
        username: 'bob',
        code: 'no_giveaway_created_in_6_months',
        label: 'No giveaway created in 6 months',
        severity: 'warn',
      },
    ])

    const req = makeModReportReq()
    const res = makeRes()

    await handler(req, res)

    // Deferred, non-ephemeral (no flags set on the ack).
    expect(res.body).toEqual({ type: 5, data: {} })

    await drainWaitUntil()

    expect(discordRest.editOriginalResponse).toHaveBeenCalledTimes(1)
    const [, , payload] = vi.mocked(discordRest.editOriginalResponse).mock.calls[0]!
    expect(payload).toMatchObject({ flags: 4 })
    const content = (payload as { content: string }).content
    expect(content).toContain('**Mod Report**')
    expect(content).toContain('‼️ **Need attention** (1 members)')
    expect(content).toContain('👀 **Warnings** (1 members)')
    expect(content).toContain(
      'Required-play deadline expired:\n- [alice](<https://sg-club.vercel.app/users/alice/?tab=won&filter=play-required>)\n'
    )
    expect(content).toContain(
      'No giveaway created in 6 months:\n- [bob](<https://sg-club.vercel.app/users/bob/>)\n'
    )
    expect(content).toContain('Ex-member entry checks run in the weekly digest only.')
  })

  it('reports zero-member sections when there are no findings', async () => {
    vi.mocked(modReport.collectGroupWarningFindings).mockResolvedValueOnce([])

    const req = makeModReportReq()
    const res = makeRes()

    await handler(req, res)
    await drainWaitUntil()

    const [, , payload] = vi.mocked(discordRest.editOriginalResponse).mock.calls[0]!
    const content = (payload as { content: string }).content
    expect(content).toContain('‼️ **Need attention** (0 members)')
    expect(content).toContain('👀 **Warnings** (0 members)')
  })

  it('surfaces a friendly error if collecting findings throws', async () => {
    vi.mocked(modReport.collectGroupWarningFindings).mockRejectedValueOnce(new Error('data file missing'))

    const req = makeModReportReq()
    const res = makeRes()

    await handler(req, res)
    await drainWaitUntil()

    expect(discordRest.editOriginalResponse).toHaveBeenCalledWith(
      'test-app-id',
      'tok',
      expect.objectContaining({ content: expect.stringContaining('data file missing') })
    )
  })
})

describe('APPLICATION_COMMAND challenge-list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeChallengeListReq(): IncomingMessage {
    return makeReq({
      type: 2,
      token: 'tok',
      channel_id: 'chan1',
      member: { user: { id: 'd1', username: 'yannbf' } },
      data: { name: 'challenge-list' },
    })
  }

  function challengeMeta(overrides: {
    slug: string
    name: string
    messageId: string
    end?: number
  }): string {
    return serializeChallenge({
      slug: overrides.slug,
      channel_id: 'chan1',
      message_id: overrides.messageId,
      deadline: 1,
      start: 1,
      // Far in the future by default, so these picker-shape tests exercise
      // an "ongoing" challenge unless a test explicitly wants an ended one.
      end: overrides.end ?? FUTURE_DEADLINE,
      name: overrides.name,
    })
  }

  it('defers ephemerally, then replies "No challenges found." when the log has no CHALLENGE metas', async () => {
    const req = makeChallengeListReq()
    const res = makeRes()

    await handler(req, res)

    // Deferred ephemeral ack — building the picker needs a log-channel fetch.
    expect(res.body).toEqual({ type: 5, data: { flags: 1 << 6 } })

    await drainWaitUntil()

    expect(discordRest.editOriginalResponse).toHaveBeenCalledWith(
      'test-app-id',
      'tok',
      expect.objectContaining({ content: 'No challenges found.' })
    )
  })

  it('replies with a "Pick a challenge:" string-select, newest challenge first', async () => {
    vi.mocked(discordRest.getAllChannelMessages).mockResolvedValueOnce([
      { id: 'log2', channel_id: 'logc', content: challengeMeta({ slug: 'neo-cab-2', name: 'Neo Cab 2', messageId: 'ann2' }), timestamp: '' },
      { id: 'log1', channel_id: 'logc', content: challengeMeta({ slug: 'neo-cab', name: 'Neo Cab', messageId: 'ann1' }), timestamp: '' },
    ])
    const req = makeChallengeListReq()
    const res = makeRes()

    await handler(req, res)
    await drainWaitUntil()

    const [, , payload] = vi.mocked(discordRest.editOriginalResponse).mock.calls[0]!
    expect((payload as { content: string }).content).toBe('Pick a challenge:')

    const components = (
      payload as {
        components: Array<{
          type: number
          components: Array<{
            type: number
            custom_id: string
            options: Array<{ label: string; value: string; description: string }>
          }>
        }>
      }
    ).components
    const select = components[0]!.components[0]!
    expect(select.type).toBe(3)
    expect(select.custom_id).toBe('clist')
    expect(select.options).toEqual([
      { label: 'Neo Cab 2', value: 'neo-cab-2', description: 'ongoing · neo-cab-2' },
      { label: 'Neo Cab', value: 'neo-cab', description: 'ongoing · neo-cab' },
    ])
  })

  it('dedupes by slug (keeping the newest meta) and caps the picker at 25 options', async () => {
    // getAllChannelMessages returns newest-first; two CHALLENGE lines per
    // slug (a re-announce) should collapse to one option, keeping the first
    // (newest) one seen.
    const messages = [
      { id: 'dup-new', channel_id: 'logc', content: challengeMeta({ slug: 'dup', name: 'Dup (new)', messageId: 'annNew' }), timestamp: '' },
      ...Array.from({ length: 29 }, (_, i) => ({
        id: `log${i}`,
        channel_id: 'logc',
        content: challengeMeta({ slug: `challenge-${i}`, name: `Challenge ${i}`, messageId: `ann${i}` }),
        timestamp: '',
      })),
      { id: 'dup-old', channel_id: 'logc', content: challengeMeta({ slug: 'dup', name: 'Dup (old)', messageId: 'annOld' }), timestamp: '' },
    ]
    vi.mocked(discordRest.getAllChannelMessages).mockResolvedValueOnce(messages)

    const req = makeChallengeListReq()
    const res = makeRes()

    await handler(req, res)
    await drainWaitUntil()

    const [, , payload] = vi.mocked(discordRest.editOriginalResponse).mock.calls[0]!
    const components = (
      payload as { components: Array<{ components: Array<{ options: Array<{ label: string; value: string }> }> }> }
    ).components
    const options = components[0]!.components[0]!.options
    expect(options).toHaveLength(25)
    expect(options[0]).toEqual({ label: 'Dup (new)', value: 'dup', description: 'ongoing · dup' })
    expect(options.some((o) => o.label === 'Dup (old)')).toBe(false)
  })

  it('lists ongoing challenges before ended ones, each newest-first within its group', async () => {
    const messages = [
      { id: 'log-ended-new', channel_id: 'logc', content: challengeMeta({ slug: 'ended-2', name: 'Ended 2', messageId: 'a1', end: 2 }), timestamp: '' },
      { id: 'log-ongoing-new', channel_id: 'logc', content: challengeMeta({ slug: 'ongoing-2', name: 'Ongoing 2', messageId: 'a2' }), timestamp: '' },
      { id: 'log-ended-old', channel_id: 'logc', content: challengeMeta({ slug: 'ended-1', name: 'Ended 1', messageId: 'a3', end: 2 }), timestamp: '' },
      { id: 'log-ongoing-old', channel_id: 'logc', content: challengeMeta({ slug: 'ongoing-1', name: 'Ongoing 1', messageId: 'a4' }), timestamp: '' },
    ]
    vi.mocked(discordRest.getAllChannelMessages).mockResolvedValueOnce(messages)

    const req = makeChallengeListReq()
    const res = makeRes()
    await handler(req, res)
    await drainWaitUntil()

    const [, , payload] = vi.mocked(discordRest.editOriginalResponse).mock.calls[0]!
    const components = (
      payload as { components: Array<{ components: Array<{ options: Array<{ value: string; description: string }> }> }> }
    ).components
    const options = components[0]!.components[0]!.options
    expect(options.map((o) => o.value)).toEqual(['ongoing-2', 'ongoing-1', 'ended-2', 'ended-1'])
    expect(options.map((o) => o.description)).toEqual([
      'ongoing · ongoing-2',
      'ongoing · ongoing-1',
      'ended · ended-2',
      'ended · ended-1',
    ])
  })

  it('excludes archived challenges entirely, even when prioritizing ongoing ones', async () => {
    const messages = [
      { id: 'log1', channel_id: 'logc', content: challengeMeta({ slug: 'archived-ongoing', name: 'Archived Ongoing', messageId: 'a1' }), timestamp: '' },
      { id: 'log2', channel_id: 'logc', content: serializeArchived({ slug: 'archived-ongoing', ts: 1 }), timestamp: '' },
      { id: 'log3', channel_id: 'logc', content: challengeMeta({ slug: 'kept', name: 'Kept', messageId: 'a2' }), timestamp: '' },
    ]
    vi.mocked(discordRest.getAllChannelMessages).mockResolvedValueOnce(messages)

    const req = makeChallengeListReq()
    const res = makeRes()
    await handler(req, res)
    await drainWaitUntil()

    const [, , payload] = vi.mocked(discordRest.editOriginalResponse).mock.calls[0]!
    const components = (
      payload as { components: Array<{ components: Array<{ options: Array<{ value: string }> }> }> }
    ).components
    const options = components[0]!.components[0]!.options
    expect(options.map((o) => o.value)).toEqual(['kept'])
  })

  it('caps at 25 with ongoing challenges prioritized over ended ones', async () => {
    // 30 ongoing + 10 ended, more than the 25-option cap combined — the cap
    // should be filled entirely by ongoing challenges, none of the ended
    // ones should make it in.
    const ongoing = Array.from({ length: 30 }, (_, i) => ({
      id: `ongoing-${i}`,
      channel_id: 'logc',
      content: challengeMeta({ slug: `ongoing-${i}`, name: `Ongoing ${i}`, messageId: `o${i}` }),
      timestamp: '',
    }))
    const ended = Array.from({ length: 10 }, (_, i) => ({
      id: `ended-${i}`,
      channel_id: 'logc',
      content: challengeMeta({ slug: `ended-${i}`, name: `Ended ${i}`, messageId: `e${i}`, end: 2 }),
      timestamp: '',
    }))
    // Interleave so the picker's ordering logic (not source order) is what's under test.
    vi.mocked(discordRest.getAllChannelMessages).mockResolvedValueOnce([...ended, ...ongoing])

    const req = makeChallengeListReq()
    const res = makeRes()
    await handler(req, res)
    await drainWaitUntil()

    const [, , payload] = vi.mocked(discordRest.editOriginalResponse).mock.calls[0]!
    const components = (
      payload as { components: Array<{ components: Array<{ options: Array<{ value: string; description: string }> }> }> }
    ).components
    const options = components[0]!.components[0]!.options
    expect(options).toHaveLength(25)
    expect(options.every((o) => o.description.startsWith('ongoing · '))).toBe(true)
  })
})

describe('MESSAGE_COMPONENT challenge-list select (clist)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defers non-ephemerally, then renders the roster for the selected slug', async () => {
    vi.mocked(discordRest.getAllChannelMessages).mockResolvedValueOnce([
      {
        id: 'log1',
        channel_id: 'logc',
        content: serializeChallenge({
          slug: 'neo-cab',
          channel_id: 'chan1',
          message_id: 'ann1',
          deadline: 1,
          start: 1,
          end: 2,
          name: 'Neo Cab',
        }),
        timestamp: '',
      },
    ])
    const req = makeReq({
      type: 3,
      token: 'tok',
      channel_id: 'chan1',
      member: { user: { id: 'd1', username: 'yannbf' } },
      data: { custom_id: 'clist', values: ['neo-cab'] },
    })
    const res = makeRes()

    await handler(req, res)

    // Deferred, non-ephemeral (no flags on the ack) — same rationale as the
    // old slug-argument /challenge-list.
    expect(res.body).toEqual({ type: 5, data: {} })

    await drainWaitUntil()

    expect(discordRest.editOriginalResponse).toHaveBeenCalledWith(
      'test-app-id',
      'tok',
      expect.objectContaining({
        content: expect.stringContaining('**Neo Cab — signups**'),
        flags: 4,
      })
    )
  })

  it('is routed independently of the su|/sg| decoder', async () => {
    // Regression guard: `clist` has no pipes, so decodeCustomId would
    // reject it — the handler must check for it before falling through to
    // the signup-button decoder.
    const req = makeReq({
      type: 3,
      token: 'tok',
      channel_id: 'chan1',
      member: { user: { id: 'd1', username: 'yannbf' } },
      data: { custom_id: 'clist', values: ['some-slug'] },
    })
    const res = makeRes()

    await handler(req, res)

    expect(res.body).not.toMatchObject({ type: 400 })
    expect(res.statusCode).not.toBe(400)
  })
})

describe('APPLICATION_COMMAND challenge-archive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeChallengeArchiveReq(): IncomingMessage {
    return makeReq({
      type: 2,
      token: 'tok',
      channel_id: 'chan1',
      member: { user: { id: 'd1', username: 'yannbf' } },
      data: { name: 'challenge-archive' },
    })
  }

  it('defers ephemerally, then replies "No challenges to archive." when the log has no CHALLENGE metas', async () => {
    const req = makeChallengeArchiveReq()
    const res = makeRes()

    await handler(req, res)

    expect(res.body).toEqual({ type: 5, data: { flags: 1 << 6 } })

    await drainWaitUntil()

    expect(discordRest.editOriginalResponse).toHaveBeenCalledWith(
      'test-app-id',
      'tok',
      expect.objectContaining({ content: 'No challenges to archive.' })
    )
  })

  it('replies with a "Pick a challenge to archive:" string-select including both ongoing and ended, but excluding archived challenges', async () => {
    vi.mocked(discordRest.getAllChannelMessages).mockResolvedValueOnce([
      {
        id: 'log1',
        channel_id: 'logc',
        content: serializeChallenge({
          slug: 'ongoing-1',
          channel_id: 'chan1',
          message_id: 'ann1',
          deadline: 1,
          start: 1,
          end: FUTURE_DEADLINE,
          name: 'Ongoing One',
        }),
        timestamp: '',
      },
      {
        id: 'log2',
        channel_id: 'logc',
        content: serializeChallenge({
          slug: 'ended-1',
          channel_id: 'chan1',
          message_id: 'ann2',
          deadline: 1,
          start: 1,
          end: 2,
          name: 'Ended One',
        }),
        timestamp: '',
      },
      {
        id: 'log3',
        channel_id: 'logc',
        content: serializeChallenge({
          slug: 'archived-1',
          channel_id: 'chan1',
          message_id: 'ann3',
          deadline: 1,
          start: 1,
          end: FUTURE_DEADLINE,
          name: 'Archived One',
        }),
        timestamp: '',
      },
      { id: 'log4', channel_id: 'logc', content: serializeArchived({ slug: 'archived-1', ts: 1 }), timestamp: '' },
    ])

    const req = makeChallengeArchiveReq()
    const res = makeRes()

    await handler(req, res)
    await drainWaitUntil()

    const [, , payload] = vi.mocked(discordRest.editOriginalResponse).mock.calls[0]!
    expect((payload as { content: string }).content).toBe('Pick a challenge to archive:')

    const components = (
      payload as {
        components: Array<{
          components: Array<{ custom_id: string; options: Array<{ label: string; value: string }> }>
        }>
      }
    ).components
    const select = components[0]!.components[0]!
    expect(select.custom_id).toBe('carch')
    expect(select.options.map((o) => o.value).sort()).toEqual(['ended-1', 'ongoing-1'])
  })
})

describe('MESSAGE_COMPONENT challenge-archive select (carch)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defers with an UPDATE_MESSAGE ack, posts the ARCHIVED marker, then edits the original response with an ephemeral confirmation and no components', async () => {
    vi.mocked(discordRest.getAllChannelMessages).mockResolvedValueOnce([
      {
        id: 'log1',
        channel_id: 'logc',
        content: serializeChallenge({
          slug: 'neo-cab',
          channel_id: 'chan1',
          message_id: 'ann1',
          deadline: 1,
          start: 1,
          end: 2,
          name: 'Neo Cab',
        }),
        timestamp: '',
      },
    ])
    const req = makeReq({
      type: 3,
      token: 'tok',
      channel_id: 'chan1',
      member: { user: { id: 'd1', username: 'yannbf' } },
      data: { custom_id: 'carch', values: ['neo-cab'] },
    })
    const res = makeRes()

    await handler(req, res)

    // Deferred UPDATE_MESSAGE — updates the same ephemeral picker message in place.
    expect(res.body).toEqual({ type: 6, data: {} })

    await drainWaitUntil()

    expect(discordRest.createMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ content: expect.stringMatching(/^ARCHIVED \{.*"slug":"neo-cab".*\}$/) })
    )

    expect(discordRest.editOriginalResponse).toHaveBeenCalledWith(
      'test-app-id',
      'tok',
      expect.objectContaining({
        content: expect.stringContaining('Archived **Neo Cab**'),
        components: [],
      })
    )
  })

  it('is routed independently of the su|/sg| decoder', async () => {
    const req = makeReq({
      type: 3,
      token: 'tok',
      channel_id: 'chan1',
      member: { user: { id: 'd1', username: 'yannbf' } },
      data: { custom_id: 'carch', values: ['some-slug'] },
    })
    const res = makeRes()

    await handler(req, res)

    expect(res.body).not.toMatchObject({ type: 400 })
    expect(res.statusCode).not.toBe(400)
  })
})

describe('PING', () => {
  it('responds with PONG', async () => {
    const req = makeReq({ type: 1 })
    const res = makeRes()
    await handler(req, res)
    expect(res.body).toEqual({ type: 1 })
  })
})
