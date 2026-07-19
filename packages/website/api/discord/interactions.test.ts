import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeModalCustomId, encodeSignupCustomId } from '../_lib/custom-id'
import { isPastDeadline } from './interactions'

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

process.env.DISCORD_PUBLIC_KEY = 'test-public-key'
process.env.DISCORD_APP_ID = 'test-app-id'
process.env.DISCORD_BOT_TOKEN = 'test-bot-token'

// Imported after env vars + mocks are set up.
const { default: handler } = await import('./interactions')
const discordRest = await import('../_lib/discord-rest')
const identity = await import('../_lib/identity')

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
})

describe('PING', () => {
  it('responds with PONG', async () => {
    const req = makeReq({ type: 1 })
    const res = makeRes()
    await handler(req, res)
    expect(res.body).toEqual({ type: 1 })
  })
})
