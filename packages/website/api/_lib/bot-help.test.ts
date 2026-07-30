import { describe, expect, it } from 'vitest'
import { FORCED_ANNOUNCE_CHANNEL_ID } from './constants.js'
import { buildBotHelpMessages } from './bot-help.js'

describe('buildBotHelpMessages', () => {
  it('returns at least one chunk, each within the 1900-char budget', () => {
    const chunks = buildBotHelpMessages()
    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1900)
    }
  })

  it('the first chunk documents /challenge-setup and where its announcement posts', () => {
    const [first] = buildBotHelpMessages()
    expect(first).toContain('/challenge-setup')
    expect(first).toContain(
      FORCED_ANNOUNCE_CHANNEL_ID ? `<#${FORCED_ANNOUNCE_CHANNEL_ID}>` : 'the channel you run it in'
    )
  })

  it('documents every command exactly once', () => {
    const combined = buildBotHelpMessages().join('\n')
    for (const command of [
      '/challenge-setup',
      '/challenge-edit',
      '/challenge-list',
      '/challenge-archive',
      '/raffle',
      '/mod-report',
      '/bot-help',
    ]) {
      expect(combined).toContain(`**${command}**`)
    }
  })
})
