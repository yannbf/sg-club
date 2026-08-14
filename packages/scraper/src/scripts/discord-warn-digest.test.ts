import { describe, expect, it } from 'vitest'
import {
  buildDigestMessages,
  groupFindingsByMember,
  isError,
  splitAndUpdateState,
  type DigestSplit,
  type WarnItem,
  type WarnState,
} from './discord-warn-digest'

const ITEM_A: WarnItem = {
  fingerprint: 'ex-member-entries:1',
  memberSgUsername: 'alice',
  label: 'Left the group but still has entries in group giveaways',
  detail: '3 active entries',
  severity: 'error',
  code: 'ex_member_entries',
}
const ITEM_B: WarnItem = {
  fingerprint: 'group-warning:2:required_play_deadline_expired',
  memberSgUsername: 'bob',
  label: 'Required-play deadline expired',
  severity: 'error',
  code: 'required_play_deadline_expired',
}
const ITEM_WARN: WarnItem = {
  fingerprint: 'group-warning:3:no_giveaway_created_in_6_months',
  memberSgUsername: 'carol',
  label: 'No giveaway created in 6 months',
  code: 'no_giveaway_created_in_6_months',
  severity: 'warn',
}
const ITEM_UPCOMING: WarnItem = {
  fingerprint: 'group-warning:4:required_play_deadline_within_15_days',
  memberSgUsername: 'dave',
  label: 'Required-play deadline within 15 days',
  detail: 'Blue Prince (deadline <t:1787000000:R>)',
  severity: 'warn',
  code: 'required_play_deadline_within_15_days',
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

  it('keeps warn-level items in the split (and thus in state) alongside error-level ones', () => {
    const state: WarnState = { items: {} }
    const split = splitAndUpdateState([ITEM_A, ITEM_WARN], state, 1000)

    expect(split.newItems.map((i) => i.fingerprint).sort()).toEqual(
      [ITEM_A.fingerprint, ITEM_WARN.fingerprint].sort()
    )
    expect(split.updatedState.items[ITEM_WARN.fingerprint]).toEqual({ firstSeen: 1000 })
  })
})

