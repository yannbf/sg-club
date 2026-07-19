// Parses admin-entered dates for /challenge-setup. Errors are returned, not
// thrown, so callers can render them straight into an ephemeral reply.

export type DateParseResult =
  | { ok: true; epochSeconds: number }
  | { ok: false; error: string }

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
// Time may be given as "HH:mm" or a bare hour ("18"), optionally preceded by
// the word "at" ("2026-08-01 at 18", "2026-08-01 at 18:30").
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})[ T](?:at\s+)?(\d{1,2}(?::\d{2})?)$/i
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}T/

// Rejects bare numeric slash dates ("1/8", "08/01/2026") outright — the
// group is international and D/M vs M/D is genuinely ambiguous, so we never
// guess. This must run before anything else since a permissive fallback
// parser could otherwise "succeed" at guessing wrong.
const AMBIGUOUS_SLASH = /^\d{1,4}\/\d{1,2}(?:\/\d{1,4})?$/

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

// Time suffix: "HH:mm" or a bare hour ("18"), optionally preceded by "at"
// ("today at 10:00", "next friday at 9", "July 13 at 12").
const TIME_SUFFIX_RE = /^(\d{1,2})(?::(\d{2}))?$/
const OFFSET_RE = /^\+(\d+)(d|w|m)$/i
const TODAY_TOMORROW_RE = /^(today|tomorrow)(?:\s+(?:at\s+)?(\d{1,2}(?::\d{2})?))?$/i
const NEXT_WEEKDAY_RE = /^next\s+([a-z]+)(?:\s+(?:at\s+)?(\d{1,2}(?::\d{2})?))?$/i
const MONTH_DAY_RE = /^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?(?:\s+(?:at\s+)?(\d{1,2}(?::\d{2})?))?$/i
const DAY_MONTH_RE = /^(\d{1,2})\s+([a-z]+)(?:,?\s+(\d{4}))?(?:\s+(?:at\s+)?(\d{1,2}(?::\d{2})?))?$/i

const ACCEPTED_FORMS_HINT =
  'YYYY-MM-DD, YYYY-MM-DD HH:mm, ISO 8601, "Aug 1" / "1 August 2026", "today" / ' +
  '"tomorrow 18:00", "next friday", or a relative offset like "+2w" / "+3d" / "+1m"'

function friendlyError(input: string): DateParseResult {
  return { ok: false, error: `Could not parse date "${input}". Use ${ACCEPTED_FORMS_HINT}.` }
}

/**
 * Full month name or any unambiguous prefix of ≥3 letters ("aug", "sept",
 * "septem"), case-insensitive. All ≥3-letter prefixes of the 12 months are
 * unique, so prefix matching can't mis-resolve.
 */
function monthIndex(name: string): number {
  const lower = name.toLowerCase()
  const exact = MONTH_NAMES.indexOf(lower)
  if (exact !== -1) return exact
  if (lower.length >= 3) return MONTH_NAMES.findIndex((m) => m.startsWith(lower))
  return -1
}

function weekdayIndex(name: string): number {
  return WEEKDAY_NAMES.indexOf(name.toLowerCase())
}

/**
 * `undefined` text means "no time given" (midnight). `null` means invalid.
 * Accepts "HH:mm" or a bare hour ("18", minute defaults to 0) — any leading
 * "at " is expected to already be stripped by the caller's regex.
 */
