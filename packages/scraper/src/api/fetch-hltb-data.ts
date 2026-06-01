// HowLongToBeat fetcher.
//
// HLTB has no public API. Their site is a Next.js app whose search
// endpoint name, init-endpoint name, and even the auth header/payload
// field names change every couple of months when they ship a new
// build (we used to call `/api/find/init` → now 404). The only
// reliable approach is to discover everything dynamically each run,
// mirroring what howlongtobeatpy does:
//
//   1. GET https://howlongtobeat.com/  → parse HTML
//   2. Find the Next.js app bundle (`<script src="…/_app-XXXXX.js">`)
//   3. Regex out the POST endpoint path used by the client
//      (`fetch("/api/<something>", { method: "POST" … })`)
//   4. GET `<endpoint>/init?t=<ts>` → JSON `{ token, <keyField>, <valField> }`
//      where the key/val field names ALSO drift between deploys.
//   5. POST `<endpoint>` with `x-auth-token` + `x-hp-key` + `x-hp-val`
//      headers, and the same key/val pair injected into the JSON body.
//
// Discovery is done lazily, cached for the lifetime of the process, and
// re-attempted on 403 (auth expiry) or 404 (endpoint renamed mid-run).

interface HltbSearchOptions {
  searchType: string
  searchTerms: string[]
  searchPage: number
  size: number
  searchOptions: Record<string, unknown>
  useCache: boolean
  [key: string]: unknown
}

interface HltbGameData {
  game_name: string
  comp_main: number // seconds
}

interface HltbSearchResponse {
  count: number
  data: HltbGameData[]
}

interface HltbAuthData {
  /** Full URL to POST searches to, e.g. https://howlongtobeat.com/api/seek */
  searchUrl: string
  /** x-auth-token header value */
  token: string
  /** name of the dynamic "hp key" field (varies per HLTB deploy) */
  hpKeyName: string
  /** value of the dynamic "hp key" field */
  hpKeyValue: string
  /** name of the dynamic "hp val" field */
  hpValName: string
  /** value of the dynamic "hp val" field */
  hpValValue: string
}

const BASE_URL = 'https://howlongtobeat.com'

class HltbFetcher {
  private authData: HltbAuthData | null = null

  private getUserAgent(): string {
    return (
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/120.0.0.0 Safari/537.36'
    )
  }

  private baseHeaders(): Record<string, string> {
    return {
      'User-Agent': this.getUserAgent(),
      origin: BASE_URL,
      referer: `${BASE_URL}/`,
    }
  }

  /** Pull the homepage and return the URL of the first script that
   *  looks like the Next.js app bundle. */
  private async findAppBundleUrl(): Promise<string> {
    const res = await fetch(`${BASE_URL}/`, { headers: this.baseHeaders() })
    if (!res.ok) {
      throw new Error(`HLTB homepage fetch failed: ${res.status}`)
    }
    const html = await res.text()
    // Prefer the canonical `_app-XXXXX.js` bundle (most likely to
    // contain the POST endpoint); fall back to scanning every script.
    const scriptSrcs = Array.from(
      html.matchAll(/<script[^>]+src=["']([^"']+\.js)["']/g),
    ).map((m) => m[1])
    const preferred = scriptSrcs.find((s) => /_app-[^./]+\.js/.test(s))
    const ordered = preferred
      ? [preferred, ...scriptSrcs.filter((s) => s !== preferred)]
      : scriptSrcs
    if (ordered.length === 0) {
      throw new Error('HLTB homepage: no <script src=…> tags found')
    }
    // Return relative or absolute, resolved against BASE_URL.
    const first = ordered[0]
    return first.startsWith('http')
      ? first
      : `${BASE_URL}${first.startsWith('/') ? '' : '/'}${first}`
  }

