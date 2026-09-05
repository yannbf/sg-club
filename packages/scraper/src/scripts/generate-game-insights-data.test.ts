import { describe, it, expect } from 'vitest'
import { cvStatusFromCache } from './generate-game-insights-data'

const NOW = 1_750_000_000
const PAST = NOW - 86_400
const FUTURE = NOW + 86_400

describe('cvStatusFromCache', () => {
  it('returns null when the app has no cached bundle status', () => {
    expect(cvStatusFromCache(undefined, NOW)).toBeNull()
  })

  it('returns null for a bundled entry cached before CV timestamps existed', () => {
    expect(
      cvStatusFromCache({ fetched_at: '2026-07-18T10:44:07.581Z', bundled: true }, NOW),
    ).toBeNull()
  })

  it('treats an unbundled game as full CV', () => {
    expect(
      cvStatusFromCache(
        {
          fetched_at: '2026-09-05T00:00:00.000Z',
          bundled: false,
          reduced_value_timestamp: null,
          no_value_timestamp: null,
        },
        NOW,
      ),
    ).toBe('FULL_CV')
  })

  it('reports reduced CV once the reduced cutoff has passed', () => {
    expect(
      cvStatusFromCache(
        {
          fetched_at: '2026-09-05T00:00:00.000Z',
          bundled: true,
          reduced_value_timestamp: PAST,
          no_value_timestamp: null,
        },
        NOW,
      ),
    ).toBe('REDUCED_CV')
  })

  it('reports no CV once the no-value cutoff has passed, even without a reduced cutoff', () => {
    expect(
      cvStatusFromCache(
        {
          fetched_at: '2026-09-05T00:00:00.000Z',
          bundled: true,
          reduced_value_timestamp: null,
          no_value_timestamp: PAST,
        },
        NOW,
      ),
    ).toBe('NO_CV')
  })

  it('prefers no CV over reduced CV when both cutoffs have passed', () => {
    expect(
      cvStatusFromCache(
        {
          fetched_at: '2026-09-05T00:00:00.000Z',
          bundled: true,
          reduced_value_timestamp: PAST - 86_400,
          no_value_timestamp: PAST,
        },
        NOW,
      ),
    ).toBe('NO_CV')
  })

  it('falls back to the reduced cutoff while the no-value cutoff is still in the future', () => {
    expect(
      cvStatusFromCache(
        {
          fetched_at: '2026-09-05T00:00:00.000Z',
          bundled: true,
          reduced_value_timestamp: PAST,
          no_value_timestamp: FUTURE,
        },
        NOW,
      ),
    ).toBe('REDUCED_CV')
  })

  it('stays full CV while every cutoff is still in the future', () => {
    expect(
      cvStatusFromCache(
        {
          fetched_at: '2026-09-05T00:00:00.000Z',
          bundled: true,
          reduced_value_timestamp: FUTURE,
          no_value_timestamp: FUTURE,
        },
        NOW,
      ),
    ).toBe('FULL_CV')
  })
})
