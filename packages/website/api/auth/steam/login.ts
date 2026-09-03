// Vercel serverless function — plain /api directory support (see
// api/discord/interactions.ts for why). Starts the Steam OpenID flow: sets a
// short-lived nonce cookie, then redirects to Steam with a return_to URL
// that carries the same nonce so the callback can confirm this round trip
// wasn't replayed from a stale or forged link.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { appendSetCookie, NONCE_COOKIE, serializeCookie } from '../../_lib/session.js'
import { getSiteOrigin, isSecureRequest } from '../../_lib/site-origin.js'
import { buildSteamLoginUrl } from '../../_lib/steam-openid.js'
import { sanitizeNextPath } from '../../_lib/next-path.js'

const NONCE_TTL_SECONDS = 600

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.end('Method not allowed')
    return
  }

  const url = new URL(req.url ?? '/', 'http://placeholder')
  const next = sanitizeNextPath(url.searchParams.get('next'))

  const nonce = randomBytes(16).toString('hex')
  const origin = getSiteOrigin(req)
  const secure = isSecureRequest(req)

  appendSetCookie(
    res,
    serializeCookie(NONCE_COOKIE, nonce, {
      maxAge: NONCE_TTL_SECONDS,
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      path: '/',
    })
  )

  const returnTo = `${origin}/api/auth/steam/callback?nonce=${encodeURIComponent(nonce)}&next=${encodeURIComponent(next)}`
  const loginUrl = buildSteamLoginUrl({ returnTo, realm: origin })

  res.statusCode = 302
  res.setHeader('Location', loginUrl)
  res.end()
}
