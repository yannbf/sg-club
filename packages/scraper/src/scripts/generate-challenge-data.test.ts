import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  achievementWinFields,
  carryPriorProgress,
  completionWinFields,
  findPriorRowByName,
  getJsonWithRetry,
  hasPlayedChallengeGame,
  parseReviewPage,
  resolveBaseline,
  resolveFixedRoster,
  reviewFields,
  seedFrozenWinners,
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

describe('stickyReviewFields (unreadable fields on a found review)', () => {
  it('keeps the prior timestamp and recommendation id when the fresh ones are empty', () => {
    const fresh: ReviewInfo = { voted_up: true, timestamp_created: 0, recommendationid: '' }
    const out = stickyReviewFields(SID, APP, reviewMap({ [SID]: fresh }), MAHRY_PRIOR)
    expect(out.wrote_review).toBe(true)
    expect(out.review_timestamp).toBe(1783667986)
    expect(out.review_recommendationid).toBe('230101341')
  })

  it('takes whichever fresh field did parse and backfills only the other', () => {
    const fresh: ReviewInfo = { voted_up: true, timestamp_created: 0, recommendationid: 'new' }
    const out = stickyReviewFields(SID, APP, reviewMap({ [SID]: fresh }), MAHRY_PRIOR)
    expect(out.review_recommendationid).toBe('new')
    expect(out.review_timestamp).toBe(1783667986)
  })

  it('leaves empty fields empty when there is no prior to backfill from', () => {
    const fresh: ReviewInfo = { voted_up: true, timestamp_created: 0, recommendationid: '' }
    const out = stickyReviewFields(SID, APP, reviewMap({ [SID]: fresh }), undefined)
    expect(out.wrote_review).toBe(true)
    expect(out.review_timestamp).toBe(0)
    expect(out.review_recommendationid).toBe('')
  })
})

const reviewPage = ({
  thumbs = 'icon_thumbsUp',
  summary = 'Recommended',
  posted = 'Posted: 21 Aug @ 9:46pm',
  recommendationId = '233397091',
  title = `Review for Some Game`,
  trailer = '',
}: {
  thumbs?: string
  summary?: string
  posted?: string
  recommendationId?: string
  title?: string
  trailer?: string
} = {}) => `
  <html><head><title>${title}</title></head><body>
    <div class="ratingSummaryBlock" id="ReviewTitle">
      <img src="https://community.akamai.steamstatic.com/public/images/${thumbs}.png">
      <div class="ratingSummary">${summary}</div>
      <div class="recommendation_date">${posted}</div>
      <div class="review_body">Great game, would play again.</div>
    </div>
    <div id="RecommendationVoteUpBtn${recommendationId}">Yes</div>
    <div id="RecommendationVoteDownBtn${recommendationId}">No</div>
    ${trailer}
  </body></html>
`

