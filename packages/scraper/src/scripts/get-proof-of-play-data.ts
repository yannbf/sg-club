import { GiveawayPointsManager } from '../api/fetch-proof-of-play'

async function main() {
  const giveawayId = process.argv[2]
  if (!giveawayId) {
    console.error('❌ Please provide a giveaway ID.')
    process.exit(1)
  }

  try {
    const manager = GiveawayPointsManager.getInstance()
    const giveaway = await manager.getGiveawayById(giveawayId)

    if (giveaway) {
      console.log('Found giveaway:', giveaway)
    } else {
      console.log(`No giveaway found with ID: ${giveawayId}`)
    }
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

main()
