// Single source of truth for required-play deadline maths and for deciding
// which required-play wins actually count against a member.
//
// Lives in api/_lib because that is the one directory all three consumers can
// import: the scraper (group-members.ts, via a relative path, as
// discord-warn-digest.ts already does), the serverless Discord handlers
// (mod-report.ts), and the Next.js UI (DeadlineStatus.tsx). Before this
// module each of those carried its own copy of the parser, and they disagreed
// on every format the spreadsheet actually contains.

/** The subset of a won giveaway these rules need. */
export interface RequiredPlayWin {
  end_timestamp: number
  required_play?: boolean
  /** Set by the scraper when the game had not released at scrape time. */
  unreleased?: boolean
  required_play_meta?: {
    requirements_met?: boolean
    deadline?: string
    deadline_in_months?: number
  }
}

/** Months allowed to fulfil a play requirement when the sheet doesn't say. */
const DEFAULT_DEADLINE_MONTHS = 2

/**
 * Parses a hand-entered deadline from the proof-of-play spreadsheet.
 *
 * The column is labelled `DEADLINE (dd-mm-yyyy)` but is free text, so the
 * values in circulation are day-first with any of `.`, `-` or `/` as the
 * separator, with or without leading zeros (`15-12-2026`, `30.6.2026`), and
 * occasionally nonsense (`31.21.2025` — month 21). Anything that isn't a real
 * calendar date returns null so the caller falls back to the months-based
 * deadline; rolling `month 21` over into the next year, as a bare `new Date`
 * does, silently pushes the deadline ~9 months out and hides the win.
 *
 * Returns the last instant of that local day — the whole day is still time
 * to play.
 */
export function parseHandEnteredDeadline(raw: string): Date | null {
  const parts = raw.trim().split(/[.\-/]/)
  if (parts.length !== 3) return null

  const [day, month, year] = parts.map((part) => Number(part))
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 2100) return null

  const date = new Date(year, month - 1, day, 23, 59, 59, 999)
  // Rejects days that don't exist in that month (31.02.2026 would roll into March).
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}

/**
 * The deadline to fulfil a win's play requirement: an explicit, parseable
 * spreadsheet deadline wins; otherwise the giveaway's end date plus
 * `deadline_in_months` (default 2, and 0 treated as unset rather than "due
 * immediately").
 */
export function requiredPlayDeadline(win: RequiredPlayWin): Date {
  const meta = win.required_play_meta
  if (meta?.deadline) {
    const parsed = parseHandEnteredDeadline(meta.deadline)
    if (parsed) return parsed
  }

  const months = meta?.deadline_in_months || DEFAULT_DEADLINE_MONTHS
  const deadline = new Date(win.end_timestamp * 1000)
  deadline.setMonth(deadline.getMonth() + months)
  return deadline
}

/** `requiredPlayDeadline` as unix seconds, for Discord `<t:…>` timestamps. */
export function requiredPlayDeadlineSec(win: RequiredPlayWin): number {
  return Math.floor(requiredPlayDeadline(win).getTime() / 1000)
}

/**
 * Whether a won giveaway counts as an outstanding play requirement.
 *
 * A game that has not released yet is excluded: the member cannot play it, so
 * counting it toward the unplayed total, the "2 unfulfilled ⇒ stop entering"
 * rule, or any deadline warning penalises them for Steam's release schedule.
 * Its deadline only starts meaning something once the game is out, at which
 * point the scraper drops the `unreleased` flag and it counts normally.
 */
export function isUnfulfilledRequiredPlay(win: RequiredPlayWin): boolean {
  return Boolean(win.required_play) && !win.required_play_meta?.requirements_met && !win.unreleased
}

/** Whole days from now until the deadline; negative once it has passed. */
export function daysUntilDeadline(win: RequiredPlayWin, now: Date = new Date()): number {
  const ms = requiredPlayDeadline(win).getTime() - now.getTime()
  return Math.floor(ms / (24 * 60 * 60 * 1000))
}

/** How far ahead a deadline is flagged as "coming up" rather than merely future. */
export const DEADLINE_WARNING_DAYS = 15
