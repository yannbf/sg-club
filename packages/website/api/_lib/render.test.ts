import { describe, expect, it } from 'vitest'
import { buildChallengeListMessages, buildClosedSummaryMessages } from './render.js'
import type { Roster, RosterEntry } from './signup-log.js'

function entry(overrides: Partial<RosterEntry>): RosterEntry {
  return {
    discord_id: '1',
    discord_handle: 'handle',
    sg_username: 'sgname',
    guest: false,
    choice: 'want',
    ...overrides,
  }
}

const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u

describe('buildClosedSummaryMessages', () => {
  it('renders a plain-markdown header + want/have lines with no embed', () => {
    const wanters = [entry({ sg_username: 'alice' }), entry({ sg_username: 'bob' })]
    const owners = [entry({ sg_username: 'carol' })]
    const [message] = buildClosedSummaryMessages({ name: 'Neo Cab', wanters, owners })

    expect(message).toBe(
      '**Signups closed — Neo Cab**\n' +
        'Want the game (2): alice, bob\n' +
        'Already have it (1): carol'
    )
  })

  it('is emoji-free', () => {
    const wanters = [entry({ sg_username: null, guest: true })]
    const [message] = buildClosedSummaryMessages({ name: 'Test', wanters, owners: [] })
    expect(emojiPattern.test(message!)).toBe(false)
  })

  it('falls back to @discord_handle for a guest with no resolved SG username', () => {
    const wanters = [entry({ sg_username: null, guest: true, discord_handle: 'someguy' })]
    const [message] = buildClosedSummaryMessages({ name: 'Test', wanters, owners: [] })
    expect(message).toContain('@someguy')
  })

  it('shows _none_ for an empty list', () => {
    const [message] = buildClosedSummaryMessages({ name: 'Test', wanters: [], owners: [] })
    expect(message).toContain('Want the game (0): _none_')
    expect(message).toContain('Already have it (0): _none_')
  })

  it('chunks into multiple messages, staying comfortably under the 2000-char Discord limit, when names are long', () => {
    const wanters = Array.from({ length: 200 }, (_, i) => entry({ sg_username: `wanter-with-a-long-name-${i}` }))
    const messages = buildClosedSummaryMessages({ name: 'Big Challenge', wanters, owners: [] })

    expect(messages.length).toBeGreaterThan(1)
    for (const message of messages) {
      // The comma-chunk itself is capped at 1900 chars; the surrounding
      // label/index text adds a little headroom on top, same as the
      // pre-existing codeblock chunker, so we assert against Discord's real
      // hard limit rather than the internal budget.
      expect(message.length).toBeLessThanOrEqual(2000)
    }
  })
})

describe('buildChallengeListMessages', () => {
  const roster: Roster = {
    wanters: [entry({ sg_username: 'alice' }), entry({ sg_username: 'bob', choice: 'want' })],
    owners: [entry({ sg_username: 'carol', choice: 'have' })],
    all: [],
    unresolved: [entry({ sg_username: null, guest: true, discord_handle: 'guestguy', choice: 'want' })],
  }
  roster.all = [...roster.wanters, ...roster.owners]

  it('renders header, want/have codeblocks, unresolved list, and a total line', () => {
    const [message] = buildChallengeListMessages({ name: 'Neo Cab', roster })

    expect(message).toContain('**Neo Cab — signups**')
    expect(message).toContain('**Want the game** (2):\n```\nalice, bob\n```')
    expect(message).toContain('**Already have it** (1):\n```\ncarol\n```')
    expect(message).toContain('Unresolved/guests (1): @guestguy')
    expect(message).toContain('Total: 3')
  })

  it('is emoji-free', () => {
    const [message] = buildChallengeListMessages({ name: 'Neo Cab', roster })
    expect(emojiPattern.test(message!)).toBe(false)
  })

  it('handles an empty roster with _none_ placeholders and zero counts', () => {
    const emptyRoster: Roster = { wanters: [], owners: [], all: [], unresolved: [] }
    const [message] = buildChallengeListMessages({ name: 'Empty', roster: emptyRoster })

    expect(message).toContain('**Want the game** (0):\n```\n(none)\n```')
    expect(message).toContain('Unresolved/guests (0): _none_')
    expect(message).toContain('Total: 0')
  })

  it('chunks into multiple messages, staying comfortably under the 2000-char Discord limit, for a large roster', () => {
    const bigWanters = Array.from({ length: 300 }, (_, i) => entry({ sg_username: `wanter-${i}-${'x'.repeat(20)}` }))
    const bigRoster: Roster = {
      wanters: bigWanters,
      owners: [],
      all: bigWanters,
      unresolved: [],
    }
    const messages = buildChallengeListMessages({ name: 'Huge Challenge', roster: bigRoster })

    expect(messages.length).toBeGreaterThan(1)
    for (const message of messages) {
      expect(message.length).toBeLessThanOrEqual(2000)
    }
  })
})
