import { describe, expect, it } from 'vitest'
import { parseAdminDate, parseDateRangeField, validateChallengeDates } from './dates.js'

describe('parseAdminDate', () => {
  it('parses YYYY-MM-DD as UTC midnight', () => {
    const result = parseAdminDate('2026-01-15')
    expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 0, 15) / 1000 })
  })

  it('parses YYYY-MM-DD HH:mm as UTC', () => {
    const result = parseAdminDate('2026-01-15 18:30')
    expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 0, 15, 18, 30) / 1000 })
  })

  it('parses a YYYY-MM-DDTHH:mm variant as UTC', () => {
    const result = parseAdminDate('2026-01-15T18:30')
    expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 0, 15, 18, 30) / 1000 })
  })

  it('parses full ISO 8601 with an explicit offset', () => {
    const result = parseAdminDate('2026-01-15T18:30:00-05:00')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.epochSeconds).toBe(Date.UTC(2026, 0, 15, 23, 30) / 1000)
    }
  })

  it('returns an error for empty input', () => {
    expect(parseAdminDate('   ')).toEqual({ ok: false, error: 'Date is required.' })
  })

  it('returns an error for unparseable input', () => {
    const result = parseAdminDate('not a date')
    expect(result.ok).toBe(false)
  })

  describe('month-name forms', () => {
    // Pin "now" to 2026-07-19 (a Sunday), matching this session's date.
    const NOW = Date.UTC(2026, 6, 19, 12, 0)

    it('parses "Aug 1" with an explicit year as midnight UTC', () => {
      const result = parseAdminDate('Aug 1 2026', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 7, 1) / 1000 })
    })

    it('parses the full month name "August 1"', () => {
      const result = parseAdminDate('August 1 2026', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 7, 1) / 1000 })
    })

    it('parses "1 Aug" (day-first)', () => {
      const result = parseAdminDate('1 Aug 2026', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 7, 1) / 1000 })
    })

    it('parses "1 August" (day-first, full name)', () => {
      const result = parseAdminDate('1 August 2026', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 7, 1) / 1000 })
    })

    it('is case-insensitive', () => {
      const result = parseAdminDate('aUg 1 2026', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 7, 1) / 1000 })
    })

    it('accepts an optional time suffix', () => {
      const result = parseAdminDate('Aug 1 2026 18:00', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 7, 1, 18, 0) / 1000 })
    })

    it('without a year, resolves to this year when the date is still upcoming', () => {
      // NOW is 2026-07-19; Aug 1 hasn't happened yet this year.
      const result = parseAdminDate('Aug 1', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 7, 1) / 1000 })
    })

    it('without a year, resolves to today when the date is today', () => {
      const result = parseAdminDate('Jul 19', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 6, 19) / 1000 })
    })

    it('without a year, rolls over to next year when the date has already passed', () => {
      // NOW is 2026-07-19; Jan 15 already happened this year.
      const result = parseAdminDate('Jan 15', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2027, 0, 15) / 1000 })
    })

    it('rejects an invalid day-of-month (e.g. Feb 30)', () => {
      const result = parseAdminDate('Feb 30 2026', NOW)
      expect(result.ok).toBe(false)
    })

    it('rejects an unrecognized month name', () => {
      const result = parseAdminDate('Augtober 1 2026', NOW)
      expect(result.ok).toBe(false)
    })
  })

  describe('today / tomorrow', () => {
    const NOW = Date.UTC(2026, 6, 19, 15, 30) // 2026-07-19 15:30 UTC

    it('parses "today" as midnight UTC of the current day', () => {
      const result = parseAdminDate('today', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 6, 19) / 1000 })
    })

    it('parses "tomorrow" as midnight UTC of the next day', () => {
      const result = parseAdminDate('tomorrow', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 6, 20) / 1000 })
    })

    it('is case-insensitive', () => {
      const result = parseAdminDate('TOMORROW', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 6, 20) / 1000 })
    })

    it('accepts an optional time suffix', () => {
      const result = parseAdminDate('tomorrow 18:00', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 6, 20, 18, 0) / 1000 })
    })

    it('rejects an invalid time suffix', () => {
      const result = parseAdminDate('tomorrow 25:00', NOW)
      expect(result.ok).toBe(false)
    })
  })

  describe('next <weekday>', () => {
    // 2026-07-19 is a Sunday.
    const SUNDAY = Date.UTC(2026, 6, 19, 12, 0)

    it('resolves to the next occurrence of a weekday later in the week', () => {
      const result = parseAdminDate('next friday', SUNDAY)
      // The following Friday is 2026-07-24.
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 6, 24) / 1000 })
    })

    it('skips today and resolves a full week ahead when today is that weekday', () => {
      const result = parseAdminDate('next sunday', SUNDAY)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 6, 26) / 1000 })
    })

    it('is case-insensitive', () => {
      const result = parseAdminDate('Next Friday', SUNDAY)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 6, 24) / 1000 })
    })

    it('accepts an optional time suffix', () => {
      const result = parseAdminDate('next friday 09:00', SUNDAY)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 6, 24, 9, 0) / 1000 })
    })

    it('rejects an unrecognized weekday', () => {
      const result = parseAdminDate('next funday', SUNDAY)
      expect(result.ok).toBe(false)
    })
  })

  describe('"at" keyword and bare-hour times', () => {
    // 2026-07-19 is a Sunday.
    const NOW = Date.UTC(2026, 6, 19, 12, 0)

    it('accepts "at" before a HH:mm time on "today"', () => {
      const result = parseAdminDate('today at 10:00', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 6, 19, 10, 0) / 1000 })
    })

    it('accepts a bare-hour time (no minutes) after "at" on a month-day form', () => {
      const result = parseAdminDate('July 13 at 12', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2027, 6, 13, 12, 0) / 1000 })
    })

    it('accepts a bare-hour time with no "at" keyword', () => {
      const result = parseAdminDate('tomorrow 9', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 6, 20, 9, 0) / 1000 })
    })

    it('accepts "at" before a bare-hour time on "next <weekday>"', () => {
      const result = parseAdminDate('next friday at 9', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 6, 24, 9, 0) / 1000 })
    })

    it('accepts "at" before a time on a plain YYYY-MM-DD date', () => {
      const result = parseAdminDate('2026-08-01 at 18', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 7, 1, 18, 0) / 1000 })
    })

    it('accepts "at" before a HH:mm time on a plain YYYY-MM-DD date', () => {
      const result = parseAdminDate('2026-08-01 at 18:30', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 7, 1, 18, 30) / 1000 })
    })

    it('rejects a bare-hour time outside 0-23 ("at 25")', () => {
      const result = parseAdminDate('today at 25', NOW)
      expect(result.ok).toBe(false)
    })

    it('rejects a bare-hour time outside 0-23 with no "at" keyword', () => {
      const result = parseAdminDate('today 25', NOW)
      expect(result.ok).toBe(false)
    })
  })

  describe('relative offsets (+Nd / +Nw / +Nm)', () => {
    const NOW = Date.UTC(2026, 6, 19, 15, 30) // 2026-07-19 15:30 UTC

    it('+Nd anchors off midnight UTC of "now" when no anchor is given', () => {
      const result = parseAdminDate('+2d', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 6, 21) / 1000 })
    })

    it('+Nw adds N weeks', () => {
      const result = parseAdminDate('+2w', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 7, 2) / 1000 })
    })

    it('+Nm adds N months', () => {
      const result = parseAdminDate('+1m', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 7, 19) / 1000 })
    })

    it('is case-insensitive for the unit letter', () => {
      const result = parseAdminDate('+2D', NOW)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 6, 21) / 1000 })
    })

    it('resolves relative to an explicit anchor instead of "now" when given', () => {
      const anchor = Date.UTC(2026, 7, 1) // 2026-08-01
      const result = parseAdminDate('+30d', NOW, anchor)
      expect(result).toEqual({ ok: true, epochSeconds: Date.UTC(2026, 7, 31) / 1000 })
    })
  })

  describe('ambiguous slash dates', () => {
    it('rejects "1/8"', () => {
      const result = parseAdminDate('1/8')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('ambiguous')
    })

    it('rejects "08/01/2026"', () => {
      const result = parseAdminDate('08/01/2026')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('ambiguous')
    })
  })
})

