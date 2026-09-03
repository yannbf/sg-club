// HS256-signed session cookie for Steam login. The payload is a plain
// { sub: steamId, iat, exp } object, base64url-encoded and HMAC-signed with
// SESSION_SECRET — no external JWT library, same "hand-roll the small
// primitive" style as verify.ts's Google service-account JWT.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getSessionSecret } from './constants.js'

export const SESSION_COOKIE = 'sg_session'
export const NONCE_COOKIE = 'sg_oid_nonce'

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days

interface SessionPayload {
  sub: string
  iat: number
  exp: number
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function base64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(padded, 'base64')
}

function sign(unsigned: string): string {
  return base64url(createHmac('sha256', getSessionSecret()).update(unsigned).digest())
}

export function signSession(
  steamId: string,
  opts: { now?: number; ttlSeconds?: number } = {}
): string {
  const now = opts.now ?? Math.floor(Date.now() / 1000)
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload: SessionPayload = { sub: steamId, iat: now, exp: now + ttl }
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  return `${unsigned}.${sign(unsigned)}`
}

/** Verifies signature and expiry; returns null on any malformed/tampered/expired token. */
export function verifySession(token: string): { steamId: string } | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerPart, payloadPart, signaturePart] = parts

  const expectedSignature = sign(`${headerPart}.${payloadPart}`)
  const expected = base64urlDecode(expectedSignature)
  const actual = base64urlDecode(signaturePart)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null
  }

  let payload: SessionPayload
  try {
    payload = JSON.parse(base64urlDecode(payloadPart).toString('utf-8')) as SessionPayload
  } catch {
    return null
  }

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null
  if (!/^\d+$/.test(payload.sub)) return null
  if (typeof payload.exp !== 'number' || Number.isNaN(payload.exp)) return null
  if (payload.exp < Math.floor(Date.now() / 1000)) return null

  return { steamId: payload.sub }
}

/** Splits a `Cookie` request header into a name -> value map, tolerating `=` inside values. */
export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie
  if (!header) return {}
  const cookies: Record<string, string> = {}
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const name = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    cookies[name] = decodeURIComponent(value)
  }
  return cookies
}

interface SerializeCookieOptions {
  maxAge: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
  path?: string
}

export function serializeCookie(
  name: string,
  value: string,
  opts: SerializeCookieOptions
): string {
  const segments = [`${name}=${encodeURIComponent(value)}`]
  segments.push(`Max-Age=${opts.maxAge}`)
  segments.push(`Path=${opts.path ?? '/'}`)
  segments.push(`SameSite=${opts.sameSite ?? 'Lax'}`)
  if (opts.httpOnly ?? true) segments.push('HttpOnly')
  if (opts.secure) segments.push('Secure')
  return segments.join('; ')
}

/** Appends to an existing `Set-Cookie` header rather than overwriting it — a response may set more than one cookie. */
export function appendSetCookie(res: ServerResponse, cookie: string): void {
  const existing = res.getHeader('Set-Cookie')
  if (existing === undefined) {
    res.setHeader('Set-Cookie', cookie)
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookie])
  } else {
    res.setHeader('Set-Cookie', [String(existing), cookie])
  }
}

export function getSessionSteamId(req: IncomingMessage): string | null {
  const cookies = parseCookies(req)
  const token = cookies[SESSION_COOKIE]
  if (!token) return null
  const session = verifySession(token)
  return session ? session.steamId : null
}

export function sessionCookie(steamId: string, isSecure: boolean): string {
  return serializeCookie(SESSION_COOKIE, signSession(steamId), {
    maxAge: DEFAULT_TTL_SECONDS,
    httpOnly: true,
    secure: isSecure,
    sameSite: 'Lax',
    path: '/',
  })
}

export function clearedCookie(name: string, isSecure: boolean): string {
  return serializeCookie(name, '', {
    maxAge: 0,
    httpOnly: true,
    secure: isSecure,
    sameSite: 'Lax',
    path: '/',
  })
}

export function clearedSessionCookie(isSecure: boolean): string {
  return clearedCookie(SESSION_COOKIE, isSecure)
}
