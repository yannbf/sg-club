import { describe, expect, it } from 'vitest'
import type { ChallengeIndexEntry } from '../../../website/api/_lib/signup-log'
import {
  batchUsernames,
  buildCongratsMessage,
  diffNewCompletions,
  joinNamesWithAnd,
  pickCongratsChannel,
  qualifyingUsernames,
  resolveCongratsChannel,
} from './discord-challenge-congrats'

describe('qualifyingUsernames', () => {
  it('includes exactly the participants the site marks as winners (is_winner)', () => {
    const result = qualifyingUsernames({
      participants: [
        // is_winner already encodes completion + playtime + required review +
        // within-deadline — e.g. a member at 100% achievements without their
        // required review has is_winner: false.
        { username: 'a', is_winner: true },
        { username: 'reviewless-completer', is_winner: false },
        { username: 'c', is_winner: false },
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

describe('pickCongratsChannel', () => {
  it('prefers congrats_channel_id when the matched meta has one', () => {
    const meta = { channel_id: 'announce-chan', congrats_channel_id: 'congrats-chan' }
    expect(pickCongratsChannel(meta, 'fallback-chan')).toBe('congrats-chan')
  })

  it('falls back to channel_id when the matched meta has no congrats_channel_id', () => {
    const meta = { channel_id: 'announce-chan', congrats_channel_id: undefined }
    expect(pickCongratsChannel(meta, 'fallback-chan')).toBe('announce-chan')
  })

  it('falls back to the provided fallback channel when no meta matched at all', () => {
    expect(pickCongratsChannel(undefined, 'fallback-chan')).toBe('fallback-chan')
  })
})

describe('resolveCongratsChannel', () => {
  function entry(overrides: Partial<ChallengeIndexEntry> = {}): ChallengeIndexEntry {
    return {
      meta: {
        slug: 'neo-cab',
        channel_id: 'announce-chan',
        message_id: 'm1',
        deadline: 1,
        start: 1,
        end: 2,
        name: 'Neo Cab',
      },
      closed: false,
      reminded: false,
      ended: false,
      archived: false,
      ...overrides,
    }
  }

  it('returns null when the matched challenge is archived, regardless of its channel config', () => {
    const index = new Map([['neo-cab', entry({ archived: true })]])
    expect(resolveCongratsChannel('neo-cab', index, 'fallback-chan')).toBeNull()
  })

  it('prefers congrats_channel_id when the matched, non-archived challenge has one', () => {
    const index = new Map([
      ['neo-cab', entry({ meta: { ...entry().meta, congrats_channel_id: 'congrats-chan' } })],
    ])
    expect(resolveCongratsChannel('neo-cab', index, 'fallback-chan')).toBe('congrats-chan')
  })

  it('falls back to channel_id for a matched, non-archived challenge with no congrats_channel_id', () => {
    const index = new Map([['neo-cab', entry()]])
    expect(resolveCongratsChannel('neo-cab', index, 'fallback-chan')).toBe('announce-chan')
  })

  it('falls back to the provided fallback channel when no entry matches the slug', () => {
    const index = new Map<string, ChallengeIndexEntry>()
    expect(resolveCongratsChannel('unknown-slug', index, 'fallback-chan')).toBe('fallback-chan')
  })
})

describe('joinNamesWithAnd', () => {
  it('bolds a single name with no "and"', () => {
    expect(joinNamesWithAnd(['a'])).toBe('**a**')
  })

  it('joins two names with "and"', () => {
    expect(joinNamesWithAnd(['a', 'b'])).toBe('**a** and **b**')
  })

  it('joins three or more names with commas and a final "and", no Oxford comma', () => {
    expect(joinNamesWithAnd(['a', 'b', 'c'])).toBe('**a**, **b** and **c**')
    expect(joinNamesWithAnd(['a', 'b', 'c', 'd'])).toBe('**a**, **b**, **c** and **d**')
  })
})

describe('buildCongratsMessage', () => {
  it('builds the exact message shape for a single name', () => {
    expect(buildCongratsMessage(['a'], 'Neo Cab', '🐼🎉')).toBe(
      '🎉 **a** just finished the **Neo Cab** challenge! Congrats 🐼🎉'
    )
  })

  it('builds the exact message shape for three names', () => {
    expect(buildCongratsMessage(['a', 'b', 'c'], 'Neo Cab', '🐼🎉')).toBe(
      '🎉 **a**, **b** and **c** just finished the **Neo Cab** challenge! Congrats 🐼🎉'
    )
  })
})

describe('batchUsernames', () => {
  it('keeps a small list in a single batch', () => {
    const batches = batchUsernames(['a', 'b', 'c'], 'Neo Cab', '🐼🎉')
    expect(batches).toEqual([['a', 'b', 'c']])
  })

  it('splits into multiple batches when the combined message would exceed the length limit, without dropping or duplicating anyone', () => {
    // Each name is long enough that a handful of them together will blow
    // past the 1900-char budget, forcing at least one split.
    const usernames = Array.from({ length: 60 }, (_, i) => `SuperLongSteamGiftsUsername${i}`)
    const batches = batchUsernames(usernames, 'Neo Cab', '🐼🎉')

    expect(batches.length).toBeGreaterThan(1)

    for (const batch of batches) {
      expect(buildCongratsMessage(batch, 'Neo Cab', '🐼🎉').length).toBeLessThanOrEqual(1900)
    }

    const flattened = batches.flat()
    expect(flattened).toEqual(usernames)
    expect(new Set(flattened).size).toBe(usernames.length)
  })

  it('still gives a single oversized username its own batch rather than dropping it', () => {
    const hugeUsername = 'X'.repeat(2000)
    const batches = batchUsernames(['a', hugeUsername, 'b'], 'Neo Cab', '🐼🎉')

    const flattened = batches.flat()
    expect(flattened).toEqual(['a', hugeUsername, 'b'])
    expect(batches.some((b) => b.length === 1 && b[0] === hugeUsername)).toBe(true)
  })
})
