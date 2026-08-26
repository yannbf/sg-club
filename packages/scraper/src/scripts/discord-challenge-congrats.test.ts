import { describe, expect, it } from 'vitest'
import type { ChallengeIndexEntry } from '../../../website/api/_lib/signup-log'
import {
  batchAnnouncements,
  batchUsernames,
  buildCongratsMessage,
  buildTieredCongratsMessage,
  diffNewCompletions,
  diffTierAnnouncements,
  isActiveChallengeFile,
  joinNamesWithAnd,
  pickCongratsChannel,
  qualifyingUsernames,
  resolveCongratsChannel,
  type TierAnnouncement,
} from './discord-challenge-congrats'

describe('isActiveChallengeFile', () => {
  it('is active when the challenge is not over and not a sign-up preview', () => {
    expect(isActiveChallengeFile({ challengeOver: false, signup_phase: undefined })).toBe(true)
  })

  it('excludes a sign-up-phase ownership preview even though challengeOver is false', () => {
    // A preview's is_winner reflects who'd already qualify today (e.g. a
    // member who owns the game, is 100%, and already reviewed it) — that
    // must not trigger a congrats before the challenge has actually begun.
    expect(isActiveChallengeFile({ challengeOver: false, signup_phase: true })).toBe(false)
  })

  it('excludes a challenge that has ended', () => {
    expect(isActiveChallengeFile({ challengeOver: true, signup_phase: false })).toBe(false)
  })
})

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

describe('diffTierAnnouncements', () => {
  it('announces new winners with their tier, and skips non-winners', () => {
    const result = diffTierAnnouncements(
      [
        { username: 'a', is_winner: true, win_tier: 'story' },
        { username: 'b', is_winner: true, win_tier: 'completion' },
        { username: 'c', is_winner: false, win_tier: null },
      ],
      [],
      {},
    )
    expect(result).toEqual([
      { username: 'a', tier: 'story', upgraded: false },
      { username: 'b', tier: 'completion', upgraded: false },
    ])
  })

  it('re-announces a story-tier winner exactly once when they upgrade to completion', () => {
    const participants = [
      { username: 'a', is_winner: true, win_tier: 'completion' as const },
    ]
    const upgraded = diffTierAnnouncements(participants, ['a'], { a: 'story' })
    expect(upgraded).toEqual([{ username: 'a', tier: 'completion', upgraded: true }])

    // Once state records the completion tier, later runs stay silent.
    expect(diffTierAnnouncements(participants, ['a'], { a: 'completion' })).toEqual([])
  })

  it('never re-announces a same-tier winner, and treats untiered winners like diffNewCompletions', () => {
    expect(
      diffTierAnnouncements(
        [{ username: 'a', is_winner: true, win_tier: 'story' }],
        ['a'],
        { a: 'story' },
      ),
    ).toEqual([])
    // Untiered challenge: no win_tier field at all, no tier state.
    expect(
      diffTierAnnouncements(
        [
          { username: 'a', is_winner: true },
          { username: 'b', is_winner: true },
        ],
        ['a'],
        {},
      ),
    ).toEqual([{ username: 'b', tier: null, upgraded: false }])
  })
})

describe('buildTieredCongratsMessage', () => {
  const emoji = '🐼🎉'
  const ann = (
    username: string,
    tier: TierAnnouncement['tier'],
    upgraded = false,
  ): TierAnnouncement => ({ username, tier, upgraded })

  it('keeps the classic message shape for untiered challenges', () => {
    expect(buildTieredCongratsMessage([ann('a', null)], 'Neo Cab', emoji)).toBe(
      '🎉 **a** just finished the **Neo Cab** challenge! Congrats 🐼🎉',
    )
  })

  it('announces story-only batches as Tier 1', () => {
    expect(
      buildTieredCongratsMessage([ann('a', 'story'), ann('b', 'story')], 'Bloody Spell', emoji),
    ).toBe(
      '🥇 **a** and **b** cleared the story of **Bloody Spell** — a Tier 1 win! Congrats 🐼🎉',
    )
  })

  it('announces completion-only batches as Tier 2', () => {
    expect(buildTieredCongratsMessage([ann('a', 'completion')], 'Bloody Spell', emoji)).toBe(
      '🏆 **a** reached 100% of **Bloody Spell** — a Tier 2 win! Congrats 🐼🎉',
    )
  })

  it('uses upgrade phrasing when every completion in the batch is an upgrade', () => {
    expect(
      buildTieredCongratsMessage([ann('a', 'completion', true)], 'Bloody Spell', emoji),
    ).toBe(
      '🏆 **a** upgraded their **Bloody Spell** win to Tier 2 — full completion! Congrats 🐼🎉',
    )
  })

  it('groups mixed tiers into a single message with one line per tier', () => {
    expect(
      buildTieredCongratsMessage(
        [ann('a', 'story'), ann('b', 'completion'), ann('c', 'story')],
        'Bloody Spell',
        emoji,
      ),
    ).toBe(
      [
        '🎉 **Bloody Spell** challenge update! 🐼🎉',
        '🥇 Tier 1 — story cleared: **a** and **c**',
        '🏆 Tier 2 — full completion: **b**',
      ].join('\n'),
    )
  })
})

