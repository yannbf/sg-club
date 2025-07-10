// src/HltbFetcher.ts
interface HltbSearchOptions {
  searchType: string
  searchTerms: string[]
  searchPage: number
  size: number
  searchOptions: Record<string, any>
  useCache: boolean
}

interface HltbGameData {
  game_name: string
  comp_main: number // in seconds
  comp_main_count: number
}

interface HltbSearchResponse {
  count: number
  data: HltbGameData[]
}

export class HltbFetcher {
  private fetchUrl = 'https://umadb.ro/hltb/fetch.php'
  private hltbBaseUrl = 'https://howlongtobeat.com'

  private getUserAgent(): string {
    return (
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/120.0.0.0 Safari/537.36'
    )
  }

  private async getKeyPath(): Promise<string> {
    const res = await fetch(this.fetchUrl, {
      headers: {
        'User-Agent': this.getUserAgent(),
      },
    })
    if (!res.ok) {
      throw new Error(`Failed to fetch key path: ${res.status}`)
    }
    const key = await res.text()
    return this.hltbBaseUrl + key.trim()
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
    confidence: number | null
  }> {
    const terms = this.normalizeName(gameName)
    const url = await this.getKeyPath()

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
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': this.getUserAgent(),
        'Content-Type': 'application/json',
        origin: this.hltbBaseUrl,
        referer: this.hltbBaseUrl,
      },
      body: JSON.stringify(query),
    })

    if (!res.ok) {
      throw new Error(`HLTB request failed: ${res.status}`)
    }

    const data: HltbSearchResponse = (await res.json()) as HltbSearchResponse

    if (data.count === 0) {
      return { name: gameName, mainStoryHours: null, confidence: null }
    }

    let selected = data.data[0]
    for (const game of data.data) {
      if (game.game_name.toLowerCase() === gameName.toLowerCase()) {
        selected = game
        break
      }
    }

    console.log({ selected })
    const hours = selected.comp_main / 3600
    const rounded = Math.round(hours * 2) / 2

    return {
      name: selected.game_name,
      mainStoryHours: rounded || null,
      confidence: selected.comp_main_count || null,
    }
  }
}

export const hltb = new HltbFetcher()