  /** Walk the bundle list and regex out the POST endpoint path. */
  private async discoverSearchEndpoint(): Promise<string> {
    const res = await fetch(`${BASE_URL}/`, { headers: this.baseHeaders() })
    if (!res.ok) {
      throw new Error(`HLTB homepage fetch failed: ${res.status}`)
    }
    const html = await res.text()
    const scriptSrcs = Array.from(
      html.matchAll(/<script[^>]+src=["']([^"']+\.js)["']/g),
    ).map((m) => m[1])
    // Try the app bundle first, then any remaining script.
    const ordered = [
      ...scriptSrcs.filter((s) => /_app-[^./]+\.js/.test(s)),
      ...scriptSrcs.filter((s) => !/_app-[^./]+\.js/.test(s)),
    ]
    for (const src of ordered) {
      const url = src.startsWith('http')
        ? src
        : `${BASE_URL}${src.startsWith('/') ? '' : '/'}${src}`
      const scriptRes = await fetch(url, { headers: this.baseHeaders() })
      if (!scriptRes.ok) continue
      const js = await scriptRes.text()
      const endpoint = this.extractEndpointFromBundle(js)
      if (endpoint) return endpoint
    }
    throw new Error(
      'HLTB: could not discover POST search endpoint from any bundle',
    )
  }

  /** Look for `fetch("/api/<path>", { method: "POST" … })` and return
   *  `/api/<path>`. Falls back to `/api/search`. */
  private extractEndpointFromBundle(js: string): string | null {
    const re =
      /fetch\s*\(\s*["']\/api\/([a-zA-Z0-9_/-]+)["'][^)]*method\s*:\s*["']POST["']/g
    const match = re.exec(js)
    if (match) {
      // Strip any sub-path (`/init`, `/v2`) — we only want the base.
      const base = match[1].split('/')[0]
      return `/api/${base}`
    }
    return null
  }

  /** Hit the `/init` endpoint, return the raw JSON which contains the
   *  token plus a key/val pair whose field names drift. */
  private async fetchAuthBlob(
    endpointPath: string,
  ): Promise<Record<string, unknown>> {
    const url = `${BASE_URL}${endpointPath}/init?t=${Date.now()}`
    const res = await fetch(url, { headers: this.baseHeaders() })
    if (!res.ok) {
      throw new Error(`HLTB init (${url}) failed: ${res.status}`)
    }
    return (await res.json()) as Record<string, unknown>
  }

  /** From an init JSON like {token, "Kxxxx": "Vxxxx"} or {token, hpKey, hpVal},
   *  extract token + the dynamically-named key/val fields. */
  private parseAuthBlob(
    json: Record<string, unknown>,
  ): { token: string; keyName: string; keyValue: string; valName: string; valValue: string } {
    const token = typeof json.token === 'string' ? json.token : ''
    let keyName = ''
    let keyValue = ''
    let valName = ''
    let valValue = ''
    for (const [name, value] of Object.entries(json)) {
      if (name === 'token') continue
      if (typeof value !== 'string') continue
      const lower = name.toLowerCase()
      if (!keyName && lower.includes('key')) {
        keyName = name
        keyValue = value
      } else if (!valName && lower.includes('val')) {
        valName = name
        valValue = value
      }
    }
    if (!token) {
      throw new Error(`HLTB init JSON missing token: ${JSON.stringify(json)}`)
    }
    return { token, keyName, keyValue, valName, valValue }
  }

  private async initAuth(): Promise<HltbAuthData> {
    if (this.authData) return this.authData
    const endpoint = await this.discoverSearchEndpoint()
    const blob = await this.fetchAuthBlob(endpoint)
    const { token, keyName, keyValue, valName, valValue } =
      this.parseAuthBlob(blob)
    this.authData = {
      searchUrl: `${BASE_URL}${endpoint}`,
      token,
      hpKeyName: keyName,
      hpKeyValue: keyValue,
      hpValName: valName,
      hpValValue: valValue,
    }
    console.log(
      `🔑 HLTB endpoint discovered: ${endpoint} (key=${keyName || '∅'}, val=${valName || '∅'})`,
    )
    return this.authData
  }

  /** Clear cached auth+endpoint so the next request rediscovers. */
  public resetAuth(): void {
    this.authData = null
  }

  private normalizeName(name: string): string[] {
    // Replace punctuation with a SPACE, not an empty string — otherwise
    // "Spider-Man" collapses to "spiderman" which HLTB's index treats as
    // a single token that doesn't co-occur with adjacent words, killing
    // multi-token searches like "Spider-Man: Miles Morales".
    return name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w\s]/gi, ' ')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
  }

