import fs from 'fs'
import { SteamGiftsHTMLScraper } from '../scrapers/fetch-steamgifts-html'

const SHARED_GA_URL = '/giveaway/VOC6u/klang'
// const GA_ENTRIES_URL = '/giveaway/VOC6u/klang/entries'
// const PLAY_REQUIRED_GA_URL = '/giveaway/ajs91/god-of-war'

const scraper = new SteamGiftsHTMLScraper()

const main = async () => {
  const html = await scraper.fetchPage(SHARED_GA_URL, true)
  fs.writeFileSync('output.html', html)
}

// Run the script only if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