describe('parseReviewPage', () => {
  it('parses a recommended review with a no-year date', () => {
    const html = reviewPage()
    const out = parseReviewPage(html, URL, APP)
    expect(out).not.toBeNull()
    expect(out!.voted_up).toBe(true)
    expect(out!.recommendationid).toBe('233397091')
    const d = new Date(out!.timestamp_created * 1000)
    expect(d.getUTCMonth()).toBe(7) // August
    expect(d.getUTCDate()).toBe(21)
    expect(d.getUTCHours()).toBe(21)
    expect(d.getUTCMinutes()).toBe(46)
  })

  it('parses a not-recommended review with a year in the date', () => {
    const html = reviewPage({
      thumbs: 'icon_thumbsDown',
      summary: 'Not Recommended',
      posted: 'Posted: 21 August, 2024 @ 9:46pm',
    })
    const out = parseReviewPage(html, URL, APP)
    expect(out).not.toBeNull()
    expect(out!.voted_up).toBe(false)
    const d = new Date(out!.timestamp_created * 1000)
    expect(d.getUTCFullYear()).toBe(2024)
    expect(d.getUTCMonth()).toBe(7)
    expect(d.getUTCDate()).toBe(21)
  })

  it('returns null when the final URL was redirected away (no review)', () => {
    const html = reviewPage()
    const redirectedUrl = `https://steamcommunity.com/profiles/${SID}/recommended/`
    expect(parseReviewPage(html, redirectedUrl, APP)).toBeNull()
  })

  it("returns null when the final URL matches but the title lacks 'Review for'", () => {
    const html = reviewPage({ title: "Some Member's Profile" })
    expect(parseReviewPage(html, URL, APP)).toBeNull()
  })

  it("ignores a sidebar thumbs-down that follows the main review's block", () => {
    const html = reviewPage({
      trailer:
        '<div class="review_box"><img src="https://x/icon_thumbsDown.png"></div>',
    })
    const out = parseReviewPage(html, URL, APP)
    expect(out!.voted_up).toBe(true)
  })

  it('takes the recommendation id from the first vote button after ReviewTitle', () => {
    const html = reviewPage({ recommendationId: '111' })
    const out = parseReviewPage(html, URL, APP)
    expect(out!.recommendationid).toBe('111')
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

// The Vellum setup: a single-achievement goal replaces the 100% goal, review
// required, no playtime floor.
const GOAL_START = Date.UTC(2026, 9, 1) / 1000
const GOAL_DEADLINE = Date.UTC(2026, 10, 1) / 1000
const GOAL = 'RAID_COMPLETE_RAVING'

const goalConfig = (over: Record<string, unknown> = {}) =>
  ({
    slug: 'gaming-challenge-6-vellum',
    dataSlug: 'vellum',
    appId: 917950,
    gameName: 'Vellum',
    startTimestamp: GOAL_START,
    roster: 'fixed',
    win: {
      type: 'completion',
      deadline: GOAL_DEADLINE,
      requireReview: true,
      goalAchievement: { apiname: GOAL, displayName: 'The Grey Area' },
      ...over,
    },
  }) as any

describe('completionWinFields (goalAchievement)', () => {
  it('goal unlocked before the challenge start, with a review, wins', () => {
    const p = player({
      achieved: [{ apiname: GOAL, unlocktime: GOAL_START - 86400 }],
      achievements_unlocked_total: 1,
    })
    const out = completionWinFields(p, goalConfig(), 0, true) as any
    expect(out.is_complete).toBe(true)
    expect(out.completed_at).toBe(GOAL_START - 86400)
    expect(out.completed_before_start).toBe(true)
    expect(out.is_winner).toBe(true)
  })

  it('goal unlocked after the deadline does not qualify', () => {
    const p = player({
      achieved: [{ apiname: GOAL, unlocktime: GOAL_DEADLINE + 60 }],
      achievements_unlocked_total: 1,
    })
    const out = completionWinFields(p, goalConfig(), 0, true) as any
    expect(out.is_complete).toBe(true)
    expect(out.completed_after_deadline).toBe(true)
    expect(out.is_winner).toBe(false)
  })

  it('goal unlocked without the required review does not qualify', () => {
    const p = player({
      achieved: [{ apiname: GOAL, unlocktime: GOAL_START + 500 }],
      achievements_unlocked_total: 1,
    })
    const out = completionWinFields(p, goalConfig(), 0, false) as any
    expect(out.is_complete).toBe(true)
    expect(out.meets_review).toBe(false)
    expect(out.is_winner).toBe(false)
  })

  it('unlocking other achievements does not satisfy the goal', () => {
    const p = player({
      achieved: [{ apiname: 'some_other_achievement', unlocktime: GOAL_START + 500 }],
      achievements_unlocked_total: 1,
    })
    const out = completionWinFields(p, goalConfig(), 0, true) as any
    expect(out.is_complete).toBe(false)
    expect(out.completed_at).toBe(null)
    expect(out.is_winner).toBe(false)
  })

  it('a goal-achievement challenge keeps the untiered field shape', () => {
    const p = player({
      achieved: [{ apiname: GOAL, unlocktime: GOAL_START + 500 }],
      achievements_unlocked_total: 1,
    })
    const out = completionWinFields(p, goalConfig(), 0, true) as any
    expect('win_tier' in out).toBe(false)
    expect('story_unlocked' in out).toBe(false)
  })
})

/** What a fresh pull looks like when Steam hides the member's library. */
const hiddenPull = () =>
  player({
    game: { owned: false, total: 0, twoWeeks: 0 },
    stats_available: false,
    achievements_total: 0,
  })

describe('carryPriorProgress', () => {
  const GOAL_AT = 1791049400

  // A persisted row that already lost the win: the goal sits in
  // challenge_achievements but completion was recomputed from a hidden pull.
  const droppedGoalRow = () => ({
    owned: false,
    stats_available: true,
    playtime_total_minutes: 588,
    achievements_total: 40,
    achievements_unlocked_total: 18,
    achievements_before_challenge: 3,
    challenge_achievements: [
      { apiname: 'EARLY', displayName: 'Early', unlocktime: GOAL_START + 100 },
      { apiname: GOAL, displayName: 'The Grey Area', unlocktime: GOAL_AT },
    ],
    challenge_achievement_count: 2,
    completed_at: null,
    is_complete: false,
  })

  it('restores a goal win a previous hidden pull already dropped', () => {
    const p = hiddenPull()
    carryPriorProgress(p, droppedGoalRow(), goalConfig())
    const out = completionWinFields(p, goalConfig(), 0, true) as any
    expect(out.is_complete).toBe(true)
    expect(out.completed_at).toBe(GOAL_AT)
    expect(out.is_winner).toBe(true)
    expect(p.game.owned).toBe(true)
    expect(p.game.total).toBe(588)
    expect(p.achievements_unlocked_total).toBe(18)
    expect(p.stats_available).toBe(true)
  })

  it('keeps a goal unlocked before the start, which challenge_achievements omits', () => {
    const preStart = GOAL_START - 86400
    const p = hiddenPull()
    carryPriorProgress(
      p,
      {
        owned: true,
        playtime_total_minutes: 90,
        achievements_unlocked_total: 5,
        challenge_achievements: [],
        completed_at: preStart,
        is_complete: true,
      },
      goalConfig(),
    )
    const out = completionWinFields(p, goalConfig(), 0, true) as any
    expect(out.is_complete).toBe(true)
    expect(out.completed_at).toBe(preStart)
    expect(out.completed_before_start).toBe(true)
    expect(out.is_winner).toBe(true)
  })

  it('leaves a fresh public pull that already has the goal untouched', () => {
    const p = player({
      achieved: [
        { apiname: 'EARLY', unlocktime: GOAL_START + 100 },
        { apiname: GOAL, unlocktime: GOAL_AT },
      ],
      achievements_total: 40,
      achievements_unlocked_total: 18,
    })
    carryPriorProgress(
      p,
      { ...droppedGoalRow(), completed_at: GOAL_AT, is_complete: true },
      goalConfig(),
    )
    expect(p.achieved.filter((a: any) => a.apiname === GOAL)).toHaveLength(1)
    expect(p.achieved).toHaveLength(2)
    const out = completionWinFields(p, goalConfig(), 0, true) as any
    expect(out.completed_at).toBe(GOAL_AT)
  })

  it('carries a 100% completion through a hidden pull via the carried timestamp', () => {
    const last = START + 90000
    const p = hiddenPull()
    carryPriorProgress(
      p,
      {
        owned: true,
        playtime_total_minutes: 600,
        achievements_total: 60,
        achievements_unlocked_total: 59,
        achievements_before_challenge: 0,
        challenge_achievements: [],
        completed_at: last,
        is_complete: true,
      },
      tieredConfig({ storyAchievement: undefined }),
    )
    const out = completionWinFields(
      p,
      tieredConfig({ storyAchievement: undefined }),
      150,
      true,
    ) as any
    expect(p.achieved).toEqual([{ apiname: '__carried__', unlocktime: last }])
    expect(out.is_complete).toBe(true)
    expect(out.completed_at).toBe(last)
    expect(out.is_winner).toBe(true)
  })

  it('subtracts re-seeded excluded unlocks from a carried 100% count', () => {
    const last = START + 90000
    const p = hiddenPull()
    carryPriorProgress(
      p,
      {
        owned: true,
        playtime_total_minutes: 600,
        achievements_total: 60,
        // 59 countable unlocks plus the excluded one.
        achievements_unlocked_total: 60,
        achievements_before_challenge: 0,
        challenge_achievements: [{ apiname: EXCLUDED, unlocktime: DEADLINE + 999 }],
        completed_at: last,
        is_complete: true,
      },
      tieredConfig({ storyAchievement: undefined }),
    )
    const out = completionWinFields(
      p,
      tieredConfig({ storyAchievement: undefined }),
      150,
      true,
    ) as any
    expect(out.is_complete).toBe(true)
    expect(out.completed_at).toBe(last)
    expect(out.completed_after_deadline).toBe(false)
  })

  it('restores a story unlock from before the start on a tiered challenge', () => {
    const preStart = START - 86400
    const p = hiddenPull()
    carryPriorProgress(
      p,
      {
        owned: true,
        playtime_total_minutes: 300,
        achievements_unlocked_total: 1,
        challenge_achievements: [],
        story_unlocked: true,
        story_unlocktime: preStart,
      },
      tieredConfig(),
    )
    const out = completionWinFields(p, tieredConfig(), 150, true) as any
    expect(out.story_unlocked).toBe(true)
    expect(out.story_unlocktime).toBe(preStart)
    expect(out.win_tier).toBe('story')
  })

  it('treats positive prior playtime as proof of ownership', () => {
    const p = hiddenPull()
    carryPriorProgress(p, { owned: false, playtime_total_minutes: 12 }, goalConfig())
    expect(p.game.owned).toBe(true)
  })

  it('does not invent ownership for a member who never owned the game', () => {
    const p = hiddenPull()
    carryPriorProgress(p, { owned: false, playtime_total_minutes: 0 }, goalConfig())
    expect(p.game.owned).toBe(false)
  })

  it('is a no-op without a prior row', () => {
    const p = hiddenPull()
    const before = JSON.parse(JSON.stringify(p))
    carryPriorProgress(p, undefined, goalConfig())
    expect(p).toEqual(before)
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

describe('resolveBaseline', () => {
  const NOW_EARLY = START + 5 * 86400
  const NOW_LATE = START + 30 * 86400
  const pull = (over: Record<string, unknown> = {}) =>
    player({ game: { owned: true, total: 900, twoWeeks: 100 }, ...over })
  const opts = (nowSeconds: number, signupPreview = false) => ({
    startTimestamp: START,
    nowSeconds,
    signupPreview,
  })

  it('seeds total minus two weeks when first seen within 14 days of the start', () => {
    expect(resolveBaseline(pull(), undefined, opts(NOW_EARLY))).toBe(800)
  })

  it('seeds 0 when first seen later and no achievement predates the start', () => {
    expect(resolveBaseline(pull(), undefined, opts(NOW_LATE))).toBe(0)
  })

  it('keeps total minus two weeks when first seen later but pre-start achievements prove earlier play', () => {
    const p = pull({ achievements_before_challenge: 4 })
    expect(resolveBaseline(p, undefined, opts(NOW_LATE))).toBe(800)
  })

  it('uses the current total in a sign-up preview, regardless of timing or prior', () => {
    expect(resolveBaseline(pull(), undefined, opts(NOW_LATE, true))).toBe(900)
    expect(
      resolveBaseline(pull(), { baseline_playtime_minutes: 10 }, opts(NOW_LATE, true)),
    ).toBe(900)
  })

  it('trusts a recorded baseline, including a 0 that came with real playtime', () => {
    const o = opts(NOW_LATE)
    expect(resolveBaseline(pull(), { baseline_playtime_minutes: 50 }, o)).toBe(50)
    expect(
      resolveBaseline(
        pull(),
        {
          baseline_playtime_minutes: 0,
          playtime_total_minutes: 300,
          achievements_unlocked_total: 5,
        },
        o,
      ),
    ).toBe(0)
  })

  it('keeps a genuine never-played row at 0', () => {
    const row = {
      baseline_playtime_minutes: 0,
      playtime_total_minutes: 0,
      achievements_unlocked_total: 0,
    }
    expect(resolveBaseline(pull(), row, opts(NOW_EARLY))).toBe(0)
  })

  describe('a row seeded while playtime was hidden', () => {
    const hiddenRow = {
      baseline_playtime_minutes: 0,
      playtime_total_minutes: 0,
      achievements_unlocked_total: 6,
    }

    it('is seeded from the first pull that shows playtime (early rule)', () => {
      expect(resolveBaseline(pull(), hiddenRow, opts(NOW_EARLY))).toBe(800)
    })

    it('is seeded with the late rule: 0 without pre-start achievements', () => {
      expect(resolveBaseline(pull(), hiddenRow, opts(NOW_LATE))).toBe(0)
    })

    it('is seeded with the late rule: total minus two weeks with pre-start achievements', () => {
      const p = pull({ achievements_before_challenge: 2 })
      expect(resolveBaseline(p, hiddenRow, opts(NOW_LATE))).toBe(800)
    })

    it('stays 0 while playtime is still hidden', () => {
      const p = pull({ game: { owned: true, total: 0, twoWeeks: 0 } })
      expect(resolveBaseline(p, hiddenRow, opts(NOW_EARLY))).toBe(0)
    })
  })
})

describe('findPriorRowByName and resolveFixedRoster', () => {
  const GHOST_ID = '76561198000000001'
  const priorRows = [
    {
      steam_id: GHOST_ID,
      username: 'Ghost Display',
      sg_username: 'GhostUser',
      avatar_url: 'https://cdn.test/ghost.jpg',
      profile_url: 'https://steamcommunity.com/id/ghost',
    },
  ]

  const failSteamLookups = () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('steam down')))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  }

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('matches by sg_username or username, ignoring case', () => {
    expect(findPriorRowByName(priorRows, ['ghostuser'])?.steam_id).toBe(GHOST_ID)
    expect(findPriorRowByName(priorRows, [undefined, 'GHOST DISPLAY'])?.steam_id).toBe(
      GHOST_ID,
    )
    expect(findPriorRowByName(priorRows, ['nobody'])).toBeUndefined()
    expect(findPriorRowByName(priorRows, [undefined])).toBeUndefined()
  })

  it('recovers an unresolvable roster entry from the prior rows', async () => {
    failSteamLookups()
    const out = await resolveFixedRoster(
      { participants: ['ghostuser'], guests: [] },
      new Map(),
      new Map(),
      new Map(),
      priorRows,
    )
    expect(out).toHaveLength(1)
    expect(out[0].steam_id).toBe(GHOST_ID)
    expect(out[0].is_guest).toBe(false)
    expect(out[0].sg_username).toBe('ghostuser')
  })

  it('still skips an entry that neither the id sources nor the prior rows know', async () => {
    failSteamLookups()
    const out = await resolveFixedRoster(
      { participants: ['stranger'], guests: [] },
      new Map(),
      new Map(),
      new Map(),
      priorRows,
    )
    expect(out).toEqual([])
  })

  it('keeps the roster list an entry was written into as its guest status', async () => {
    failSteamLookups()
    const out = await resolveFixedRoster(
      { participants: [], guests: ['ghostuser'] },
      new Map(),
      new Map(),
      new Map(),
      priorRows,
    )
    expect(out[0].is_guest).toBe(true)
  })

  it('falls back to the prior avatar, profile and name when the Steam lookup fails', async () => {
    failSteamLookups()
    const out = await resolveFixedRoster(
      { participants: [{ steam_id: GHOST_ID }], guests: [] },
      new Map(),
      new Map(),
      new Map(),
      priorRows,
    )
    expect(out[0].avatar_url).toBe('https://cdn.test/ghost.jpg')
    expect(out[0].profile_url).toBe('https://steamcommunity.com/id/ghost')
    expect(out[0].display_name).toBe('Ghost Display')
  })

  it('prefers a successful Steam lookup over the prior row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: {
            players: [
              {
                personaname: 'Fresh Name',
                avatarfull: 'https://cdn.test/fresh.jpg',
                profileurl: 'https://steamcommunity.com/id/fresh',
              },
            ],
          },
        }),
      }),
    )
    const out = await resolveFixedRoster(
      { participants: [{ steam_id: GHOST_ID }], guests: [] },
      new Map(),
      new Map(),
      new Map(),
      priorRows,
    )
    expect(out[0].avatar_url).toBe('https://cdn.test/fresh.jpg')
    expect(out[0].display_name).toBe('Fresh Name')
  })
})

