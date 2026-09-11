import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler from './me.js'
import { encodeUiHint, signSession, UI_HINT_COOKIE } from '../_lib/session.js'

const ADMIN_STEAM_ID = '76561198000000001'
const MEMBER_STEAM_ID = '76561198000000002'
const EX_MEMBER_STEAM_ID = '76561198000000003'
const UNKNOWN_STEAM_ID = '76561198000000099'

const STEAM_ID_MAP = {
  [MEMBER_STEAM_ID]: { current: 'MemberName', previous: [] },
}

const GROUP_USERS = {
  lastUpdated: 0,
  users: {
    [ADMIN_STEAM_ID]: {
      username: 'AdminName',
      avatar_url: 'https://example.com/admin.jpg',
      steam_id: ADMIN_STEAM_ID,
    },
    [MEMBER_STEAM_ID]: {
      username: 'MemberNameStale',
      avatar_url: 'https://example.com/member.jpg',
      steam_id: MEMBER_STEAM_ID,
    },
  },
}

const EX_MEMBERS = {
  lastUpdated: 0,
  users: {
    [EX_MEMBER_STEAM_ID]: {
      username: 'ExMemberName',
      avatar_url: 'https://example.com/ex.jpg',
      steam_id: EX_MEMBER_STEAM_ID,
    },
  },
}

vi.mock('../_lib/data.js', () => ({
  loadDataFile: vi.fn(async (name: string) => {
    if (name === 'steam_id_map.json') return STEAM_ID_MAP
    if (name === 'group_users.json') return GROUP_USERS
    if (name === 'ex_members.json') return EX_MEMBERS
    throw new Error(`unexpected data file ${name}`)
  }),
}))

function fakeRequest(cookieHeader?: string): IncomingMessage {
  return { headers: { host: 'sg-club.vercel.app', cookie: cookieHeader } } as unknown as IncomingMessage
}

function fakeResponse(): ServerResponse & {
  statusCode: number
  body: unknown
  headers: Record<string, string | string[]>
} {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string | string[]>,
    setHeader(name: string, value: string | string[]) {
      this.headers[name] = value
    },
    getHeader(name: string) {
      return this.headers[name]
    },
    end(chunk?: string) {
      if (chunk) this.body = JSON.parse(chunk)
    },
  }
  return res as unknown as ServerResponse & {
    statusCode: number
    body: unknown
    headers: Record<string, string | string[]>
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SESSION_SECRET = 'test-session-secret'
  process.env.ADMIN_STEAM_IDS = ADMIN_STEAM_ID
})

describe('GET /api/auth/me', () => {
  it('returns user: null with no session', async () => {
    const req = fakeRequest()
    const res = fakeResponse()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ user: null })
    expect(res.headers['Cache-Control']).toBe('no-store')
  })

  it('returns user: null with an invalid session', async () => {
    const req = fakeRequest('sg_session=garbage')
    const res = fakeResponse()
    await handler(req, res)
    expect(res.body).toEqual({ user: null })
  })

  it('returns the full profile for a signed-in admin member', async () => {
    const req = fakeRequest(`sg_session=${signSession(ADMIN_STEAM_ID)}`)
    const res = fakeResponse()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      user: {
        steamId: ADMIN_STEAM_ID,
        username: 'AdminName',
        avatarUrl: 'https://example.com/admin.jpg',
        isMember: true,
        isExMember: false,
        isAdmin: true,
      },
    })
  })

  it('prefers steam_id_map.json current username over the group roster username', async () => {
    const req = fakeRequest(`sg_session=${signSession(MEMBER_STEAM_ID)}`)
    const res = fakeResponse()
    await handler(req, res)
    expect(res.body).toMatchObject({ user: { username: 'MemberName', isMember: true, isAdmin: false } })
  })

  it('resolves an ex-member', async () => {
    const req = fakeRequest(`sg_session=${signSession(EX_MEMBER_STEAM_ID)}`)
    const res = fakeResponse()
    await handler(req, res)
    expect(res.body).toMatchObject({
      user: { username: 'ExMemberName', isMember: false, isExMember: true },
    })
  })

  it('resolves an unknown steam id to a member with null username/avatar', async () => {
    const req = fakeRequest(`sg_session=${signSession(UNKNOWN_STEAM_ID)}`)
    const res = fakeResponse()
    await handler(req, res)
    expect(res.body).toEqual({
      user: {
        steamId: UNKNOWN_STEAM_ID,
        username: null,
        avatarUrl: null,
        isMember: false,
        isExMember: false,
        isAdmin: false,
      },
    })
  })
})

function setCookieHeaders(res: { headers: Record<string, string | string[]> }): string[] {
  const value = res.headers['Set-Cookie']
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

describe('GET /api/auth/me — sg_ui hint cookie', () => {
  it('signed-in with no hint cookie gets a Set-Cookie for sg_ui', async () => {
    const req = fakeRequest(`sg_session=${signSession(MEMBER_STEAM_ID)}`)
    const res = fakeResponse()
    await handler(req, res)
    const cookies = setCookieHeaders(res)
    expect(cookies.some((c) => c.startsWith(`${UI_HINT_COOKIE}=`))).toBe(true)
  })

  it('signed-in with a stale/wrong hint cookie gets it rewritten', async () => {
    const req = fakeRequest(
      `sg_session=${signSession(MEMBER_STEAM_ID)}; ${UI_HINT_COOKIE}=00000000000000000`
    )
    const res = fakeResponse()
    await handler(req, res)
    const cookies = setCookieHeaders(res)
    expect(cookies.some((c) => c.startsWith(`${UI_HINT_COOKIE}=`))).toBe(true)
  })

  it('signed-in with the correct hint cookie gets no sg_ui Set-Cookie', async () => {
    const hint = encodeUiHint(MEMBER_STEAM_ID, false)
    const req = fakeRequest(`sg_session=${signSession(MEMBER_STEAM_ID)}; ${UI_HINT_COOKIE}=${hint}`)
    const res = fakeResponse()
    await handler(req, res)
    const cookies = setCookieHeaders(res)
    expect(cookies.some((c) => c.startsWith(`${UI_HINT_COOKIE}=`))).toBe(false)
  })

  it('signed-out with an sg_ui cookie gets it cleared', async () => {
    const req = fakeRequest(`${UI_HINT_COOKIE}=deadbeefdeadbeef1`)
    const res = fakeResponse()
    await handler(req, res)
    const cookies = setCookieHeaders(res)
    const uiCookie = cookies.find((c) => c.startsWith(`${UI_HINT_COOKIE}=`))
    expect(uiCookie).toBeDefined()
    expect(uiCookie).toContain('Max-Age=0')
  })

  it('signed-out with no sg_ui cookie gets no Set-Cookie', async () => {
    const req = fakeRequest()
    const res = fakeResponse()
    await handler(req, res)
    expect(setCookieHeaders(res)).toEqual([])
  })
})
