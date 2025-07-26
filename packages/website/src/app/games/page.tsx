import { getGameData, getAllGiveaways, getAllUsers } from '@/lib/data'
import GamesClient from './client'

export default async function GamesPage() {
  const giveaways = await getAllGiveaways()
  const gameData = await getGameData()

  const allUsers = await getAllUsers()
  const lastUpdated = allUsers?.lastUpdated ?? null

  // Create a map of usernames to avatar URLs
  const userAvatars = new Map(
    Object.values(allUsers?.users || {}).map((user) => [
      user.username,
      user.avatar_url,
    ])
  )

  return <GamesClient giveaways={giveaways} gameData={gameData} userAvatars={userAvatars} lastUpdated={lastUpdated} />
}