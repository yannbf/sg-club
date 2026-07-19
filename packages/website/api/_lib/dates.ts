// Parses admin-entered dates for /challenge-setup. Errors are returned, not
// thrown, so callers can render them straight into an ephemeral reply.

export type DateParseResult =
  | { ok: true; epochSeconds: number }
  | { ok: false; error: string }

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/

/**
 * Accepts `YYYY-MM-DD`, `YYYY-MM-DD HH:mm`, and ISO 8601. Interpreted as UTC
 * unless the input already carries an offset (only possible via the ISO 8601
 * path, e.g. `2026-01-01T00:00:00-05:00`).
 */
export function parseAdminDate(input: string): DateParseResult {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, error: 'Date is required.' }

  let isoCandidate = trimmed
  if (DATE_ONLY.test(trimmed)) {
    isoCandidate = `${trimmed}T00:00:00Z`
  } else if (DATE_TIME.test(trimmed)) {
    isoCandidate = `${trimmed.replace(' ', 'T')}:00Z`
  }
  // Otherwise assume it's already ISO 8601 (with or without an offset) and
  // let Date parse it as-is.

  const parsed = new Date(isoCandidate)
  if (Number.isNaN(parsed.getTime())) {
    return {
      ok: false,
      error: `Could not parse date "${input}". Use YYYY-MM-DD, YYYY-MM-DD HH:mm, or ISO 8601.`,
    }
  }
  return { ok: true, epochSeconds: Math.floor(parsed.getTime() / 1000) }
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
 * Validates the trio of dates used by /challenge-setup. signupDeadline
 * defaults to start when omitted. Ordering rule: deadline <= start < end.
 */
export function validateChallengeDates(input: {
  start: string
  end: string
  signupDeadline?: string
}): ChallengeDatesResult {
  const startResult = parseAdminDate(input.start)
  if (!startResult.ok) return { ok: false, error: `start: ${startResult.error}` }

  const endResult = parseAdminDate(input.end)
  if (!endResult.ok) return { ok: false, error: `end: ${endResult.error}` }

  const deadlineResult = input.signupDeadline
    ? parseAdminDate(input.signupDeadline)
    : startResult
  if (!deadlineResult.ok) {
    return { ok: false, error: `signup_deadline: ${deadlineResult.error}` }
  }

  const { epochSeconds: start } = startResult
  const { epochSeconds: end } = endResult
  const { epochSeconds: signupDeadline } = deadlineResult

  if (signupDeadline > start) {
    return { ok: false, error: 'Signup deadline must be at or before the start date.' }
  }
  if (start >= end) {
    return { ok: false, error: 'Start date must be before the end date.' }
  }

  return { ok: true, dates: { signupDeadline, start, end } }
}
