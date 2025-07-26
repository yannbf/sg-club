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
          "invite_only": false,
          "is_shared": false,
          "link": "IHdPD/stray",
          "name": "Stray",
          "package_id": null,
          "points": 30,
          "region_restricted": false,
          "required_play": true,
          "start_timestamp": 1753567200,
          "whitelist": false,
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
          "invite_only": false,
          "is_shared": true,
          "link": "oiSDZ/the-stone-of-madness",
          "name": "The Stone of Madness",
          "package_id": null,
          "points": 30,
          "region_restricted": false,
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

    it('should extract end timestamp from giveaway that has not started yet', async () => {
      const html = loadMockHtml('sg-giveaway-not-started-page.html')
      const result = await scraper['parseGiveawayDetails'](html)

      expect(result).toMatchInlineSnapshot(`
        {
          "end_timestamp": 1754125200,
          "is_shared": false,
          "is_whitelist": false,
          "required_play": true,
        }
      `)
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