describe('parseDateRangeField', () => {
  it('splits on a unicode arrow surrounded by spaces', () => {
    const result = parseDateRangeField('2026-01-01 → 2026-02-01')
    expect(result).toEqual({ ok: true, start: '2026-01-01', end: '2026-02-01' })
  })

  it('splits on an ASCII arrow surrounded by spaces', () => {
    const result = parseDateRangeField('2026-01-01 -> 2026-02-01')
    expect(result).toEqual({ ok: true, start: '2026-01-01', end: '2026-02-01' })
  })

  it("splits on the standalone word 'to' surrounded by spaces", () => {
    const result = parseDateRangeField('2026-01-01 to 2026-02-01')
    expect(result).toEqual({ ok: true, start: '2026-01-01', end: '2026-02-01' })
  })

  it("splits on the standalone word 'till' surrounded by spaces", () => {
    const result = parseDateRangeField('2026-01-01 till 2026-02-01')
    expect(result).toEqual({ ok: true, start: '2026-01-01', end: '2026-02-01' })
  })

  it("splits on the standalone word 'until' surrounded by spaces", () => {
    const result = parseDateRangeField('2026-01-01 until 2026-02-01')
    expect(result).toEqual({ ok: true, start: '2026-01-01', end: '2026-02-01' })
  })

  it('is case-insensitive for the word separator', () => {
    const result = parseDateRangeField('2026-01-01 TO 2026-02-01')
    expect(result).toEqual({ ok: true, start: '2026-01-01', end: '2026-02-01' })
  })

  it('preserves a space-separated date+time on each side', () => {
    const result = parseDateRangeField('2026-01-01 18:30 → 2026-02-01 09:00')
    expect(result).toEqual({ ok: true, start: '2026-01-01 18:30', end: '2026-02-01 09:00' })
  })

  it('returns an error for empty input', () => {
    expect(parseDateRangeField('   ')).toEqual({ ok: false, error: 'Dates are required.' })
  })

  it('returns an error when no recognizable separator is present', () => {
    const result = parseDateRangeField('2026-01-01 2026-02-01')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Could not parse dates')
  })

  it('returns an error when one side of the separator is blank', () => {
    const result = parseDateRangeField('2026-01-01 → ')
    expect(result.ok).toBe(false)
  })
})

