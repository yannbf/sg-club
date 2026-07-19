import { describe, expect, it } from 'vitest'
import { parseAdminDate, validateChallengeDates } from './dates.js'

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
})
