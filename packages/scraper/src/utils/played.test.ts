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
    it('needs a quarter of the main story', () => {
      expect(isGamePlayed(play(149), 10)).toBe(false)
      expect(isGamePlayed(play(150), 10)).toBe(true)
    })

    it('scales down with a short main story', () => {
      expect(isGamePlayed(play(44), 3)).toBe(false)
      expect(isGamePlayed(play(45), 3)).toBe(true)
    })

    it('caps the bar at 15h however long the main story is', () => {
      expect(isGamePlayed(play(60 * 15 - 1), 200)).toBe(false)
      expect(isGamePlayed(play(60 * 15), 200)).toBe(true)
      expect(isGamePlayed(play(60 * 15), 60)).toBe(true)
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
