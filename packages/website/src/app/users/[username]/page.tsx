// page.tsx
import { getUser, getAllGiveaways, getAllUsers, getGameData, getUserEntries } from '@/lib/data'
import { notFound } from 'next/navigation'
import UserDetailPageClient from './UserDetailPageClient'
import { Metadata } from 'next'

export async function generateStaticParams() {
  const userData = await getAllUsers()
  if (!userData) return []

  return Object.values(userData.users).map((user) => ({
    username: user.username,
  }))
}

export async function generateMetadata({ params }: { params: { username: string } }): Promise<Metadata> {
  const username = decodeURIComponent(params.username)
  const user = await getUser(username)

  if (!user) {
    return {
      title: 'User not found',
      description: 'This user does not exist.',
    }
  }

  const description = `Ratio ${user.stats.giveaway_ratio} | Created ${user.giveaways_created?.length ?? 0} GAs | Received ${user.stats.real_total_received_count} | Sent ${user.stats.total_sent_count} | Received ${user.stats.total_received_count}`

  return {
    title: `${user.username}'s Profile`,
    description,
    openGraph: {
      title: `${user.username}'s Profile`,
      description,
    },
  }
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
  const userEntries = await getUserEntries()
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
      userEntries={userEntries}
    />
  )
} 