describe('hasPlayedChallengeGame (non-participants)', () => {
  // The shape a persisted nonParticipants row has: no owned/is_complete/
  // challenge_achievements.
  const listedRow = () => ({
    username: 'someone',
    steam_id: '76561198000000002',
    playtime_total_minutes: 240,
    playtime_2weeks_minutes: 0,
    achievements_unlocked_total: 12,
    achievements_total: 40,
    challenge_achievement_count: 3,
  })

  it('keeps a previously listed member through a hidden pull and carries their numbers', () => {
    const p = hiddenPull()
    expect(hasPlayedChallengeGame(p, listedRow(), goalConfig())).toBe(true)
    expect(p.game.total).toBe(240)
    expect(p.achievements_unlocked_total).toBe(12)
    expect(p.achievements_total).toBe(40)
    expect(p.challenge_achievement_count).toBe(3)
  })

  it('does not list a member who was never listed and whose pull is hidden', () => {
    expect(hasPlayedChallengeGame(hiddenPull(), undefined, goalConfig())).toBe(false)
  })

  it('does not list an owner with no playtime and no prior listing', () => {
    const p = player({ game: { owned: true, total: 0, twoWeeks: 0 } })
    expect(hasPlayedChallengeGame(p, undefined, goalConfig())).toBe(false)
  })

  it('lists a fresh public pull with no prior row', () => {
    expect(hasPlayedChallengeGame(player(), undefined, goalConfig())).toBe(true)
  })
})

