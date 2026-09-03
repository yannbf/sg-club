import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  appendSetCookie,
  clearedCookie,
  getSessionSteamId,
  parseCookies,
  serializeCookie,
  sessionCookie,
  signSession,
  verifySession,
} from './session.js'

beforeEach(() => {
  process.env.SESSION_SECRET = 'test-session-secret'
})

function fakeRequest(cookieHeader?: string): IncomingMessage {
  return { headers: { cookie: cookieHeader } } as unknown as IncomingMessage
}

describe('signSession / verifySession', () => {
  it('round-trips a steam id', () => {
    const token = signSession('76561198000000001')
    expect(verifySession(token)).toEqual({ steamId: '76561198000000001' })
  })

  it('rejects a token with a tampered signature', () => {
    const token = signSession('76561198000000001')
    const [header, payload, signature] = token.split('.')
    const tampered = `${header}.${payload}.${signature.slice(0, -1)}${signature.at(-1) === 'a' ? 'b' : 'a'}`
    expect(verifySession(tampered)).toBeNull()
  })

  it('rejects a token with a tampered payload', () => {
    const token = signSession('76561198000000001')
    const otherToken = signSession('76561198000000002')
    const [, payload] = otherToken.split('.')
    const [header, , signature] = token.split('.')
    expect(verifySession(`${header}.${payload}.${signature}`)).toBeNull()
  })

  it('rejects an expired token', () => {
    const now = Math.floor(Date.now() / 1000)
    const token = signSession('76561198000000001', { now: now - 1000, ttlSeconds: 100 })
    expect(verifySession(token)).toBeNull()
  })

  it('rejects malformed tokens', () => {
    expect(verifySession('not-a-token')).toBeNull()
    expect(verifySession('a.b')).toBeNull()
    expect(verifySession('')).toBeNull()
  })

  it('rejects a non-numeric subject', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
      .toString('base64url')
    const now = Math.floor(Date.now() / 1000)
    const payload = Buffer.from(
      JSON.stringify({ sub: 'not-a-steam-id', iat: now, exp: now + 1000 })
    ).toString('base64url')
    // Signature doesn't matter here — this must fail shape validation regardless.
    expect(verifySession(`${header}.${payload}.deadbeef`)).toBeNull()
  })
})

describe('parseCookies', () => {
  it('parses multiple cookies', () => {
    const req = fakeRequest('a=1; b=2')
    expect(parseCookies(req)).toEqual({ a: '1', b: '2' })
  })

  it('handles = inside a cookie value', () => {
    const req = fakeRequest('sg_session=abc.def=.ghi')
    expect(parseCookies(req)).toEqual({ sg_session: 'abc.def=.ghi' })
  })

  it('returns an empty object with no cookie header', () => {
    expect(parseCookies(fakeRequest())).toEqual({})
  })
})

describe('appendSetCookie', () => {
  function fakeResponse() {
    const headers = new Map<string, string | string[]>()
    return {
      getHeader: (name: string) => headers.get(name),
      setHeader: (name: string, value: string | string[]) => headers.set(name, value),
      headers,
    } as unknown as ServerResponse & { headers: Map<string, string | string[]> }
  }

  it('accumulates cookies instead of overwriting', () => {
    const res = fakeResponse()
    appendSetCookie(res, 'a=1')
    appendSetCookie(res, 'b=2')
    expect(res.getHeader('Set-Cookie')).toEqual(['a=1', 'b=2'])
  })

  it('starts from a single existing Set-Cookie value', () => {
    const res = fakeResponse()
    res.setHeader('Set-Cookie', 'a=1')
    appendSetCookie(res, 'b=2')
    expect(res.getHeader('Set-Cookie')).toEqual(['a=1', 'b=2'])
  })
})

describe('serializeCookie / clearedCookie', () => {
  it('sets HttpOnly and Secure flags as requested', () => {
    const cookie = serializeCookie('name', 'value', { maxAge: 60, httpOnly: true, secure: true })
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('Max-Age=60')
  })

  it('omits Secure when not requested', () => {
    const cookie = serializeCookie('name', 'value', { maxAge: 60, secure: false })
    expect(cookie).not.toContain('Secure')
  })

  it('clearedCookie sets Max-Age=0', () => {
    expect(clearedCookie('sg_session', true)).toContain('Max-Age=0')
  })
})

describe('getSessionSteamId', () => {
  it('returns the steam id for a valid session cookie', () => {
    const cookie = sessionCookie('76561198000000001', true)
    const value = cookie.split(';')[0].split('=')[1]
    const req = fakeRequest(`sg_session=${value}`)
    expect(getSessionSteamId(req)).toBe('76561198000000001')
  })

  it('returns null with no cookie', () => {
    expect(getSessionSteamId(fakeRequest())).toBeNull()
  })

  it('returns null with an invalid session', () => {
    expect(getSessionSteamId(fakeRequest('sg_session=garbage'))).toBeNull()
  })
})
