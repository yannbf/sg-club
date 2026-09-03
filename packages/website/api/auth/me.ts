// Vercel serverless function — plain /api directory support (see
// api/discord/interactions.ts for why). The client learns who's signed in
// through this endpoint, since the session cookie is HttpOnly and can't be
// read from the page itself.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { getSessionSteamId } from '../_lib/session.js'
import { resolveSteamUser } from '../_lib/auth-user.js'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json')

  const steamId = getSessionSteamId(req)
  if (!steamId) {
    res.statusCode = 200
    res.end(JSON.stringify({ user: null }))
    return
  }

  const user = await resolveSteamUser(steamId, req.headers.host)
  res.statusCode = 200
  res.end(JSON.stringify({ user }))
}
