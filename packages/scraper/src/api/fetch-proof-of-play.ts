import Papa from 'papaparse'

// ─── Interfaces ───────────────────────────────────────────────────────

interface GiveawayRow {
  ID: string
  GAME: string
  WINNER: string
  'COMPLETE PLAYING': string
  'EXTRA POINTS': string
}

interface PlayRequirementRow {
  ID: string
  GAME: string
  WINNER: string
  'PLAY REQUIREMENTS MET': string
  DEADLINE: string
  'DEADLINE (IN MONTHS)': string
  'ADDITIONAL NOTES': string
}

interface PlayRequirementData {
  id: string
  game: string
  winner: string
  playRequirementsMet: boolean
  deadline: string
  deadlineInMonths: number
  additionalNotes: string
}

interface GiveawayData {
  id: string
  game: string
  winner: string
  completePlaying: boolean
  extraPoints: number
  playRequirements?: PlayRequirementData
}

// ─── Class ────────────────────────────────────────────────────────────

export class GiveawayPointsManager {
  private static instance: GiveawayPointsManager
  private readonly SHEET_ID = '1h20q3RPeYTDwL_hl3uWEq6SSRbSlsHJW3VhN538oP3A'

  private readonly GID = {
    GIVEAWAYS: '0', // proof of play tab
    PLAY_REQUIRED: '2065024481', // play required tab
  }

  private readonly CACHE_DURATION = 25 * 60 * 1000 // 25 min

  private giveawayCache: GiveawayData[] | null = null
  private giveawayLastFetch = 0
  private giveawayFetchPromise: Promise<GiveawayData[]> | null = null

  private playReqCache: PlayRequirementData[] | null = null
  private playReqLastFetch = 0
  private playReqFetchPromise: Promise<PlayRequirementData[]> | null = null

  private constructor() {}

  public static getInstance(): GiveawayPointsManager {
    if (!GiveawayPointsManager.instance) {
      GiveawayPointsManager.instance = new GiveawayPointsManager()
    }
    return GiveawayPointsManager.instance
  }

  // ─── Shared CSV Fetcher ─────────────────────────────────────────────

  private async fetchCsvData<T>(gid: string): Promise<T[]> {
    const csvUrl = `https://docs.google.com/spreadsheets/d/${this.SHEET_ID}/export?format=csv&gid=${gid}`

    try {
      const response = await fetch(csvUrl)

      if (!response.ok) {
        throw new Error(`Failed to fetch sheet: ${response.statusText}`)
      }

      const csvText = await response.text()
      const parsed = Papa.parse<T>(csvText, {
        header: true,
        skipEmptyLines: true,
      })

      if (parsed.errors.length > 0) {
        console.warn('⚠️ Parse warnings:', parsed.errors)
      }

      return parsed.data
    } catch (err) {
      console.error(
        '❌ CSV Fetch error:',
        err instanceof Error ? err.message : err
      )
      throw err
    }
  }

  // ─── Giveaway Logic ─────────────────────────────────────────────────

  private parseGiveawayRow(row: GiveawayRow): GiveawayData {
    return {
      id: row.ID,
      game: row.GAME,
      winner: row.WINNER,
      completePlaying: row['COMPLETE PLAYING'].toUpperCase() === 'YES',
      extraPoints: parseInt(row['EXTRA POINTS'], 10) || 0,
    }
  }

  private async fetchGiveaways(): Promise<GiveawayData[]> {
    if (this.giveawayFetchPromise) return this.giveawayFetchPromise

    const now = Date.now()
    if (
      this.giveawayCache &&
      now - this.giveawayLastFetch < this.CACHE_DURATION
    ) {
      return this.giveawayCache
    }

    this.giveawayFetchPromise = Promise.all([
      this.fetchCsvData<GiveawayRow>(this.GID.GIVEAWAYS),
      this.fetchPlayRequirements(),
    ])
      .then(([giveawayRows, playReqs]) => {
        const playReqMap = new Map<string, PlayRequirementData>()
        for (const pr of playReqs) {
          playReqMap.set(pr.id, pr)
        }

        const giveaways = giveawayRows
          .filter((row) => row.ID && row.GAME)
          .map((row) => {
            const base = this.parseGiveawayRow(row)
            const playRequirements = playReqMap.get(base.id)
            return { ...base, playRequirements }
          })

        this.giveawayCache = giveaways
        this.giveawayLastFetch = Date.now()
        return giveaways
      })
      .finally(() => {
        this.giveawayFetchPromise = null
      })

    return this.giveawayFetchPromise
  }

  public async getAllGiveaways(): Promise<GiveawayData[]> {
    return this.fetchGiveaways()
  }

  public async getGiveawayById(id: string): Promise<GiveawayData | null> {
    const giveaways = await this.fetchGiveaways()
    return giveaways.find((g) => g.id === id) || null
  }

  // ─── Play Requirements Logic ────────────────────────────────────────

  private parsePlayRequirementRow(
    row: PlayRequirementRow
  ): PlayRequirementData {
    return {
      id: row.ID,
      game: row.GAME,
      winner: row.WINNER,
      playRequirementsMet: row['PLAY REQUIREMENTS MET'].toUpperCase() === 'YES',
      deadline: row.DEADLINE,
      deadlineInMonths: parseInt(row['DEADLINE (IN MONTHS)'], 10) || 0,
      additionalNotes: row['ADDITIONAL NOTES'] || '',
    }
  }

  private async fetchPlayRequirements(): Promise<PlayRequirementData[]> {
    if (this.playReqFetchPromise) return this.playReqFetchPromise

    const now = Date.now()
    if (
      this.playReqCache &&
      now - this.playReqLastFetch < this.CACHE_DURATION
    ) {
      return this.playReqCache
    }

    this.playReqFetchPromise = this.fetchCsvData<PlayRequirementRow>(
      this.GID.PLAY_REQUIRED
    )
      .then((rows) =>
        rows
          .filter((row) => row.ID && row.GAME)
          .map((row) => this.parsePlayRequirementRow(row))
      )
      .then((data) => {
        this.playReqCache = data
        this.playReqLastFetch = Date.now()
        return data
      })
      .finally(() => {
        this.playReqFetchPromise = null
      })

    return this.playReqFetchPromise
  }

  public async getPlayRequirementsById(
    id: string
  ): Promise<PlayRequirementData | null> {
    const playReqs = await this.fetchPlayRequirements()
    return playReqs.find((p) => p.id === id) || null
  }
}
