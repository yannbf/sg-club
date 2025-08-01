import { generateInsights } from '../utils/generate-insights'
import { generateGiveawaysData } from './generate-giveaways-data'
import { generateMembersData } from './generate-members-data'
import { fileURLToPath } from 'node:url'
import { generateGamePrices } from '../api/fetch-game-prices'
import { execSync } from 'node:child_process'

// perhaps we will use this later.
async function maybeCommitAndPush() {
  if (process.env.CI !== 'true') {
    console.log('🛑 Not in CI – skipping commit and push')
    return
  }

  try {
    // Stage all modified JSON files
    execSync(`git add '*.json'`, { stdio: 'inherit' })

    // Format UTC date
    const date = new Date().toISOString().replace('T', ' ').substring(0, 19)
    const message = `🔄 Updated data - ${date} UTC`

    // Commit and push
    execSync(`git commit -m "${message}"`, { stdio: 'inherit' })
    execSync('git push', { stdio: 'inherit' })
    console.log('✅ Changes committed and pushed')
  } catch (err) {
    console.log('⚠️ Nothing to commit or push, or an error occurred.')
  }
}

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