describe('seedFrozenWinners', () => {
  const row = (id: string, over: Record<string, unknown> = {}) => ({
    steam_id: id,
    is_winner: false,
    win_tier: null,
    ...over,
  })
  const prior = (rows: Record<string, any>[]) =>
    new Map(rows.map((r) => [r.steam_id, r]))

  it('includes a prior winner whose pull was hidden at the freeze run, with their prior tier', () => {
    const participants = [
      row('fresh', { is_winner: true, win_tier: 'completion' }),
      row('hidden'),
      row('never'),
    ]
    const out = seedFrozenWinners(
      participants,
      prior([row('hidden', { is_winner: true, win_tier: 'story' })]),
      true,
    )
    expect(out.ids).toEqual(['fresh', 'hidden'])
    expect(out.tiers).toEqual({ fresh: 'completion', hidden: 'story' })
  })

  it('excludes a prior winner who completed after the deadline', () => {
    const out = seedFrozenWinners(
      [row('late')],
      prior([row('late', { is_winner: true, completed_after_deadline: true })]),
      false,
    )
    expect(out.ids).toEqual([])
  })

  it('takes the fresh tier over the prior tier for a member qualifying in both', () => {
    const out = seedFrozenWinners(
      [row('up', { is_winner: true, win_tier: 'completion' })],
      prior([row('up', { is_winner: true, win_tier: 'story' })]),
      true,
    )
    expect(out.tiers).toEqual({ up: 'completion' })
  })

  it('reports no tier map for untiered challenges and ignores members absent from the pull', () => {
    const out = seedFrozenWinners(
      [row('a', { is_winner: true })],
      prior([row('gone', { is_winner: true })]),
      false,
    )
    expect(out.ids).toEqual(['a'])
    expect(out.tiers).toBeNull()
  })
})

