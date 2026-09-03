import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSteamLoginUrl, verifySteamCallback } from './steam-openid.js'

const RETURN_TO = 'https://sg-club.vercel.app/api/auth/steam/callback?nonce=abc&next=%2Fme%2F'
const REALM = 'https://sg-club.vercel.app'
const STEAM_ID = '76561198000000001'
const CLAIMED_ID = `https://steamcommunity.com/openid/id/${STEAM_ID}`

function validQuery(overrides: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': CLAIMED_ID,
    'openid.identity': CLAIMED_ID,
    'openid.return_to': RETURN_TO,
    'openid.response_nonce': '2024-01-01T00:00:00Zabc',
    'openid.assoc_handle': 'handle',
    'openid.signed': 'signed,op_endpoint',
    'openid.sig': 'sig',
    ...overrides,
  })
}

function jsonOkText(body: string): Response {
  return { ok: true, status: 200, text: async () => body } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildSteamLoginUrl', () => {
  it('builds the expected query params', () => {
    const url = new URL(buildSteamLoginUrl({ returnTo: RETURN_TO, realm: REALM }))
    expect(url.origin + url.pathname).toBe('https://steamcommunity.com/openid/login')
    expect(url.searchParams.get('openid.ns')).toBe('http://specs.openid.net/auth/2.0')
    expect(url.searchParams.get('openid.mode')).toBe('checkid_setup')
    expect(url.searchParams.get('openid.identity')).toBe(
      'http://specs.openid.net/auth/2.0/identifier_select'
    )
    expect(url.searchParams.get('openid.claimed_id')).toBe(
      'http://specs.openid.net/auth/2.0/identifier_select'
    )
    expect(url.searchParams.get('openid.return_to')).toBe(RETURN_TO)
    expect(url.searchParams.get('openid.realm')).toBe(REALM)
  })
})

describe('verifySteamCallback', () => {
  it('returns the steam id for a valid callback', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        jsonOkText('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n')
    )
    vi.stubGlobal('fetch', fetchMock)

    const steamId = await verifySteamCallback(
      validQuery(),
      'https://sg-club.vercel.app/api/auth/steam/callback'
    )
    expect(steamId).toBe(STEAM_ID)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://steamcommunity.com/openid/login')
    expect(init?.method).toBe('POST')
    const body = new URLSearchParams(init?.body as string)
    expect(body.get('openid.mode')).toBe('check_authentication')
  })

  it('returns null when steam reports is_valid:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonOkText('is_valid:false\n')))
    const steamId = await verifySteamCallback(
      validQuery(),
      'https://sg-club.vercel.app/api/auth/steam/callback'
    )
    expect(steamId).toBeNull()
  })

  it('rejects a claimed_id on the wrong host', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonOkText('is_valid:true\n')))
    const badClaimedId = `https://evil.com/openid/id/${STEAM_ID}`
    const steamId = await verifySteamCallback(
      validQuery({ 'openid.claimed_id': badClaimedId, 'openid.identity': badClaimedId }),
      'https://sg-club.vercel.app/api/auth/steam/callback'
    )
    expect(steamId).toBeNull()
  })

  it('rejects when identity does not match claimed_id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonOkText('is_valid:true\n')))
    const steamId = await verifySteamCallback(
      validQuery({ 'openid.identity': `https://steamcommunity.com/openid/id/76561198099999999` }),
      'https://sg-club.vercel.app/api/auth/steam/callback'
    )
    expect(steamId).toBeNull()
  })

  it('rejects when return_to does not start with the expected prefix', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonOkText('is_valid:true\n')))
    const steamId = await verifySteamCallback(
      validQuery({ 'openid.return_to': 'https://evil.com/callback' }),
      'https://sg-club.vercel.app/api/auth/steam/callback'
    )
    expect(steamId).toBeNull()
  })

  it('rejects when mode is not id_res', async () => {
    const fetchMock = vi.fn(async () => jsonOkText('is_valid:true\n'))
    vi.stubGlobal('fetch', fetchMock)
    const steamId = await verifySteamCallback(
      validQuery({ 'openid.mode': 'cancel' }),
      'https://sg-club.vercel.app/api/auth/steam/callback'
    )
    expect(steamId).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
