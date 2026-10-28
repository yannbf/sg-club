import type { Giveaway, User } from '@/types'
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
 * chart. Lower than `PLAYED_ACHIEVEMENT_PERCENT`. Games without achievements
 * are judged by playtime instead.
 */
export const GROUP_PLAY_RATE_ACHIEVEMENT_PERCENT = 10

/**
 * How far a won game has been taken, judged from Steam data and mod sign-off:
 * - `complete`: every achievement is unlocked.
 * - `played`: at least `GROUP_PLAY_RATE_ACHIEVEMENT_PERCENT` of achievements,
 *   or (for a game without achievements) playtime at the HowLongToBeat bar,
 *   or a mod confirmed the play.
 * - `started`: some playtime or achievements, short of the played bar.
 * - `notStarted`: no recorded progress. Unreadable Steam stats land here too:
 *   the chart treats unknown as not played.
 *
 * A game without achievements can be started or played but never complete.
 */
export type WinProgress = 'complete' | 'played' | 'started' | 'notStarted'

/**
 * Cumulative tallies over counted wins: every complete win is also played, and
 * every played win is also started.
 */
export interface PlayRateCounts {
  /** Every counted win. */
  counted: number
  /** Any tier above `notStarted`. */
  started: number
  /** `played` or `complete`. */
  played: number
  complete: number
}

/** Play-required wins: sign-off beats Steam evidence, which beats nothing. */
export interface RequiredPlayCounts {
  /** Signed off in the Play Required sheet. */
  approved: number
  /** Not signed off, but a mod confirmed the play or Steam meets the played bar. */
  played: number
  unplayed: number
}

/**
 * Tallies for one set of wins. `overall` holds every counted win; `required`
 * splits the play-required ones; `ipb.submitted` counts wins with an
 * "I Play Bro" submission.
 */
export interface PlayRateTable {
  overall: PlayRateCounts
  required: RequiredPlayCounts
  ipb: { submitted: number }
}

export interface GroupPlayRate {
  /** Group-exclusive wins only. */
  exclusive: PlayRateTable
  /** Every counted win, shared and whitelist ones included. */
  all: PlayRateTable
  /** Wins left out because the game hasn't released. */
  unreleased: number
}

/** The fields of a won-game record that decide its progress tier. */
export type WinProgressInput = ConfirmedPlaySignal & {
  steam_play_data?: {
    playtime_minutes: number
    achievements_unlocked: number
    achievements_total: number
  }
}

type PlayData = NonNullable<WinProgressInput['steam_play_data']>

function meetsAchievementBar(play: PlayData): boolean {
  return (
    play.achievements_total > 0 &&
    play.achievements_unlocked * 100 >= play.achievements_total * GROUP_PLAY_RATE_ACHIEVEMENT_PERCENT
  )
}

function meetsPlaytimeBar(play: PlayData, hltbMainStoryHours?: number | null): boolean {
  const requiredMinutes =
    hltbMainStoryHours && hltbMainStoryHours > 0
      ? Math.min(hltbMainStoryHours * 60 * PLAYED_HLTB_FRACTION, PLAYED_HLTB_CAP_MINUTES)
      : UNKNOWN_LENGTH_PLAYED_MINUTES
  return requiredMinutes > 0 && play.playtime_minutes >= requiredMinutes
}

/** Progress-tier bar: achievements decide when the game has any, playtime otherwise. */
function meetsPlayedBar(play: PlayData, hltbMainStoryHours?: number | null): boolean {
  return play.achievements_total > 0
    ? meetsAchievementBar(play)
    : meetsPlaytimeBar(play, hltbMainStoryHours)
}

/**
 * Play-required bar: either the achievement or the playtime bar counts, so a
 * long game with few achievements still reads as in progress once played.
 */
export function meetsRequiredPlayBar(
  win: WinProgressInput,
  hltbMainStoryHours?: number | null,
): boolean {
  if (isConfirmedPlayed(win)) return true
  const play = win.steam_play_data
  if (!play) return false
  return meetsAchievementBar(play) || meetsPlaytimeBar(play, hltbMainStoryHours)
}

/**
 * Judged from the recorded numbers. `hltbMainStoryHours` is the game's
 * HowLongToBeat main-story length, when known. A game that has achievements
 * is judged by them alone; playtime only matters for games without any.
 */
export function classifyWinProgress(
  win: WinProgressInput,
  hltbMainStoryHours?: number | null,
): WinProgress {
  const play = win.steam_play_data
  if (play && play.achievements_total > 0 && play.achievements_unlocked >= play.achievements_total) {
    return 'complete'
  }
  if (play && meetsPlayedBar(play, hltbMainStoryHours)) return 'played'
  if (isConfirmedPlayed(win)) return 'played'
  if (play && (play.playtime_minutes > 0 || play.achievements_unlocked > 0)) return 'started'
  return 'notStarted'
}

function emptyCounts(): PlayRateCounts {
  return { counted: 0, started: 0, played: 0, complete: 0 }
}

function emptyTable(): PlayRateTable {
  return {
    overall: emptyCounts(),
    required: { approved: 0, played: 0, unplayed: 0 },
    ipb: { submitted: 0 },
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
  progress: WinProgress,
  steamPlayed: boolean,
  submitted: boolean,
): void {
  const { overall } = table
  overall.counted++
  if (progress !== 'notStarted') overall.started++
  if (progress === 'complete' || progress === 'played') overall.played++
  if (progress === 'complete') overall.complete++
  if (submitted) table.ipb.submitted++
  if (win.required_play) {
    const bucket: keyof RequiredPlayCounts = win.required_play_meta?.requirements_met
      ? 'approved'
      : steamPlayed
        ? 'played'
        : 'unplayed'
    table.required[bucket]++
  }
}

/**
 * Tallies every current member's wins by progress tier, once counting only
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

      const hltbHours = hltbHoursFor(giveaway)
      const progress = classifyWinProgress(win, hltbHours)
      const steamPlayed = meetsRequiredPlayBar(win, hltbHours)
      const shared = Boolean(giveaway.is_shared || giveaway.whitelist)
      const submitted = hasIpbSubmission(
        win,
        ipbDiscord?.wins[ipbDiscordWinKey(user.steam_id, win.link)],
      )
      tally(result.all, win, progress, steamPlayed, submitted)
      if (!shared) tally(result.exclusive, win, progress, steamPlayed, submitted)
    }
  }
  return result
}

/** A tier's share of counted wins, as a whole percentage. Null when there are none. */
export function playShare(
  counts: PlayRateCounts,
  tier: 'started' | 'played' | 'complete',
): number | null {
  return counts.counted === 0 ? null : Math.round((counts[tier] / counts.counted) * 100)
}

/**
 * Share of counted wins that are played (including complete), as a whole
 * percentage. Null when there are none.
 */
export function playRatePercent(counts: PlayRateCounts): number | null {
  return playShare(counts, 'played')
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
