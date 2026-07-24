import { beforeEach, describe, expect, it, vi } from 'vitest'
import { serializeArchived, serializeChallenge, serializeSignup } from '../../../website/api/_lib/signup-log'

// Mocked so closeExpiredSignups can be exercised end-to-end without hitting
// the real Discord API.
vi.mock('../../../website/api/_lib/discord-rest', () => ({
  createMessage: vi.fn(async () => ({ id: 'm1', channel_id: 'c1', content: '', timestamp: '' })),
  editMessage: vi.fn(async () => ({ id: 'm1', channel_id: 'c1', content: '', timestamp: '' })),
  getAllChannelMessages: vi.fn(async () => []),
}))

const { closeExpiredSignups } = await import('./discord-close-signups')
const discordRest = await import('../../../website/api/_lib/discord-rest')

const PAST_DEADLINE_META = {
  slug: 'archived-one',
  channel_id: 'c1',
  message_id: 'm1',
  deadline: 1,
  start: 1,
  end: 2,
  name: 'Archived One',
}

const PAST_DEADLINE_ACTIVE_META = {
  slug: 'active-one',
  channel_id: 'c2',
  message_id: 'm2',
  deadline: 1,
  start: 1,
  end: 2,
  name: 'Active One',
}

describe('closeExpiredSignups — archived challenges', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips an archived challenge past its deadline entirely — no summary, no button-disable, no CLOSED marker', async () => {
    vi.mocked(discordRest.getAllChannelMessages).mockResolvedValueOnce([
      { id: 'l1', channel_id: 'log', content: serializeChallenge(PAST_DEADLINE_META), timestamp: '' },
      { id: 'l2', channel_id: 'log', content: serializeArchived({ slug: 'archived-one', ts: 1 }), timestamp: '' },
    ])

    await closeExpiredSignups()

    expect(discordRest.createMessage).not.toHaveBeenCalled()
    expect(discordRest.editMessage).not.toHaveBeenCalled()
  })

  it('still closes a non-archived challenge past its deadline in the same run', async () => {
    vi.mocked(discordRest.getAllChannelMessages).mockResolvedValueOnce([
      { id: 'l1', channel_id: 'log', content: serializeChallenge(PAST_DEADLINE_META), timestamp: '' },
      { id: 'l2', channel_id: 'log', content: serializeArchived({ slug: 'archived-one', ts: 1 }), timestamp: '' },
      { id: 'l3', channel_id: 'log', content: serializeChallenge(PAST_DEADLINE_ACTIVE_META), timestamp: '' },
      {
        id: 'l4',
        channel_id: 'log',
        content: serializeSignup({
          slug: 'active-one',
          choice: 'want',
          discord_id: 'd1',
          discord_handle: 'yannbf',
          sg_username: 'yannbf',
          guest: false,
          ts: 1,
        }),
        timestamp: '',
      },
    ])

    await closeExpiredSignups()

    // The closed-summary post and the button-disable edit both target the
    // active challenge's own channel/message, never the archived one's.
    expect(discordRest.createMessage).toHaveBeenCalledWith(
      'c2',
      expect.objectContaining({ content: expect.stringContaining('Active One') })
    )
    expect(discordRest.createMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ content: expect.stringMatching(/^CLOSED \{.*"slug":"active-one".*\}$/) })
    )
    expect(discordRest.editMessage).toHaveBeenCalledWith('c2', 'm2', expect.anything())
    expect(discordRest.editMessage).not.toHaveBeenCalledWith('c1', 'm1', expect.anything())
  })
})
