import { afterEach, describe, expect, it, vi } from 'vitest'
import {
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
