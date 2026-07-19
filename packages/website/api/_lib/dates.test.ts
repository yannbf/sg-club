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
  it('accepts start < end, deadline defaulting to start', () => {
    const result = validateChallengeDates({ start: '2026-02-01', end: '2026-03-01' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.dates.signupDeadline).toBe(result.dates.start)
      expect(result.dates.start).toBeLessThan(result.dates.end)
    }
  })

  it('accepts an explicit deadline before start', () => {
    const result = validateChallengeDates({
      start: '2026-02-01',
      end: '2026-03-01',
      signupDeadline: '2026-01-25',
    })
    expect(result.ok).toBe(true)
  })

  it('accepts a deadline equal to start', () => {
    const result = validateChallengeDates({
      start: '2026-02-01',
      end: '2026-03-01',
      signupDeadline: '2026-02-01',
    })
    expect(result.ok).toBe(true)
  })

  it('rejects a deadline after start', () => {
    const result = validateChallengeDates({
      start: '2026-02-01',
      end: '2026-03-01',
      signupDeadline: '2026-02-05',
    })
    expect(result).toEqual({
      ok: false,
      error: 'Signup deadline must be at or before the start date.',
    })
  })

  it('rejects start >= end', () => {
    const result = validateChallengeDates({ start: '2026-03-01', end: '2026-03-01' })
    expect(result).toEqual({ ok: false, error: 'Start date must be before the end date.' })
  })

  it('rejects start after end', () => {
    const result = validateChallengeDates({ start: '2026-04-01', end: '2026-03-01' })
    expect(result).toEqual({ ok: false, error: 'Start date must be before the end date.' })
  })

  it('propagates an unparseable start date error', () => {
    const result = validateChallengeDates({ start: 'nope', end: '2026-03-01' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/^start:/)
  })

  it('propagates an unparseable end date error', () => {
    const result = validateChallengeDates({ start: '2026-02-01', end: 'nope' })
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
})
