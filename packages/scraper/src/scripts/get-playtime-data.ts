import { getSteamChecker } from '../api/fetch-steam-data'

async function main() {
  const steamId = process.argv[2] ?? '76561197984532155'
  const appId = process.argv[3] ?? '516202'
  if (!steamId || !appId) {
    console.error('❌ Please provide a steamId and appId.')
    process.exit(1)
  }

  try {
    const steamChecker = getSteamChecker()
    const playtime = await steamChecker.getGamePlayData(
      steamId,
      Number(appId),
      'app' // use 'sub' if it's a package
    )
    console.log(playtime)
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

main()
