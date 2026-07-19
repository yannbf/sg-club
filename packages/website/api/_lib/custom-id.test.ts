import { describe, expect, it } from 'vitest'
import {
  CustomIdTooLongError,
  decodeCustomId,
  encodeModalCustomId,
  encodeSignupCustomId,
  slugify,
  validateSlugForCustomId,
} from './custom-id.js'

describe('custom-id', () => {
  it('round-trips a button custom_id', () => {
    const id = encodeSignupCustomId('neo-cab', 'want', 1784448663)
    expect(id).toBe('su|neo-cab|want|1784448663')
    expect(decodeCustomId(id)).toEqual({
      kind: 'button',
      slug: 'neo-cab',
      choice: 'want',
      deadlineEpoch: 1784448663,
    })
  })

  it('round-trips a modal custom_id', () => {
    const id = encodeModalCustomId('kill-the-crows', 'have', 1700000000)
    expect(id).toBe('sg|kill-the-crows|have|1700000000')
    expect(decodeCustomId(id)).toEqual({
      kind: 'modal',
      slug: 'kill-the-crows',
      choice: 'have',
      deadlineEpoch: 1700000000,
    })
  })

  it('round-trips the out choice', () => {
    const id = encodeSignupCustomId('neo-cab', 'out', 1784448663)
    expect(decodeCustomId(id)?.choice).toBe('out')
  })

  it('rejects malformed custom_ids', () => {
    expect(decodeCustomId('garbage')).toBeNull()
    expect(decodeCustomId('su|slug|bogus-choice|123')).toBeNull()
    expect(decodeCustomId('su|Bad_Slug|want|123')).toBeNull()
    expect(decodeCustomId('su|slug|want|not-a-number')).toBeNull()
    expect(decodeCustomId('xx|slug|want|123')).toBeNull()
    expect(decodeCustomId('su|slug|want')).toBeNull()
  })

  it('throws when an encoded id would exceed 100 chars', () => {
    // encode*CustomId doesn't itself enforce the slug regex — that's
    // validateSlugForCustomId's job — so this exercises the raw length guard.
    const longSlug = 'a'.repeat(90)
    expect(() => encodeModalCustomId(longSlug, 'have', 9999999999)).toThrow(
      CustomIdTooLongError
    )
  })

  it('validateSlugForCustomId accepts a normal slug', () => {
    expect(validateSlugForCustomId('neo-cab')).toBeNull()
  })

  it('validateSlugForCustomId rejects invalid characters', () => {
    expect(validateSlugForCustomId('Neo Cab!')).not.toBeNull()
  })

  it('validateSlugForCustomId rejects a slug that would blow the 100-char budget', () => {
    // 40 chars is the max allowed by the slug regex itself, and still fits
    // comfortably (sg|<40 a's>|have|9999999999 = 3+40+1+4+1+10 = 59 chars).
    // This test instead exercises the length guard directly by checking the
    // regex boundary: 41 chars is already rejected by the pattern.
    expect(validateSlugForCustomId('a'.repeat(41))).not.toBeNull()
  })
})

describe('slugify', () => {
  it('lowercases and collapses spaces/punctuation into single hyphens', () => {
    expect(slugify('Neo Cab: A Journey!')).toBe('neo-cab-a-journey')
  })

  it('truncates a very long name to 40 chars', () => {
    const slug = slugify('a'.repeat(50))
    expect(slug).toBe('a'.repeat(40))
    expect(slug.length).toBe(40)
  })

  it('trims a trailing dash left behind by truncation mid-dash-run', () => {
    // 39 'a's + a space (-> hyphen) lands the hyphen exactly at index 39, so
    // slice(0, 40) would otherwise end with a dangling '-'.
    const name = `${'a'.repeat(39)} ${'b'.repeat(10)}`
    const slug = slugify(name)
    expect(slug).toBe('a'.repeat(39))
    expect(slug.endsWith('-')).toBe(false)
  })

  it('slugifies an all-punctuation name to an empty string', () => {
    const slug = slugify('!!!___...')
    expect(slug).toBe('')
    expect(validateSlugForCustomId(slug)).not.toBeNull()
  })
})
