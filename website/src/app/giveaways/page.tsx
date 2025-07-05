import { getAllGiveaways } from '@/lib/data'
import GiveawaysClient from './client'

export default async function GiveawaysPage() {
  const giveaways = await getAllGiveaways()

  return <GiveawaysClient giveaways={giveaways} />
} 