import { getAllGiveaways, getLastUpdated, getAllUsers, getGameData, getSteamIdMap } from '@/lib/data'
import GiveawaysClient from './client'

export default async function GiveawaysPage() {
  const [giveaways, lastUpdated, allUsers, gameData, steamIdMap] = await Promise.all([
    getAllGiveaways(),
    getLastUpdated(),
    getAllUsers(),
    getGameData(),
    getSteamIdMap(),
  ])

  // Create a map of steam_id to avatar_url for display
  const userAvatars = new Map(
    Object.values(allUsers?.users || {}).map((user) => [
      user.steam_id,
      user.avatar_url,
    ])
  )

  // Use steam_id_map.json for steam_id → current username resolution
  const userNames = new Map(
    Object.entries(steamIdMap).map(([steamId, entry]) => [steamId, entry.current])
  )

  return <GiveawaysClient
    giveaways={giveaways}
    lastUpdated={lastUpdated}
    userAvatars={userAvatars}
    userNames={userNames}
    gameData={gameData}
  />
} 