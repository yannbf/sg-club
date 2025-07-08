import fs from 'fs'
import { SteamGiftsHTMLScraper } from '../scrapers/fetch-steamgifts-html'

const SHARED_GA_URL = '/giveaway/VOC6u/klang'

const scraper = new SteamGiftsHTMLScraper()

const main = async () => {
  const html = await scraper.fetchPage(SHARED_GA_URL, true)
  fs.writeFileSync('output.html', html)
}

// Run the script only if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