describe('groupFindingsByMember', () => {
  it('merges a new error item and a lingering error item for the same user into one entry', () => {
    const split: DigestSplit = {
      newItems: [ITEM_A],
      lingeringItems: [
        {
          ...ITEM_A,
          fingerprint: 'group-warning:1:zero_play_rate_with_wins',
          label: 'Zero play rate despite wins',
          detail: undefined,
          code: 'zero_play_rate_with_wins',
          firstSeen: 1700000000,
        },
      ],
      prunedFingerprints: [],
      updatedState: { items: {} },
    }

    const grouped = groupFindingsByMember(split, isError)

    expect(grouped).toHaveLength(1)
    expect(grouped[0]!.username).toBe('alice')
    // One new, one lingering — so the member is not "all new", and their
    // time on the list comes from the lingering finding.
    expect(grouped[0]!.allNew).toBe(false)
    expect(grouped[0]!.onListSince).toBe(1700000000)
    // Ordered by importance, so the lingering zero-play-rate finding outranks
    // the new ex-member-entries one.
    expect(grouped[0]!.findings.map((f) => [f.label, f.isNew])).toEqual([
      ['Zero play rate despite wins', false],
      ['Left the group but still has entries in group giveaways', true],
    ])
  })

  it('takes the oldest firstSeen when a member has several lingering findings', () => {
    const split: DigestSplit = {
      newItems: [],
      lingeringItems: [
        { ...ITEM_A, firstSeen: 1700000000 },
        {
          ...ITEM_A,
          fingerprint: 'group-warning:1:zero_play_rate_with_wins',
          firstSeen: 1600000000,
        },
      ],
      prunedFingerprints: [],
      updatedState: { items: {} },
    }

    expect(groupFindingsByMember(split, isError)[0]!.onListSince).toBe(1600000000)
  })

  it('orders a member findings by importance, not by new-vs-lingering', () => {
    const split: DigestSplit = {
      newItems: [
        {
          ...ITEM_B,
          memberSgUsername: 'bob',
          label: 'No giveaway created in 6 months',
          code: 'no_giveaway_created_in_6_months',
        },
      ],
      lingeringItems: [
        {
          ...ITEM_B,
          memberSgUsername: 'bob',
          label: 'Entered a giveaway while ineligible',
          code: 'illegal_entered_any_giveaways',
          firstSeen: 1000,
        },
      ],
      prunedFingerprints: [],
      updatedState: { items: {} },
    }

    expect(groupFindingsByMember(split, isError)[0]!.findings.map((f) => f.code)).toEqual([
      'illegal_entered_any_giveaways',
      'no_giveaway_created_in_6_months',
    ])
  })

  it('excludes a member whose only findings are warn-level', () => {
    const split: DigestSplit = {
      newItems: [ITEM_WARN],
      lingeringItems: [],
      prunedFingerprints: [],
      updatedState: { items: {} },
    }

    expect(groupFindingsByMember(split, isError)).toEqual([])
  })

  it('shows only the error findings for a member who has both error and warn findings', () => {
    const warnFromBob: WarnItem = { ...ITEM_WARN, memberSgUsername: 'bob' }
    const split: DigestSplit = {
      newItems: [ITEM_B, warnFromBob],
      lingeringItems: [],
      prunedFingerprints: [],
      updatedState: { items: {} },
    }

    const grouped = groupFindingsByMember(split, isError)

    expect(grouped).toHaveLength(1)
    expect(grouped[0]!.username).toBe('bob')
    expect(grouped[0]!.findings.map((f) => f.label)).toEqual([
      'Required-play deadline expired',
    ])
  })

  it('sorts members with a new error finding before members with only lingering error findings, alphabetically within each group', () => {
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

    const grouped = groupFindingsByMember(split, isError)

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

  it('stays silent (empty array) when every finding is warn-level and none is an upcoming deadline', () => {
    const split: DigestSplit = {
      newItems: [ITEM_WARN],
      lingeringItems: [],
      prunedFingerprints: [],
      updatedState: { items: {} },
    }
    expect(buildDigestMessages(split)).toEqual([])
  })

  it('reports an upcoming required-play deadline in its own section, warn severity notwithstanding', () => {
    const split: DigestSplit = {
      newItems: [ITEM_UPCOMING],
      lingeringItems: [],
      prunedFingerprints: [],
      updatedState: { items: {} },
    }
    const fullText = buildDigestMessages(split).join('\n')

    expect(fullText).toContain('**Required-play deadlines coming up**')
    expect(fullText).toContain('Blue Prince')
    // Deep-linked to the Won tab like every other required-play finding.
    expect(fullText).toContain(
      '[dave](<https://sg-club.vercel.app/users/dave/?tab=won&filter=play-required>)'
    )
  })

  it('drops an upcoming-deadline finding that names no game, and the member with it', () => {
    // Happens when group_users.json still carries a warning computed from a
    // deadline the current parser reads differently — there is no game to
    // point at, so there is nothing actionable to post.
    const gameless: WarnItem = { ...ITEM_UPCOMING, detail: undefined }
    const split: DigestSplit = {
      newItems: [ITEM_B, gameless],
      lingeringItems: [],
      prunedFingerprints: [],
      updatedState: { items: {} },
    }
    const fullText = buildDigestMessages(split).join('\n')

    expect(fullText).not.toContain('dave')
    expect(fullText).not.toContain('**Required-play deadlines coming up**')
  })

  it('keeps each section header attached to its own intro line', () => {
    const split: DigestSplit = {
      newItems: [ITEM_UPCOMING],
      lingeringItems: [],
      prunedFingerprints: [],
      updatedState: { items: {} },
    }
    const messages = buildDigestMessages(split)

    // A header and the line explaining it are one atomic segment, so chunking
    // can never strand a header at the end of a message.
    for (const header of ['**Weekly Mod Digest**', '**Required-play deadlines coming up**']) {
      const message = messages.find((m) => m.includes(header))!
      const lines = message.split('\n')
      const headerIndex = lines.indexOf(header)
      expect(lines[headerIndex + 1]).toBeDefined()
      expect(lines[headerIndex + 1]!.startsWith('**')).toBe(false)
    }
  })

  it('sorts the deadline section by name, since it shows no new/unresolved marker', () => {
    const split: DigestSplit = {
      newItems: [{ ...ITEM_UPCOMING, memberSgUsername: 'zoe' }],
      lingeringItems: [
        { ...ITEM_UPCOMING, memberSgUsername: 'adam', firstSeen: 1000 },
      ],
      prunedFingerprints: [],
      updatedState: { items: {} },
    }
    const fullText = buildDigestMessages(split).join('\n')

    expect(fullText.indexOf('adam')).toBeLessThan(fullText.indexOf('zoe'))
  })

  it('keeps upcoming deadlines below the violations, and other warn-level findings out entirely', () => {
    const split: DigestSplit = {
      newItems: [ITEM_B, ITEM_WARN, ITEM_UPCOMING],
      lingeringItems: [],
      prunedFingerprints: [],
      updatedState: { items: {} },
    }
    const fullText = buildDigestMessages(split).join('\n')

    expect(fullText.indexOf('bob')).toBeLessThan(
      fullText.indexOf('**Required-play deadlines coming up**')
    )
    expect(fullText.indexOf('**Required-play deadlines coming up**')).toBeLessThan(
      fullText.indexOf('dave')
    )
    expect(fullText).not.toContain('carol')
  })

  it('lists a member in both sections when they are in violation AND have a deadline coming up', () => {
    const bobDeadline: WarnItem = { ...ITEM_UPCOMING, memberSgUsername: 'bob' }
    const split: DigestSplit = {
      newItems: [ITEM_B, bobDeadline],
      lingeringItems: [],
      prunedFingerprints: [],
      updatedState: { items: {} },
    }
    const fullText = buildDigestMessages(split).join('\n')

    expect(fullText).toContain('Required-play deadline expired')
    expect(fullText.match(/\[bob\]/g)).toHaveLength(2)
  })

  it('renders no emojis anywhere in the output', () => {
    const split: DigestSplit = {
      newItems: [ITEM_A, ITEM_B],
      lingeringItems: [],
      prunedFingerprints: [],
      updatedState: { items: {} },
    }
    const messages = buildDigestMessages(split)
    const fullText = messages.join('\n')
    const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
    expect(emojiPattern.test(fullText)).toBe(false)
  })

  it('deep-links members with required-play error codes to their filtered Won tab', () => {
    const playRequiredItem: WarnItem = {
      ...ITEM_B,
      code: 'required_play_deadline_expired',
    }
    const split: DigestSplit = {
      newItems: [ITEM_A, playRequiredItem],
      lingeringItems: [],
      prunedFingerprints: [],
      updatedState: { items: {} },
    }

    const fullText = buildDigestMessages(split).join('\n')

    // bob (required-play code) gets the filtered Won-tab deep link; alice
    // (ex-member entries only) gets the Entered-tab open-filter deep link.
    expect(fullText).toContain(
      '[bob](<https://sg-club.vercel.app/users/bob/?tab=won&filter=play-required>)'
    )
    expect(fullText).toContain(
      '[alice](<https://sg-club.vercel.app/users/alice/?tab=entered&filter=open>)'
    )
  })

  it('deep-links a member whose only finding is ex-member entries to their open Entered tab, but not when mixed with other non-play-required findings', () => {
    const otherErrorForAlice: WarnItem = {
      fingerprint: 'group-warning:alice:some_future_error',
      memberSgUsername: 'alice',
      label: 'Some future error',
      severity: 'error',
      code: 'some_future_error',
    }
    const soloSplit: DigestSplit = {
      newItems: [ITEM_A],
      lingeringItems: [],
      prunedFingerprints: [],
      updatedState: { items: {} },
    }
    const mixedSplit: DigestSplit = {
      newItems: [ITEM_A, otherErrorForAlice],
      lingeringItems: [],
      prunedFingerprints: [],
      updatedState: { items: {} },
    }

    expect(buildDigestMessages(soloSplit).join('\n')).toContain(
      '[alice](<https://sg-club.vercel.app/users/alice/?tab=entered&filter=open>)'
    )
    expect(buildDigestMessages(mixedSplit).join('\n')).toContain(
      '[alice](<https://sg-club.vercel.app/users/alice/>)'
    )
  })

  it('puts the header only on the first message and never splits a bullet across messages', () => {
    // Long category strings force a split into multiple ≤1900-char messages.
    const longCategory = 'X'.repeat(150)
    const newItems: WarnItem[] = Array.from({ length: 30 }, (_, i) => ({
      fingerprint: `f:${i}`,
      memberSgUsername: `member${String(i).padStart(2, '0')}`,
      label: longCategory,
      severity: 'error' as const,
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
    expect(messages[0]!.startsWith('**Weekly Mod Digest**\n')).toBe(true)
    for (const message of messages.slice(1)) {
      expect(message).not.toContain('**Weekly Mod Digest**')
    }

    // Every message stays under the 1900-char cap.
    for (const message of messages) {
      expect(message.length).toBeLessThanOrEqual(1900)
    }

    // No member is split mid-way: each member's whole block (name line plus
    // its finding sub-bullets) appears intact inside exactly one message.
    for (const member of groupFindingsByMember(split, isError)) {
      const block = [
        `- [${member.username}](<https://sg-club.vercel.app/users/${member.username}/>) — new this week`,
        `  - ${longCategory}`,
      ].join('\n')
      expect(messages.filter((message) => message.includes(block))).toHaveLength(1)
    }
  })
})
