// Single definition of what a won giveaway's Steam data says about whether the
// member played it, and of the play rate built on that.
//
// Lives in api/_lib for the same reason required-play.ts does: the scraper
// (calculateUserWarnings), the serverless Discord handlers (mod-report.ts) and
// the Next.js UI (spring-cleaning.ts) can all import it, and it has no imports
// of its own. Its input types are structural, so both the scraper's and the
// website's `giveaways_won` entries are accepted as-is.
//
// The core distinction is between a game Steam shows as unplayed and a game
// Steam could not say anything about. A hidden profile, a failed library read,
// a delisted package or a game missing from the library all produce a record
// with zero playtime; reading that as "unplayed" turns a privacy setting into
// a 0% play rate.

/** Why Steam stats could not be read for a win — mirrors the scraper's `NoStatsReason`. */
type NoStatsReason = string

/** The Steam snapshot fields the classification reads. */
export interface PlaySnapshot {
  playtime_minutes?: number
  achievements_unlocked?: number
  never_played?: boolean
  has_no_available_stats?: boolean
  no_stats_reason?: NoStatsReason
}

/** The subset of a won giveaway the classification reads. */
export interface PlayEvidenceWin {
  steam_play_data?: PlaySnapshot
  /** Set by the scraper when the game had not released at scrape time. */
  unreleased?: boolean
  /** A mod-recorded "I played, bro" attestation. */
  i_played_bro?: boolean
  /** A signed-off proof-of-play requirement. */
  required_play_meta?: { requirements_met?: boolean }
}

/**
 * What Steam says about one win:
 * - `played`: the numbers show play.
 * - `unplayed`: the library was read and shows the game owned but not played.
 * - `unreadable`: nothing can be said — no snapshot, or one with no evidence
 *   whose stats could not be read.
 * - `unreleased`: the game is not out yet, so there is nothing to play.
 */
export type PlayEvidenceClass = 'played' | 'unplayed' | 'unreadable' | 'unreleased'

/**
 * Reasons that mean the zero playtime on the snapshot is a gap in the data.
 * `no_steam_stats` is deliberately absent: it means the library read fine and
 * only the achievements are missing, so the playtime is real.
 */
const UNREADABLE_REASONS: ReadonlySet<NoStatsReason> = new Set([
  'library_unavailable',
  'package_delisted',
  'not_in_library',
])

/**
 * Classifies a win from its Steam snapshot alone; attestations are not
 * consulted (see `summarizePlayEvidence`).
 *
 * The recorded numbers decide, and `has_no_available_stats` never overrides
 * them: it is also set for `no_steam_stats`, where playtime is genuine and
 * only achievements are missing. A snapshot kept from an earlier readable pull
 * (`stats_hidden_at`) still carries its playtime, so it is classified by that
 * playtime rather than by the later failed read.
 */
export function classifyPlayEvidence(win: PlayEvidenceWin): PlayEvidenceClass {
  if (win.unreleased) return 'unreleased'

  const play = win.steam_play_data
  if (!play) return 'unreadable'

  const hasEvidence = (play.playtime_minutes ?? 0) > 0 || (play.achievements_unlocked ?? 0) > 0
  if (!hasEvidence) {
    const reason = play.no_stats_reason
    if (reason ? UNREADABLE_REASONS.has(reason) : play.has_no_available_stats) {
      return 'unreadable'
    }
  }

  return play.never_played ? 'unplayed' : 'played'
}

/** True when a mod attested the win was played, whatever Steam shows. */
export function isAttestedPlayed(win: PlayEvidenceWin): boolean {
  return Boolean(win.i_played_bro || win.required_play_meta?.requirements_met)
}

export interface PlayEvidenceSummary {
  played: number
  unplayed: number
  unreadable: number
  unreleased: number
  /**
   * `played / (played + unplayed)`, in [0, 1]; null when no win has readable
   * evidence, so callers can tell "no data" apart from a genuine 0%.
   */
  rate: number | null
}

/**
 * Tallies a member's wins by evidence class and derives the play rate over the
 * readable ones. Unreadable and unreleased wins are in neither the numerator
 * nor the denominator.
 *
 * An attested win ("I played, bro", or a met play requirement) counts as
 * played regardless of Steam data, since the game may have been played
 * elsewhere or the profile may be private. Unreleased wins stay unreleased
 * even when attested. Callers pass the wins they want judged; any scoping
 * (time window, CV status, deleted giveaways) is theirs to apply first.
 */
export function summarizePlayEvidence(wins: Iterable<PlayEvidenceWin>): PlayEvidenceSummary {
  const counts = { played: 0, unplayed: 0, unreadable: 0, unreleased: 0 }
  for (const win of wins) {
    const cls = classifyPlayEvidence(win)
    counts[cls === 'unreleased' || !isAttestedPlayed(win) ? cls : 'played']++
  }
  const readable = counts.played + counts.unplayed
  return { ...counts, rate: readable === 0 ? null : counts.played / readable }
}