describe('carryPriorProgress (hidden pull and 100% completion)', () => {
  const noStory = () => tieredConfig({ storyAchievement: undefined })

  it('does not manufacture a win from an excluded unlock that predates the start', () => {
    // 59 of 60 unlocked, one of them the excluded achievement: effectively 58
    // of 59, so not complete. The excluded unlock is pre-start, so it is not in
    // challenge_achievements and a count comparison would read it as 59 of 59.
    const p = hiddenPull()
    carryPriorProgress(
      p,
      {
        owned: true,
        stats_available: true,
        playtime_total_minutes: 600,
        achievements_total: 60,
        achievements_unlocked_total: 59,
        achievements_before_challenge: 58,
        challenge_achievements: [{ apiname: 'a1', unlocktime: START + 50 }],
        challenge_achievement_count: 1,
        is_complete: false,
        completed_at: null,
      },
      noStory(),
    )
    const out = completionWinFields(p, noStory(), 150, true) as any
    expect(out.is_complete).toBe(false)
    expect(out.is_winner).toBe(false)
  })

  it('keeps a prior-complete member complete through a hidden pull', () => {
    const last = START + 90000
    const p = hiddenPull()
    carryPriorProgress(
      p,
      {
        owned: true,
        stats_available: true,
        playtime_total_minutes: 600,
        achievements_total: 60,
        achievements_unlocked_total: 60,
        challenge_achievements: [{ apiname: EXCLUDED, unlocktime: START - 5 }],
        is_complete: true,
        completed_at: last,
      },
      noStory(),
    )
    const out = completionWinFields(p, noStory(), 150, true) as any
    expect(out.is_complete).toBe(true)
    expect(out.completed_at).toBe(last)
    expect(out.is_winner).toBe(true)
  })

  it('uses the count comparison when the fresh pull is not below the prior count', () => {
    const p = player({
      achieved: fullClear(START + 90000),
      achievements_unlocked_total: 59,
    })
    carryPriorProgress(
      p,
      {
        owned: true,
        playtime_total_minutes: 100,
        achievements_unlocked_total: 40,
        is_complete: false,
      },
      noStory(),
    )
    expect(p.carried_is_complete).toBeUndefined()
    const out = completionWinFields(p, noStory(), 150, true) as any
    expect(out.is_complete).toBe(true)
  })
})

