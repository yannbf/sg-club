import { describe, expect, it, vi } from 'vitest'
import { resolveDiscordUserToSgUsername, validateSgUsername } from './identity'

vi.mock('./data', () => ({
  loadDataFile: vi.fn(async (name: string) => {
    if (name === 'discord_members.json') {
      return {
        members: { yannbf: true, Almostn33t: true },
        handles: { yannbf: 'yann.codes', Almostn33t: 'numaya231_72104' },
      }
    }
    if (name === 'group_users.json') {
      return {
        users: {
          '765611980000000001': { username: 'yannbf', steam_id: '765611980000000001' },
          '765611980000000002': { username: 'Almostn33t', steam_id: '765611980000000002' },
        },
      }
    }
    throw new Error(`unexpected data file ${name}`)
  }),
}))

describe('resolveDiscordUserToSgUsername', () => {
  it('resolves a handle to its SG username', async () => {
    expect(await resolveDiscordUserToSgUsername('yann.codes')).toBe('yannbf')
  })

  it('is case-insensitive', async () => {
    expect(await resolveDiscordUserToSgUsername('YANN.CODES')).toBe('yannbf')
  })

  it('returns null for an unrecognized handle', async () => {
    expect(await resolveDiscordUserToSgUsername('someone-else')).toBeNull()
  })
})

describe('validateSgUsername', () => {
  it('returns the canonical casing for a case-insensitive match', async () => {
    expect(await validateSgUsername('YANNBF')).toBe('yannbf')
  })

  it('trims whitespace before matching', async () => {
    expect(await validateSgUsername('  yannbf  ')).toBe('yannbf')
  })

  it('returns null for a non-member (treated as guest)', async () => {
    expect(await validateSgUsername('totally-not-a-member')).toBeNull()
  })

  it('returns null for empty input', async () => {
    expect(await validateSgUsername('   ')).toBeNull()
  })
})
