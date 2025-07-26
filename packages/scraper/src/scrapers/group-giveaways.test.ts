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
      expect(giveaways[0]).toMatchInlineSnapshot(`
        {
          "app_id": 837470,
          "comment_count": 3,
          "contributor_level": 0,
          "copies": 1,
          "created_timestamp": 1751715957,
          "creator": {
            "avatar": "",
            "role": "user",
            "username": "Troutroum",
          },
          "end_timestamp": 1751913000,
          "entry_count": 22,
          "group": true,
          "id": "0T6OW",
          "invite_only": false,
          "is_shared": false,
          "link": "0T6OW/untitled-goose-game",
          "name": "Untitled Goose
                              Game",
          "package_id": null,
          "points": 20,
          "region_restricted": false,
          "required_play": false,
          "start_timestamp": 1751715897,
          "whitelist": false,
        }
      `)
    })
  })

  describe('parseGiveawayDetails', () => {
    it('should correctly identify a shared giveaway and whitelist', async () => {
      const html = loadMockHtml('sg-shared-group-ga-page.html')
      const result = await scraper['parseGiveawayDetails'](html)

      expect(result).toEqual({
        required_play: false,
        is_shared: true,
        is_whitelist: true,
      })
    })

    it('should correctly identify a giveaway with play required', async () => {
      const html = loadMockHtml('sg-giveaway-page.html')
      const result = await scraper['parseGiveawayDetails'](html)

      expect(result).toEqual({
        required_play: true,
        is_shared: false,
        is_whitelist: false,
      })
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
