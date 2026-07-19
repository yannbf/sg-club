import { describe, expect, it } from 'vitest'
import { splitAndUpdateState, type WarnItem, type WarnState } from './discord-warn-digest'

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
