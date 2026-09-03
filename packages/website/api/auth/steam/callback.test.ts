import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler from './callback.js'
import { verifySession } from '../../_lib/session.js'

const STEAM_ID = '76561198000000001'
const CLAIMED_ID = `https://steamcommunity.com/openid/id/${STEAM_ID}`
const NONCE = 'test-nonce'

vi.mock('../../_lib/auth-user.js', () => ({
  resolveSteamUser: vi.fn(async (steamId: string) => ({
    steamId,
    username: 'tester',
    avatarUrl: null,
    isMember: true,
    isExMember: false,
    isAdmin: false,
  })),
}))
vi.mock('@vercel/analytics/server', () => ({ track: vi.fn(async () => undefined) }))
vi.mock('../../_lib/steam-openid.js', () => ({
  verifySteamCallback: vi.fn(),
}))

import { verifySteamCallback } from '../../_lib/steam-openid.js'

function fakeRequest(url: string, cookieHeader?: string): IncomingMessage {
  return {
    method: 'GET',
    url,
    headers: { host: 'sg-club.vercel.app', cookie: cookieHeader },
  } as unknown as IncomingMessage
}

function fakeResponse(): ServerResponse & { statusCode: number; headers: Record<string, string | string[]> } {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string | string[]>,
    getHeader(name: string) {
      return this.headers[name]
    },
    setHeader(name: string, value: string | string[]) {
      this.headers[name] = value
    },
    end() {},
  }
  return res as unknown as ServerResponse & { statusCode: number; headers: Record<string, string | string[]> }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SESSION_SECRET = 'test-session-secret'
})

describe('GET /api/auth/steam/callback', () => {
  it('redirects to the error page on nonce mismatch', async () => {
    const req = fakeRequest(
      `/api/auth/steam/callback?nonce=${NONCE}&next=%2Fme%2F`,
      'sg_oid_nonce=different-nonce'
    )
    const res = fakeResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(302)
    expect(res.headers.Location).toBe('/login/?error=steam')
    expect(verifySteamCallback).not.toHaveBeenCalled()
  })

  it('redirects to the error page with no nonce cookie', async () => {
    const req = fakeRequest(`/api/auth/steam/callback?nonce=${NONCE}&next=%2Fme%2F`)
    const res = fakeResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(302)
    expect(res.headers.Location).toBe('/login/?error=steam')
  })

  it('redirects to the error page when Steam rejects the assertion', async () => {
    vi.mocked(verifySteamCallback).mockResolvedValueOnce(null)
    const req = fakeRequest(
      `/api/auth/steam/callback?nonce=${NONCE}&next=%2Fme%2F&openid.claimed_id=${encodeURIComponent(CLAIMED_ID)}`,
      `sg_oid_nonce=${NONCE}`
    )
    const res = fakeResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(302)
    expect(res.headers.Location).toBe('/login/?error=steam')
  })

  it('on success sets the session cookie, clears the nonce cookie, and redirects to next', async () => {
    vi.mocked(verifySteamCallback).mockResolvedValueOnce(STEAM_ID)
    const req = fakeRequest(
      `/api/auth/steam/callback?nonce=${NONCE}&next=%2Fusers%2Ffoo%2F`,
      `sg_oid_nonce=${NONCE}`
    )
    const res = fakeResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(302)
    expect(res.headers.Location).toBe('/users/foo/')

    const setCookies = res.headers['Set-Cookie'] as string[]
    const sessionCookie = setCookies.find((c) => c.startsWith('sg_session='))
    expect(sessionCookie).toBeDefined()
    const token = sessionCookie!.split(';')[0].split('=')[1]
    expect(verifySession(decodeURIComponent(token))).toEqual({ steamId: STEAM_ID })

    const nonceCookie = setCookies.find((c) => c.startsWith('sg_oid_nonce='))
    expect(nonceCookie).toContain('Max-Age=0')
  })

  it('falls back to /me/ when next is protocol-relative', async () => {
    vi.mocked(verifySteamCallback).mockResolvedValueOnce(STEAM_ID)
    const req = fakeRequest(
      `/api/auth/steam/callback?nonce=${NONCE}&next=${encodeURIComponent('//evil.com')}`,
      `sg_oid_nonce=${NONCE}`
    )
    const res = fakeResponse()
    await handler(req, res)

    expect(res.headers.Location).toBe('/me/')
  })
})
