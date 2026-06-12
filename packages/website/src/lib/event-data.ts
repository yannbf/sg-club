import { getAllGiveaways, getChallengeData } from '@/lib/data'
import {
  buildGiveawayEventSummaries,
  buildSpecialEventSummary,
  CHALLENGE_EVENTS,
  eventLingerUntil,
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
  const now = Date.now() / 1000

  const challengeSummaries: EventSummary[] = []
  for (const meta of CHALLENGE_EVENTS) {
    const data = meta.challengeSlug
      ? await getChallengeData(meta.challengeSlug)
      : null
    // "Ongoing" depends on the challenge kind:
    //  - completion (has a `deadline`): live until the deadline passes, then it
    //    lingers in "Happening now" for `keepLiveForDays`/`keepLiveUntil`.
    //  - achievement: live until someone wins, then it lingers past the win.
    let isOngoing: boolean
    // Whether the challenge's natural end has passed (deadline reached, or for
    // achievement challenges a winner recorded) — it then lingers in "Happening
    // now" with an "Ended" badge until the linger window closes.
    let naturalEndPassed: boolean
    if (data?.deadline != null) {
      isOngoing = now <= eventLingerUntil(data.deadline, meta)
      naturalEndPassed = now >= data.deadline
    } else {
      isOngoing =
        !data?.winnerUsername ||
        (data.winnerUnlocktime != null &&
          now <= eventLingerUntil(data.winnerUnlocktime, meta))
      naturalEndPassed = Boolean(data?.winnerUsername)
    }
    challengeSummaries.push({
      meta,
      giveawayCount: 0,
      totalCopies: 0,
      totalEntries: 0,
      uniqueCreators: 0,
      winnersCount: 0,
      startTimestamp: data?.startTimestamp ?? null,
      // Display end = inclusive last day (the stored deadline is the exclusive
      // UTC-midnight cutoff); noon-of-prior-day renders the right calendar day.
      endTimestamp: data?.deadline != null ? data.deadline - 43200 : null,
      isOngoing,
      hasEnded: isOngoing && naturalEndPassed,
      participantCount: data?.participants.length ?? 0,
      winnerUsername: data?.winnerUsername ?? null,
      winnerCount: data?.winnerUsernames?.length,
    })
  }

  const specialSummaries = SPECIAL_EVENTS.map((meta) =>
    buildSpecialEventSummary(meta, giveaways),
  )

  // Single chronological list (most recent first) across all event kinds, so
  // the /events page and homepage banner don't show them grouped by type.
  const dateKey = (e: EventSummary) =>
    e.startTimestamp ?? e.endTimestamp ?? 0
  return [...challengeSummaries, ...specialSummaries, ...giveawayEvents].sort(
    (a, b) => dateKey(b) - dateKey(a),
  )
}
