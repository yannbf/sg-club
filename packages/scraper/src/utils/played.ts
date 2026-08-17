/**
 * The single definition of "this member actually played the game".
 *
 * Owning a game and launching it once is not playing it, so raw playtime > 0
 * is not enough. Evidence is graded by what Steam can prove:
 *
 * - The game has achievements → at least 10% of them unlocked.
 * - No achievements → at least 25% of HowLongToBeat's main story played,
 *   capped at 15h so an epic-length game can't put the bar out of reach.
 * - No achievements and no HLTB length → at least 2h played.
 *
 * An unknown HLTB length falls back to the 2h bar, the loosest threshold the
 * rules define, so a missing lookup can never make the check stricter than the
 * data supports.
 */

export const PLAYED_ACHIEVEMENT_PERCENT = 10
export const PLAYED_HLTB_FRACTION = 0.25
export const PLAYED_HLTB_CAP_MINUTES = 15 * 60
export const UNKNOWN_LENGTH_PLAYED_MINUTES = 2 * 60

export interface PlayEvidence {
  playtime_minutes: number
  achievements_unlocked: number
  achievements_total: number
}

export function isGamePlayed(
  play: PlayEvidence,
  hltbMainStoryHours?: number | null,
): boolean {
  if (play.achievements_total > 0) {
    const percentage =
      (play.achievements_unlocked / play.achievements_total) * 100
    return percentage >= PLAYED_ACHIEVEMENT_PERCENT
  }

  if (hltbMainStoryHours) {
    const required = Math.min(
      hltbMainStoryHours * 60 * PLAYED_HLTB_FRACTION,
      PLAYED_HLTB_CAP_MINUTES,
    )
    return play.playtime_minutes >= required
  }

  return play.playtime_minutes >= UNKNOWN_LENGTH_PLAYED_MINUTES
}
