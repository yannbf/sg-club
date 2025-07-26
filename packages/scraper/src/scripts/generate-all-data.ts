import { generateInsights } from '../utils/generate-insights'
import { generateGiveawaysData } from './generate-giveaways-data'
import { generateMembersData } from './generate-members-data'

async function generateAllData(): Promise<void> {
  console.log('🚀 Generating all the data...')
  const startTime = Date.now()
  await generateGiveawaysData()
  await generateMembersData()
  await generateInsights()
  const endTime = Date.now()
  const duration = (endTime - startTime) / 1000
  console.log(`✅ Full pipeline with data generated in ${duration} seconds`)
}

await generateAllData()
