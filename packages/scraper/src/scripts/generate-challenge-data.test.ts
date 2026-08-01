import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  completionWinFields,
  getJsonWithRetry,
  reviewFields,
  stickyReviewFields,
  type ReviewFields,
  type ReviewInfo,
} from './generate-challenge-data'

const APP = 794540
const SID = '76561198117390871'
const URL = `https://steamcommunity.com/profiles/${SID}/recommended/${APP}`

const reviewMap = (entries: Record<string, ReviewInfo> = {}) =>
  new Map(Object.entries(entries))

// Mahry's real review, the one that briefly vanished from the Neo Cab board.
const MAHRY_REVIEW: ReviewInfo = {
  voted_up: true,
  timestamp_created: 1783667986,
  recommendationid: '230101341',
}
const MAHRY_PRIOR: ReviewFields = {
  wrote_review: true,
  review_voted_up: true,
  review_timestamp: 1783667986,
  review_recommendationid: '230101341',
  review_url: URL,
}

describe('reviewFields', () => {
  it('maps a found review to full fields', () => {
    const out = reviewFields(SID, APP, reviewMap({ [SID]: MAHRY_REVIEW }))
    expect(out).toEqual(MAHRY_PRIOR)
  })

  it('maps a missing review to the empty shape', () => {
    expect(reviewFields(SID, APP, reviewMap())).toEqual({
      wrote_review: false,
      review_voted_up: null,
      review_timestamp: null,
      review_recommendationid: null,
      review_url: null,
    })
  })
})

describe('stickyReviewFields', () => {
  it('uses the fresh review when the fetch finds one', () => {
    const out = stickyReviewFields(SID, APP, reviewMap({ [SID]: MAHRY_REVIEW }), {
      wrote_review: false,
    })
    expect(out.wrote_review).toBe(true)
    expect(out.review_recommendationid).toBe('230101341')
    expect(out.review_timestamp).toBe(1783667986)
    expect(out.review_url).toBe(URL)
  })

  it('prefers the fresh review over the prior one so edits flow through', () => {
    // Member flipped their recommendation from thumbs-down to thumbs-up.
    const fresh: ReviewInfo = {
      voted_up: true,
      timestamp_created: 200,
      recommendationid: 'new',
    }
    const prior: ReviewFields = {
      wrote_review: true,
      review_voted_up: false,
      review_timestamp: 100,
      review_recommendationid: 'old',
      review_url: URL,
    }
    const out = stickyReviewFields(SID, APP, reviewMap({ [SID]: fresh }), prior)
    expect(out.review_voted_up).toBe(true)
    expect(out.review_recommendationid).toBe('new')
    expect(out.review_timestamp).toBe(200)
  })

  it('carries a prior review forward when the fresh fetch misses it (the flap fix)', () => {
    // Fetch came back empty for this member — the exact Neo Cab failure mode.
    const out = stickyReviewFields(SID, APP, reviewMap(), MAHRY_PRIOR)
    expect(out).toEqual(MAHRY_PRIOR)
  })

  it('reconstructs review_url when a carried-forward prior never stored one', () => {
    const out = stickyReviewFields(SID, APP, reviewMap(), {
      wrote_review: true,
      review_recommendationid: 'r',
    })
    expect(out.wrote_review).toBe(true)
    expect(out.review_url).toBe(URL)
    expect(out.review_recommendationid).toBe('r')
  })

  it('stays "no review" when neither the fetch nor the prior run had one', () => {
    expect(stickyReviewFields(SID, APP, reviewMap(), undefined).wrote_review).toBe(
      false,
    )
    expect(
      stickyReviewFields(SID, APP, reviewMap(), { wrote_review: false })
        .wrote_review,
    ).toBe(false)
  })
})

// The Bloody Spell setup: two prize tiers ("Departure" story clear → full
// completion), review required, "Master of Magic" excluded from the 100% goal.
const START = Date.UTC(2026, 7, 1) / 1000
const DEADLINE = Date.UTC(2026, 8, 1) / 1000
const STORY = 'a10016' // Departure
const EXCLUDED = 'a30008' // Master of Magic

const tieredConfig = (over: Record<string, unknown> = {}) =>
  ({
    slug: 'gaming-challenge-4-bloody-spell',
    dataSlug: 'bloody_spell',
    appId: 992300,
    gameName: 'Bloody Spell',
    startTimestamp: START,
    roster: 'fixed',
    win: {
      type: 'completion',
      deadline: DEADLINE,
      requireReview: true,
      minPlaytimeMinutes: 120,
      storyAchievement: { apiname: STORY, displayName: 'Departure' },
      excludeAchievements: [EXCLUDED],
      ...over,
    },
  }) as any

const player = (over: Record<string, unknown> = {}) =>
  ({
    game: { owned: true, total: 300, twoWeeks: 300 },
    achieved: [],
    stats_available: true,
    achievements_total: 60,
    achievements_unlocked_total: 0,
    achievements_before_challenge: 0,
    challenge_achievements: [],
    challenge_achievement_count: 0,
    ...over,
  }) as any

