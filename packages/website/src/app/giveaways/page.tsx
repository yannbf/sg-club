import { getAllGiveaways, getLastUpdated, getAllUsers } from '@/lib/data'
import GiveawaysClient from './client'

export default async function GiveawaysPage() {
  const giveaways = await getAllGiveaways()
  const lastUpdated = await getLastUpdated()
  const allUsers = await getAllUsers()

  // Create a map of usernames to avatar URLs
  const userAvatars = new Map(allUsers?.users.map(user => [user.username, user.avatar_url]))

  return <GiveawaysClient 
    giveaways={giveaways} 
    lastUpdated={lastUpdated} 
    userAvatars={userAvatars} 
  />
} 