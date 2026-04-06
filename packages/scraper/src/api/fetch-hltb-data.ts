// src/HltbFetcher.ts
interface HltbSearchOptions {
  searchType: string
  searchTerms: string[]
  searchPage: number
  size: number
  searchOptions: Record<string, any>
  useCache: boolean
  [key: string]: unknown
}

interface HltbGameData {
  game_name: string
  comp_main: number // in seconds
}

interface HltbSearchResponse {
  count: number
  data: HltbGameData[]
}

interface HltbAuthData {
  token: string
  hpKey: string
  hpVal: string
}

class HltbFetcher {
  private hltbBaseUrl = 'https://howlongtobeat.com'
  private authData: HltbAuthData | null = null

  private getUserAgent(): string {
    return (
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/120.0.0.0 Safari/537.36'
    )
  }

  private async initAuth(): Promise<HltbAuthData> {
    if (this.authData) return this.authData

    const res = await fetch(
      `${this.hltbBaseUrl}/api/find/init?t=${Date.now()}`,
      {
        headers: {
          'User-Agent': this.getUserAgent(),
          origin: this.hltbBaseUrl,
          referer: this.hltbBaseUrl,
        },
      },
    )
    if (!res.ok) {
      throw new Error(`Failed to init HLTB auth: ${res.status}`)
    }
    this.authData = (await res.json()) as HltbAuthData
    return this.authData
  }

  /** Clear cached auth so the next request fetches a fresh token */
  public resetAuth(): void {
    this.authData = null
  }

  private normalizeName(name: string): string[] {
    const normalized = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/gi, '')
      .toLowerCase()
      .split(/\s+/)

    return normalized
  }

  public async getGameInfo(gameName: string): Promise<{
    name: string
    mainStoryHours: number | null
  }> {
    const terms = this.normalizeName(gameName)
    const auth = await this.initAuth()

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
          rangeTime: { min: null, max: null },
          gameplay: { perspective: '', flow: '', genre: '', difficulty: '' },
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
      [auth.hpKey]: auth.hpVal,
    }

    const res = await fetch(`${this.hltbBaseUrl}/api/find`, {
      method: 'POST',
      headers: {
        'User-Agent': this.getUserAgent(),
        'Content-Type': 'application/json',
        origin: this.hltbBaseUrl,
        referer: this.hltbBaseUrl,
        'x-auth-token': auth.token,
        'x-hp-key': auth.hpKey,
        'x-hp-val': auth.hpVal,
      },
      body: JSON.stringify(query),
    })

    if (res.status === 403) {
      // Token expired — refresh and retry once
      this.resetAuth()
      const freshAuth = await this.initAuth()
      query[freshAuth.hpKey] = freshAuth.hpVal

      const retryRes = await fetch(`${this.hltbBaseUrl}/api/find`, {
        method: 'POST',
        headers: {
          'User-Agent': this.getUserAgent(),
          'Content-Type': 'application/json',
          origin: this.hltbBaseUrl,
          referer: this.hltbBaseUrl,
          'x-auth-token': freshAuth.token,
          'x-hp-key': freshAuth.hpKey,
          'x-hp-val': freshAuth.hpVal,
        },
        body: JSON.stringify(query),
      })

      if (!retryRes.ok) {
        throw new Error(`HLTB request failed after token refresh: ${retryRes.status}`)
      }

      const data: HltbSearchResponse = (await retryRes.json()) as HltbSearchResponse
      return this.pickBestMatch(data, gameName)
    }

    if (!res.ok) {
      throw new Error(`HLTB request failed: ${res.status}`)
    }

    const data: HltbSearchResponse = (await res.json()) as HltbSearchResponse
    return this.pickBestMatch(data, gameName)
  }

  private pickBestMatch(
    data: HltbSearchResponse,
    gameName: string,
  ): { name: string; mainStoryHours: number | null } {
    if (data.count === 0) {
      return { name: gameName, mainStoryHours: null }
    }

    let selected = data.data[0]
    for (const game of data.data) {
      if (game.game_name.toLowerCase() === gameName.toLowerCase()) {
        selected = game
        break
      }
    }

    const hours = selected.comp_main / 3600
    const rounded = Math.round(hours * 2) / 2

    return {
      name: selected.game_name,
      mainStoryHours: rounded || null,
    }
  }
}

export const hltb = new HltbFetcher()