/** 59 countable unlocks (everything except the excluded one), last at `lastAt`. */
const fullClear = (lastAt: number) =>
  Array.from({ length: 59 }, (_, i) => ({
    apiname: i === 0 ? STORY : `a${i}`,
    unlocktime: i === 58 ? lastAt : START + 1000 + i,
  }))

describe('completionWinFields (tiered)', () => {
  it('story achievement + review qualifies at the story tier', () => {
    const p = player({
      achieved: [{ apiname: STORY, unlocktime: START + 5000 }],
      achievements_unlocked_total: 1,
    })
    const out = completionWinFields(p, tieredConfig(), 150, true) as any
    expect(out.is_winner).toBe(true)
    expect(out.win_tier).toBe('story')
    expect(out.qualified_at).toBe(START + 5000)
    expect(out.is_complete).toBe(false)
  })

  it('neither tier qualifies without the 2h of challenge-window play', () => {
    const p = player({
      achieved: fullClear(START + 90000), // includes the story achievement
      achievements_unlocked_total: 59,
    })
    // 100 minutes played — under the 120-minute floor.
    const out = completionWinFields(p, tieredConfig(), 100, true) as any
    expect(out.is_complete).toBe(true)
    expect(out.story_unlocked).toBe(true)
    expect(out.meets_playtime).toBe(false)
    expect(out.is_winner).toBe(false)
    expect(out.win_tier).toBe(null)
  })

  it('story achievement without the required review does not qualify', () => {
    const p = player({
      achieved: [{ apiname: STORY, unlocktime: START + 5000 }],
      achievements_unlocked_total: 1,
    })
    const out = completionWinFields(p, tieredConfig(), 150, false) as any
    expect(out.is_winner).toBe(false)
    expect(out.win_tier).toBe(null)
    expect(out.story_unlocked).toBe(true)
  })

  it('a pre-challenge story clear still counts (completion semantics)', () => {
    const p = player({
      achieved: [{ apiname: STORY, unlocktime: START - 86400 }],
      achievements_unlocked_total: 1,
    })
    const out = completionWinFields(p, tieredConfig(), 150, true) as any
    expect(out.win_tier).toBe('story')
  })

  it('a story clear after the deadline never qualifies', () => {
    const p = player({
      achieved: [{ apiname: STORY, unlocktime: DEADLINE + 60 }],
      achievements_unlocked_total: 1,
    })
    const out = completionWinFields(p, tieredConfig(), 150, true) as any
    expect(out.is_winner).toBe(false)
    expect(out.story_after_deadline).toBe(true)
  })

  it('unlocking everything except the excluded achievement is full completion', () => {
    const last = START + 90000
    const p = player({
      achieved: fullClear(last),
      achievements_unlocked_total: 59,
    })
    const out = completionWinFields(p, tieredConfig(), 150, true) as any
    expect(out.is_complete).toBe(true)
    expect(out.win_tier).toBe('completion')
    expect(out.completed_at).toBe(last)
    expect(out.qualified_at).toBe(last)
  })

  it('a late excluded-achievement unlock neither blocks nor shifts the 100% moment', () => {
    const last = START + 90000
    const p = player({
      // Excluded achievement unlocked AFTER the deadline — must not push
      // completed_at past it, and must not be required for completion.
      achieved: [
        ...fullClear(last),
        { apiname: EXCLUDED, unlocktime: DEADLINE + 999 },
      ],
      achievements_unlocked_total: 60,
    })
    const out = completionWinFields(p, tieredConfig(), 150, true) as any
    expect(out.is_complete).toBe(true)
    expect(out.completed_at).toBe(last)
    expect(out.completed_after_deadline).toBe(false)
    expect(out.win_tier).toBe('completion')
  })

  it('untiered challenges keep their exact field shape (no story/tier fields)', () => {
    const p = player({
      achieved: [{ apiname: STORY, unlocktime: START + 5000 }],
      achievements_unlocked_total: 1,
    })
    const out = completionWinFields(
      p,
      tieredConfig({ storyAchievement: undefined, excludeAchievements: undefined }),
      150,
      true,
    ) as any
    expect('win_tier' in out).toBe(false)
    expect('story_unlocked' in out).toBe(false)
    expect(out.is_winner).toBe(false)
  })
})

describe('getJsonWithRetry', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('retries transient failures and returns the eventual success', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests' })
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: 1 }) })
    vi.stubGlobal('fetch', fetchMock)

    const p = getJsonWithRetry('https://example.test', 4)
    await vi.runAllTimersAsync()
    await expect(p).resolves.toEqual({ ok: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('throws after exhausting every attempt', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    const p = getJsonWithRetry('https://example.test', 3)
    const assertion = expect(p).rejects.toThrow('network down')
    await vi.runAllTimersAsync()
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
