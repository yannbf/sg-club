import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeModalCustomId, encodeSignupCustomId, slugify } from '../_lib/custom-id.js'
import { serializeChallenge } from '../_lib/signup-log.js'
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

  it('responds immediately with a MODAL and 4 action rows, without deferring', async () => {
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
      data: { components: Array<{ components: Array<{ custom_id: string }> }> }
    }
    expect(body.data.components).toHaveLength(4)
    const customIds = body.data.components.map((row) => row.components[0]!.custom_id)
    expect(customIds).toEqual(['name', 'description', 'dates', 'signup_deadline'])
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
  }): IncomingMessage {
    const fields = {
      name: 'Neo Cab',
      description: 'A great challenge',
      dates: '2026-01-01 → 2026-02-01',
      signup_deadline: '',
      ...overrides,
    }
    return makeReq({
      type: 5,
      token: 'tok',
      channel_id: 'chan1',
      member: { user: { id: 'd1', username: 'yannbf' } },
      data: {
        custom_id: 'csetup',
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

  it.each([
    ['an arrow', '2026-01-01 → 2026-02-01'],
    ['an ASCII arrow', '2026-01-01 -> 2026-02-01'],
    ["the word 'to'", '2026-01-01 to 2026-02-01'],
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
    expect(content).toContain('**Need attention** (1 members)')
    expect(content).toContain('**Warnings** (1 members)')
    expect(content).toContain('Required-play deadline expired: [alice](<https://sg-club.vercel.app/users/alice/?tab=won&filter=play-required>)')
    expect(content).toContain('No giveaway created in 6 months: [bob](<https://sg-club.vercel.app/users/bob/>)')
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
    expect(content).toContain('**Need attention** (0 members)')
    expect(content).toContain('**Warnings** (0 members)')
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
  }): string {
    return serializeChallenge({
      slug: overrides.slug,
      channel_id: 'chan1',
      message_id: overrides.messageId,
      deadline: 1,
      start: 1,
      end: 2,
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
      { label: 'Neo Cab 2', value: 'neo-cab-2', description: 'neo-cab-2' },
      { label: 'Neo Cab', value: 'neo-cab', description: 'neo-cab' },
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
    expect(options[0]).toEqual({ label: 'Dup (new)', value: 'dup', description: 'dup' })
    expect(options.some((o) => o.label === 'Dup (old)')).toBe(false)
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

describe('PING', () => {
  it('responds with PONG', async () => {
    const req = makeReq({ type: 1 })
    const res = makeRes()
    await handler(req, res)
    expect(res.body).toEqual({ type: 1 })
  })
})
