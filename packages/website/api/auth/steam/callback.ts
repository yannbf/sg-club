// Vercel serverless function — plain /api directory support (see
// api/discord/interactions.ts for why). Completes the Steam OpenID flow
// started by login.ts: the nonce query param must match the nonce cookie
// (replay/CSRF protection — Steam OpenID has no state param of its own),
// then the openid.* assertion is verified against Steam directly. Any
// failure — mismatched nonce, a forged or expired assertion, an unexpected
// error — redirects to the login page's error state rather than surfacing a
// 500, since this endpoint is reached by the user's browser, not an API
// client.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import {
  appendSetCookie,
  clearedCookie,
  NONCE_COOKIE,
  parseCookies,
  sessionCookie,
} from '../../_lib/session.js'
import { getSiteOrigin, isSecureRequest } from '../../_lib/site-origin.js'
import { verifySteamCallback } from '../../_lib/steam-openid.js'
import { sanitizeNextPath } from '../../_lib/next-path.js'
import { resolveSteamUser } from '../../_lib/auth-user.js'
import { track } from '@vercel/analytics/server'

const ERROR_REDIRECT = '/login/?error=steam'

/**
 * Records a successful sign-in as a Vercel Analytics custom event (visible
 * on plans that include custom events) and as a structured function-log
 * line. Best effort: analytics must never break the login redirect.
 */
async function recordLogin(steamId: string, host: string | undefined): Promise<void> {
  let username: string | null = null
  try {
    username = (await resolveSteamUser(steamId, host)).username
  } catch (err) {
    console.error('auth/steam/callback: could not resolve username for login log', err)
  }
  console.log(`steam_login steamId=${steamId} username=${username ?? '-'}`)
  try {
    await track('steam_login', { steamId, username: username ?? 'unknown' })
  } catch (err) {
    console.error('auth/steam/callback: analytics track failed', err)
  }
}

function redirect(res: ServerResponse, location: string): void {
  res.statusCode = 302
  res.setHeader('Location', location)
  res.end()
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end('Method not allowed')
      return
    }

    const url = new URL(req.url ?? '/', 'http://placeholder')
    const nonceParam = url.searchParams.get('nonce')
    const cookies = parseCookies(req)
    const nonceCookie = cookies[NONCE_COOKIE]

    if (!nonceParam || !nonceCookie || !safeEqual(nonceParam, nonceCookie)) {
      redirect(res, ERROR_REDIRECT)
      return
    }

    const origin = getSiteOrigin(req)
    const secure = isSecureRequest(req)
    const steamId = await verifySteamCallback(
      url.searchParams,
      `${origin}/api/auth/steam/callback`
    )

    if (!steamId) {
      redirect(res, ERROR_REDIRECT)
      return
    }

    const next = sanitizeNextPath(url.searchParams.get('next'))
    await recordLogin(steamId, req.headers.host)

    appendSetCookie(res, sessionCookie(steamId, secure))
    appendSetCookie(res, clearedCookie(NONCE_COOKIE, secure))
    redirect(res, next)
  } catch (err) {
    console.error('auth/steam/callback: request failed', err)
    redirect(res, ERROR_REDIRECT)
  }
}
