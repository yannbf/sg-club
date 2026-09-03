// Vercel serverless function — plain /api directory support (see
// api/discord/interactions.ts for why). Clears the session cookie.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { appendSetCookie, clearedSessionCookie } from '../_lib/session.js'
import { isSecureRequest } from '../_lib/site-origin.js'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end('Method not allowed')
    return
  }

  appendSetCookie(res, clearedSessionCookie(isSecureRequest(req)))
  res.statusCode = 204
  res.end()
}
