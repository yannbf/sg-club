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
  'DEADLINE (dd-mm-yyyy)': string
  'DEADLINE (IN MONTHS)': string
  REQUIREMENTS: string
}

interface DecreasedRatioRow {
  ID: string
  GAME: string
  WINNER: string
  NOTES: string
  GIFT_WEIGHT: string
  WIN_WEIGHT: string
}

interface PlayRequirementData {
  id: string
  game: string
  winner: string
  playRequirementsMet: boolean
  ignoreRequirements?: boolean
  deadline?: string
  deadlineInMonths?: number
  additionalNotes?: string
}

export interface GiveawayData {
  id: string
  game: string
  winner: string
  completedIplayBro: boolean
  extraPoints: number
  playRequirements?: PlayRequirementData
}

export interface DecreasedRatioData {
  id: string
  game: string
  winner: string
  winWeight: number
  giftWeight: number
  notes?: string
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
    INVALID_RATIO: '1029246486', // invalid ratio tab
  }

  private readonly CACHE_DURATION = 25 * 60 * 1000 // 25 min

  private giveawayCache: GiveawayData[] | null = null
  private giveawayLastFetch = 0
  private giveawayFetchPromise: Promise<GiveawayData[]> | null = null

  private playReqCache: PlayRequirementData[] | null = null
  private playReqLastFetch = 0
  private playReqFetchPromise: Promise<PlayRequirementData[]> | null = null

  private decreasedRatioCache: DecreasedRatioData[] | null = null
  private decreasedRatioLastFetch = 0
  private decreasedRatioFetchPromise: Promise<DecreasedRatioData[]> | null =
    null

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
    let data: PlayRequirementData = {
      id: row.ID.trim(),
      game: row.GAME.trim(),
      winner: row.WINNER.trim(),
      playRequirementsMet:
        row['PLAY REQUIREMENTS MET'].trim().toUpperCase() === 'YES',
      ignoreRequirements:
        row['PLAY REQUIREMENTS MET'].trim().toUpperCase() === 'NA',
      deadline: undefined,
      deadlineInMonths: 2,
      additionalNotes: undefined,
    }

    if (row['DEADLINE (dd-mm-yyyy)'] !== '') {
      data.deadline = row['DEADLINE (dd-mm-yyyy)']
    }
    if (row['DEADLINE (IN MONTHS)'] !== '') {
      data.deadlineInMonths = parseInt(row['DEADLINE (IN MONTHS)'], 10)
    }
    if (row['REQUIREMENTS'] !== '') {
      data.additionalNotes = row['REQUIREMENTS']
    }

    return data
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

  // ─── Invalid Ratio Logic ────────────────────────────────────────────

  private parseDecreasedRatioRow(row: DecreasedRatioRow): DecreasedRatioData {
    const notes = (row.NOTES || '').trim()
    return {
      id: row.ID.trim(),
      game: row.GAME.trim(),
      winner: row.WINNER.trim(),
      notes: notes === '' ? undefined : notes,
      winWeight: parseFloat(row['WIN_WEIGHT'].trim()) || 1,
      giftWeight: parseFloat(row['GIFT_WEIGHT'].trim()) || 1,
    }
  }

  private async fetchDecreasedRatios(): Promise<DecreasedRatioData[]> {
    if (this.decreasedRatioFetchPromise) return this.decreasedRatioFetchPromise

    const now = Date.now()
    if (
      this.decreasedRatioCache &&
      now - this.decreasedRatioLastFetch < this.CACHE_DURATION
    ) {
      return this.decreasedRatioCache
    }

    this.decreasedRatioFetchPromise = this.fetchCsvData<DecreasedRatioRow>(
      this.GID.INVALID_RATIO
    )
      .then((rows) =>
        rows
          .filter((row) => row.ID && row.GAME)
          .map((row) => this.parseDecreasedRatioRow(row))
      )
      .then((data) => {
        this.decreasedRatioCache = data
        this.decreasedRatioLastFetch = Date.now()
        return data
      })
      .finally(() => {
        this.decreasedRatioFetchPromise = null
      })

    return this.decreasedRatioFetchPromise
  }

  public async getDecreasedRatioById(
    id: string
  ): Promise<DecreasedRatioData[] | null> {
    const rows = await this.fetchDecreasedRatios()
    const matches = rows.filter((r) => r.id === id)
    return matches.length > 0 ? matches : null
  }
}
