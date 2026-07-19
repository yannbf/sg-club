import { describe, expect, it } from 'vitest'
import {
  buildRoster,
  parseLogLine,
  serializeChallenge,
  serializeClosed,
  serializeSignup,
} from './signup-log'

const CHALLENGE_META = {
  slug: 'neo-cab',
  channel_id: 'c1',
  message_id: 'm1',
  deadline: 1700000000,
  start: 1700000100,
  end: 1700001000,
  name: 'Neo Cab',
}

const SIGNUP_BASE = {
  slug: 'neo-cab',
  discord_id: 'd1',
  discord_handle: 'yannbf',
  sg_username: 'yannbf' as string | null,
  guest: false,
}

describe('serialize/parseLogLine round trip', () => {
  it('round-trips a CHALLENGE line', () => {
    const line = serializeChallenge(CHALLENGE_META)
    expect(parseLogLine(line)).toEqual({ type: 'CHALLENGE', data: CHALLENGE_META })
  })

  it('round-trips a SIGNUP line', () => {
    const event = { ...SIGNUP_BASE, choice: 'want' as const, ts: 1700000050 }
    const line = serializeSignup(event)
    expect(parseLogLine(line)).toEqual({ type: 'SIGNUP', data: event })
  })

  it('round-trips a CLOSED line', () => {
    const event = { slug: 'neo-cab', ts: 1700000500 }
    const line = serializeClosed(event)
    expect(parseLogLine(line)).toEqual({ type: 'CLOSED', data: event })
  })
})

describe('parseLogLine tolerance', () => {
  it('skips messages with no space', () => {
    expect(parseLogLine('SIGNUP')).toBeNull()
  })

  it('skips messages with an unknown type prefix', () => {
    expect(parseLogLine('HELLO {"foo":"bar"}')).toBeNull()
  })

  it('skips messages with invalid JSON', () => {
    expect(parseLogLine('SIGNUP {not json}')).toBeNull()
  })

  it('skips messages whose JSON is not an object', () => {
    expect(parseLogLine('SIGNUP [1,2,3]')).toBeNull()
    expect(parseLogLine('SIGNUP null')).toBeNull()
  })

  it('skips plain human chat in the log channel', () => {
    expect(parseLogLine('anyone know when this closes?')).toBeNull()
  })

  it('skips a SIGNUP missing required fields', () => {
    expect(parseLogLine('SIGNUP {"slug":"neo-cab"}')).toBeNull()
  })

  it('skips a CHALLENGE missing required fields', () => {
    expect(parseLogLine('CHALLENGE {"slug":"neo-cab"}')).toBeNull()
  })
})

describe('buildRoster', () => {
  function signupLine(overrides: Partial<typeof SIGNUP_BASE & { choice: string; ts: number }>) {
    return {
      content: serializeSignup({
        ...SIGNUP_BASE,
        choice: 'want',
        ts: 1,
        ...overrides,
      } as Parameters<typeof serializeSignup>[0]),
    }
  }

  it('dedupes by discord_id keeping the latest event by ts', () => {
    const messages = [
      signupLine({ discord_id: 'd1', choice: 'want', ts: 100 }),
      signupLine({ discord_id: 'd1', choice: 'have', ts: 200 }),
    ]
    const roster = buildRoster(messages, 'neo-cab')
    expect(roster.owners).toHaveLength(1)
    expect(roster.wanters).toHaveLength(0)
    expect(roster.owners[0].discord_id).toBe('d1')
  })

  it('is independent of array order (newest-first Discord pagination)', () => {
    const messages = [
      signupLine({ discord_id: 'd1', choice: 'have', ts: 200 }),
      signupLine({ discord_id: 'd1', choice: 'want', ts: 100 }),
    ]
    const roster = buildRoster(messages, 'neo-cab')
    expect(roster.owners).toHaveLength(1)
    expect(roster.wanters).toHaveLength(0)
  })

  it('drops users whose latest choice is out', () => {
    const messages = [
      signupLine({ discord_id: 'd1', choice: 'want', ts: 100 }),
      signupLine({ discord_id: 'd1', choice: 'out', ts: 200 }),
    ]
    const roster = buildRoster(messages, 'neo-cab')
    expect(roster.all).toHaveLength(0)
  })

  it('lets a user re-join after withdrawing', () => {
    const messages = [
      signupLine({ discord_id: 'd1', choice: 'want', ts: 100 }),
      signupLine({ discord_id: 'd1', choice: 'out', ts: 200 }),
      signupLine({ discord_id: 'd1', choice: 'have', ts: 300 }),
    ]
    const roster = buildRoster(messages, 'neo-cab')
    expect(roster.owners).toHaveLength(1)
  })

  it('marks guest entries and null sg_username as unresolved', () => {
    const messages = [
      signupLine({ discord_id: 'd1', choice: 'want', ts: 100, guest: true, sg_username: null }),
      signupLine({ discord_id: 'd2', choice: 'have', ts: 100, guest: false, sg_username: null }),
      signupLine({ discord_id: 'd3', choice: 'want', ts: 100, guest: false, sg_username: 'yannbf' }),
    ]
    const roster = buildRoster(messages, 'neo-cab')
    expect(roster.unresolved.map((e) => e.discord_id).sort()).toEqual(['d1', 'd2'])
    expect(roster.all).toHaveLength(3)
  })

  it('ignores SIGNUP events for a different slug', () => {
    const messages = [
      signupLine({ discord_id: 'd1', choice: 'want', ts: 100, slug: 'other-challenge' }),
    ]
    const roster = buildRoster(messages, 'neo-cab')
    expect(roster.all).toHaveLength(0)
  })

  it('ignores non-protocol messages mixed into the channel history', () => {
    const messages = [
      { content: 'hey does anyone know the deadline' },
      signupLine({ discord_id: 'd1', choice: 'want', ts: 100 }),
      { content: 'SIGNUP {broken json' },
    ]
    const roster = buildRoster(messages, 'neo-cab')
    expect(roster.wanters).toHaveLength(1)
  })

  it('separates wanters and owners, with all = union of both', () => {
    const messages = [
      signupLine({ discord_id: 'd1', choice: 'want', ts: 100 }),
      signupLine({ discord_id: 'd2', choice: 'have', ts: 100 }),
    ]
    const roster = buildRoster(messages, 'neo-cab')
    expect(roster.wanters).toHaveLength(1)
    expect(roster.owners).toHaveLength(1)
    expect(roster.all).toHaveLength(2)
  })
})
