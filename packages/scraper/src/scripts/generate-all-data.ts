import { generateInsights } from '../utils/generate-insights'
import { generateGiveawaysData } from './generate-giveaways-data'
import { generateMembersData } from './generate-members-data'
import { fileURLToPath } from 'node:url'
import { generateGamePrices } from '../api/fetch-game-prices'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

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
  const giveawaysJsonPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../website/public/data/giveaways.json'
  )

  if (existsSync(giveawaysJsonPath)) {
    const giveawaysData = JSON.parse(readFileSync(giveawaysJsonPath, 'utf-8'))
    if (giveawaysData.last_updated) {
      const lastUpdated = new Date(giveawaysData.last_updated)
      const now = new Date()
      const oneHour = 60 * 60 * 1000

      // for debugging purposes show NOW and LAST UPDATED in readable format
      console.log(`NOW: ${now.toLocaleString()}`)
      console.log(`LAST UPDATED: ${lastUpdated.toLocaleString()}`)
      const difference = now.getTime() - lastUpdated.getTime()
      console.log(
        `DIFFERENCE: ${difference} milliseconds or ${
          difference / 60000
        } minutes`
      )

      const hasBeenUpdatedRecently =
        now.getTime() - lastUpdated.getTime() < oneHour
      if (hasBeenUpdatedRecently) {
        console.log(
          `✅ Data was updated less than one hour ago at ${lastUpdated.toLocaleTimeString()}. Skipping generation.`
        )
        return
      }
    }
  }

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
