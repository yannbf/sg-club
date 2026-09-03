// Resolves the site's own origin from a request, for building Steam OpenID
// return_to/realm URLs and deciding whether cookies can carry the Secure
// flag. Vercel sets x-forwarded-proto/host correctly on every deployment;
// SITE_ORIGIN exists only to override this for local `vercel dev`, where the
// request arrives over plain http.

import type { IncomingMessage } from 'node:http'

export function getSiteOrigin(req: IncomingMessage): string {
  const override = process.env.SITE_ORIGIN
  if (override) return override.replace(/\/$/, '')

  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'https'
  const host = req.headers.host
  return `${proto}://${host}`
}

export function isSecureRequest(req: IncomingMessage): boolean {
  if (process.env.SITE_ORIGIN) {
    return process.env.SITE_ORIGIN.startsWith('https://')
  }
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'https'
  return proto === 'https'
}
