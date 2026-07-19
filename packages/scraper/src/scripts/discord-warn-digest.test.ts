import { describe, expect, it } from 'vitest'
import {
  buildDigestMessages,
  groupFindingsByMember,
  splitAndUpdateState,
  type DigestSplit,
  type WarnItem,
  type WarnState,
} from './discord-warn-digest'

const ITEM_A: WarnItem = {
  fingerprint: 'ex-member-entries:1',
  memberSgUsername: 'alice',
  category: 'Ex-member entries',
  description: 'alice: ex-member entries',
}
const ITEM_B: WarnItem = {
  fingerprint: 'group-warning:2:required_play_deadline_expired',
  memberSgUsername: 'bob',
  category: 'Required-play deadline expired',
  description: 'bob: required-play deadline expired',
}

describe('splitAndUpdateState', () => {
  it('puts everything in newItems on a first run with empty state', () => {
    const state: WarnState = { items: {} }
    const split = splitAndUpdateState([ITEM_A, ITEM_B], state, 1000)

    expect(split.newItems.map((i) => i.fingerprint).sort()).toEqual(
      [ITEM_A.fingerprint, ITEM_B.fingerprint].sort()
    )
    expect(split.lingeringItems).toEqual([])
    expect(split.prunedFingerprints).toEqual([])
    expect(split.updatedState.items[ITEM_A.fingerprint]).toEqual({ firstSeen: 1000 })
  })

  it('moves a previously-seen item into lingeringItems with its original firstSeen', () => {
    const state: WarnState = { items: { [ITEM_A.fingerprint]: { firstSeen: 500 } } }
    const split = splitAndUpdateState([ITEM_A], state, 2000)

    expect(split.newItems).toEqual([])
    expect(split.lingeringItems).toEqual([{ ...ITEM_A, firstSeen: 500 }])
    expect(split.updatedState.items[ITEM_A.fingerprint]).toEqual({ firstSeen: 500 })
  })

  it('splits new vs lingering correctly when both are present', () => {
    const state: WarnState = { items: { [ITEM_A.fingerprint]: { firstSeen: 500 } } }
    const split = splitAndUpdateState([ITEM_A, ITEM_B], state, 2000)

    expect(split.newItems).toEqual([ITEM_B])
    expect(split.lingeringItems).toEqual([{ ...ITEM_A, firstSeen: 500 }])
  })

  it('prunes state entries whose finding has disappeared', () => {
    const state: WarnState = {
      items: {
        [ITEM_A.fingerprint]: { firstSeen: 500 },
        'stale-fingerprint': { firstSeen: 100 },
      },
    }
    const split = splitAndUpdateState([ITEM_A], state, 2000)

    expect(split.prunedFingerprints).toEqual(['stale-fingerprint'])
    expect(split.updatedState.items['stale-fingerprint']).toBeUndefined()
  })

  it('returns an empty split for zero findings and empty state', () => {
    const split = splitAndUpdateState([], { items: {} }, 1000)
    expect(split.newItems).toEqual([])
    expect(split.lingeringItems).toEqual([])
    expect(split.prunedFingerprints).toEqual([])
    expect(split.updatedState).toEqual({ items: {} })
  })

  it('prunes everything when findings drop to zero', () => {
    const state: WarnState = { items: { [ITEM_A.fingerprint]: { firstSeen: 500 } } }
    const split = splitAndUpdateState([], state, 2000)
    expect(split.prunedFingerprints).toEqual([ITEM_A.fingerprint])
    expect(split.updatedState).toEqual({ items: {} })
  })
})

describe('groupFindingsByMember', () => {
  it('merges a new item and a lingering item for the same user into one entry', () => {
    const split: DigestSplit = {
      newItems: [ITEM_A],
      lingeringItems: [{ ...ITEM_A, fingerprint: 'group-warning:1:zero_play_rate_with_wins', category: 'Zero play rate despite wins', firstSeen: 1700000000 }],
      prunedFingerprints: [],
      updatedState: { items: {} },
    }

    const grouped = groupFindingsByMember(split)

    expect(grouped).toHaveLength(1)
    expect(grouped[0]!.username).toBe('alice')
    expect(grouped[0]!.hasNew).toBe(true)
    expect(grouped[0]!.findingLines).toEqual([
      '🆕 Ex-member entries',
      '⏳ Zero play rate despite wins (since <t:1700000000:R>)',
    ])
  })

  it('sorts members with a new finding before members with only lingering findings, alphabetically within each group', () => {
    const split: DigestSplit = {
      // "zack" (new) should sort before "yara" (new) alphabetically, and
      // both should sort before "bob"/"carol" (lingering-only), even though
      // insertion order here is the reverse of the expected output order.
      newItems: [
        { ...ITEM_A, memberSgUsername: 'zack' },
        { ...ITEM_A, memberSgUsername: 'yara' },
      ],
      lingeringItems: [
        { ...ITEM_B, memberSgUsername: 'carol', firstSeen: 1000 },
        { ...ITEM_B, memberSgUsername: 'bob', firstSeen: 1000 },
      ],
      prunedFingerprints: [],
      updatedState: { items: {} },
    }

    const grouped = groupFindingsByMember(split)

    expect(grouped.map((m) => m.username)).toEqual(['yara', 'zack', 'bob', 'carol'])
  })
})

describe('buildDigestMessages', () => {
  it('returns an empty array when there are no members', () => {
    const split: DigestSplit = {
      newItems: [],
      lingeringItems: [],
      prunedFingerprints: [],
      updatedState: { items: {} },
    }
    expect(buildDigestMessages(split)).toEqual([])
  })

  it('puts the header only on the first message and never splits a bullet across messages', () => {
    // Long category strings force a split into multiple ≤1900-char messages.
    const longCategory = 'X'.repeat(150)
    const newItems: WarnItem[] = Array.from({ length: 30 }, (_, i) => ({
      fingerprint: `f:${i}`,
      memberSgUsername: `member${String(i).padStart(2, '0')}`,
      category: longCategory,
      description: 'irrelevant',
    }))
    const split: DigestSplit = {
      newItems,
      lingeringItems: [],
      prunedFingerprints: [],
      updatedState: { items: {} },
    }

    const messages = buildDigestMessages(split)

    expect(messages.length).toBeGreaterThan(1)

    // Header appears exactly once, only on the first message.
    expect(messages[0]!.startsWith('📋 **Weekly Mod Digest**\n')).toBe(true)
    for (const message of messages.slice(1)) {
      expect(message).not.toContain('📋 **Weekly Mod Digest**')
    }

    // Every message stays under the 1900-char cap.
    for (const message of messages) {
      expect(message.length).toBeLessThanOrEqual(1900)
    }

    // No bullet is split mid-way: every line in every message is either the
    // header or a well-formed bullet, and concatenating all bullets across
    // all messages reconstructs the full expected set with nothing
    // missing or duplicated.
    const expectedBullets = groupFindingsByMember(split).map(
      (m) => `- [${m.username}](https://sg-club.vercel.app/users/${m.username}/) — ${m.findingLines.join(' · ')}`
    )
    const actualBullets = messages.flatMap((message) =>
      message
        .split('\n')
        .filter((line) => line !== '📋 **Weekly Mod Digest**' && line.length > 0)
    )
    expect(actualBullets).toEqual(expectedBullets)
  })
})
