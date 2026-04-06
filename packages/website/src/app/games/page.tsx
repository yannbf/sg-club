import { getGameData, getAllGiveaways, getAllUsers } from '@/lib/data'
import GamesClient from './client'

export default async function GamesPage() {
  const giveaways = await getAllGiveaways()
  const gameData = await getGameData()

  const allUsers = await getAllUsers()
  const lastUpdated = allUsers?.lastUpdated ?? null

  // Create maps for looking up user data by steam_id
  const users = Object.values(allUsers?.users || {})
  const userAvatars = new Map(users.map((user) => [user.steam_id, user.avatar_url]))
  const userNames = new Map(users.map((user) => [user.steam_id, user.username]))

  return <GamesClient giveaways={giveaways} gameData={gameData} userAvatars={userAvatars} userNames={userNames} lastUpdated={lastUpdated} />
}