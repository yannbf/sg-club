// Steam only supports OpenID 2.0, not OAuth — this hand-rolls the whole
// protocol rather than pulling in a dependency built for Express. Login is a
// redirect with a fixed set of query params; verifying the callback is a
// second request back to Steam with openid.mode swapped to
// check_authentication, checking the response body for "is_valid:true".

const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login'
const CLAIMED_ID_PATTERN = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/

interface BuildLoginUrlOptions {
  returnTo: string
  realm: string
}

export function buildSteamLoginUrl(opts: BuildLoginUrlOptions): string {
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.return_to': opts.returnTo,
    'openid.realm': opts.realm,
  })
  return `${STEAM_OPENID_ENDPOINT}?${params.toString()}`
}

/**
 * Verifies a Steam OpenID callback and returns the authenticated steamId64,
 * or null if any check fails. Order matters: the cheap local checks
 * (mode, return_to prefix, claimed_id shape, identity match) run before the
 * network round-trip to Steam that confirms the assertion wasn't forged.
 */
export async function verifySteamCallback(
  query: URLSearchParams,
  expectedReturnToPrefix: string
): Promise<string | null> {
  if (query.get('openid.mode') !== 'id_res') return null

  const returnTo = query.get('openid.return_to')
  if (!returnTo || !returnTo.startsWith(expectedReturnToPrefix)) return null

  const claimedId = query.get('openid.claimed_id')
  const identity = query.get('openid.identity')
  if (!claimedId || !identity || claimedId !== identity) return null

  const match = CLAIMED_ID_PATTERN.exec(claimedId)
  if (!match) return null
  const steamId = match[1]

  const checkParams = new URLSearchParams(query)
  checkParams.set('openid.mode', 'check_authentication')

  const res = await fetch(STEAM_OPENID_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: checkParams.toString(),
  })
  if (!res.ok) return null
  const body = await res.text()
  if (!/(^|\n)is_valid:true(\r?\n|$)/.test(body)) return null

  return steamId
}
