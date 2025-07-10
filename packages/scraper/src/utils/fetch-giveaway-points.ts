import Papa from 'papaparse'

// Define the structure of a giveaway row
interface GiveawayRow {
  ID: string
  GAME: string
  WINNER: string
  'COMPLETE PLAYING': string
  'EXTRA POINTS': string
}

interface GiveawayData {
  id: string
  game: string
  winner: string
  completePlaying: boolean
  extraPoints: number
}

export class GiveawayPointsManager {
  private static instance: GiveawayPointsManager
  private readonly SHEET_ID = '1h20q3RPeYTDwL_hl3uWEq6SSRbSlsHJW3VhN538oP3A'
  private cachedData: GiveawayData[] | null = null
  private lastFetchTime: number = 0
  private readonly CACHE_DURATION = 5 * 60 * 1000 // 5 minutes in milliseconds
  private fetchPromise: Promise<GiveawayData[]> | null = null

  private constructor() {}

  public static getInstance(): GiveawayPointsManager {
    if (!GiveawayPointsManager.instance) {
      GiveawayPointsManager.instance = new GiveawayPointsManager()
    }
    return GiveawayPointsManager.instance
  }

  private parseRow(row: GiveawayRow): GiveawayData {
    return {
      id: row.ID,
      game: row.GAME,
      winner: row.WINNER,
      completePlaying: row['COMPLETE PLAYING'].toUpperCase() === 'YES',
      extraPoints: parseInt(row['EXTRA POINTS'], 10) || 0,
    }
  }

  private async fetchAllGiveaways(): Promise<GiveawayData[]> {
    // If there's already a fetch in progress, wait for it
    if (this.fetchPromise) {
      console.log('🔄 Fetch already in progress, waiting...')
      return this.fetchPromise
    }

    // Check if we have valid cached data
    const now = Date.now()
    if (this.cachedData && now - this.lastFetchTime < this.CACHE_DURATION) {
      console.log('📦 Using cached data')
      return this.cachedData
    }

    // Start new fetch
    this.fetchPromise = this.doFetch()

    try {
      const data = await this.fetchPromise
      return data
    } finally {
      // Clear the promise so future fetches can occur
      this.fetchPromise = null
    }
  }

  private async doFetch(): Promise<GiveawayData[]> {
    const csvUrl = `https://docs.google.com/spreadsheets/d/${this.SHEET_ID}/export?format=csv`

    try {
      console.log('🔄 Fetching spreadsheet data...')
      const response = await fetch(csvUrl)

      if (!response.ok) {
        throw new Error(`Failed to fetch sheet: ${response.statusText}`)
      }

      const csvText = await response.text()
      const parsed = Papa.parse<GiveawayRow>(csvText, {
        header: true,
        skipEmptyLines: true,
      })

      if (parsed.errors.length > 0) {
        console.warn('⚠️  Parse warnings:', parsed.errors)
      }

      // Transform and validate the data
      const giveaways = parsed.data
        .filter((row) => row.ID && row.GAME) // Skip incomplete rows
        .map((row) => this.parseRow(row))

      // Update cache
      this.cachedData = giveaways
      this.lastFetchTime = Date.now()

      console.log(`✅ Fetched ${giveaways.length} giveaways`)
      return giveaways
    } catch (err) {
      console.error(
        '❌ Error fetching data:',
        err instanceof Error ? err.message : err
      )
      // If we have cached data, return it as fallback
      if (this.cachedData) {
        console.log('📦 Using cached data as fallback')
        return this.cachedData
      }
      throw err
    }
  }

  public async getGiveawayById(
    giveawayId: string
  ): Promise<GiveawayData | null> {
    try {
      const giveaways = await this.fetchAllGiveaways()
      const giveaway = giveaways.find((g) => g.id === giveawayId)

      if (giveaway) {
        console.log('🎯 Giveaway found:', giveaway)
        return giveaway
      } else {
        console.log('❌ No giveaway found for ID:', giveawayId)
        return null
      }
    } catch (err) {
      console.error('❌ Error:', err instanceof Error ? err.message : err)
      return null
    }
  }

  public async getAllGiveaways(): Promise<GiveawayData[]> {
    return this.fetchAllGiveaways()
  }
}
