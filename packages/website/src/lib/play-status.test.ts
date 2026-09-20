import { describe, expect, it } from 'vitest'
import {
  isConfirmedPlayed,
  unplayedLabel,
  unplayedReason,
  PLAYED_ACHIEVEMENT_PERCENT,
  PLAYED_HLTB_FRACTION,
  PLAYED_HLTB_CAP_MINUTES,
  UNKNOWN_LENGTH_PLAYED_MINUTES,
} from '@/lib/play-status'
import {
  PLAYED_ACHIEVEMENT_PERCENT as SCRAPER_PLAYED_ACHIEVEMENT_PERCENT,
  PLAYED_HLTB_FRACTION as SCRAPER_PLAYED_HLTB_FRACTION,
  PLAYED_HLTB_CAP_MINUTES as SCRAPER_PLAYED_HLTB_CAP_MINUTES,
  UNKNOWN_LENGTH_PLAYED_MINUTES as SCRAPER_UNKNOWN_LENGTH_PLAYED_MINUTES,
} from '../../../scraper/src/utils/played'

describe('isConfirmedPlayed', () => {
  it('is true when "I played, bro" was attested', () => {
    expect(isConfirmedPlayed({ i_played_bro: true })).toBe(true)
  })

  it('is true when a play requirement was signed off', () => {
    expect(
      isConfirmedPlayed({ required_play_meta: { requirements_met: true } }),
    ).toBe(true)
  })

  it('is false with neither signal', () => {
    expect(isConfirmedPlayed({})).toBe(false)
  })
})

describe('unplayedLabel', () => {
  it('is "Never played" with zero playtime and zero achievements', () => {
    expect(
      unplayedLabel({ playtime_minutes: 0, achievements_unlocked: 0 }),
    ).toBe('Never played')
  })

  it('is "Never played" when given undefined', () => {
    expect(unplayedLabel(undefined)).toBe('Never played')
  })

  it('is "Never played" when given null', () => {
    expect(unplayedLabel(null)).toBe('Never played')
  })

  it('is "Barely played" with recorded playtime only', () => {
    expect(
      unplayedLabel({ playtime_minutes: 60, achievements_unlocked: 0 }),
    ).toBe('Barely played')
  })

  it('is "Barely played" with unlocked achievements only', () => {
    expect(
      unplayedLabel({ playtime_minutes: 0, achievements_unlocked: 3 }),
    ).toBe('Barely played')
  })

  it('is "Barely played" for an achievement-less game under the HLTB/2h bar', () => {
    expect(
      unplayedLabel({ playtime_minutes: 30, achievements_unlocked: 0 }),
    ).toBe('Barely played')
  })

  it('is "Never played" with zero playtime and zero achievements (restated)', () => {
    expect(
      unplayedLabel({ playtime_minutes: 0, achievements_unlocked: 0 }),
    ).toBe('Never played')
  })
})

describe('threshold parity with the scraper', () => {
  it('mirrors the thresholds in packages/scraper/src/utils/played.ts', () => {
    expect(PLAYED_ACHIEVEMENT_PERCENT).toBe(SCRAPER_PLAYED_ACHIEVEMENT_PERCENT)
    expect(PLAYED_HLTB_FRACTION).toBe(SCRAPER_PLAYED_HLTB_FRACTION)
    expect(PLAYED_HLTB_CAP_MINUTES).toBe(SCRAPER_PLAYED_HLTB_CAP_MINUTES)
    expect(UNKNOWN_LENGTH_PLAYED_MINUTES).toBe(
      SCRAPER_UNKNOWN_LENGTH_PLAYED_MINUTES,
    )
  })
})

describe('unplayedReason', () => {
  it('reports nothing recorded when there is no playtime or achievements', () => {
    expect(unplayedReason({ playtime_minutes: 0, achievements_unlocked: 0 })).toBe(
      'No playtime or achievements recorded on Steam.',
    )
  })

  it('reports nothing recorded for an untouched game that has achievements', () => {
    expect(
      unplayedReason({ playtime_minutes: 0, achievements_unlocked: 0, achievements_total: 20 }),
    ).toBe('No playtime or achievements recorded on Steam.')
  })

  it('reports nothing recorded for null/undefined play data', () => {
    expect(unplayedReason(null)).toBe('No playtime or achievements recorded on Steam.')
    expect(unplayedReason(undefined)).toBe(
      'No playtime or achievements recorded on Steam.',
    )
  })

  it('reports the achievement percentage when the game has achievements', () => {
    expect(
      unplayedReason({ achievements_unlocked: 3, achievements_total: 20 }),
    ).toBe('3/20 achievements (15%) — 25% needed to count as played.')
  })

  it('floors the achievement percentage instead of rounding up to the threshold', () => {
    // 49/200 = 24.5%, which Math.round would push to 25% — reading as met.
    expect(
      unplayedReason({ achievements_unlocked: 49, achievements_total: 200 }),
    ).toBe('49/200 achievements (24%) — 25% needed to count as played.')
  })

  it('reports playtime vs. the HLTB-derived requirement when known', () => {
    expect(
      unplayedReason({ playtime_minutes: 45, achievements_unlocked: 0 }, 10),
    ).toBe(
      '45m played — 2h 30m needed to count as played (25% of the 10h HowLongToBeat main story).',
    )
  })

  it('reports the 15h cap instead of the 25% clause once HLTB length is long enough', () => {
    expect(
      unplayedReason({ playtime_minutes: 45, achievements_unlocked: 0 }, 100),
    ).toBe('45m played — 15h needed to count as played (capped at 15h).')
  })

  it('reports playtime vs. the flat 2h bar when no HLTB length is known', () => {
    expect(
      unplayedReason({ playtime_minutes: 45, achievements_unlocked: 0 }, null),
    ).toBe(
      '45m played — 2h needed to count as played (no achievements or HowLongToBeat length to measure against).',
    )
  })
})
