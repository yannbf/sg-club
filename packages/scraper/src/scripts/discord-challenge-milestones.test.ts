import { beforeEach, describe, expect, it, vi } from 'vitest'
import { serializeArchived, serializeChallenge } from '../../../website/api/_lib/signup-log'

// Mocked so postChallengeMilestones can be exercised end-to-end (the
// archived-skip behavior below) without hitting the real Discord API.
vi.mock('../../../website/api/_lib/discord-rest', () => ({
  createMessage: vi.fn(async () => ({ id: 'm1', channel_id: 'c1', content: '', timestamp: '' })),
  getAllChannelMessages: vi.fn(async () => []),
}))

const {
  build24hReminderMessage,
  buildEndedMessage,
  challengePhrase,
  matchChallengeFile,
  needsEndedNotice,
  needsReminder,
  postChallengeMilestones,
} = await import('./discord-challenge-milestones')
const discordRest = await import('../../../website/api/_lib/discord-rest')

describe('challengePhrase', () => {
  it('appends " challenge" when the name does not already end with the word', () => {
    expect(challengePhrase('Neo Cab')).toBe('Neo Cab challenge')
  })

  it('leaves the name as-is when it already ends with "challenge" (case-insensitive)', () => {
    expect(challengePhrase('Test Challenge')).toBe('Test Challenge')
    expect(challengePhrase('test challenge')).toBe('test challenge')
    expect(challengePhrase('Weird CHALLENGE')).toBe('Weird CHALLENGE')
  })

  it('tolerates trailing whitespace when checking for the word "challenge"', () => {
    expect(challengePhrase('Test Challenge  ')).toBe('Test Challenge')
  })

  it('does not false-positive on a name that merely contains "challenge" mid-string', () => {
    expect(challengePhrase('Challenge Accepted')).toBe('Challenge Accepted challenge')
  })
})

describe('build24hReminderMessage', () => {
  it('builds the headline + qualified-count sentence when a count is given', () => {
    expect(build24hReminderMessage('Neo Cab', 5)).toBe(
      "Only 24h until the Neo Cab challenge is over! We've got 5 qualified members so far!"
    )
  })

  it('uses the name as-is when it already ends with "challenge"', () => {
    expect(build24hReminderMessage('Test Challenge', 2)).toBe(
      "Only 24h until the Test Challenge is over! We've got 2 qualified members so far!"
    )
  })

  it('omits the second sentence entirely when qualifiedCount is null, rather than showing 0', () => {
    expect(build24hReminderMessage('Neo Cab', null)).toBe('Only 24h until the Neo Cab challenge is over!')
  })

  it('still shows a count of 0 when a data file matched but nobody has qualified yet', () => {
    expect(build24hReminderMessage('Neo Cab', 0)).toBe(
      "Only 24h until the Neo Cab challenge is over! We've got 0 qualified members so far!"
    )
  })
})

describe('buildEndedMessage', () => {
  it('builds the exact "challenge over" message with a no-preview link', () => {
    expect(buildEndedMessage('Neo Cab')).toBe(
      'The Neo Cab challenge is over! Click [here](<https://sg-club.vercel.app/events/>) to see the results'
    )
  })

  it('applies the same "challenge" dedup as the 24h reminder', () => {
    expect(buildEndedMessage('Test Challenge')).toBe(
      'The Test Challenge is over! Click [here](<https://sg-club.vercel.app/events/>) to see the results'
    )
  })
})

describe('matchChallengeFile', () => {
  const files = [
    { slug: 'neo-cab', gameName: 'Neo Cab', participants: [] },
    { slug: 'kill-the-crows-json-slug', gameName: 'Kill the Crows', participants: [] },
  ]

  it('matches on exact slug equality first', () => {
    const match = matchChallengeFile({ slug: 'neo-cab', name: 'Neo Cab' }, files)
    expect(match?.slug).toBe('neo-cab')
  })

  it('falls back to slugify(gameName) === meta.slug', () => {
    const match = matchChallengeFile({ slug: 'kill-the-crows', name: 'Something Else' }, files)
    expect(match?.slug).toBe('kill-the-crows-json-slug')
  })

  it('falls back to slugify(meta.name) === json.slug', () => {
    const match = matchChallengeFile({ slug: 'unrelated-slug', name: 'kill the crows json slug' }, files)
    expect(match?.slug).toBe('kill-the-crows-json-slug')
  })

  it('falls back to slugify(meta.name) === slugify(json.gameName)', () => {
    const match = matchChallengeFile({ slug: 'unrelated-slug', name: 'Neo Cab!!' }, files)
    expect(match?.slug).toBe('neo-cab')
  })

  it('returns undefined when nothing matches', () => {
    const match = matchChallengeFile({ slug: 'totally-unmatched', name: 'Totally Unmatched' }, files)
    expect(match).toBeUndefined()
  })
})

