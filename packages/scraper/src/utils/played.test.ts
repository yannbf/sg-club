import { describe, it, expect } from 'vitest'
import { isGamePlayed } from './played'

const play = (
  playtimeMinutes: number,
  unlocked = 0,
  total = 0,
): { playtime_minutes: number; achievements_unlocked: number; achievements_total: number } => ({
  playtime_minutes: playtimeMinutes,
  achievements_unlocked: unlocked,
  achievements_total: total,
})

describe('isGamePlayed', () => {
  describe('game with achievements', () => {
    it('counts as played at 10% unlocked', () => {
      expect(isGamePlayed(play(60, 5, 50))).toBe(true)
    })

    it('does not count below 10%, however long it was run', () => {
      expect(isGamePlayed(play(60 * 40, 4, 50))).toBe(false)
    })

    it('ignores HLTB length when achievements exist', () => {
      expect(isGamePlayed(play(60 * 40, 0, 50), 10)).toBe(false)
    })
  })

  describe('game without achievements', () => {
    it('needs 20% of a main story longer than 4h', () => {
      expect(isGamePlayed(play(119), 10)).toBe(false)
      expect(isGamePlayed(play(120), 10)).toBe(true)
    })

    it('needs 2h for a main story of 4h or less', () => {
      expect(isGamePlayed(play(119), 3)).toBe(false)
      expect(isGamePlayed(play(120), 3)).toBe(true)
      expect(isGamePlayed(play(120), 4)).toBe(true)
    })

    it('falls back to the 2h bar when HLTB is unknown', () => {
      expect(isGamePlayed(play(119))).toBe(false)
      expect(isGamePlayed(play(120), null)).toBe(true)
    })
  })

  it('treats an untouched game as unplayed', () => {
    expect(isGamePlayed(play(0, 0, 50))).toBe(false)
    expect(isGamePlayed(play(0))).toBe(false)
  })
})
