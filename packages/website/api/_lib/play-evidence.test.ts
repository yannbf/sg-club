import { describe, expect, it } from 'vitest'
import {
  classifyPlayEvidence,
  isAttestedPlayed,
  summarizePlayEvidence,
  type PlayEvidenceWin,
} from './play-evidence.js'

const win = (steam_play_data: PlayEvidenceWin['steam_play_data'], rest: PlayEvidenceWin = {}): PlayEvidenceWin => ({
  steam_play_data,
  ...rest,
})

describe('classifyPlayEvidence', () => {
  it('classifies a readable snapshot that is not never-played as played', () => {
    expect(
      classifyPlayEvidence(win({ playtime_minutes: 300, achievements_unlocked: 4, never_played: false }))
    ).toBe('played')
  })

  it('classifies a readable never-played snapshot as unplayed', () => {
    expect(
      classifyPlayEvidence(win({ playtime_minutes: 0, achievements_unlocked: 0, never_played: true }))
    ).toBe('unplayed')
  })

  it('keeps below-threshold playtime on an owned game as unplayed', () => {
    expect(classifyPlayEvidence(win({ playtime_minutes: 20, never_played: true }))).toBe('unplayed')
  })

  it('treats an achievement-less game with real playtime as played despite has_no_available_stats', () => {
    expect(
      classifyPlayEvidence(
        win({
          playtime_minutes: 600,
          achievements_unlocked: 0,
          never_played: false,
          has_no_available_stats: true,
          no_stats_reason: 'no_steam_stats',
        })
      )
    ).toBe('played')
  })

  it('treats an achievement-less game with zero playtime as unplayed: the library was read', () => {
    expect(
      classifyPlayEvidence(
        win({
          playtime_minutes: 0,
          never_played: true,
          has_no_available_stats: true,
          no_stats_reason: 'no_steam_stats',
        })
      )
    ).toBe('unplayed')
  })

  it.each(['library_unavailable', 'package_delisted', 'not_in_library'])(
    'classifies a %s snapshot with no evidence as unreadable',
    (reason) => {
      expect(
        classifyPlayEvidence(
          win({
            playtime_minutes: 0,
            achievements_unlocked: 0,
            never_played: true,
            has_no_available_stats: true,
            no_stats_reason: reason,
          })
        )
      ).toBe('unreadable')
    }
  )

  it('classifies has_no_available_stats with no reason and no evidence as unreadable', () => {
    expect(
      classifyPlayEvidence(win({ playtime_minutes: 0, never_played: true, has_no_available_stats: true }))
    ).toBe('unreadable')
  })

  it('classifies a missing snapshot as unreadable', () => {
    expect(classifyPlayEvidence({})).toBe('unreadable')
  })

  it('keeps a snapshot retained from an earlier readable pull classified by its playtime', () => {
    expect(
      classifyPlayEvidence(
        win({
          playtime_minutes: 900,
          achievements_unlocked: 12,
          never_played: false,
          has_no_available_stats: true,
          no_stats_reason: 'library_unavailable',
        })
      )
    ).toBe('played')
  })

  it('does not call a snapshot with achievements but no playtime unreadable', () => {
    expect(
      classifyPlayEvidence(
        win({
          playtime_minutes: 0,
          achievements_unlocked: 3,
          never_played: true,
          no_stats_reason: 'not_in_library',
        })
      )
    ).toBe('unplayed')
  })

  it('classifies an unreleased win as unreleased whatever the snapshot says', () => {
    expect(classifyPlayEvidence({ unreleased: true })).toBe('unreleased')
    expect(
      classifyPlayEvidence(win({ playtime_minutes: 500, never_played: false }, { unreleased: true }))
    ).toBe('unreleased')
  })

  it('ignores attestations: the classification is Steam evidence only', () => {
    expect(classifyPlayEvidence({ i_played_bro: true })).toBe('unreadable')
  })
})

describe('isAttestedPlayed', () => {
  it('is true for i_played_bro or a met requirement, false otherwise', () => {
    expect(isAttestedPlayed({ i_played_bro: true })).toBe(true)
    expect(isAttestedPlayed({ required_play_meta: { requirements_met: true } })).toBe(true)
    expect(isAttestedPlayed({ required_play_meta: { requirements_met: false } })).toBe(false)
    expect(isAttestedPlayed({})).toBe(false)
  })
})

describe('summarizePlayEvidence', () => {
  const played = win({ playtime_minutes: 300, never_played: false })
  const unplayed = win({ playtime_minutes: 0, never_played: true })
  const hidden = win({
    playtime_minutes: 0,
    never_played: true,
    has_no_available_stats: true,
    no_stats_reason: 'library_unavailable',
  })

  it('counts each class and takes the rate over played + unplayed only', () => {
    const summary = summarizePlayEvidence([played, played, unplayed, hidden, hidden, hidden, { unreleased: true }])
    expect(summary).toEqual({ played: 2, unplayed: 1, unreadable: 3, unreleased: 1, rate: 2 / 3 })
  })

  it('has a null rate when nothing is readable, not 0', () => {
    expect(summarizePlayEvidence([hidden, {}, { unreleased: true }]).rate).toBeNull()
    expect(summarizePlayEvidence([]).rate).toBeNull()
  })

  it('has a 0 rate when readable wins are all unplayed', () => {
    expect(summarizePlayEvidence([unplayed, unplayed, hidden]).rate).toBe(0)
  })

  it('counts an attested win as played even when its stats are unreadable or unplayed', () => {
    const summary = summarizePlayEvidence([
      { ...hidden, i_played_bro: true },
      { ...unplayed, required_play_meta: { requirements_met: true } },
      unplayed,
    ])
    expect(summary).toMatchObject({ played: 2, unplayed: 1, unreadable: 0, rate: 2 / 3 })
  })

  it('keeps an attested unreleased win unreleased', () => {
    expect(summarizePlayEvidence([{ unreleased: true, i_played_bro: true }])).toMatchObject({
      played: 0,
      unreleased: 1,
      rate: null,
    })
  })
})
