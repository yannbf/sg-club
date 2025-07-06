import { getAllGiveaways, getLastUpdated } from '@/lib/data'
import GiveawaysClient from './client'

export default async function GiveawaysPage() {
  const giveaways = await getAllGiveaways()
  const lastUpdated = await getLastUpdated()

  return <GiveawaysClient giveaways={giveaways} lastUpdated={lastUpdated} />
} 