describe('needsReminder', () => {
  const NOW = 1_700_000_000
  // A start far enough back that end - start always exceeds the 24h window.
  const LONG_AGO = NOW - 30 * 24 * 60 * 60

  it('is true when the challenge ends within 24h and has not been reminded', () => {
    const meta = { slug: 'neo-cab', start: LONG_AGO, end: NOW + 60 * 60 } // 1h from now
    expect(needsReminder(meta, new Set(), NOW)).toBe(true)
  })

  it('is true at exactly the 24h boundary', () => {
    const meta = { slug: 'neo-cab', start: LONG_AGO, end: NOW + 24 * 60 * 60 }
    expect(needsReminder(meta, new Set(), NOW)).toBe(true)
  })

  it('is false when more than 24h remain', () => {
    const meta = { slug: 'neo-cab', start: LONG_AGO, end: NOW + 25 * 60 * 60 }
    expect(needsReminder(meta, new Set(), NOW)).toBe(false)
  })

  it('is false once the challenge has already ended (end <= now)', () => {
    const meta = { slug: 'neo-cab', start: LONG_AGO, end: NOW - 1 }
    expect(needsReminder(meta, new Set(), NOW)).toBe(false)
  })

  it('is false when a REMINDER24 marker already exists for the slug', () => {
    const meta = { slug: 'neo-cab', start: LONG_AGO, end: NOW + 60 * 60 }
    expect(needsReminder(meta, new Set(['neo-cab']), NOW)).toBe(false)
  })

  it('is false for challenges whose total duration is 24h or less (born inside the window)', () => {
    // A 15h challenge created moments ago — the live edge case that fired a
    // "24h left" reminder minutes after the challenge was announced.
    const shortMeta = { slug: 'flash', start: NOW - 60, end: NOW - 60 + 15 * 60 * 60 }
    expect(needsReminder(shortMeta, new Set(), NOW)).toBe(false)
    // Exactly 24h long: still suppressed.
    const exactMeta = { slug: 'exact', start: NOW, end: NOW + 24 * 60 * 60 }
    expect(needsReminder(exactMeta, new Set(), NOW)).toBe(false)
    // Just over 24h long: eligible once inside the window.
    const longerMeta = { slug: 'longer', start: NOW - 2 * 60 * 60, end: NOW + 23 * 60 * 60 }
    expect(needsReminder(longerMeta, new Set(), NOW)).toBe(true)
  })
})

describe('needsEndedNotice', () => {
  const NOW = 1_700_000_000

  it('is true once end has passed and no ENDED marker exists', () => {
    const meta = { slug: 'neo-cab', end: NOW - 1 }
    expect(needsEndedNotice(meta, new Set(), NOW)).toBe(true)
  })

  it('is true at exactly end === now', () => {
    const meta = { slug: 'neo-cab', end: NOW }
    expect(needsEndedNotice(meta, new Set(), NOW)).toBe(true)
  })

  it('is false while the challenge is still running', () => {
    const meta = { slug: 'neo-cab', end: NOW + 1 }
    expect(needsEndedNotice(meta, new Set(), NOW)).toBe(false)
  })

  it('is false once an ENDED marker already exists for the slug', () => {
    const meta = { slug: 'neo-cab', end: NOW - 1 }
    expect(needsEndedNotice(meta, new Set(['neo-cab']), NOW)).toBe(false)
  })
})

describe('postChallengeMilestones — archived challenges', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const PAST_END = { slug: 'archived-one', channel_id: 'c1', message_id: 'm1', deadline: 1, start: 1, end: 1, name: 'Archived One' }
  const PAST_END_ACTIVE = { slug: 'active-one', channel_id: 'c2', message_id: 'm2', deadline: 1, start: 1, end: 1, name: 'Active One' }

  it('skips an archived challenge entirely — no ended notice, no marker posted for it', async () => {
    vi.mocked(discordRest.getAllChannelMessages).mockResolvedValueOnce([
      { id: 'l1', channel_id: 'log', content: serializeChallenge(PAST_END), timestamp: '' },
      { id: 'l2', channel_id: 'log', content: serializeArchived({ slug: 'archived-one', ts: 1 }), timestamp: '' },
    ])

    await postChallengeMilestones()

    // Only the CHALLENGE + ARCHIVED reads happened; no message was ever
    // posted to the challenge's own channel or a new marker to the log.
    expect(discordRest.createMessage).not.toHaveBeenCalled()
  })

  it('still processes a non-archived challenge in the same run', async () => {
    vi.mocked(discordRest.getAllChannelMessages).mockResolvedValueOnce([
      { id: 'l1', channel_id: 'log', content: serializeChallenge(PAST_END), timestamp: '' },
      { id: 'l2', channel_id: 'log', content: serializeArchived({ slug: 'archived-one', ts: 1 }), timestamp: '' },
      { id: 'l3', channel_id: 'log', content: serializeChallenge(PAST_END_ACTIVE), timestamp: '' },
    ])

    await postChallengeMilestones()

    // Ended notice + ENDED marker for the non-archived challenge only.
    expect(discordRest.createMessage).toHaveBeenCalledWith(
      'c2',
      expect.objectContaining({ content: expect.stringContaining('Active One') })
    )
    expect(discordRest.createMessage).not.toHaveBeenCalledWith(
      'c1',
      expect.anything()
    )
  })
})
