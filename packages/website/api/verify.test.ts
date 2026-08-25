import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler from './verify.js'

const ADMIN_PASSWORD = 'hunter2'
const ADMIN_PASSWORD_HASH = createHash('sha256').update(ADMIN_PASSWORD).digest('hex')

const GIVEAWAYS = {
  giveaways: [
    {
      id: 'abc12',
      name: 'Some Game',
      points: 25,
      winners: [{ name: 'steam1', winner_username: 'winnerName', status: 'won' }],
    },
    {
      id: 'noWin',
      name: 'No Winner Game',
      points: 10,
      winners: [],
    },
    {
      id: 'TF7Vk',
      name: 'Gorogoa',
      points: 15,
      winners: [
        { name: 'steamFirst', winner_username: 'dramainfouracts', status: 'won' },
        { name: 'steamSecond', winner_username: 'lext', status: 'won' },
      ],
    },
  ],
}

vi.mock('./_lib/data.js', () => ({
  loadDataFile: vi.fn(async () => GIVEAWAYS),
}))

vi.mock('./_lib/discord-rest.js', () => ({
  addReaction: vi.fn(async () => {}),
  removeReaction: vi.fn(async () => {}),
}))

import { addReaction, removeReaction } from './_lib/discord-rest.js'

/** Builds a fake IncomingMessage carrying a JSON body, for handler(req, res). */
function fakeRequest(body: unknown, method = 'POST'): IncomingMessage {
  const raw = JSON.stringify(body)
  const req = {
    method,
    headers: { host: 'sg-club.vercel.app' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(raw)
    },
  }
  return req as unknown as IncomingMessage
}

function fakeResponse(): ServerResponse & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value
    },
    end(chunk?: string) {
      if (chunk) this.body = JSON.parse(chunk)
    },
  }
  return res as unknown as ServerResponse & { statusCode: number; body: unknown }
}

/** Sets up the fetch mock for a run that reaches the Google Sheets API: token exchange, tab-title lookup, and values.get, keyed by tab values. */
function mockGoogleFlow(tabTitle: string, values: string[][]) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (url.includes('oauth2.googleapis.com/token')) {
      return jsonResponse({ access_token: 'fake-token' })
    }
    if (url.includes('fields=sheets.properties')) {
      return jsonResponse({
        sheets: [
          { properties: { sheetId: 0, title: tabTitle } },
          { properties: { sheetId: 2065024481, title: 'Play Required' } },
        ],
      })
    }
    if (url.includes('/values/') && url.includes(':append')) {
      return jsonResponse({})
    }
    if (url.includes('/values/') && init?.method === 'PUT') {
      return jsonResponse({})
    }
    if (url.includes('/values/')) {
      return jsonResponse({ values })
    }
    return jsonResponse({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls }
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  process.env.ADMIN_PASSWORD_HASH = ADMIN_PASSWORD_HASH
  process.env.GOOGLE_SA_EMAIL = 'sa@example.com'
  process.env.GOOGLE_SA_PRIVATE_KEY = FAKE_PRIVATE_KEY
})

