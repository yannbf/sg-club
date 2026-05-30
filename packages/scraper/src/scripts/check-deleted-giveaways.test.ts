import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'node:url'
import {
  isGiveawayDeleted,
  shouldCheckGiveaway,
} from './check-deleted-giveaways.js'
import type { Giveaway } from '../types/steamgifts.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('checkDeletedGiveaways', () => {
  describe('isGiveawayDeleted', () => {
    it('should detect deleted giveaway from HTML', () => {
      const deletedHtmlPath = path.join(
        __dirname,
        '../../mocks/sg-deleted-ga.html'
      )
      const deletedHtml = fs.readFileSync(deletedHtmlPath, 'utf-8')

      const result = isGiveawayDeleted(deletedHtml)

      expect(result.deleted).toBe(true)
    })

    it('should return false for non-error pages', () => {
      const normalHtml = `
        <!DOCTYPE html>
        <html>
        <head><title>Normal Giveaway</title></head>
        <body>
          <div class="page__heading__breadcrumbs">Giveaway</div>
          <div>Normal giveaway content</div>
        </body>
        </html>
      `

      const result = isGiveawayDeleted(normalHtml)
      expect(result.deleted).toBe(false)
    })

    it('should return false for error pages that are not deleted giveaways', () => {
      const errorHtml = `
        <!DOCTYPE html>
        <html>
        <head><title>Error</title></head>
        <body>
          <div class="page__heading__breadcrumbs">Error</div>
          <div class="table__row-inner-wrap">
            <div class="table__column--width-small"><strong>Error</strong></div>
            <div class="table__column--width-fill">Some other error, not deleted</div>
          </div>
        </body>
        </html>
      `

      const result = isGiveawayDeleted(errorHtml)
      expect(result.deleted).toBe(false)
    })
  })

  describe('shouldCheckGiveaway', () => {
    it('should return true for ended giveaway with no entries', () => {
      const now = Math.floor(Date.now() / 1000)
      const giveaway: Giveaway = {
        id: 'test',
        name: 'Test Giveaway',
        points: 10,
        copies: 1,
        app_id: null,
        package_id: null,
        link: 'test/test-giveaway',
        created_timestamp: now - 1000,
        start_timestamp: now - 1000,
        end_timestamp: now - 500, // Ended 500 seconds ago
        group: true,
        entry_count: 0, // No entries
        creator: '76561197960287930',
        creator_username: 'testuser',
      }

      const result = shouldCheckGiveaway(giveaway)
      expect(result).toBe(true)
    })

    it('should return true for ongoing giveaway (can be deleted before ending)', () => {
      const now = Math.floor(Date.now() / 1000)
      const giveaway: Giveaway = {
        id: 'test',
        name: 'Test Giveaway',
        points: 10,
        copies: 1,
        app_id: null,
        package_id: null,
        link: 'test/test-giveaway',
        created_timestamp: now - 1000,
        start_timestamp: now - 1000,
        end_timestamp: now + 500, // Ends in 500 seconds
        group: true,
        entry_count: 13, // Has entries but creator could still delete it
        creator: '76561197960287930',
        creator_username: 'testuser',
      }

      const result = shouldCheckGiveaway(giveaway)
      expect(result).toBe(true)
    })

    it('should return false for giveaway already marked deleted', () => {
      const now = Math.floor(Date.now() / 1000)
      const giveaway: Giveaway = {
        id: 'test',
        name: 'Test Giveaway',
        points: 10,
        copies: 1,
        app_id: null,
        package_id: null,
        link: 'test/test-giveaway',
        created_timestamp: now - 1000,
        start_timestamp: now - 1000,
        end_timestamp: now - 500,
        group: true,
        entry_count: 0,
        deleted: true,
        creator: '76561197960287930',
        creator_username: 'testuser',
      }

      const result = shouldCheckGiveaway(giveaway)
      expect(result).toBe(false)
    })

    it('should return true for ended giveaway with undefined winners', () => {
      const now = Math.floor(Date.now() / 1000)
      const giveaway: Giveaway = {
        id: 'test',
        name: 'Test Giveaway',
        points: 10,
        copies: 1,
        app_id: null,
        package_id: null,
        link: 'test/test-giveaway',
        created_timestamp: now - 1000,
        start_timestamp: now - 1000,
        end_timestamp: now - 500,
        group: true,
        entry_count: 5,
        // winners: undefined — never populated
        creator: '76561197960287930',
        creator_username: 'testuser',
      }

      const result = shouldCheckGiveaway(giveaway)
      expect(result).toBe(true)
    })

    it('should return false for ended giveaway with a confirmed received winner', () => {
      const now = Math.floor(Date.now() / 1000)
      const giveaway: Giveaway = {
        id: 'test',
        name: 'Test Giveaway',
        points: 10,
        copies: 1,
        app_id: null,
        package_id: null,
        link: 'test/test-giveaway',
        created_timestamp: now - 1000,
        start_timestamp: now - 1000,
        end_timestamp: now - 500, // Ended 500 seconds ago
        group: true,
        entry_count: 5,
        winners: [{ name: 'winneruser', status: 'received' }],
        creator: '76561197960287930',
        creator_username: 'testuser',
      }

      const result = shouldCheckGiveaway(giveaway)
      expect(result).toBe(false)
    })

    it('should return true for future giveaway (not yet ended)', () => {
      const now = Math.floor(Date.now() / 1000)
      const giveaway: Giveaway = {
        id: 'test',
        name: 'Test Giveaway',
        points: 10,
        copies: 1,
        app_id: null,
        package_id: null,
        link: 'test/test-giveaway',
        created_timestamp: now + 1000, // In the future
        start_timestamp: now + 1000,
        end_timestamp: now + 1500,
        group: true,
        entry_count: 0,
        creator: '76561197960287930',
        creator_username: 'testuser',
      }

      const result = shouldCheckGiveaway(giveaway)
      expect(result).toBe(true)
    })
  })
})
