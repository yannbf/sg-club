import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchSteamTags,
  getCachedSteamTags,
  isHorrorOrMysteryTag,
  parseSteamStoreTags,
} from './fetch-steam-tags'

describe('fetchSteamTags', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns null and caches nothing when the request is not OK', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })))
    expect(await fetchSteamTags({ app_id: 9000001 })).toBeNull()
    expect(getCachedSteamTags('app:9000001')).toBeUndefined()
  })

  it('returns null when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    expect(await fetchSteamTags({ app_id: 9000002 })).toBeNull()
    expect(getCachedSteamTags('app:9000002')).toBeUndefined()
  })

  it('caches an empty list for a page that loaded but is not an app page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>Welcome to Steam</html>', { status: 200 })),
    )
    expect(await fetchSteamTags({ app_id: 9000003 })).toEqual([])
    expect(getCachedSteamTags('app:9000003')).toEqual([])
  })
})

describe('parseSteamStoreTags', () => {
  it('reads the full list embedded in InitAppTagModal', () => {
    const html = `<html><script>
      InitAppTagModal( 12345, [{"tagid":1721,"name":"Psychological Horror","count":525,"browseable":true},{"tagid":9,"name":"Story [Rich]","count":10,"browseable":true}], [], 'x' );
    </script></html>`
    expect(parseSteamStoreTags(html)).toEqual([
      'Psychological Horror',
      'Story [Rich]',
    ])
  })

  it('falls back to the visible tag links', () => {
    const html = `<div class="glance_tags popular_tags">
      <a class="app_tag">Mystery</a><a class="app_tag"> Puzzle </a>
      <a class="app_tag add_button">+</a></div>`
    expect(parseSteamStoreTags(html)).toEqual(['Mystery', 'Puzzle'])
  })

  it('returns null for a page that is not an app page', () => {
    expect(parseSteamStoreTags('<html><body>Welcome to Steam</body></html>')).toBeNull()
  })

  it('returns an empty list for an app page with an empty tag array', () => {
    expect(parseSteamStoreTags('InitAppTagModal( 1, [], [] )')).toEqual([])
  })
})

describe('isHorrorOrMysteryTag', () => {
  it.each(['Horror', 'psychological horror', 'Survival HORROR', 'Mystery', 'Detective', 'Lovecraftian', 'Thriller', 'Psychological Thriller'])(
    'accepts %s',
    (tag) => expect(isHorrorOrMysteryTag(tag)).toBe(true),
  )

  it.each(['Mystery Dungeon', 'Action', 'Puzzle', 'Story Rich', ''])(
    'rejects %s',
    (tag) => expect(isHorrorOrMysteryTag(tag)).toBe(false),
  )
})
