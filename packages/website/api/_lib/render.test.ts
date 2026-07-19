import { describe, expect, it } from 'vitest'
import {
  buildAnnouncementEmbed,
  buildChallengeListMessages,
  buildClosedSummaryMessages,
  buildDisabledComponents,
  buildSignupComponents,
  withUpdatedSignupCounts,
} from './render.js'
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

describe('buildAnnouncementEmbed', () => {
  const input = {
    name: 'Neo Cab',
    description: 'A great challenge',
    signupDeadline: 1700000000,
    start: 1700000100,
    end: 1700001000,
  }

  it('sets a plain title (no emoji) and the admin description', () => {
    const embed = buildAnnouncementEmbed(input)
    expect(embed.title).toBe('Neo Cab')
    expect(embed.description).toBe('A great challenge')
  })

  it('renders "Signups close" and "Challenge" as inline fields', () => {
    const embed = buildAnnouncementEmbed(input)
    const fields = embed.fields as Array<{ name: string; value: string; inline?: boolean }>

    const close = fields.find((f) => f.name === 'Signups close')
    expect(close).toEqual({ name: 'Signups close', value: '<t:1700000000:R>', inline: true })

    const challenge = fields.find((f) => f.name === 'Challenge')
    expect(challenge).toEqual({
      name: 'Challenge',
      value: '<t:1700000100:d> → <t:1700001000:d>',
      inline: true,
    })
  })

  it('sets the initial zero counts on the embed footer (not a field)', () => {
    const embed = buildAnnouncementEmbed(input)
    expect(embed.footer).toEqual({ text: '🎁 0 want · ✅ 0 have' })
    const fields = embed.fields as Array<{ name: string; value: string; inline?: boolean }>
    expect(fields.some((f) => f.name === 'Signups so far')).toBe(false)
  })

  it('sets the banner image', () => {
    const embed = buildAnnouncementEmbed(input)
    expect(embed.image).toEqual({ url: 'https://sg-club.vercel.app/game-challenge-banner.png' })
  })

  it('keeps the accent color', () => {
    const embed = buildAnnouncementEmbed(input)
    expect(embed.color).toBe(0x5865f2)
  })
})

describe('withUpdatedSignupCounts', () => {
  it('updates the footer text with the new counts, preserving other fields untouched', () => {
    const embed = buildAnnouncementEmbed({
      name: 'Neo Cab',
      description: 'desc',
      signupDeadline: 1,
      start: 2,
      end: 3,
    })
    const updated = withUpdatedSignupCounts(embed, 3, 2)
    expect(updated.footer).toEqual({ text: '🎁 3 want · ✅ 2 have' })
    const fields = updated.fields as Array<{ name: string; value: string; inline?: boolean }>
    expect(fields.find((f) => f.name === 'Signups close')).toMatchObject({ inline: true })
    expect(fields.find((f) => f.name === 'Challenge')).toMatchObject({ inline: true })
  })

  it('preserves other footer properties (e.g. an icon_url) when updating the text', () => {
    const embed = { ...buildAnnouncementEmbed({
      name: 'Neo Cab',
      description: 'desc',
      signupDeadline: 1,
      start: 2,
      end: 3,
    }), footer: { text: 'old', icon_url: 'https://example.com/icon.png' } }
    const updated = withUpdatedSignupCounts(embed, 5, 4)
    expect(updated.footer).toEqual({
      text: '🎁 5 want · ✅ 4 have',
      icon_url: 'https://example.com/icon.png',
    })
  })

  it('preserves the image and other top-level embed fields', () => {
    const embed = buildAnnouncementEmbed({
      name: 'Neo Cab',
      description: 'desc',
      signupDeadline: 1,
      start: 2,
      end: 3,
    })
    const updated = withUpdatedSignupCounts(embed, 1, 1)
    expect(updated.image).toEqual(embed.image)
    expect(updated.title).toBe(embed.title)
  })
})

describe('buildSignupComponents', () => {
  it('builds the three signup buttons plus a trailing link button', () => {
    const rows = buildSignupComponents('neo-cab', 1700000000)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.components).toHaveLength(4)
  })

  it('appends a type-2 style-5 link button pointing at the fixed events url, with no custom_id', () => {
    const rows = buildSignupComponents('neo-cab', 1700000000)
    const buttons = rows[0]!.components

    const linkButton = buttons[3]!
    expect(linkButton).toMatchObject({
      type: 2,
      style: 5,
      label: 'View Event',
      url: 'https://sg-club.vercel.app/events/',
    })
    expect(linkButton.custom_id).toBeUndefined()
  })

  it('keeps the three signup buttons with valid custom_ids alongside the link button', () => {
    const rows = buildSignupComponents('neo-cab', 1700000000)
    const signupButtons = rows[0]!.components.slice(0, 3)
    for (const button of signupButtons) {
      expect(button.custom_id).toContain('neo-cab')
      expect(button.url).toBeUndefined()
    }
  })

  it('uses a plain "✕ Withdraw" label (no emoji) for the withdraw button', () => {
    const rows = buildSignupComponents('neo-cab', 1700000000)
    const withdrawButton = rows[0]!.components.find((c) => c.label.includes('Withdraw'))
    expect(withdrawButton?.label).toBe('✕ Withdraw')
  })
})

describe('buildDisabledComponents', () => {
  it('disables only the three signup buttons, leaving the link button enabled', () => {
    const rows = buildDisabledComponents('neo-cab', 1700000000)
    const buttons = rows[0]!.components
    expect(buttons).toHaveLength(4)

    const signupButtons = buttons.filter((b) => b.style !== 5)
    const linkButton = buttons.find((b) => b.style === 5)!

    expect(signupButtons).toHaveLength(3)
    expect(signupButtons.every((b) => b.disabled === true)).toBe(true)
    expect(linkButton.disabled).toBeUndefined()
    expect(linkButton.url).toBe('https://sg-club.vercel.app/events/')
  })
})

describe('buildClosedSummaryMessages', () => {
  it('renders a plain-markdown header + want/have lines with no embed', () => {
    const wanters = [entry({ sg_username: 'alice' }), entry({ sg_username: 'bob' })]
    const owners = [entry({ sg_username: 'carol' })]
    const [message] = buildClosedSummaryMessages({ name: 'Neo Cab', wanters, owners })

    expect(message).toBe(
      '**Signups closed — Neo Cab**\n' +
        'Want the game (2): alice, bob\n' +
        'Already have it (1): carol\n' +
        "Let's get to gaming! Best of luck to you all <3"
    )
  })

  it('appends the farewell paragraph to the last chunked message when the roster is large', () => {
    const wanters = Array.from({ length: 200 }, (_, i) => entry({ sg_username: `wanter-with-a-long-name-${i}` }))
    const messages = buildClosedSummaryMessages({ name: 'Big Challenge', wanters, owners: [] })

    expect(messages.length).toBeGreaterThan(1)
    expect(messages[messages.length - 1]).toContain("Let's get to gaming! Best of luck to you all <3")
    for (const message of messages.slice(0, -1)) {
      expect(message).not.toContain('Best of luck')
    }
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