  private buildPayload(
    auth: HltbAuthData,
    terms: string[],
  ): HltbSearchOptions {
    const query: HltbSearchOptions = {
      searchType: 'games',
      searchTerms: terms,
      searchPage: 1,
      size: 20,
      searchOptions: {
        games: {
          userId: 0,
          platform: '',
          sortCategory: 'popular',
          rangeCategory: 'main',
          rangeTime: { min: 0, max: 0 },
          gameplay: {
            perspective: '',
            flow: '',
            genre: '',
            difficulty: '',
          },
          rangeYear: { min: '', max: '' },
          modifier: '',
        },
        users: { sortCategory: 'postcount' },
        lists: { sortCategory: 'follows' },
        filter: '',
        sort: 0,
        randomizer: 0,
      },
      useCache: true,
    }
    // HLTB expects the JSON body to contain a dynamic auth pair where
    // the FIELD NAME is the value of the init "key" field and the
    // FIELD VALUE is the value of the init "val" field. e.g. an init
    // response of `{token, hpKey: "ign_xxx", hpVal: "ba3c…"}` results
    // in `payload["ign_xxx"] = "ba3c…"`, not `payload["hpKey"] = "ign_xxx"`.
    if (auth.hpKeyValue && auth.hpValValue) {
      query[auth.hpKeyValue] = auth.hpValValue
    }
    return query
  }

  private buildHeaders(auth: HltbAuthData): Record<string, string> {
    const h: Record<string, string> = {
      'User-Agent': this.getUserAgent(),
      'Content-Type': 'application/json',
      origin: BASE_URL,
      referer: `${BASE_URL}/`,
      accept: '*/*',
      'x-auth-token': auth.token,
    }
    if (auth.hpKeyValue) h['x-hp-key'] = auth.hpKeyValue
    if (auth.hpValValue) h['x-hp-val'] = auth.hpValValue
    return h
  }

  public async getGameInfo(gameName: string): Promise<{
    name: string
    mainStoryHours: number | null
  }> {
    const terms = this.normalizeName(gameName)
    if (terms.length === 0) {
      return { name: gameName, mainStoryHours: null }
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const auth = await this.initAuth()
      const res = await fetch(auth.searchUrl, {
        method: 'POST',
        headers: this.buildHeaders(auth),
        body: JSON.stringify(this.buildPayload(auth, terms)),
      })

      if (res.ok) {
        const data = (await res.json()) as HltbSearchResponse
        return this.pickBestMatch(data, gameName)
      }

      // 403 = auth/token expired. 404 = endpoint renamed since we
      // cached it. Both: reset and retry exactly once.
      if ((res.status === 403 || res.status === 404) && attempt === 0) {
        this.resetAuth()
        continue
      }

      throw new Error(`HLTB request failed: ${res.status} ${res.statusText}`)
    }
    // Unreachable.
    return { name: gameName, mainStoryHours: null }
  }

  private pickBestMatch(
    data: HltbSearchResponse,
    gameName: string,
  ): { name: string; mainStoryHours: number | null } {
    if (!data || data.count === 0 || !Array.isArray(data.data)) {
      return { name: gameName, mainStoryHours: null }
    }

    let selected = data.data[0]
    for (const game of data.data) {
      if (game.game_name.toLowerCase() === gameName.toLowerCase()) {
        selected = game
        break
      }
    }

    const hours = (selected.comp_main || 0) / 3600
    const rounded = Math.round(hours * 2) / 2

    return {
      name: selected.game_name,
      mainStoryHours: rounded || null,
    }
  }
}

export const hltb = new HltbFetcher()