// A real RSA keypair, generated once, so createSign(...).sign(privateKey)
// in the handler under test succeeds. Only the private key is used.
const { privateKey: FAKE_PRIVATE_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

describe('POST /api/verify', () => {
  it('rejects a wrong password with 401', async () => {
    const req = fakeRequest({ password: 'wrong', type: 'ipb', giveawayId: 'abc12' })
    const res = fakeResponse()
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })

  it('rejects non-POST requests with 405', async () => {
    const req = fakeRequest({}, 'GET')
    const res = fakeResponse()
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })

  it('updates the matching IPB row when found', async () => {
    const values = [
      ['ID', 'GAME', 'WINNER', 'COMPLETE PLAYING', 'EXTRA POINTS'],
      ['abc12', 'Some Game', 'winnerName', 'NO', ''],
    ]
    const { calls } = mockGoogleFlow('I play bro', values)
    const req = fakeRequest({ password: ADMIN_PASSWORD, type: 'ipb', giveawayId: 'abc12' })
    const res = fakeResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, action: 'updated' })

    const putCalls = calls.filter((c) => c.init?.method === 'PUT')
    expect(putCalls.length).toBe(2)
    expect(putCalls[0].url).toContain(encodeURIComponent("'I play bro'!D2"))
    expect(JSON.parse(putCalls[0].init!.body as string)).toMatchObject({ values: [['YES']] })
    expect(putCalls[1].url).toContain(encodeURIComponent("'I play bro'!E2"))
    expect(JSON.parse(putCalls[1].init!.body as string)).toMatchObject({ values: [['25']] })
  })

  it('appends a new row when the giveaway has no IPB sheet row yet', async () => {
    const values = [['ID', 'GAME', 'WINNER', 'COMPLETE PLAYING', 'EXTRA POINTS']]
    const { calls } = mockGoogleFlow('I play bro', values)
    const req = fakeRequest({ password: ADMIN_PASSWORD, type: 'ipb', giveawayId: 'abc12' })
    const res = fakeResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, action: 'appended' })

    const appendCall = calls.find((c) => c.url.includes(':append'))
    expect(appendCall).toBeTruthy()
    expect(JSON.parse(appendCall!.init!.body as string)).toMatchObject({
      values: [['abc12', 'Some Game', 'winnerName', 'YES', '25']],
    })
  })

  it('returns 404 for a play_required giveaway with no sheet row', async () => {
    const values = [['ID', 'GAME', 'WINNER', 'PLAY REQUIREMENTS MET']]
    mockGoogleFlow('Play Required', values)
    const req = fakeRequest({ password: ADMIN_PASSWORD, type: 'play_required', giveawayId: 'abc12' })
    const res = fakeResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(404)
  })

  it('adds a ✅ reaction to the thread on verify', async () => {
    const values = [
      ['ID', 'GAME', 'WINNER', 'COMPLETE PLAYING', 'EXTRA POINTS'],
      ['abc12', 'Some Game', 'winnerName', 'NO', ''],
    ]
    mockGoogleFlow('I play bro', values)

    const req = fakeRequest({
      password: ADMIN_PASSWORD,
      type: 'ipb',
      giveawayId: 'abc12',
      discordThreadId: 'thread1',
    })
    const res = fakeResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, discord: 'reacted' })
    expect(addReaction).toHaveBeenCalledWith('thread1', 'thread1', '✅')
    expect(removeReaction).not.toHaveBeenCalled()
  })

  it('does not fail the request when the Discord reaction fails', async () => {
    const values = [
      ['ID', 'GAME', 'WINNER', 'COMPLETE PLAYING', 'EXTRA POINTS'],
      ['abc12', 'Some Game', 'winnerName', 'NO', ''],
    ]
    mockGoogleFlow('I play bro', values)
    vi.mocked(addReaction).mockRejectedValueOnce(new Error('discord is down'))

    const req = fakeRequest({
      password: ADMIN_PASSWORD,
      type: 'ipb',
      giveawayId: 'abc12',
      discordThreadId: 'thread1',
    })
    const res = fakeResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, discord: 'failed' })
  })

  it('unverifies an IPB row: sets COMPLETE PLAYING to NO and clears EXTRA POINTS', async () => {
    const values = [
      ['ID', 'GAME', 'WINNER', 'COMPLETE PLAYING', 'EXTRA POINTS'],
      ['abc12', 'Some Game', 'winnerName', 'YES', '25'],
    ]
    const { calls } = mockGoogleFlow('I play bro', values)
    const req = fakeRequest({
      password: ADMIN_PASSWORD,
      type: 'ipb',
      action: 'unverify',
      giveawayId: 'abc12',
      discordThreadId: 'thread1',
    })
    const res = fakeResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, action: 'unverified', discord: 'unreacted' })

    const putCalls = calls.filter((c) => c.init?.method === 'PUT')
    expect(putCalls.length).toBe(2)
    expect(putCalls[0].url).toContain(encodeURIComponent("'I play bro'!D2"))
    expect(JSON.parse(putCalls[0].init!.body as string)).toMatchObject({ values: [['NO']] })
    expect(putCalls[1].url).toContain(encodeURIComponent("'I play bro'!E2"))
    expect(JSON.parse(putCalls[1].init!.body as string)).toMatchObject({ values: [['']] })

    expect(removeReaction).toHaveBeenCalledWith('thread1', 'thread1', '✅')
    expect(addReaction).not.toHaveBeenCalled()
  })

  it('returns 404 unverifying an IPB row that does not exist', async () => {
    const values = [['ID', 'GAME', 'WINNER', 'COMPLETE PLAYING', 'EXTRA POINTS']]
    mockGoogleFlow('I play bro', values)
    const req = fakeRequest({
      password: ADMIN_PASSWORD,
      type: 'ipb',
      action: 'unverify',
      giveawayId: 'abc12',
    })
    const res = fakeResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(404)
  })

  it('does not fail the unverify request when removing the Discord reaction fails', async () => {
    const values = [
      ['ID', 'GAME', 'WINNER', 'COMPLETE PLAYING', 'EXTRA POINTS'],
      ['abc12', 'Some Game', 'winnerName', 'YES', '25'],
    ]
    mockGoogleFlow('I play bro', values)
    vi.mocked(removeReaction).mockRejectedValueOnce(new Error('discord is down'))

    const req = fakeRequest({
      password: ADMIN_PASSWORD,
      type: 'ipb',
      action: 'unverify',
      giveawayId: 'abc12',
      discordThreadId: 'thread1',
    })
    const res = fakeResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, action: 'unverified', discord: 'failed' })
  })

  it('unverifies a play_required row: sets PLAY REQUIREMENTS MET to NO', async () => {
    const values = [
      ['ID', 'GAME', 'WINNER', 'PLAY REQUIREMENTS MET'],
      ['abc12', 'Some Game', 'winnerName', 'YES'],
    ]
    const { calls } = mockGoogleFlow('Play Required', values)
    const req = fakeRequest({
      password: ADMIN_PASSWORD,
      type: 'play_required',
      action: 'unverify',
      giveawayId: 'abc12',
    })
    const res = fakeResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, action: 'unverified', discord: 'skipped' })

    const putCalls = calls.filter((c) => c.init?.method === 'PUT')
    expect(putCalls.length).toBe(1)
    expect(putCalls[0].url).toContain(encodeURIComponent("'Play Required'!D2"))
    expect(JSON.parse(putCalls[0].init!.body as string)).toMatchObject({ values: [['NO']] })
  })

  it('appends a Play Required row with empty status/deadline/requirements cells when registering', async () => {
    const values = [
      [
        'ID',
        'GAME',
        'WINNER',
        'PLAY REQUIREMENTS MET',
        'DEADLINE (dd-mm-yyyy)',
        'DEADLINE (IN MONTHS)',
        'REQUIREMENTS',
        'NOTES',
      ],
    ]
    const { calls } = mockGoogleFlow('Play Required', values)
    const req = fakeRequest({
      password: ADMIN_PASSWORD,
      type: 'play_required',
      action: 'register',
      giveawayId: 'abc12',
    })
    const res = fakeResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, action: 'registered' })

    const appendCall = calls.find((c) => c.url.includes(':append'))
    expect(appendCall).toBeTruthy()
    expect(JSON.parse(appendCall!.init!.body as string)).toMatchObject({
      values: [
        [
          'abc12',
          'Some Game',
          'winnerName',
          '',
          '',
          '',
          '',
          'TODO: Add proper requirements or delete this note',
        ],
      ],
    })
  })

  it('reports already registered when a Play Required row already exists', async () => {
    const values = [
      ['ID', 'GAME', 'WINNER', 'PLAY REQUIREMENTS MET'],
      ['abc12', 'Some Game', 'winnerName', 'NO'],
    ]
    const { calls } = mockGoogleFlow('Play Required', values)
    const req = fakeRequest({
      password: ADMIN_PASSWORD,
      type: 'play_required',
      action: 'register',
      giveawayId: 'abc12',
    })
    const res = fakeResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, action: 'registered', already: true })
    expect(calls.some((c) => c.url.includes(':append'))).toBe(false)
  })

  it('rejects register for type ipb with 400', async () => {
    const req = fakeRequest({
      password: ADMIN_PASSWORD,
      type: 'ipb',
      action: 'register',
      giveawayId: 'abc12',
    })
    const res = fakeResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(400)
  })

  it('resolves the tab title by gid rather than assuming a fixed name', async () => {
    const values = [
      ['ID', 'GAME', 'WINNER', 'COMPLETE PLAYING', 'EXTRA POINTS'],
      ['abc12', 'Some Game', 'winnerName', 'NO', ''],
    ]
    const { calls } = mockGoogleFlow('Hoja 1 renamed by a mod', values)
    const req = fakeRequest({ password: ADMIN_PASSWORD, type: 'ipb', giveawayId: 'abc12' })
    const res = fakeResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    const valuesGetCall = calls.find(
      (c) => c.url.includes('/values/') && !c.url.includes(':append') && c.init?.method !== 'PUT',
    )
    expect(valuesGetCall?.url).toContain(encodeURIComponent("'Hoja 1 renamed by a mod'!A:Z"))
  })

  it('rejects a multi-winner giveaway verify with 400 when winnerSteamId is missing', async () => {
    const values = [['ID', 'GAME', 'WINNER', 'COMPLETE PLAYING', 'EXTRA POINTS']]
    mockGoogleFlow('I play bro', values)
    const req = fakeRequest({ password: ADMIN_PASSWORD, type: 'ipb', giveawayId: 'TF7Vk' })
    const res = fakeResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(400)
  })

  it('verifying a multi-winner giveaway with winnerSteamId picks the right winner', async () => {
    const values = [['ID', 'GAME', 'WINNER', 'COMPLETE PLAYING', 'EXTRA POINTS']]
    const { calls } = mockGoogleFlow('I play bro', values)
    const req = fakeRequest({
      password: ADMIN_PASSWORD,
      type: 'ipb',
      giveawayId: 'TF7Vk',
      winnerSteamId: 'steamSecond',
    })
    const res = fakeResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, action: 'appended' })

    const appendCall = calls.find((c) => c.url.includes(':append'))
    expect(appendCall).toBeTruthy()
    expect(JSON.parse(appendCall!.init!.body as string)).toMatchObject({
      values: [['TF7Vk', 'Gorogoa', 'lext', 'YES', '15']],
    })
  })

  it('skips a same-ID row belonging to a different winner and appends a second row', async () => {
    const values = [
      ['ID', 'GAME', 'WINNER', 'COMPLETE PLAYING', 'EXTRA POINTS'],
      ['TF7Vk', 'Gorogoa', 'dramainfouracts', 'YES', '15'],
    ]
    const { calls } = mockGoogleFlow('I play bro', values)
    const req = fakeRequest({
      password: ADMIN_PASSWORD,
      type: 'ipb',
      giveawayId: 'TF7Vk',
      winnerSteamId: 'steamSecond',
    })
    const res = fakeResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, action: 'appended' })

    const appendCall = calls.find((c) => c.url.includes(':append'))
    expect(appendCall).toBeTruthy()
    expect(JSON.parse(appendCall!.init!.body as string)).toMatchObject({
      values: [['TF7Vk', 'Gorogoa', 'lext', 'YES', '15']],
    })
    expect(calls.some((c) => c.init?.method === 'PUT')).toBe(false)
  })

  it('unverify matches the right winner among two rows sharing the same giveaway id', async () => {
    const values = [
      ['ID', 'GAME', 'WINNER', 'COMPLETE PLAYING', 'EXTRA POINTS'],
      ['TF7Vk', 'Gorogoa', 'dramainfouracts', 'YES', '15'],
      ['TF7Vk', 'Gorogoa', 'lext', 'YES', '15'],
    ]
    const { calls } = mockGoogleFlow('I play bro', values)
    const req = fakeRequest({
      password: ADMIN_PASSWORD,
      type: 'ipb',
      action: 'unverify',
      giveawayId: 'TF7Vk',
      winnerSteamId: 'steamSecond',
    })
    const res = fakeResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, action: 'unverified' })

    const putCalls = calls.filter((c) => c.init?.method === 'PUT')
    expect(putCalls.length).toBe(2)
    // Row 3 (lext) must be the one updated, not row 2 (dramainfouracts).
    expect(putCalls[0].url).toContain(encodeURIComponent("'I play bro'!D3"))
    expect(JSON.parse(putCalls[0].init!.body as string)).toMatchObject({ values: [['NO']] })
    expect(putCalls[1].url).toContain(encodeURIComponent("'I play bro'!E3"))
    expect(JSON.parse(putCalls[1].init!.body as string)).toMatchObject({ values: [['']] })
  })
})
