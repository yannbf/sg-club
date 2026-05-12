import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadMockHtml } from '../test-utils/load-mock-html'
import { SteamGiftsHTMLScraper } from './group-giveaways'

describe('SteamGiftsHTMLScraper', () => {
  let scraper: SteamGiftsHTMLScraper

  beforeEach(() => {
    scraper = new SteamGiftsHTMLScraper()
    scraper.fetchPage = vi.fn(() => Promise.resolve(''))
    scraper.fetchDetailedWinners = vi.fn(() => Promise.resolve([]))
    scraper.fetchDetailedEntries = vi.fn(() => Promise.resolve([]))
  })

  describe('parseWinnersPage', () => {
    it('should correctly parse winners page with different statuses', () => {
      const html = loadMockHtml('sg-giveaway-winners-page.html')
      const winners = scraper['parseWinnersPage'](html)

      expect(winners).toHaveLength(5)
      expect(winners).toEqual([
        { name: 'a10i', status: 'received' },
        { name: 'CosmicDrink', status: 'received' },
        { name: 'Griske14', status: 'received' },
        { name: 'ManowGamer', status: 'received' },
        { name: 'VinroyIsViral', status: 'received' },
      ])
    })

    it('should handle winners page with error message', () => {
      const html = loadMockHtml('sg-winners-error-not-in-group-page.html')
      const winners = scraper['parseWinnersPage'](html)
      expect(winners).toHaveLength(0)
    })
  })

  describe('parseEntriesPage', () => {
    it('should correctly parse entries page with different statuses', () => {
      const html = loadMockHtml('sg-giveaway-entries-page.html')
      const entries = scraper['parseEntriesPage'](html)

      expect(entries).toMatchInlineSnapshot(`
        [
          {
            "joined_at": "1752100978",
            "username": "GordonShephard",
          },
          {
            "joined_at": "1752100026",
            "username": "deathhell44",
          },
          {
            "joined_at": "1752099953",
            "username": "faelynaris",
          },
          {
            "joined_at": "1752085340",
            "username": "Cos2k",
          },
        ]
      `)
    })

    it('should handle winners page with error message', () => {
      const html = loadMockHtml('sg-winners-error-not-in-group-page.html')
      const winners = scraper['parseWinnersPage'](html)
      expect(winners).toHaveLength(0)
    })
  })

  describe('parseGiveaways', () => {
    it('should correctly parse multiple giveaways from group page', async () => {
      const html = loadMockHtml('sg-group-giveaways-page.html')
      const giveaways = await scraper['parseGiveaways'](html)

      expect(giveaways).toHaveLength(25)

      const giveawayStartingInFuture = giveaways[0]
      expect(giveawayStartingInFuture).toMatchInlineSnapshot(`
        {
          "app_id": 1332010,
          "comment_count": 4,
          "copies": 1,
          "created_timestamp": 1753371963,
          "creator": "Patzl",
          "end_timestamp": 1754125200,
          "entry_count": 0,
          "group": true,
          "id": "IHdPD",
          "link": "IHdPD/stray",
          "name": "Stray",
          "package_id": null,
          "points": 30,
          "start_timestamp": 1753567200,
        }
      `)

      const normalGiveaway = giveaways[2]
      expect(normalGiveaway).toMatchInlineSnapshot(`
        {
          "app_id": 1309710,
          "comment_count": 3,
          "copies": 1,
          "created_timestamp": 1753055803,
          "creator": "NateSCC",
          "end_timestamp": 1753545240,
          "entry_count": 100,
          "group": true,
          "id": "oiSDZ",
          "is_shared": true,
          "link": "oiSDZ/the-stone-of-madness",
          "name": "The Stone of Madness",
          "package_id": null,
          "points": 30,
          "required_play": true,
          "start_timestamp": 1753055803,
          "whitelist": true,
        }
      `)
    })
  })

  describe('parseGiveawayDetails', () => {
    it('should correctly identify a shared giveaway and whitelist', async () => {
      const html = loadMockHtml('sg-shared-group-ga-page.html')
      const result = await scraper['parseGiveawayDetails'](html)

      expect(result).toEqual(
        expect.objectContaining({
          required_play: false,
          is_shared: true,
          is_whitelist: true,
        })
      )
    })

    it('should correctly identify a giveaway with play required', async () => {
      const html = loadMockHtml('sg-giveaway-page.html')
      const result = await scraper['parseGiveawayDetails'](html)

      expect(result).toEqual(
        expect.objectContaining({
          required_play: true,
          is_shared: false,
          is_whitelist: false,
        })
      )
    })

    it('should correctly identify a giveaway with event type', async () => {
      const html = loadMockHtml('sg-giveaway-page.html')
      const result = await scraper['parseGiveawayDetails'](html)

      expect(result).toEqual(
        expect.objectContaining({
          required_play: true,
          is_shared: false,
          is_whitelist: false,
          event_type: 'rpg_august',
        })
      )
    })

    it('should extract end timestamp from giveaway that has not started yet', async () => {
      const html = loadMockHtml('sg-giveaway-not-started-page.html')
      const result = await scraper['parseGiveawayDetails'](html)

      expect(result).toMatchInlineSnapshot(`
        {
          "end_timestamp": 1754125200,
          "event_type": undefined,
          "is_shared": false,
          "is_whitelist": false,
          "required_play": true,
        }
      `)
    })
  })

  describe('applyMay2026EventTag', () => {
    const may15Noon2026 = Math.floor(Date.UTC(2026, 4, 15, 12, 0, 0) / 1000)
    const apr15Noon2026 = Math.floor(Date.UTC(2026, 3, 15, 12, 0, 0) / 1000)

    function makeGA(overrides: Partial<{
      cv_status: 'FULL_CV' | 'REDUCED_CV' | 'NO_CV'
      entry_count: number
      end_timestamp: number
      event_type: string
      is_shared: boolean
    }>) {
      return {
        id: 'x',
        name: 'Test',
        points: 10,
        copies: 1,
        link: 'x/test',
        created_timestamp: 0,
        start_timestamp: 0,
        end_timestamp: may15Noon2026,
        entry_count: 10,
        region_restricted: false,
        invite_only: false,
        whitelist: false,
        group: true,
        contributor_level: 0,
        comment_count: 0,
        creator: 'tester',
        app_id: 1,
        cv_status: 'FULL_CV' as const,
        ...overrides,
      } as unknown as Parameters<typeof scraper.applyMay2026EventTag>[0][number]
    }

    it('tags a FULL_CV May 2026 giveaway with at least 5 entries', () => {
      const ga = makeGA({})
      scraper.applyMay2026EventTag([ga])
      expect(ga.event_type).toBe('may_event_2026')
    })

    it('does NOT tag a non-FULL_CV giveaway, even if otherwise eligible', () => {
      const reduced = makeGA({ cv_status: 'REDUCED_CV' })
      const none = makeGA({ cv_status: 'NO_CV' })
      scraper.applyMay2026EventTag([reduced, none])
      expect(reduced.event_type).toBeUndefined()
      expect(none.event_type).toBeUndefined()
    })

    it('does NOT tag a shared giveaway, even if otherwise eligible', () => {
      const ga = makeGA({ is_shared: true })
      scraper.applyMay2026EventTag([ga])
      expect(ga.event_type).toBeUndefined()
    })

    it('removes the tag when the giveaway becomes shared', () => {
      const ga = makeGA({ is_shared: true, event_type: 'may_event_2026' })
      scraper.applyMay2026EventTag([ga])
      expect(ga.event_type).toBeUndefined()
    })

    it('tags a giveaway with exactly 5 entries', () => {
      const ga = makeGA({ entry_count: 5 })
      scraper.applyMay2026EventTag([ga])
      expect(ga.event_type).toBe('may_event_2026')
    })

    it('does NOT tag a giveaway with 4 entries', () => {
      const ga = makeGA({ entry_count: 4 })
      scraper.applyMay2026EventTag([ga])
      expect(ga.event_type).toBeUndefined()
    })

    it('does NOT tag a giveaway that ends outside May 2026', () => {
      const ga = makeGA({ end_timestamp: apr15Noon2026 })
      scraper.applyMay2026EventTag([ga])
      expect(ga.event_type).toBeUndefined()
    })

    it('leaves a description-based event_type untouched', () => {
      const ga = makeGA({ event_type: 'rpg_august' })
      scraper.applyMay2026EventTag([ga])
      expect(ga.event_type).toBe('rpg_august')
    })

    it('removes the tag when entries later drop below 5', () => {
      // Previously eligible, now has 3 entries
      const ga = makeGA({ entry_count: 3, event_type: 'may_event_2026' })
      scraper.applyMay2026EventTag([ga])
      expect(ga.event_type).toBeUndefined()
    })

    it('removes the tag when cv_status is no longer FULL_CV', () => {
      const ga = makeGA({
        cv_status: 'REDUCED_CV',
        event_type: 'may_event_2026',
      })
      scraper.applyMay2026EventTag([ga])
      expect(ga.event_type).toBeUndefined()
    })

    it('migrates legacy may_2026_event tag to may_event_2026 when still eligible', () => {
      const ga = makeGA({ event_type: 'may_2026_event' })
      scraper.applyMay2026EventTag([ga])
      expect(ga.event_type).toBe('may_event_2026')
    })

    it('removes legacy may_2026_event tag when no longer eligible', () => {
      const ga = makeGA({ entry_count: 2, event_type: 'may_2026_event' })
      scraper.applyMay2026EventTag([ga])
      expect(ga.event_type).toBeUndefined()
    })
  })

  describe('getNextPage', () => {
    it('should correctly parse next page link when available', () => {
      const html = loadMockHtml('sg-group-giveaways-page.html')
      const nextPage = scraper['getNextPage'](html)

      expect(nextPage).toBe('/group/WlYTQ/thegiveawaysclub/search?page=2')
    })
  })
})
