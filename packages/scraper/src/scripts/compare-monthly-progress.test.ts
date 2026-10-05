import { describe, expect, it } from 'vitest'
import {
  computeWinProgress,
  hasPlayEvidence,
  isBaselineUnknown,
} from './compare-monthly-progress.js'

const UNREADABLE = {
  playtime_minutes: 0,
  achievements_unlocked: 0,
  has_no_available_stats: true,
  no_stats_reason: 'library_unavailable',
}

describe('hasPlayEvidence', () => {
  it('is true for playtime or achievements and false otherwise', () => {
    expect(hasPlayEvidence({ playtime_minutes: 1 })).toBe(true)
    expect(hasPlayEvidence({ achievements_unlocked: 1 })).toBe(true)
    expect(hasPlayEvidence({ playtime_minutes: 0, achievements_unlocked: 0 })).toBe(false)
    expect(hasPlayEvidence(undefined)).toBe(false)
  })
})

describe('isBaselineUnknown', () => {
  it('treats an unreadable library with no evidence as unknown', () => {
    expect(isBaselineUnknown(UNREADABLE)).toBe(true)
  })

  it('treats a flagged stats-less read with no reason as unknown', () => {
    expect(isBaselineUnknown({ playtime_minutes: 0, has_no_available_stats: true })).toBe(true)
  })

  it('treats a win present without a stats object as unknown', () => {
    expect(isBaselineUnknown(null)).toBe(true)
  })

  it('treats a win absent from the baseline as a known zero start', () => {
    expect(isBaselineUnknown(undefined)).toBe(false)
  })

  it('treats a readable, never-played win as a real zero', () => {
    expect(isBaselineUnknown({ playtime_minutes: 0, achievements_unlocked: 0 })).toBe(false)
    expect(
      isBaselineUnknown({
        playtime_minutes: 0,
        has_no_available_stats: true,
        no_stats_reason: 'no_steam_stats',
      }),
    ).toBe(false)
  })

  it('keeps a baseline with evidence known even if flagged stats-less', () => {
    expect(isBaselineUnknown({ ...UNREADABLE, playtime_minutes: 30 })).toBe(false)
  })
})

describe('computeWinProgress', () => {
  it('excludes a win whose baseline was unreadable from progress', () => {
    const r = computeWinProgress({ playtime_minutes: 30000, achievements_unlocked: 10 }, UNREADABLE)
    expect(r).toEqual({ baselineUnknown: true, minutes: 0, completedInPeriod: false })
  })

  it('excludes a completion whose baseline is unknown', () => {
    const r = computeWinProgress(
      { playtime_minutes: 600, achievements_unlocked: 10, achievements_total: 10 },
      null,
    )
    expect(r.completedInPeriod).toBe(false)
    expect(r.baselineUnknown).toBe(true)
  })

  it('counts progress against a real zero baseline', () => {
    const r = computeWinProgress(
      { playtime_minutes: 120 },
      { playtime_minutes: 0, achievements_unlocked: 0 },
    )
    expect(r).toEqual({ baselineUnknown: false, minutes: 120, completedInPeriod: false })
  })

  it('counts the full playtime of a win absent from the baseline', () => {
    const r = computeWinProgress({ playtime_minutes: 90 }, undefined)
    expect(r.minutes).toBe(90)
    expect(r.baselineUnknown).toBe(false)
  })

  it('leaves a normal delta unchanged and clamps negatives to zero', () => {
    expect(computeWinProgress({ playtime_minutes: 500 }, { playtime_minutes: 200 }).minutes).toBe(300)
    expect(computeWinProgress({ playtime_minutes: 100 }, { playtime_minutes: 200 }).minutes).toBe(0)
  })

  it('flags a completion that crossed the HLTB threshold this period', () => {
    const r = computeWinProgress({ playtime_minutes: 660 }, { playtime_minutes: 100 }, 10)
    expect(r.completedInPeriod).toBe(true)
  })

  it('does not re-count a game already complete at baseline', () => {
    const r = computeWinProgress({ playtime_minutes: 700 }, { playtime_minutes: 650 }, 10)
    expect(r.completedInPeriod).toBe(false)
    expect(r.minutes).toBe(50)
  })
})
