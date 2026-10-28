import type { Giveaway, NoStatsReason, User } from '@/types'
import {
  PLAYED_HLTB_CAP_MINUTES,
  PLAYED_HLTB_FRACTION,
  UNKNOWN_LENGTH_PLAYED_MINUTES,
  isConfirmedPlayed,
  type ConfirmedPlaySignal,
} from './play-status'
import { ipbDiscordWinKey, type IpbDiscordData } from '@/types/ipb-discord'

/**
 * Achievement percentage that counts a win as played in the group play-rate
 * chart. Lower than `PLAYED_ACHIEVEMENT_PERCENT`, and the chart accepts either
 * this bar or the playtime bar, whichever is met.
 */
export const GROUP_PLAY_RATE_ACHIEVEMENT_PERCENT = 10

/**
 * What the evidence says about one won game:
 * - `confirmed`: a mod confirmed the play ("I played, bro" or a signed-off
 *   play requirement), whatever Steam shows.
 * - `played`: not confirmed, but Steam shows play that meets the achievement
 *   or playtime bar.
 * - `unplayed`: Steam stats were readable and fall short of the played bar.
 * - `unknown`: Steam stats are unreadable.
 */
export type WinEvidence = 'played' | 'confirmed' | 'unplayed' | 'unknown'

/**
 * Per-row tallies. A win with unreadable Steam stats (`unknown` evidence)
 * counts as `unplayed`: it has no proof of play, so the chart has no separate
 * bucket for it and the play rate keeps it in the denominator.
 */
export type PlayRateCounts = Record<Exclude<WinEvidence, 'unknown'>, number>

/** Play-required wins: sign-off beats Steam evidence, which beats nothing. */
export interface RequiredPlayCounts {
  /** Signed off in the Play Required sheet. */
  approved: number
  /** Not signed off, but a mod confirmed the play or Steam meets the played bar. */
  played: number
  unplayed: number
}

/**
 * Per-row tallies for one set of wins. `overall` holds every counted win;
 * `required` and `noRequirement` split it by `required_play`; `ipb.submitted`
 * counts wins with an "I Play Bro" submission. `shared` holds the shared and
 * whitelist wins, and is empty in the exclusive-only table.
 */
export interface PlayRateTable {
  overall: PlayRateCounts
  required: RequiredPlayCounts
  ipb: { submitted: number }
  noRequirement: PlayRateCounts
  shared: PlayRateCounts
}

export interface GroupPlayRate {
  /** Group-exclusive wins only. */
  exclusive: PlayRateTable
  /** Every counted win, shared and whitelist ones included. */
  all: PlayRateTable
  /** Wins left out because the game hasn't released. */
  unreleased: number
}

/** The fields of a won-game record that decide its evidence class. */
export type WinEvidenceInput = ConfirmedPlaySignal & {
  steam_play_data?: {
    playtime_minutes: number
    achievements_unlocked: number
    achievements_total: number
    is_playtime_private: boolean
    has_no_available_stats: boolean
    no_stats_reason?: NoStatsReason
  }
}

function meetsPlayedBar(
  play: NonNullable<WinEvidenceInput['steam_play_data']>,
  hltbMainStoryHours?: number | null,
): boolean {
  if (
    play.achievements_total > 0 &&
    play.achievements_unlocked * 100 >=
      play.achievements_total * GROUP_PLAY_RATE_ACHIEVEMENT_PERCENT
  ) {
    return true
  }
  const requiredMinutes =
    hltbMainStoryHours && hltbMainStoryHours > 0
      ? Math.min(hltbMainStoryHours * 60 * PLAYED_HLTB_FRACTION, PLAYED_HLTB_CAP_MINUTES)
      : UNKNOWN_LENGTH_PLAYED_MINUTES
  return requiredMinutes > 0 && play.playtime_minutes >= requiredMinutes
}

/**
 * Judged from the recorded numbers. `hltbMainStoryHours` is the game's
 * HowLongToBeat main-story length, when known.
 */
