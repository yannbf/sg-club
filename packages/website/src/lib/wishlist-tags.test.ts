import { describe, expect, it } from 'vitest'
import {
  countTags,
  matchesAnyTag,
  tagsMatchSearch,
  toggleTag,
} from './wishlist-tags'

describe('countTags', () => {
  it('counts games per tag, most common first, ties alphabetical', () => {
    expect(
      countTags([['B', 'A'], ['A', 'C'], undefined, ['A', 'A']]),
    ).toEqual([
      { tag: 'A', count: 3 },
      { tag: 'B', count: 1 },
      { tag: 'C', count: 1 },
    ])
  })
})

describe('matchesAnyTag', () => {
  it('requires at least one selected tag', () => {
    expect(matchesAnyTag(['A'], ['A', 'B'])).toBe(true)
    expect(matchesAnyTag(['C'], ['A', 'B'])).toBe(false)
  })
  it('matches everything on an empty selection, nothing for untagged games otherwise', () => {
    expect(matchesAnyTag(undefined, [])).toBe(true)
    expect(matchesAnyTag(undefined, ['A'])).toBe(false)
  })
})

describe('tagsMatchSearch', () => {
  it('matches substrings case-insensitively against a lower-cased term', () => {
    expect(tagsMatchSearch(['Story Rich'], 'rich')).toBe(true)
    expect(tagsMatchSearch(['Action'], 'rich')).toBe(false)
    expect(tagsMatchSearch(undefined, 'rich')).toBe(false)
  })
})

describe('toggleTag', () => {
  it('adds and removes', () => {
    expect(toggleTag(['A'], 'B')).toEqual(['A', 'B'])
    expect(toggleTag(['A', 'B'], 'A')).toEqual(['B'])
  })
})
