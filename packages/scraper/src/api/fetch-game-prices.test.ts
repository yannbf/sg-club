import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyPackageResolution,
  fetchReviewSummary,
  isPackageResolutionDue,
  resolveHeaderImageUrl,
  selectHeaderArtCandidates,
  selectReleaseCandidates,
  shouldApplyReviewSummary,
} from './fetch-game-prices'

const NOW = new Date('2026-08-14T12:00:00Z').getTime()
const daysAgo = (days: number) =>
  new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString()

/** Only the fields selectReleaseCandidates reads; the rest is irrelevant here. */
const game = (fields: Record<string, unknown>) =>
  ({
    name: 'game',
    app_id: null,
    package_id: null,
    price_usd_full: null,
    price_usd_reduced: null,
    needs_manual_update: false,
    hltb_main_story_hours: null,
    rating_percent: null,
    review_count: null,
    review_score_desc: null,
    reviews_updated_at: null,
    coming_soon: null,
    release_date: null,
    release_checked_at: null,
    header_image_url: null,
    header_image_checked_at: null,
    ...fields,
  }) as Parameters<typeof selectReleaseCandidates>[0][number]

describe('selectHeaderArtCandidates', () => {
  it('includes every game whose art has never been looked up', () => {
    const candidates = selectHeaderArtCandidates(
      [game({ app_id: 1, name: 'unchecked' })],
      NOW
    )
    expect(candidates.map((g) => g.name)).toEqual(['unchecked'])
  })

  it('keeps a resolved URL for a month before re-resolving it', () => {
    const fresh = game({
      app_id: 1,
      name: 'fresh',
      header_image_url: 'https://example/a/header.jpg',
      header_image_checked_at: daysAgo(10),
    })
    const stale = game({
      app_id: 2,
      name: 'stale',
      header_image_url: 'https://example/b/header.jpg',
      header_image_checked_at: daysAgo(40),
    })
    expect(
      selectHeaderArtCandidates([fresh, stale], NOW).map((g) => g.name)
    ).toEqual(['stale'])
  })

  it('retries a game with no art after a week', () => {
    const recentMiss = game({
      app_id: 1,
      name: 'recent-miss',
      header_image_checked_at: daysAgo(3),
    })
    const oldMiss = game({
      app_id: 2,
      name: 'old-miss',
      header_image_checked_at: daysAgo(10),
    })
    expect(
      selectHeaderArtCandidates([recentMiss, oldMiss], NOW).map((g) => g.name)
    ).toEqual(['old-miss'])
  })

  it('resolves package-only entries through their backing app id', () => {
    const candidates = selectHeaderArtCandidates(
      [
        game({ app_id: null, package_id: 5, name: 'no-app' }),
        game({ app_id: null, package_id: 6, app_id_for_package_id: 99, name: 'sub' }),
      ],
      NOW
    )
    expect(candidates.map((g) => g.name)).toEqual(['sub'])
  })

  it('puts never-checked games ahead of ones with a stale stamp', () => {
    const candidates = selectHeaderArtCandidates(
      [
        game({ app_id: 1, name: 'stale', header_image_checked_at: daysAgo(30) }),
        game({ app_id: 2, name: 'never' }),
      ],
      NOW
    )
    expect(candidates.map((g) => g.name)).toEqual(['never', 'stale'])
  })
})

describe('selectReleaseCandidates', () => {
  it('includes every game whose release status has never been checked', () => {
    const candidates = selectReleaseCandidates(
      [game({ app_id: 1, name: 'unchecked' })],
      NOW
    )
    expect(candidates.map((g) => g.name)).toEqual(['unchecked'])
  })

  it('never re-checks a game already known to be released', () => {
    const candidates = selectReleaseCandidates(
      [
        game({
          app_id: 1,
          name: 'released',
          coming_soon: false,
          release_checked_at: daysAgo(400),
        }),
      ],
      NOW
    )
    expect(candidates).toEqual([])
  })

  it('re-checks an unreleased game once its last check goes stale', () => {
    const fresh = game({
      app_id: 1,
      name: 'fresh',
      coming_soon: true,
      release_checked_at: daysAgo(1),
    })
    const stale = game({
      app_id: 2,
      name: 'stale',
      coming_soon: true,
      release_checked_at: daysAgo(5),
    })
    expect(selectReleaseCandidates([fresh, stale], NOW).map((g) => g.name)).toEqual([
      'stale',
    ])
  })

  it('checks never-checked games before stale re-checks', () => {
    const stale = game({
      app_id: 10,
      name: 'stale',
      coming_soon: true,
      release_checked_at: daysAgo(5),
    })
    const unchecked = game({ app_id: 20, name: 'unchecked' })
    expect(selectReleaseCandidates([stale, unchecked], NOW).map((g) => g.name)).toEqual(
      ['unchecked', 'stale']
    )
  })

  it('backfills newest app IDs first, where the unreleased games are', () => {
    const games = [
      game({ app_id: 400, name: 'old' }),
      game({ app_id: 4231820, name: 'brand new' }),
      game({ app_id: 774171, name: 'middling' }),
    ]
    expect(selectReleaseCandidates(games, NOW).map((g) => g.name)).toEqual([
      'brand new',
      'middling',
      'old',
    ])
  })

  it('orders stale re-checks oldest-checked first', () => {
    const games = [
      game({ app_id: 1, name: 'recent', coming_soon: true, release_checked_at: daysAgo(3) }),
      game({ app_id: 2, name: 'ancient', coming_soon: true, release_checked_at: daysAgo(30) }),
    ]
    expect(selectReleaseCandidates(games, NOW).map((g) => g.name)).toEqual([
      'ancient',
      'recent',
    ])
  })

  it('falls back to a package entry resolved app ID, and skips games with no app ID at all', () => {
    const games = [
      game({ app_id: null, package_id: 99, name: 'no app id' }),
      game({ app_id: null, app_id_for_package_id: 555, name: 'resolved package' }),
    ]
    expect(selectReleaseCandidates(games, NOW).map((g) => g.name)).toEqual([
      'resolved package',
    ])
  })
})

