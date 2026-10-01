import { describe, expect, it } from 'vitest'
import { isHorrorOrMysteryTag, parseSteamStoreTags } from './fetch-steam-tags'

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
