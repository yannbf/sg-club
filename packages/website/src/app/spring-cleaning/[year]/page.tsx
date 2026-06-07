import { notFound } from 'next/navigation'
import {
  getAllUsers,
  getAllGiveaways,
  getGameData,
  getWishlist,
  getUserEntries,
} from '@/lib/data'
import {
  analyzeSpringCleaning,
  getSpringCleaningEdition,
  SPRING_CLEANINGS,
} from '@/lib/spring-cleaning'
import { AdminGate } from '@/components/AdminGate'
import SpringCleaningClient from '../client'

export function generateStaticParams() {
  return SPRING_CLEANINGS.map((edition) => ({ year: edition.slug }))
}

export default async function SpringCleaningEditionPage(props: {
  params: Promise<{ year: string }>
}) {
  const { year } = await props.params
  const edition = getSpringCleaningEdition(year)
  if (!edition) notFound()

  const userData = await getAllUsers()
  const giveaways = await getAllGiveaways()
  const gameData = await getGameData()
  const wishlist = await getWishlist()
  const userEntries = await getUserEntries()

  if (!userData) {
    return (
      <AdminGate>
        <div className="flex h-64 items-center justify-center">
          <p className="text-muted-foreground">Unable to load user data</p>
        </div>
      </AdminGate>
    )
  }

  const result = analyzeSpringCleaning(
    Object.values(userData.users),
    giveaways,
    gameData,
    wishlist,
    userEntries,
  )

  return (
    <AdminGate>
      <SpringCleaningClient
        result={result}
        edition={edition}
        lastUpdated={userData.lastUpdated}
      />
    </AdminGate>
  )
}
