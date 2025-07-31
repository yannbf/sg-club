import { generateInsights } from '../utils/generate-insights'
import { generateGiveawaysData } from './generate-giveaways-data'
import { generateMembersData } from './generate-members-data'
import { fileURLToPath } from 'node:url'
import { generateGamePrices } from '../api/fetch-game-prices'

async function generateAllData(): Promise<void> {
  console.log('🚀 Generating all the data...')
  const startTime = Date.now()
  await generateGiveawaysData()
  await generateGamePrices()
  await generateMembersData()
  await generateInsights()
  const endTime = Date.now()
  const duration = (endTime - startTime) / 1000
  console.log(`✅ Full pipeline with data generated in ${duration} seconds`)
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await generateAllData()
  }
}
