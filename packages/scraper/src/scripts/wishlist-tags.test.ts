import { describe, expect, it, vi } from 'vitest'
import { attachWishlistTags, WISHLIST_TAGS_PER_GAME } from './wishlist-tags'
import type { WishlistEntry } from '../scrapers/group-wishlist'

function entry(app_id: number): WishlistEntry {
  return {
    name: `Game ${app_id}`,
    app_id,
    package_id: null,
    steam_url: `https://store.steampowered.com/app/${app_id}`,
    image_url: null,
    wishlist_count: 10,
  }
}

function harness(initial: Record<string, string[]> = {}) {
  const cache: Record<string, string[]> = { ...initial }
  const results: Record<number, string[] | null> = {}
  const fetchTags = vi.fn(async (ids: { app_id: number | null }) => {
    const tags = results[ids.app_id!] ?? null
    if (tags !== null) cache[`app:${ids.app_id}`] = tags
    return tags
  })
  const saveCache = vi.fn()
  const deps = {
    fetchTags,
    getCached: (key: string) => cache[key],
    saveCache,
    delayMs: 0,
    delay: async () => {},
  }
  return { cache, results, fetchTags, saveCache, deps }
}

describe('attachWishlistTags', () => {
  it('fetches only games without cached tags', async () => {
    const h = harness({ 'app:1': ['Action'] })
    h.results[2] = ['Puzzle']
    const entries = [entry(1), entry(2)]
    await attachWishlistTags(entries, { deps: h.deps })
    expect(h.fetchTags).toHaveBeenCalledTimes(1)
    expect(h.fetchTags.mock.calls[0][0].app_id).toBe(2)
    expect(entries[0].tags).toEqual(['Action'])
    expect(entries[1].tags).toEqual(['Puzzle'])
  })

  it('keeps the top tags in vote order', async () => {
    const all = Array.from({ length: 15 }, (_, i) => `Tag ${i}`)
    const h = harness({ 'app:1': all })
    const entries = [entry(1)]
    await attachWishlistTags(entries, { deps: h.deps })
    expect(entries[0].tags).toEqual(all.slice(0, WISHLIST_TAGS_PER_GAME))
  })

  it('leaves entries without tags when the fetch failed, and caches nothing', async () => {
    const h = harness()
    const entries = [entry(1)]
    await attachWishlistTags(entries, { deps: h.deps })
    expect(entries[0].tags).toBeUndefined()
    expect(h.cache).toEqual({})
  })

  it('omits tags for a known-empty list and drops stale ones', async () => {
    const h = harness({ 'app:1': [] })
    const stale = { ...entry(1), tags: ['Old'] }
    await attachWishlistTags([stale], { deps: h.deps })
    expect(stale.tags).toBeUndefined()
    expect(h.fetchTags).not.toHaveBeenCalled()
  })

  it('respects the fetch limit', async () => {
    const h = harness()
    for (const id of [1, 2, 3]) h.results[id] = ['X']
    const entries = [entry(1), entry(2), entry(3)]
    await attachWishlistTags(entries, { limit: 2, deps: h.deps })
    expect(h.fetchTags).toHaveBeenCalledTimes(2)
    expect(entries[2].tags).toBeUndefined()
  })

  it('stops early after repeated consecutive failures and saves', async () => {
    const h = harness()
    const entries = Array.from({ length: 30 }, (_, i) => entry(i + 1))
    await attachWishlistTags(entries, { deps: h.deps })
    expect(h.fetchTags).toHaveBeenCalledTimes(10)
    expect(h.saveCache).toHaveBeenCalled()
  })
})
