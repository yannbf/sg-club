/**
 * The single definition of "this member actually played the game".
 *
 * Owning a game and launching it once is not playing it, so raw playtime > 0
 * is not enough. Evidence is graded by what Steam can prove:
 *
 * - The game has achievements → at least 10% of them unlocked.
 * - No achievements, and HowLongToBeat's main story is over 4h → at least 20%
 *   of that main story played.
 * - No achievements, and a short (or unknown-length) game → at least 2h played.
 *
 * An unknown HLTB length falls back to the short-game bar: 2h is the lowest
 * threshold the rules define, so a missing lookup can never make the check
 * stricter than the data supports.
 */

export const PLAYED_ACHIEVEMENT_PERCENT = 10
export const PLAYED_HLTB_FRACTION = 0.2
export const SHORT_GAME_HLTB_HOURS = 4
export const SHORT_GAME_PLAYED_MINUTES = 2 * 60

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

  if (hltbMainStoryHours && hltbMainStoryHours > SHORT_GAME_HLTB_HOURS) {
    return (
      play.playtime_minutes >= hltbMainStoryHours * 60 * PLAYED_HLTB_FRACTION
    )
  }

  return play.playtime_minutes >= SHORT_GAME_PLAYED_MINUTES
}
