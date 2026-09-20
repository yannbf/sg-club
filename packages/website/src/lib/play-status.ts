import type { Giveaway } from '@/types'

/**
 * The subset of a won-game record needed to tell whether play was confirmed
 * out-of-band — matches both `User['giveaways_won'][number]` and
 * `WonGiveawaysClient`'s local `WonGiveaway` alias.
 */
export interface ConfirmedPlaySignal {
  /** Winner posted the "I played, bro!" attestation and a mod confirmed it. */
  i_played_bro?: boolean
  required_play_meta?: Pick<
    NonNullable<Giveaway['required_play_meta']>,
    'requirements_met'
  >
}

/**
 * A win is confirmed played when a mod signed off on "I played, bro" or on a
 * play-requirement's proof of play — regardless of what Steam's playtime/
 * achievement data says (the game may have been played elsewhere, or the
 * profile may be private). This is the single source of truth for that
 * signal; every "never played" / play-rate computation in the app must defer
 * to it instead of re-deriving the same two fields.
 */
export function isConfirmedPlayed(win: ConfirmedPlaySignal): boolean {
  return Boolean(win.i_played_bro || win.required_play_meta?.requirements_met)
}

/**
 * Label for a win that falls short of the "played" bar. Recorded playtime or
 * unlocked achievements make it "Barely played"; with neither it is "Never played".
 */
export function unplayedLabel(
  play?: { playtime_minutes?: number; achievements_unlocked?: number } | null,
): 'Never played' | 'Barely played' {
  const hasPlaytime = (play?.playtime_minutes ?? 0) > 0
  const hasAchievements = (play?.achievements_unlocked ?? 0) > 0
  return hasPlaytime || hasAchievements ? 'Barely played' : 'Never played'
}

/**
 * Mirrors the "played" thresholds in `packages/scraper/src/utils/played.ts`,
 * which derives `steam_play_data.never_played`: a game with achievements
 * counts as played at this percentage unlocked; without achievements, at
 * this fraction of the HowLongToBeat main story (capped at this many
 * minutes); without achievements or an HLTB length, at this many minutes.
 */
export const PLAYED_ACHIEVEMENT_PERCENT = 25
export const PLAYED_HLTB_FRACTION = 0.25
export const PLAYED_HLTB_CAP_MINUTES = 15 * 60
export const UNKNOWN_LENGTH_PLAYED_MINUTES = 2 * 60

/** Minutes as "45m", "2h", or "2h 30m" — for the never/barely-played hover text. */
function formatMinutesShort(minutes: number): string {
  const rounded = Math.round(minutes)
  const hours = Math.floor(rounded / 60)
  const mins = rounded % 60
  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

/**
 * Explains why a fell-short win carries its never/barely-played label, using
 * the same evidence and thresholds `isGamePlayed` in
 * `packages/scraper/src/utils/played.ts` checks. `hltbMainStoryHours` is the
 * game's HowLongToBeat main-story length, when known.
 */
export function unplayedReason(
  play?:
    | {
        playtime_minutes?: number
        achievements_unlocked?: number
        achievements_total?: number
      }
    | null,
  hltbMainStoryHours?: number | null,
): string {
  const playtimeMinutes = play?.playtime_minutes ?? 0
  const achievementsUnlocked = play?.achievements_unlocked ?? 0
  const achievementsTotal = play?.achievements_total ?? 0

  if (playtimeMinutes <= 0 && achievementsUnlocked <= 0) {
    return 'No playtime or achievements recorded on Steam.'
  }

  if (achievementsTotal > 0) {
    const rawPercentage = (achievementsUnlocked / achievementsTotal) * 100
    // A rounded percentage that reads as meeting the threshold would
    // contradict the fell-short label it's explaining, so floor it instead.
    const roundedPercentage = Math.round(rawPercentage)
    const percentage =
      roundedPercentage >= PLAYED_ACHIEVEMENT_PERCENT
        ? Math.floor(rawPercentage)
        : roundedPercentage
    return `${achievementsUnlocked}/${achievementsTotal} achievements (${percentage}%) — ${PLAYED_ACHIEVEMENT_PERCENT}% needed to count as played.`
  }

  if (hltbMainStoryHours) {
    const uncappedRequired = hltbMainStoryHours * 60 * PLAYED_HLTB_FRACTION
    const required = Math.min(uncappedRequired, PLAYED_HLTB_CAP_MINUTES)
    const capped = uncappedRequired > PLAYED_HLTB_CAP_MINUTES
    const clause = capped
      ? `(capped at ${formatMinutesShort(PLAYED_HLTB_CAP_MINUTES)})`
      : `(${PLAYED_HLTB_FRACTION * 100}% of the ${hltbMainStoryHours}h HowLongToBeat main story)`
    return `${formatMinutesShort(playtimeMinutes)} played — ${formatMinutesShort(required)} needed to count as played ${clause}.`
  }

  return `${formatMinutesShort(playtimeMinutes)} played — ${formatMinutesShort(UNKNOWN_LENGTH_PLAYED_MINUTES)} needed to count as played (no achievements or HowLongToBeat length to measure against).`
}
