import { getAllGiveaways, getLastUpdated, getAllUsers, getExMembers, getGameData, getSteamIdMap } from '@/lib/data'
import { createCreatorResolver } from '@/lib/creator-resolver'
import { buildWinnerPlayStats } from '@/lib/winner-play-stats'
import GiveawaysClient from './client'

export default async function GiveawaysPage() {
  const [giveaways, lastUpdated, allUsers, exMembers, gameData, steamIdMap] = await Promise.all([
    getAllGiveaways(),
    getLastUpdated(),
    getAllUsers(),
    getExMembers(),
    getGameData(),
    getSteamIdMap(),
  ])

  // Ex-member steam_ids — winners that are neither members nor ex-members
  // are labelled "non-group member" instead of "(ex)".
  const exMemberIds = new Set(Object.keys(exMembers?.users ?? {}))

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

  // Playtime/achievements/proof-of-play a winner has on the game they won.
  const playStatsByWin = buildWinnerPlayStats(
    giveaways,
    [allUsers, exMembers],
    createCreatorResolver(steamIdMap),
  )

  return <GiveawaysClient
    giveaways={giveaways}
    lastUpdated={lastUpdated}
    userAvatars={userAvatars}
    userNames={userNames}
    exMemberIds={exMemberIds}
    playStatsByWin={playStatsByWin}
    gameData={gameData}
  />
} 