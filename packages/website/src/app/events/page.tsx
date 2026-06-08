import { getEventSummaries } from '@/lib/event-data'
import EventsClient from './client'

export const metadata = {
  title: 'Events — The Giveaways Club',
  description:
    'Monthly giveaway events and community gaming challenges from The Giveaways Club.',
}

export default async function EventsPage() {
  const events = await getEventSummaries()
  return <EventsClient events={events} />
}
