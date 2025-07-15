// page.tsx
import { getUser, getAllGiveaways, getAllUsers, getGameData } from '@/lib/data'
import { notFound } from 'next/navigation'
import UserDetailPageClient from './UserDetailPageClient'

export async function generateStaticParams() {
  const userData = await getAllUsers()
  if (!userData) return []

  return Object.values(userData.users).map((user) => ({
    username: user.username,
  }))
}

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const user = await getUser(decodeURIComponent(username))
  const allUsers = await getAllUsers()
  const giveaways = await getAllGiveaways()
  const gameDataObj = await getGameData()
  
  if (!user) {
    notFound()
  }

  // Convert gameData from object to array
  const gameData = Object.entries(gameDataObj).map(([, data]) => data)

  return (
    <UserDetailPageClient
      user={user}
      allUsers={allUsers}
      giveaways={giveaways}
      gameData={gameData}
    />
  )
} 