// Vercel serverless function — plain /api directory support (see
// api/discord/interactions.ts for why). The client learns who's signed in
// through this endpoint, since the session cookie is HttpOnly and can't be
// read from the page itself.

import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  appendSetCookie,
  clearedUiHintCookie,
  encodeUiHint,
  getSessionSteamId,
  parseCookies,
  uiHintCookie,
  UI_HINT_COOKIE,
} from '../_lib/session.js'
import { isSecureRequest } from '../_lib/site-origin.js'
import { resolveSteamUser } from '../_lib/auth-user.js'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json')

  const steamId = getSessionSteamId(req)
  const cookies = parseCookies(req)

  if (!steamId) {
    if (cookies[UI_HINT_COOKIE] !== undefined) {
      appendSetCookie(res, clearedUiHintCookie(isSecureRequest(req)))
    }
    res.statusCode = 200
    res.end(JSON.stringify({ user: null }))
    return
  }

  const user = await resolveSteamUser(steamId, req.headers.host)
  const expectedHint = encodeUiHint(steamId, user.isAdmin)
  if (cookies[UI_HINT_COOKIE] !== expectedHint) {
    appendSetCookie(res, uiHintCookie(steamId, user.isAdmin, isSecureRequest(req)))
  }
  res.statusCode = 200
  res.end(JSON.stringify({ user }))
}