describe('batchAnnouncements', () => {
  it('keeps a small mixed batch in a single message', () => {
    const anns: TierAnnouncement[] = [
      { username: 'a', tier: 'story', upgraded: false },
      { username: 'b', tier: 'completion', upgraded: false },
    ]
    expect(batchAnnouncements(anns, 'Bloody Spell', '🐼🎉')).toEqual([anns])
  })

  it('splits when the rendered message would exceed the limit, dropping nobody', () => {
    const anns: TierAnnouncement[] = Array.from({ length: 60 }, (_, i) => ({
      username: `SuperLongSteamGiftsUsername${i}`,
      tier: i % 2 ? ('story' as const) : ('completion' as const),
      upgraded: false,
    }))
    const batches = batchAnnouncements(anns, 'Bloody Spell', '🐼🎉')
    expect(batches.length).toBeGreaterThan(1)
    for (const batch of batches) {
      expect(
        buildTieredCongratsMessage(batch, 'Bloody Spell', '🐼🎉').length,
      ).toBeLessThanOrEqual(1900)
    }
    expect(batches.flat()).toEqual(anns)
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

  const neoCabFile = { slug: 'neo-cab', gameName: 'Neo Cab' }

  it('returns null when the matched challenge is archived, regardless of its channel config', () => {
    const index = new Map([['neo-cab', entry({ archived: true })]])
    expect(resolveCongratsChannel(neoCabFile, index, 'fallback-chan')).toBeNull()
  })

  it('prefers congrats_channel_id when the matched, non-archived challenge has one', () => {
    const index = new Map([
      ['neo-cab', entry({ meta: { ...entry().meta, congrats_channel_id: 'congrats-chan' } })],
    ])
    expect(resolveCongratsChannel(neoCabFile, index, 'fallback-chan')).toBe('congrats-chan')
  })

  it('falls back to channel_id for a matched, non-archived challenge with no congrats_channel_id', () => {
    const index = new Map([['neo-cab', entry()]])
    expect(resolveCongratsChannel(neoCabFile, index, 'fallback-chan')).toBe('announce-chan')
  })

  it('falls back to the provided fallback channel when no entry matches the slug', () => {
    const index = new Map<string, ChallengeIndexEntry>()
    expect(
      resolveCongratsChannel({ slug: 'unknown-slug', gameName: 'Unknown' }, index, 'fallback-chan')
    ).toBe('fallback-chan')
  })

  it('fuzzy-matches when the log slug came from the game name, not the data-file slug', () => {
    // The real gaming-challenge-4 shape: /challenge-setup slugified the typed
    // name "Bloody Spell" into "bloody-spell", while the site data file uses
    // the hardcoded slug "gaming-challenge-4-bloody-spell".
    const index = new Map([
      [
        'bloody-spell',
        entry({
          meta: {
            ...entry().meta,
            slug: 'bloody-spell',
            name: 'Bloody Spell',
            congrats_channel_id: 'bloodspell-chan',
          },
        }),
      ],
    ])
    const file = { slug: 'gaming-challenge-4-bloody-spell', gameName: 'Bloody Spell' }
    expect(resolveCongratsChannel(file, index, 'fallback-chan')).toBe('bloodspell-chan')
  })

  it('still skips congrats (null) when the fuzzy-matched challenge is archived', () => {
    const index = new Map([
      ['bloody-spell', entry({ archived: true, meta: { ...entry().meta, slug: 'bloody-spell', name: 'Bloody Spell' } })],
    ])
    const file = { slug: 'gaming-challenge-4-bloody-spell', gameName: 'Bloody Spell' }
    expect(resolveCongratsChannel(file, index, 'fallback-chan')).toBeNull()
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
