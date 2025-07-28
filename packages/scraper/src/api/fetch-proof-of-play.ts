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

export interface GiveawayData {
  id: string
  game: string
  winner: string
  completedIplayBro: boolean
  extraPoints: number
  playRequirements?: PlayRequirementData
}

interface GiveawayDataMap {
  [id: string]: {
    game: string
    winners: {
      name: string
      completedIplayBro: boolean
      extraPoints: number
      playRequirements?: PlayRequirementData
    }[]
  }
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

  private parseGiveawayRow(
    row: GiveawayRow
  ): Omit<GiveawayData, 'playRequirements'> {
    return {
      id: row.ID,
      game: row.GAME,
      winner: row.WINNER,
      completedIplayBro: row['COMPLETE PLAYING'].toUpperCase() === 'YES',
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
        // Create maps for faster lookups
        const playReqsByIdAndWinner = new Map<string, PlayRequirementData>()
        playReqs.forEach((pr) => {
          const key = `${pr.id}:${pr.winner.toLowerCase()}`
          playReqsByIdAndWinner.set(key, pr)
        })

        // Process giveaway rows and include any matching play requirements
        const giveaways = giveawayRows
          .filter((row) => row.ID && row.GAME)
          .map((row) => {
            const base = this.parseGiveawayRow(row)
            const key = `${base.id}:${base.winner.toLowerCase()}`
            const playRequirements = playReqsByIdAndWinner.get(key)
            return { ...base, playRequirements }
          })

        // Add any play requirements that don't have matching giveaway rows
        const existingKeys = new Set(
          giveaways.map((g) => `${g.id}:${g.winner.toLowerCase()}`)
        )
        for (const pr of playReqs) {
          const key = `${pr.id}:${pr.winner.toLowerCase()}`
          if (!existingKeys.has(key)) {
            giveaways.push({
              id: pr.id,
              game: pr.game,
              winner: pr.winner,
              completedIplayBro: false,
              extraPoints: 0,
              playRequirements: pr,
            })
          }
        }

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

  public async getGiveawayById(id: string): Promise<GiveawayData[] | null> {
    const giveaways = await this.fetchGiveaways()
    return giveaways.filter((g) => g.id === id) || null
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