describe('carryPriorProgress (stats_available)', () => {
  it('keeps stats available for a member with zero achievements on a hidden pull', () => {
    const p = hiddenPull()
    carryPriorProgress(
      p,
      {
        owned: true,
        stats_available: true,
        playtime_total_minutes: 60,
        achievements_unlocked_total: 0,
      },
      goalConfig(),
    )
    expect(p.stats_available).toBe(true)
  })

  it('does not invent stats availability the prior row never had', () => {
    const p = hiddenPull()
    carryPriorProgress(
      p,
      {
        owned: true,
        stats_available: false,
        playtime_total_minutes: 60,
        achievements_unlocked_total: 0,
      },
      goalConfig(),
    )
    expect(p.stats_available).toBe(false)
  })
})

describe('carryPriorProgress (achievement challenge milestones)', () => {
  const heroConfig = () =>
    ({
      slug: 'gaming-challenge-1-backpack-hero',
      dataSlug: 'backpack_hero',
      appId: 1970580,
      gameName: 'Backpack Hero',
      startTimestamp: START,
      roster: 'fixed',
      win: {
        type: 'achievement',
        apiname: 'ItemHero',
        displayName: 'Hero',
        description: 'Discover at least 700 items',
        milestones: [
          { apiname: 'ItemDiscoverer', label: 'Discoverer', items: 200 },
          { apiname: 'ItemExpert', label: 'Expert', items: 400 },
          { apiname: 'ItemHero', label: 'Hero', items: 700 },
        ],
      },
    }) as any

  /** Row as achievementWinFields persisted it from a public pull. */
  const publicRow = (over: Record<string, unknown> = {}) => ({
    owned: true,
    stats_available: true,
    playtime_total_minutes: 900,
    achievements_total: 30,
    achievements_unlocked_total: 3,
    achievements_before_challenge: 1,
    challenge_achievements: [
      { apiname: 'ItemExpert', unlocktime: START + 100 },
      { apiname: 'ItemHero', unlocktime: START + 200 },
    ],
    challenge_achievement_count: 2,
    milestones: [
      { apiname: 'ItemDiscoverer', label: 'Discoverer', items: 200, unlocked: true, unlocktime: START - 500 },
      { apiname: 'ItemExpert', label: 'Expert', items: 400, unlocked: true, unlocktime: START + 100 },
      { apiname: 'ItemHero', label: 'Hero', items: 700, unlocked: true, unlocktime: START + 200 },
    ],
    had_hero_before: false,
    has_hero: true,
    hero_unlocktime: START + 200,
    ...over,
  })

  it('keeps pre-start and in-window milestones and the hero unlock through a hidden pull', () => {
    const p = hiddenPull()
    carryPriorProgress(p, publicRow(), heroConfig())
    const out = achievementWinFields(p, heroConfig())
    expect(out.milestones.map((m: any) => [m.apiname, m.unlocked, m.unlocktime])).toEqual([
      ['ItemDiscoverer', true, START - 500],
      ['ItemExpert', true, START + 100],
      ['ItemHero', true, START + 200],
    ])
    expect(out.has_hero).toBe(true)
    expect(out.hero_unlocktime).toBe(START + 200)
    expect(out.had_hero_before).toBe(false)
  })

  it('keeps had_hero_before when the hero unlock predates the start', () => {
    const p = hiddenPull()
    carryPriorProgress(
      p,
      publicRow({
        challenge_achievements: [],
        challenge_achievement_count: 0,
        milestones: [
          { apiname: 'ItemDiscoverer', label: 'Discoverer', items: 200, unlocked: true, unlocktime: START - 900 },
          { apiname: 'ItemExpert', label: 'Expert', items: 400, unlocked: true, unlocktime: START - 800 },
          { apiname: 'ItemHero', label: 'Hero', items: 700, unlocked: true, unlocktime: START - 700 },
        ],
        had_hero_before: true,
        has_hero: false,
        hero_unlocktime: null,
      }),
      heroConfig(),
    )
    const out = achievementWinFields(p, heroConfig())
    expect(out.had_hero_before).toBe(true)
    expect(out.milestones[2].unlocktime).toBe(START - 700)
  })

  it('records pre-start hero play even when the hero is not a milestone', () => {
    const cfg = heroConfig()
    cfg.win.milestones = []
    const p = hiddenPull()
    carryPriorProgress(
      p,
      publicRow({ challenge_achievements: [], milestones: [], had_hero_before: true }),
      cfg,
    )
    expect(achievementWinFields(p, cfg).had_hero_before).toBe(true)
  })

  it('leaves a fresh public pull untouched', () => {
    const p = player({
      achieved: [
        { apiname: 'ItemDiscoverer', unlocktime: START - 500 },
        { apiname: 'ItemExpert', unlocktime: START + 100 },
      ],
      achievements_total: 30,
      achievements_unlocked_total: 3,
    })
    carryPriorProgress(p, publicRow(), heroConfig())
    expect(p.achieved.filter((a: any) => a.apiname === 'ItemDiscoverer')).toHaveLength(1)
  })
})
