import { describe, expect, it } from 'vitest'
import { selectReleaseCandidates } from './fetch-game-prices'

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
    ...fields,
  }) as Parameters<typeof selectReleaseCandidates>[0][number]

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