function parseTimeSuffix(text: string | undefined): { hour: number; minute: number } | null {
  if (!text) return { hour: 0, minute: 0 }
  const match = TIME_SUFFIX_RE.exec(text)
  if (!match) return null
  const hour = Number(match[1])
  const minute = match[2] !== undefined ? Number(match[2]) : 0
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

function startOfUtcDay(epochMs: number): number {
  const d = new Date(epochMs)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function addUtcDays(epochMs: number, days: number): number {
  return epochMs + days * 86_400_000
}

function addUtcMonths(epochMs: number, months: number): number {
  const d = new Date(epochMs)
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth() + months,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds()
  )
}

/**
 * Accepts, all interpreted as UTC:
 *  - `YYYY-MM-DD`, `YYYY-MM-DD HH:mm`, and ISO 8601 (unchanged from before —
 *    ISO 8601 with an explicit offset is honored as-is, e.g.
 *    `2026-01-01T00:00:00-05:00`).
 *  - Month-name forms: "Aug 1", "August 1", "1 Aug", "1 August", with an
 *    optional year ("Aug 1 2026") and optional time suffix ("Aug 1 18:00").
 *    Without a year, resolves to the next occurrence: this year if the date
 *    is today-or-future (by calendar date, UTC), otherwise next year.
 *  - "today" / "tomorrow" (midnight UTC), with an optional time suffix
 *    ("tomorrow 18:00").
 *  - "next <weekday>" (e.g. "next friday"): the next occurrence of that
 *    weekday strictly after today (UTC), with an optional time suffix.
 *  - Relative offsets "+Nd" / "+Nw" / "+Nm" (days/weeks/months), resolved
 *    against `anchor` if given, else midnight UTC of `now`.
 *  - Time suffixes (wherever accepted above, plus after a plain
 *    `YYYY-MM-DD`) may be preceded by the word "at" ("today at 10:00", "July
 *    13 at 12"), and may be a bare hour with no minute ("12" → 12:00,
 *    validated 0-23).
 *  - Deliberately NOT accepted: ambiguous numeric slash dates like "1/8" —
 *    this is an international group and D/M vs M/D is genuinely ambiguous.
 *
 * `now` defaults to `Date.now()`; pass it explicitly in tests to pin "today"
 * / "tomorrow" / "next <weekday>" / year-rollover / offset resolution.
 * `anchor` (epoch ms) is only consulted for the "+N_" relative-offset forms
 * — callers computing the END of a range should pass the parsed START's
 * epoch so "aug 1 to +30d" resolves relative to Aug 1, not to `now`.
 */
export function parseAdminDate(input: string, now: number = Date.now(), anchor?: number): DateParseResult {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, error: 'Date is required.' }

  if (AMBIGUOUS_SLASH.test(trimmed)) {
    return {
      ok: false,
      error: `Could not parse date "${input}" — ambiguous "/" dates aren't accepted (unclear if it's D/M or M/D). Use ${ACCEPTED_FORMS_HINT}.`,
    }
  }

  if (DATE_ONLY.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00Z`)
    if (!Number.isNaN(parsed.getTime())) return { ok: true, epochSeconds: Math.floor(parsed.getTime() / 1000) }
  } else {
    const dateTimeMatch = DATE_TIME.exec(trimmed)
    if (dateTimeMatch) {
      const time = parseTimeSuffix(dateTimeMatch[2])
      if (!time) return friendlyError(input)
      const parsed = new Date(`${dateTimeMatch[1]}T00:00:00Z`)
      if (!Number.isNaN(parsed.getTime())) {
        const ms = parsed.getTime() + time.hour * 3_600_000 + time.minute * 60_000
        return { ok: true, epochSeconds: Math.floor(ms / 1000) }
      }
    }
  }

  const offsetMatch = OFFSET_RE.exec(trimmed)
  if (offsetMatch) {
    const amount = Number(offsetMatch[1])
    const unit = offsetMatch[2]!.toLowerCase()
    const anchorMs = anchor ?? startOfUtcDay(now)
    const resultMs =
      unit === 'd' ? addUtcDays(anchorMs, amount) : unit === 'w' ? addUtcDays(anchorMs, amount * 7) : addUtcMonths(anchorMs, amount)
    return { ok: true, epochSeconds: Math.floor(resultMs / 1000) }
  }

  const todayMatch = TODAY_TOMORROW_RE.exec(trimmed)
  if (todayMatch) {
    const time = parseTimeSuffix(todayMatch[2])
    if (!time) return friendlyError(input)
    const dayOffset = todayMatch[1]!.toLowerCase() === 'tomorrow' ? 1 : 0
    const ms = addUtcDays(startOfUtcDay(now), dayOffset) + time.hour * 3_600_000 + time.minute * 60_000
    return { ok: true, epochSeconds: Math.floor(ms / 1000) }
  }

  const nextWeekdayMatch = NEXT_WEEKDAY_RE.exec(trimmed)
  if (nextWeekdayMatch) {
    const wd = weekdayIndex(nextWeekdayMatch[1]!)
    if (wd === -1) return friendlyError(input)
    const time = parseTimeSuffix(nextWeekdayMatch[2])
    if (!time) return friendlyError(input)
    const base = startOfUtcDay(now)
    const currentWd = new Date(base).getUTCDay()
    let delta = wd - currentWd
    if (delta <= 0) delta += 7 // strictly after today, even if today is that weekday
    const ms = addUtcDays(base, delta) + time.hour * 3_600_000 + time.minute * 60_000
    return { ok: true, epochSeconds: Math.floor(ms / 1000) }
  }

  const monthDay =
    parseMonthDayMatch(MONTH_DAY_RE.exec(trimmed), 1, 2, 3, 4) ??
    parseMonthDayMatch(DAY_MONTH_RE.exec(trimmed), 2, 1, 3, 4)
  if (monthDay) {
    const { month, day, year, time: timeText } = monthDay
    if (day < 1 || day > 31) return friendlyError(input)
    const time = parseTimeSuffix(timeText)
    if (!time) return friendlyError(input)

    let resolvedYear: number
    if (year !== undefined) {
      resolvedYear = Number(year)
    } else {
      const currentYear = new Date(now).getUTCFullYear()
      const candidateDayMs = Date.UTC(currentYear, month, day)
      resolvedYear = candidateDayMs >= startOfUtcDay(now) ? currentYear : currentYear + 1
    }

    const ms = Date.UTC(resolvedYear, month, day, time.hour, time.minute)
    const roundTrip = new Date(ms)
    // Guard against JS's silent rollover for an invalid day-in-month (e.g. Feb 30).
    if (roundTrip.getUTCMonth() !== month || roundTrip.getUTCDate() !== day) return friendlyError(input)

    return { ok: true, epochSeconds: Math.floor(ms / 1000) }
  }

  if (ISO_LIKE.test(trimmed)) {
    const parsed = new Date(trimmed)
    if (!Number.isNaN(parsed.getTime())) return { ok: true, epochSeconds: Math.floor(parsed.getTime() / 1000) }
  }

  return friendlyError(input)
}

interface MonthDayFields {
  month: number
  day: number
  year?: string
  time?: string
}

/**
 * Shared by the "Month Day" and "Day Month" regexes: pulls the month-name
 * group through `monthIndex`, and returns `null` if the match failed or the
 * month name isn't recognized.
 */
function parseMonthDayMatch(
  match: RegExpExecArray | null,
  monthGroup: number,
  dayGroup: number,
  yearGroup: number,
  timeGroup: number
): MonthDayFields | null {
  if (!match) return null
  const month = monthIndex(match[monthGroup]!)
  if (month === -1) return null
  return { month, day: Number(match[dayGroup]), year: match[yearGroup], time: match[timeGroup] }
}

export type DateRangeSplitResult =
  | { ok: true; start: string; end: string }
  | { ok: false; error: string }

const DATE_RANGE_SEPARATOR = /\s+(?:→|->|to|till|until)\s+/i

/**
 * Splits a single "Dates (UTC)" modal field into start/end date strings, on
 * whichever of `→`, `->`, or the standalone word `to`/`till`/`until`
 * (surrounded by whitespace) the admin used. Each side is handed to
 * `parseAdminDate` unparsed — this function only handles splitting the
 * combined field.
 */
export function parseDateRangeField(input: string): DateRangeSplitResult {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, error: 'Dates are required.' }

  const match = trimmed.match(DATE_RANGE_SEPARATOR)
  if (!match) {
    return {
      ok: false,
      error: `Could not parse dates "${input}". Use "<start> → <end>" or "<start> to <end>".`,
    }
  }

  const matchIndex = match.index ?? 0
  const start = trimmed.slice(0, matchIndex).trim()
  const end = trimmed.slice(matchIndex + match[0].length).trim()
  if (!start || !end) {
    return {
      ok: false,
      error: `Could not parse dates "${input}". Use "<start> → <end>" or "<start> to <end>".`,
    }
  }

  return { ok: true, start, end }
}

export interface ChallengeDates {
  signupDeadline: number
  start: number
  end: number
}

export type ChallengeDatesResult =
  | { ok: true; dates: ChallengeDates }
  | { ok: false; error: string }

/**
 * Validates the trio of dates used by /challenge-setup.
 *
 * `now` is threaded through to `parseAdminDate` for every side (pin it in
 * tests). The end date's relative-offset forms ("+30d" etc.) anchor off the
 * parsed start date rather than `now`, so "aug 1 to +30d" means 30 days
 * after Aug 1 — the start side and signup_deadline anchor off `now` instead.
 *
 * Immediate starts: a start strictly before *today's* UTC calendar day is
 * rejected, but a start anywhere within today — even earlier today, i.e.
 * already in the past by clock time — is allowed and treated as the
 * challenge starting immediately (e.g. "today", or "July 20" typed on
 * July 20). The end date must still be strictly after start AND strictly in
 * the future.
 *
 * signupDeadline defaults to `start` when omitted — *unless* the resolved
 * start is already at-or-before `now` (an immediate start), in which case it
 * defaults to `end` instead, so signups stay open for the remainder of an
 * already-running challenge (owner-approved). An explicit signupDeadline is
 * always validated against the old `deadline <= start` ordering rule
 * regardless of immediate-start-ness.
 */
export function validateChallengeDates(
  input: { start: string; end: string; signupDeadline?: string },
  now: number = Date.now()
): ChallengeDatesResult {
  const startResult = parseAdminDate(input.start, now)
  if (!startResult.ok) return { ok: false, error: `start: ${startResult.error}` }

  const endResult = parseAdminDate(input.end, now, startResult.epochSeconds * 1000)
  if (!endResult.ok) return { ok: false, error: `end: ${endResult.error}` }

  const { epochSeconds: start } = startResult
  const { epochSeconds: end } = endResult
  const nowSeconds = Math.floor(now / 1000)
  const startOfTodaySeconds = Math.floor(startOfUtcDay(now) / 1000)

  if (start < startOfTodaySeconds) {
    return { ok: false, error: 'Start date must be today or in the future.' }
  }

  const isImmediateStart = start <= nowSeconds
  const deadlineGiven = Boolean(input.signupDeadline)
  const deadlineResult = deadlineGiven
    ? parseAdminDate(input.signupDeadline!, now)
    : isImmediateStart
      ? endResult
      : startResult
  if (!deadlineResult.ok) {
    return { ok: false, error: `signup_deadline: ${deadlineResult.error}` }
  }

  const { epochSeconds: signupDeadline } = deadlineResult

  if (deadlineGiven && signupDeadline > start) {
    return { ok: false, error: 'Signup deadline must be at or before the start date.' }
  }
  if (start >= end) {
    return { ok: false, error: 'Start date must be before the end date.' }
  }
  if (end <= nowSeconds) {
    return { ok: false, error: 'End date must be in the future.' }
  }

  return { ok: true, dates: { signupDeadline, start, end } }
}