describe('fetchReviewSummary', () => {
  const respond = (body: unknown, init: { status?: number } = {}) =>
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status: init.status ?? 200 })
    )

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('summarises a successful response with reviews', async () => {
    vi.stubGlobal(
      'fetch',
      respond({
        success: 1,
        query_summary: {
          review_score_desc: 'Very Positive',
          total_positive: 85,
          total_reviews: 100,
        },
      })
    )
    expect(await fetchReviewSummary(10)).toEqual({
      rating_percent: 85,
      review_count: 100,
      review_score_desc: 'Very Positive',
    })
  })

  it('reports a real zero for a new game with no reviews yet', async () => {
    vi.stubGlobal(
      'fetch',
      respond({
        success: 1,
        query_summary: {
          review_score_desc: 'No user reviews',
          total_positive: 0,
          total_reviews: 0,
        },
      })
    )
    expect(await fetchReviewSummary(10)).toEqual({
      rating_percent: null,
      review_count: 0,
      review_score_desc: 'No user reviews',
    })
  })

  it.each([
    ['success is missing', { query_summary: { total_reviews: 5 } }],
    ['success is 0', { success: 0, query_summary: { total_reviews: 5 } }],
  ])('returns null when %s', async (_label, body) => {
    vi.stubGlobal('fetch', respond(body))
    expect(await fetchReviewSummary(10)).toBeNull()
  })

  it('returns null when query_summary is absent', async () => {
    vi.stubGlobal('fetch', respond({ success: 1 }))
    expect(await fetchReviewSummary(10)).toBeNull()
  })

  it('returns null without retrying on a non-retryable HTTP error', async () => {
    const fetchMock = respond({}, { status: 404 })
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchReviewSummary(10)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('shouldApplyReviewSummary', () => {
  const summary = (review_count: number | null) => ({
    rating_percent: null,
    review_count,
    review_score_desc: null,
  })

  it('rejects a zero against a positive stored count', () => {
    expect(shouldApplyReviewSummary(52918, summary(0))).toBe(false)
  })

  it('accepts a zero when nothing positive is stored', () => {
    expect(shouldApplyReviewSummary(0, summary(0))).toBe(true)
    expect(shouldApplyReviewSummary(null, summary(0))).toBe(true)
    expect(shouldApplyReviewSummary(undefined, summary(0))).toBe(true)
  })

  it('accepts any positive fresh count', () => {
    expect(shouldApplyReviewSummary(52918, summary(52000))).toBe(true)
    expect(shouldApplyReviewSummary(0, summary(3))).toBe(true)
  })
})

describe('resolveHeaderImageUrl', () => {
  it('keeps the stored URL when the lookup came back empty', () => {
    expect(resolveHeaderImageUrl('https://example/old.jpg', null)).toBe(
      'https://example/old.jpg'
    )
  })

  it('replaces the stored URL with a fresh one', () => {
    expect(
      resolveHeaderImageUrl('https://example/old.jpg', 'https://example/new.jpg')
    ).toBe('https://example/new.jpg')
  })

  it('stays null when nothing is stored and nothing was found', () => {
    expect(resolveHeaderImageUrl(null, null)).toBeNull()
    expect(resolveHeaderImageUrl(undefined, null)).toBeNull()
  })
})

describe('isPackageResolutionDue', () => {
  it('asks for a package that has never been resolved', () => {
    expect(isPackageResolutionDue({}, NOW)).toBe(true)
  })

  it('asks again for a stored null with no attempt timestamp', () => {
    expect(isPackageResolutionDue({ app_id_for_package_id: null }, NOW)).toBe(true)
  })

  it('waits a week after a null attempt', () => {
    const attempt = (days: number) => ({
      app_id_for_package_id: null,
      app_id_for_package_checked_at: daysAgo(days),
    })
    expect(isPackageResolutionDue(attempt(1), NOW)).toBe(false)
    expect(isPackageResolutionDue(attempt(8), NOW)).toBe(true)
  })

  it('treats an unparseable timestamp on a null as due', () => {
    expect(
      isPackageResolutionDue(
        { app_id_for_package_id: null, app_id_for_package_checked_at: 'garbage' },
        NOW
      )
    ).toBe(true)
  })

  it('never asks again once an app id is resolved', () => {
    expect(
      isPackageResolutionDue(
        {
          app_id_for_package_id: 440,
          app_id_for_package_checked_at: daysAgo(400),
        },
        NOW
      )
    ).toBe(false)
  })
})

describe('applyPackageResolution', () => {
  it('stores a resolved id and stamps the attempt', () => {
    expect(applyPackageResolution(null, 440, NOW)).toEqual({
      app_id_for_package_id: 440,
      app_id_for_package_checked_at: new Date(NOW).toISOString(),
    })
  })

  it('keeps a resolved id when a later attempt returns null', () => {
    expect(applyPackageResolution(440, null, NOW).app_id_for_package_id).toBe(440)
  })

  it('stores null, stamped, when a first attempt finds nothing', () => {
    expect(applyPackageResolution(undefined, null, NOW)).toEqual({
      app_id_for_package_id: null,
      app_id_for_package_checked_at: new Date(NOW).toISOString(),
    })
  })
})