describe('validateChallengeDates', () => {
  // These fixture dates (Feb/Mar 2026) are only "future" relative to a fixed
  // point before them — pin `now` to 2026-01-01 so the new "start must be
  // today-or-future" / "end must be in the future" rules don't depend on the
  // real wall clock.
  const BEFORE_FIXTURES = Date.UTC(2026, 0, 1)

  it('accepts start < end, deadline defaulting to start', () => {
    const result = validateChallengeDates({ start: '2026-02-01', end: '2026-03-01' }, BEFORE_FIXTURES)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.dates.signupDeadline).toBe(result.dates.start)
      expect(result.dates.start).toBeLessThan(result.dates.end)
    }
  })

  it('accepts an explicit deadline before start', () => {
    const result = validateChallengeDates(
      {
        start: '2026-02-01',
        end: '2026-03-01',
        signupDeadline: '2026-01-25',
      },
      BEFORE_FIXTURES
    )
    expect(result.ok).toBe(true)
  })

  it('accepts a deadline equal to start', () => {
    const result = validateChallengeDates(
      {
        start: '2026-02-01',
        end: '2026-03-01',
        signupDeadline: '2026-02-01',
      },
      BEFORE_FIXTURES
    )
    expect(result.ok).toBe(true)
  })

  it('rejects a deadline after start', () => {
    const result = validateChallengeDates(
      {
        start: '2026-02-01',
        end: '2026-03-01',
        signupDeadline: '2026-02-05',
      },
      BEFORE_FIXTURES
    )
    expect(result).toEqual({
      ok: false,
      error: 'Signup deadline must be at or before the start date.',
    })
  })

  it('rejects start >= end', () => {
    const result = validateChallengeDates({ start: '2026-03-01', end: '2026-03-01' }, BEFORE_FIXTURES)
    expect(result).toEqual({ ok: false, error: 'Start date must be before the end date.' })
  })

  it('rejects start after end', () => {
    const result = validateChallengeDates({ start: '2026-04-01', end: '2026-03-01' }, BEFORE_FIXTURES)
    expect(result).toEqual({ ok: false, error: 'Start date must be before the end date.' })
  })

  it('propagates an unparseable start date error', () => {
    const result = validateChallengeDates({ start: 'nope', end: '2026-03-01' }, BEFORE_FIXTURES)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/^start:/)
  })

  it('propagates an unparseable end date error', () => {
    const result = validateChallengeDates({ start: '2026-02-01', end: 'nope' }, BEFORE_FIXTURES)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/^end:/)
  })

  describe('lenient forms + anchoring', () => {
    const NOW = Date.UTC(2026, 6, 19, 12, 0) // 2026-07-19

    it('anchors the end side\'s "+Nd" relative to the parsed start date, not "now"', () => {
      const result = validateChallengeDates({ start: 'Aug 1 2026', end: '+30d' }, NOW)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.dates.start).toBe(Date.UTC(2026, 7, 1) / 1000)
        expect(result.dates.end).toBe(Date.UTC(2026, 7, 31) / 1000)
      }
    })

    it('anchors the start side\'s "+Nd" relative to "now" (midnight UTC)', () => {
      const result = validateChallengeDates({ start: '+1w', end: '+2w' }, NOW)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.dates.start).toBe(Date.UTC(2026, 6, 26) / 1000)
      }
    })

    it('anchors signup_deadline\'s "+Nd" relative to "now", independent of the start anchor', () => {
      const result = validateChallengeDates(
        { start: 'Aug 1 2026', end: 'Sep 1 2026', signupDeadline: '+1w' },
        NOW
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.dates.signupDeadline).toBe(Date.UTC(2026, 6, 26) / 1000)
      }
    })

    it('accepts a mix of lenient forms across start/end', () => {
      const result = validateChallengeDates({ start: 'tomorrow', end: 'next friday' }, NOW)
      expect(result.ok).toBe(true)
    })

    it('rejects an ambiguous slash date on either side, with the field-prefixed friendly error', () => {
      const result = validateChallengeDates({ start: '1/8', end: '2026-03-01' }, NOW)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/^start:/)
        expect(result.error).toContain('ambiguous')
      }
    })
  })

  describe('immediate starts', () => {
    // 2026-07-19 is a Sunday, noon UTC.
    const NOW = Date.UTC(2026, 6, 19, 12, 0)

    it('allows a same-UTC-day start already in the past by clock time, treating it as immediate ("today to august 31")', () => {
      const range = parseDateRangeField('today to august 31')
      expect(range.ok).toBe(true)
      if (!range.ok) return
      const result = validateChallengeDates(range, NOW)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.dates.start).toBe(Date.UTC(2026, 6, 19) / 1000)
        expect(result.dates.end).toBe(Date.UTC(2026, 7, 31) / 1000)
      }
    })

    it('allows "<today\'s date> to <tomorrow>" typed on the same day ("July 20 to July 21")', () => {
      const SAME_DAY_NOW = Date.UTC(2026, 6, 20, 15, 0) // 2026-07-20 15:00 UTC
      const range = parseDateRangeField('July 20 to July 21')
      expect(range.ok).toBe(true)
      if (!range.ok) return
      const result = validateChallengeDates(range, SAME_DAY_NOW)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.dates.start).toBe(Date.UTC(2026, 6, 20) / 1000)
        expect(result.dates.end).toBe(Date.UTC(2026, 6, 21) / 1000)
      }
    })

    it('defaults signup_deadline to end for an immediate start ("today at 10:00 until august 31")', () => {
      const AFTER_TEN = Date.UTC(2026, 6, 19, 15, 0) // 2026-07-19 15:00 UTC, after 10:00
      const range = parseDateRangeField('today at 10:00 until august 31')
      expect(range.ok).toBe(true)
      if (!range.ok) return
      const result = validateChallengeDates(range, AFTER_TEN)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.dates.start).toBe(Date.UTC(2026, 6, 19, 10, 0) / 1000)
        expect(result.dates.end).toBe(Date.UTC(2026, 7, 31) / 1000)
        expect(result.dates.signupDeadline).toBe(result.dates.end)
      }
    })

    it('keeps defaulting signup_deadline to start for a future start ("July 20 10:00 till August 13 at 12")', () => {
      const BEFORE_TEN = Date.UTC(2026, 6, 20, 8, 0) // 2026-07-20 08:00 UTC, before 10:00
      const range = parseDateRangeField('July 20 10:00 till August 13 at 12')
      expect(range.ok).toBe(true)
      if (!range.ok) return
      const result = validateChallengeDates(range, BEFORE_TEN)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.dates.start).toBe(Date.UTC(2026, 6, 20, 10, 0) / 1000)
        expect(result.dates.end).toBe(Date.UTC(2026, 7, 13, 12, 0) / 1000)
        expect(result.dates.signupDeadline).toBe(result.dates.start)
      }
    })

    it('propagates a bare-hour validation error (e.g. "at 25") from either side of the range', () => {
      const result = validateChallengeDates({ start: 'today at 25', end: 'august 31' }, NOW)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/^start:/)
    })

    it('rejects a start strictly before today — a genuinely past date, not just earlier today', () => {
      const result = validateChallengeDates({ start: 'July 18 2026', end: 'august 31' }, NOW)
      expect(result).toEqual({ ok: false, error: 'Start date must be today or in the future.' })
    })

    it('rejects an end date that is not strictly in the future, even if it is after start', () => {
      const result = validateChallengeDates({ start: 'today', end: 'today at 06:00' }, NOW)
      expect(result).toEqual({ ok: false, error: 'End date must be in the future.' })
    })

    it('an explicitly-given deadline after start is still an error, even for an immediate start', () => {
      const result = validateChallengeDates(
        { start: 'today', end: 'august 31', signupDeadline: 'next friday' },
        NOW
      )
      expect(result).toEqual({
        ok: false,
        error: 'Signup deadline must be at or before the start date.',
      })
    })
  })
})
