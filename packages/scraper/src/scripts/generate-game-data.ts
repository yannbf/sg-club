import { fileURLToPath } from 'node:url'
import { generateGamePrices } from '../api/fetch-game-prices'

async function generateGameData(): Promise<void> {
  const startTime = Date.now()
  await generateGamePrices()
  const endTime = Date.now()
  const duration = (endTime - startTime) / 1000
  console.log(`✅ Data generated in ${duration} seconds`)
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await generateGameData()
  }
}
