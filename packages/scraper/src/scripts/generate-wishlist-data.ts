import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { scrapeGroupWishlist } from '../scrapers/group-wishlist'
import { logError } from '../utils/log-error'

export async function generateWishlistData(): Promise<void> {
  const filename = '../website/public/data/wishlist.json'

  try {
    console.log('🚀 Starting wishlist scraping...')
    const entries = await scrapeGroupWishlist()

    const data = {
      last_updated: new Date().toISOString(),
      entries,
    }

    writeFileSync(filename, JSON.stringify(data, null, 2))
    console.log(`💾 Wishlist saved to ${filename} (${entries.length} entries)`)
  } catch (error) {
    const errorMessage = 'Failed to scrape wishlist'
    console.error(`❌ ${errorMessage}:`, error)
    logError(error, errorMessage)
    process.exit(1)
  }
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await generateWishlistData()
  }
}
