import { describe, it, expect } from 'vitest'
import { mergeWithPreviousSnapshot, CARRY_OVER_MS } from './generate-wishlist-data'
import type { WishlistData } from './generate-wishlist-data'
import type { WishlistEntry } from '../scrapers/group-wishlist'

const NOW = new Date('2026-08-15T07:00:00.000Z')

function entry(overrides: Partial<WishlistEntry> & { name: string }): WishlistEntry {
  return {
    app_id: null,
    package_id: null,
    steam_url: 'https://store.steampowered.com/app/0',
    image_url: null,
    wishlist_count: 10,
    ...overrides,
  }
}

function snapshot(
  entries: WishlistEntry[],
  lastUpdated = '2026-08-01T07:00:00.000Z',
): WishlistData {
  return { last_updated: lastUpdated, entries }
}

describe('mergeWithPreviousSnapshot', () => {
  it('stamps freshly scraped entries with last_seen = now', () => {
    const result = mergeWithPreviousSnapshot(
      [entry({ name: 'The Alters', app_id: 1601570 })],
      null,
      NOW,
    )
    expect(result).toHaveLength(1)
    expect(result[0].last_seen).toBe(NOW.toISOString())
  })

  it('carries over a recently seen entry the scrape missed, keeping its last_seen', () => {
    const missed = entry({
      name: 'The Alters',
      app_id: 1601570,
      wishlist_count: 45,
      last_seen: '2026-08-01T07:00:00.000Z',
    })
    const result = mergeWithPreviousSnapshot(
      [entry({ name: 'Other Game', app_id: 1 })],
      snapshot([missed]),
      NOW,
    )
    expect(result.map((e) => e.name)).toContain('The Alters')
    const carried = result.find((e) => e.name === 'The Alters')!
    expect(carried.last_seen).toBe('2026-08-01T07:00:00.000Z')
    expect(carried.wishlist_count).toBe(45)
  })

  it('drops entries not seen within the carry-over window', () => {
    const stale = entry({
      name: 'Old Game',
      app_id: 2,
      last_seen: new Date(NOW.getTime() - CARRY_OVER_MS - 1).toISOString(),
    })
    const result = mergeWithPreviousSnapshot([], snapshot([stale]), NOW)
    expect(result).toHaveLength(0)
  })

  it('prefers the current scrape when an entry appears in both', () => {
    const result = mergeWithPreviousSnapshot(
      [entry({ name: 'Game', app_id: 3, wishlist_count: 40 })],
      snapshot([
        entry({
          name: 'Game',
          app_id: 3,
          wishlist_count: 45,
          last_seen: '2026-08-01T07:00:00.000Z',
        }),
      ]),
      NOW,
    )
    expect(result).toHaveLength(1)
    expect(result[0].wishlist_count).toBe(40)
    expect(result[0].last_seen).toBe(NOW.toISOString())
  })

  it("falls back to the snapshot's last_updated for entries without last_seen", () => {
    const legacyRecent = entry({ name: 'Legacy Game', app_id: 4 })
    const kept = mergeWithPreviousSnapshot(
      [],
      snapshot([legacyRecent], '2026-08-01T07:00:00.000Z'),
      NOW,
    )
    expect(kept.map((e) => e.name)).toContain('Legacy Game')

    const droppedResult = mergeWithPreviousSnapshot(
      [],
      snapshot([legacyRecent], '2026-07-01T07:00:00.000Z'),
      NOW,
    )
    expect(droppedResult).toHaveLength(0)
  })

  it('keys entries by app, package, then name', () => {
    const result = mergeWithPreviousSnapshot(
      [
        entry({ name: 'Pack', package_id: 100 }),
        entry({ name: 'named only' }),
      ],
      snapshot([
        entry({ name: 'Pack renamed', package_id: 100, last_seen: '2026-08-14T00:00:00.000Z' }),
        entry({ name: 'Named Only', last_seen: '2026-08-14T00:00:00.000Z' }),
      ]),
      NOW,
    )
    expect(result).toHaveLength(2)
  })

  it('sorts the merged list by wishlist_count descending', () => {
    const result = mergeWithPreviousSnapshot(
      [entry({ name: 'Low', app_id: 5, wishlist_count: 10 })],
      snapshot([
        entry({
          name: 'High',
          app_id: 6,
          wishlist_count: 50,
          last_seen: '2026-08-01T07:00:00.000Z',
        }),
      ]),
      NOW,
    )
    expect(result.map((e) => e.name)).toEqual(['High', 'Low'])
  })
})