export function classifyWinEvidence(
  win: WinEvidenceInput,
  hltbMainStoryHours?: number | null,
): WinEvidence {
  const play = win.steam_play_data
  if (isConfirmedPlayed(win)) return 'confirmed'
  if (play && meetsPlayedBar(play, hltbMainStoryHours)) return 'played'
  if (!play) return 'unknown'

  const noEvidence = play.playtime_minutes <= 0 && play.achievements_unlocked <= 0
  // `no_steam_stats` means the library read fine and the zero playtime is
  // real; the game just exposes no achievements.
  const unreadable =
    play.is_playtime_private ||
    (play.has_no_available_stats && play.no_stats_reason !== 'no_steam_stats')
  return noEvidence && unreadable ? 'unknown' : 'unplayed'
}

function emptyCounts(): PlayRateCounts {
  return { played: 0, confirmed: 0, unplayed: 0 }
}

function emptyTable(): PlayRateTable {
  return {
    overall: emptyCounts(),
    required: { approved: 0, played: 0, unplayed: 0 },
    ipb: { submitted: 0 },
    noRequirement: emptyCounts(),
    shared: emptyCounts(),
  }
}

/** Whether the win has an "I Play Bro" submission, approved or not. */
function hasIpbSubmission(
  win: Pick<NonNullable<User['giveaways_won']>[number], 'i_played_bro' | 'ipb_sheet_status'>,
  discordEntry: unknown,
): boolean {
  return Boolean(discordEntry || win.i_played_bro || win.ipb_sheet_status != null)
}

function tally(
  table: PlayRateTable,
  win: NonNullable<User['giveaways_won']>[number],
  evidence: Exclude<WinEvidence, 'unknown'>,
  shared: boolean,
  submitted: boolean,
): void {
  table.overall[evidence]++
  if (submitted) table.ipb.submitted++
  if (shared) table.shared[evidence]++
  if (win.required_play) {
    const bucket: keyof RequiredPlayCounts = win.required_play_meta?.requirements_met
      ? 'approved'
      : evidence === 'played' || evidence === 'confirmed'
        ? 'played'
        : 'unplayed'
    table.required[bucket]++
  } else {
    table.noRequirement[evidence]++
  }
}

/**
 * Tallies every current member's wins by evidence class, once counting only
 * group-exclusive giveaways and once counting all of them. `giveaways` is
 * expected to be the already-counted list: wins whose giveaway isn't in it
 * (or that are flagged deleted) are skipped. Unreleased games count toward
 * nothing but `unreleased`. `hltbHoursFor` supplies each game's HowLongToBeat
 * main-story length, so this module needn't load game data.
 */
export function buildGroupPlayRate(
  users: User[],
  giveaways: Giveaway[],
  hltbHoursFor: (giveaway: Giveaway) => number | null | undefined,
  ipbDiscord: IpbDiscordData | null,
): GroupPlayRate {
  const byLink = new Map(giveaways.map((g) => [g.link, g]))
  const result: GroupPlayRate = {
    exclusive: emptyTable(),
    all: emptyTable(),
    unreleased: 0,
  }

  for (const user of users) {
    for (const win of user.giveaways_won ?? []) {
      if (win.deleted) continue
      const giveaway = byLink.get(win.link)
      if (!giveaway) continue
      if (win.unreleased) {
        result.unreleased++
        continue
      }

      const classified = classifyWinEvidence(win, hltbHoursFor(giveaway))
      const evidence = classified === 'unknown' ? 'unplayed' : classified
      const shared = Boolean(giveaway.is_shared || giveaway.whitelist)
      const submitted = hasIpbSubmission(
        win,
        ipbDiscord?.wins[ipbDiscordWinKey(user.steam_id, win.link)],
      )
      tally(result.all, win, evidence, shared, submitted)
      if (!shared) tally(result.exclusive, win, evidence, false, submitted)
    }
  }
  return result
}

/**
 * Share of wins with evidence of play, as a whole percentage, over every
 * counted win. Null when there are none.
 */
export function playRatePercent(counts: PlayRateCounts): number | null {
  const played = counts.played + counts.confirmed
  const total = played + counts.unplayed
  return total === 0 ? null : Math.round((played / total) * 100)
}

/**
 * Share of play-required wins that are approved or Steam-played, as a whole
 * percentage. Null when there are none.
 */
export function requiredPlayRatePercent(counts: RequiredPlayCounts): number | null {
  const played = counts.approved + counts.played
  const total = played + counts.unplayed
  return total === 0 ? null : Math.round((played / total) * 100)
}
