import { describe, expect, it } from 'vitest'
import {
  daysUntilDeadline,
  isUnfulfilledRequiredPlay,
  parseHandEnteredDeadline,
  requiredPlayDeadline,
} from './required-play'

/** Fixture giveaway end date, in unix seconds (decodes to a June 28 17:00 UTC). */
const END = 1782666000

describe('parseHandEnteredDeadline', () => {
  it('parses the documented dd.MM.yyyy form as the last instant of that local day', () => {
    const parsed = parseHandEnteredDeadline('31.12.2025')!
    expect(parsed.getFullYear()).toBe(2025)
    expect(parsed.getMonth()).toBe(11)
    expect(parsed.getDate()).toBe(31)
    expect(parsed.getHours()).toBe(23)
    expect(parsed.getMinutes()).toBe(59)
  })

  it('parses the dash form the spreadsheet column header actually asks for', () => {
    const parsed = parseHandEnteredDeadline('15-12-2026')!
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(11)
    expect(parsed.getDate()).toBe(15)
  })

  it('parses slashes too', () => {
    const parsed = parseHandEnteredDeadline('24/11/2026')!
    expect(parsed.getMonth()).toBe(10)
    expect(parsed.getDate()).toBe(24)
  })

  it('parses values written without leading zeros', () => {
    const parsed = parseHandEnteredDeadline('5.4.2026')!
    expect(parsed.getMonth()).toBe(3)
    expect(parsed.getDate()).toBe(5)
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseHandEnteredDeadline('  30.6.2026 ')?.getMonth()).toBe(5)
  })

  it('rejects an out-of-range month instead of rolling it into a later year', () => {
    // A bare `new Date(2025, 20, 31)` silently becomes September 2026, which
    // pushes the deadline ~9 months out and hides the win from every warning.
    expect(parseHandEnteredDeadline('31.21.2025')).toBeNull()
  })

  it('rejects a day that does not exist in that month', () => {
    expect(parseHandEnteredDeadline('31.02.2026')).toBeNull()
  })

  it('rejects values that are not three numeric parts', () => {
    expect(parseHandEnteredDeadline('')).toBeNull()
    expect(parseHandEnteredDeadline('soon')).toBeNull()
    expect(parseHandEnteredDeadline('12.2026')).toBeNull()
    expect(parseHandEnteredDeadline('1.2.3.4')).toBeNull()
    expect(parseHandEnteredDeadline('aa.bb.cccc')).toBeNull()
  })
})

describe('requiredPlayDeadline', () => {
  it('uses an explicit deadline over the months-based one', () => {
    const deadline = requiredPlayDeadline({
      end_timestamp: END,
      required_play_meta: { deadline: '15-12-2026', deadline_in_months: 2 },
    })
    expect(deadline.getFullYear()).toBe(2026)
    expect(deadline.getMonth()).toBe(11)
    expect(deadline.getDate()).toBe(15)
  })

  it('falls back to end date + deadline_in_months when the deadline is unparseable', () => {
    const deadline = requiredPlayDeadline({
      end_timestamp: END,
      required_play_meta: { deadline: '31.21.2025', deadline_in_months: 4 },
    })
    const expected = new Date(END * 1000)
    expected.setMonth(expected.getMonth() + 4)
    expect(deadline.getTime()).toBe(expected.getTime())
  })

  it('defaults to 2 months when no deadline info is present', () => {
    const deadline = requiredPlayDeadline({ end_timestamp: END })
    const expected = new Date(END * 1000)
    expected.setMonth(expected.getMonth() + 2)
    expect(deadline.getTime()).toBe(expected.getTime())
  })

  it('treats 0 months as unset rather than as due on the end date', () => {
    const zero = requiredPlayDeadline({
      end_timestamp: END,
      required_play_meta: { deadline_in_months: 0 },
    })
    expect(zero.getTime()).toBe(requiredPlayDeadline({ end_timestamp: END }).getTime())
  })
})

describe('daysUntilDeadline', () => {
  it('counts whole days remaining', () => {
    const now = new Date(2026, 11, 10, 12, 0, 0)
    const win = { end_timestamp: END, required_play_meta: { deadline: '15-12-2026' } }
    expect(daysUntilDeadline(win, now)).toBe(5)
  })

  it('goes negative once the deadline has passed', () => {
    const now = new Date(2026, 11, 20, 12, 0, 0)
    const win = { end_timestamp: END, required_play_meta: { deadline: '15-12-2026' } }
    expect(daysUntilDeadline(win, now)).toBe(-5)
  })
})

describe('isUnfulfilledRequiredPlay', () => {
  it('counts a required-play win whose requirements are unmet', () => {
    expect(
      isUnfulfilledRequiredPlay({
        end_timestamp: END,
        required_play: true,
        required_play_meta: { requirements_met: false },
      })
    ).toBe(true)
  })

  it('does not count a win with no play requirement', () => {
    expect(isUnfulfilledRequiredPlay({ end_timestamp: END })).toBe(false)
  })

  it('does not count a win whose requirements are met', () => {
    expect(
      isUnfulfilledRequiredPlay({
        end_timestamp: END,
        required_play: true,
        required_play_meta: { requirements_met: true },
      })
    ).toBe(false)
  })

  it('does not count a game that has not released yet', () => {
    expect(
      isUnfulfilledRequiredPlay({
        end_timestamp: END,
        required_play: true,
        unreleased: true,
        required_play_meta: { requirements_met: false },
      })
    ).toBe(false)
  })
})
