import { describe, expect, it } from 'vitest'
import { diffNewCompletions, qualifyingUsernames } from './discord-challenge-congrats'

describe('qualifyingUsernames', () => {
  it('includes only participants who are complete and did not complete before start', () => {
    const result = qualifyingUsernames({
      participants: [
        { username: 'a', is_complete: true, completed_before_start: false },
        { username: 'b', is_complete: true, completed_before_start: true },
        { username: 'c', is_complete: false, completed_before_start: false },
      ],
    })
    expect(result).toEqual(['a'])
  })
})

describe('diffNewCompletions', () => {
  it('returns qualifying usernames not already announced', () => {
    expect(diffNewCompletions(['a', 'b', 'c'], ['a'])).toEqual(['b', 'c'])
  })

  it('never re-announces the same username twice', () => {
    const alreadyAnnounced = ['a', 'b']
    expect(diffNewCompletions(['a', 'b'], alreadyAnnounced)).toEqual([])
  })

  it('returns an empty diff when nothing is new', () => {
    expect(diffNewCompletions([], ['a'])).toEqual([])
  })

  it('handles multiple challenges independently (state keyed by slug elsewhere)', () => {
    // The diffing function itself is slug-agnostic — the caller passes in
    // the announced list for a single slug — so this just re-confirms two
    // separate calls don't leak state into each other.
    const neoCabAnnounced = ['a']
    const killTheCrowsAnnounced: string[] = []

    expect(diffNewCompletions(['a', 'b'], neoCabAnnounced)).toEqual(['b'])
    expect(diffNewCompletions(['a', 'b'], killTheCrowsAnnounced)).toEqual(['a', 'b'])
  })

  it('is stable across repeated runs once state has been updated', () => {
    let announced: string[] = []
    const qualifying = ['a', 'b']

    const firstRun = diffNewCompletions(qualifying, announced)
    expect(firstRun).toEqual(['a', 'b'])
    announced = [...announced, ...firstRun]

    const secondRun = diffNewCompletions(qualifying, announced)
    expect(secondRun).toEqual([])
  })
})
