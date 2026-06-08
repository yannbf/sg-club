import { getAllGiveaways, getChallengeData } from '@/lib/data'
import {
  buildGiveawayEventSummaries,
  buildSpecialEventSummary,
  CHALLENGE_EVENTS,
  SPECIAL_EVENTS,
  type EventSummary,
} from '@/lib/events'

/**
 * Assembles every event summary (giveaway events + challenges) for listing
 * surfaces (the /events page and the homepage "ongoing" banner). Deleted
 * giveaways are already excluded by buildGiveawayEventSummaries.
 */
export async function getEventSummaries(): Promise<EventSummary[]> {
  const giveaways = await getAllGiveaways()
  const giveawayEvents = buildGiveawayEventSummaries(giveaways)

  const challengeSummaries: EventSummary[] = []
  for (const meta of CHALLENGE_EVENTS) {
    const data = meta.challengeSlug
      ? await getChallengeData(meta.challengeSlug)
      : null
    challengeSummaries.push({
      meta,
      giveawayCount: 0,
      totalCopies: 0,
      totalEntries: 0,
      uniqueCreators: 0,
      winnersCount: 0,
      startTimestamp: data?.startTimestamp ?? null,
      endTimestamp: null,
      // A challenge is "ongoing" until someone wins it.
      isOngoing: !data?.winnerUsername,
      participantCount: data?.participants.length ?? 0,
      winnerUsername: data?.winnerUsername ?? null,
    })
  }

  const specialSummaries = SPECIAL_EVENTS.map((meta) =>
    buildSpecialEventSummary(meta, giveaways),
  )

  return [...challengeSummaries, ...specialSummaries, ...giveawayEvents]
}
