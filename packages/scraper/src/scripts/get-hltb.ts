import { hltb } from '../api/fetch-hltb-data'

async function main() {
  const gameName = process.argv[2]
  if (!gameName) {
    console.error('❌ Please provide a game name.')
    process.exit(1)
  }

  try {
    const gameInfo = await hltb.getGameInfo(gameName)

    if (gameInfo.mainStoryHours !== null) {
      console.log('✅ Game found:', {
        name: gameInfo.name,
        mainStoryHours: gameInfo.mainStoryHours,
      })
    } else {
      console.log(`❌ No game found with name: ${gameName}`)
    }
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

main()
