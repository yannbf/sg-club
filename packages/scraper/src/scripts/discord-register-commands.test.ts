import { describe, expect, it } from 'vitest'
import { commands } from './discord-register-commands'

describe('challenge-setup command registration shape', () => {
  const challengeSetup = commands.find((c) => c.name === 'challenge-setup')

  it('exists and stays admin-only', () => {
    expect(challengeSetup).toBeDefined()
    expect(challengeSetup?.default_member_permissions).toBe('32')
  })

  it('gains exactly one optional congrats-channel option', () => {
    expect(challengeSetup?.options).toHaveLength(1)
    const option = challengeSetup?.options[0]
    expect(option).toMatchObject({
      name: 'congrats-channel',
      type: 7, // CHANNEL
      required: false,
      channel_types: [0], // GUILD_TEXT
    })
    expect(typeof option?.description).toBe('string')
  })
})

describe('other commands are unchanged', () => {
  it('challenge-list still takes no options', () => {
    const challengeList = commands.find((c) => c.name === 'challenge-list')
    expect(challengeList?.options).toEqual([])
    expect(challengeList?.default_member_permissions).toBe('32')
  })

  it('mod-report still takes no options', () => {
    const modReport = commands.find((c) => c.name === 'mod-report')
    expect(modReport?.options).toEqual([])
    expect(modReport?.default_member_permissions).toBe('32')
  })

  it('registers exactly four commands', () => {
    expect(commands).toHaveLength(4)
  })
})

describe('challenge-archive command registration shape', () => {
  const challengeArchive = commands.find((c) => c.name === 'challenge-archive')

  it('exists, is admin-only, and takes no options', () => {
    expect(challengeArchive).toBeDefined()
    expect(challengeArchive?.default_member_permissions).toBe('32')
    expect(challengeArchive?.options).toEqual([])
    expect(typeof challengeArchive?.description).toBe('string')
  })
})
