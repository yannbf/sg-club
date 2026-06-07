import { notFound } from 'next/navigation'
import {
  getAllUsers,
  getAllGiveaways,
  getGameData,
  getWishlist,
  getUserEntries,
  getSpringCleaningSnapshot,
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

  // Prefer the frozen snapshot — it captures the edition exactly as detected,
  // surviving members leaving or fixing their stats. Fall back to a live
  // analysis only when an edition hasn't been frozen yet (a draft).
  const snapshot = await getSpringCleaningSnapshot(edition.slug)
  if (snapshot) {
    return (
      <AdminGate>
        <SpringCleaningClient
          result={snapshot.result}
          edition={edition}
          lastUpdated={snapshot.sourceLastUpdated}
          frozenAt={snapshot.generatedAt}
        />
      </AdminGate>
    )
  }

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
