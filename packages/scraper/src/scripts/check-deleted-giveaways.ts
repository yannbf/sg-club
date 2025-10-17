import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { load } from 'cheerio'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { Giveaway } from '../types/steamgifts.js'
import { groupGiveawaysScraper } from '../scrapers/group-giveaways.js'
import { delay } from '../utils/common.js'

interface GiveawayData {
  last_updated: string
  giveaways: Giveaway[]
}

interface DeletionInfo {
  deleted: boolean
  reason?: string
  description?: string
}

/**
 * Checks if a giveaway page HTML indicates that the giveaway is deleted
 */
function isGiveawayDeleted(html: string): DeletionInfo {
  const $ = load(html)

  // Check if this is an error page
  const pageHeading = $('.page__heading__breadcrumbs').text().trim()
  if (pageHeading !== 'Error') {
    return { deleted: false }
  }

  // Look for the error table rows
  const errorRows = $('.table__row-outer-wrap')

  let isDeleted = false
  let reason = ''

  errorRows.each((_, row) => {
    const $row = $(row)
    const label = $row.find('.table__column--width-small strong').text().trim()
    const value = $row.find('.table__column--width-fill').text().trim()

    if (label === 'Error') {
      // Check if it contains "Deleted" text
      if (value.includes('Deleted')) {
        isDeleted = true
      }
    } else if (label === 'Reason') {
      reason = value
    }
  })

  return {
    deleted: isDeleted,
    reason: reason || undefined,
  }
}

/**
 * Gets the full URL for a giveaway
 */
function getGiveawayUrl(giveaway: Giveaway): string {
  return `/giveaway/${giveaway.id}/${giveaway.link.split('/').pop()}`
}

/**
 * Checks if a giveaway should be checked for deletion
 * Returns true if the giveaway has ended and has no entries
 */
function shouldCheckGiveaway(giveaway: Giveaway): boolean {
  const now = Math.floor(Date.now() / 1000)
  const hasEnded = giveaway.end_timestamp < now
  const hasNoEntries = giveaway.entry_count === 0
  const hasNoWinners = giveaway.winners?.length === 0
  const hasNoConfirmedWinners =
    giveaway.winners?.every((winner) => winner.status !== 'received') ?? false

  return (
    hasEnded &&
    (hasNoEntries || hasNoWinners || hasNoConfirmedWinners) &&
    !giveaway.deleted
  )
}

/**
 * Updates giveaways that have been deleted
 */
async function checkDeletedGiveaways(): Promise<void> {
  const giveawaysJsonPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../website/public/data/giveaways.json'
  )

  if (!existsSync(giveawaysJsonPath)) {
    console.log(
      '❌ giveaways.json not found. Run generate-giveaways-data.ts first.'
    )
    return
  }

  const giveawaysData: GiveawayData = JSON.parse(
    readFileSync(giveawaysJsonPath, 'utf-8')
  )

  console.log(
    `🔍 Checking ${giveawaysData.giveaways.length} giveaways for deletion...`
  )

  let checkedCount = 0
  let deletedCount = 0
  let errorCount = 0

  // Filter giveaways that need to be checked
  const giveawaysToCheck = giveawaysData.giveaways.filter(shouldCheckGiveaway)

  console.log(
    `📋 Found ${giveawaysToCheck.length} ended giveaways with no entries to check`
  )

  for (const giveaway of giveawaysToCheck) {
    try {
      const url = getGiveawayUrl(giveaway)
      console.log(`🔍 Checking: ${giveaway.name} (${url})`)

      const html = await groupGiveawaysScraper.fetchPage(url, false)
      const deletionInfo = isGiveawayDeleted(html)

      if (deletionInfo.deleted !== undefined) {
        giveaway.deleted = deletionInfo.deleted
        if (deletionInfo.deleted) {
          console.log(`🗑️  Found deleted giveaway: ${giveaway.name}`)
          giveaway.deleted_reason = deletionInfo.reason
          deletedCount++
        }
      }

      checkedCount++

      // Add a small delay to be respectful to the server
      if (checkedCount % 10 === 0) {
        await delay(1000)
      }
    } catch (error) {
      console.error(`❌ Error checking giveaway ${giveaway.name}:`, error)
      errorCount++
    }
  }

  // Save the updated data
  giveawaysData.last_updated = new Date().toISOString()
  writeFileSync(giveawaysJsonPath, JSON.stringify(giveawaysData, null, 2))

  console.log(`✅ Checked ${checkedCount} giveaways`)
  console.log(`🗑️  Marked ${deletedCount} giveaways as deleted`)
  if (errorCount > 0) {
    console.log(`❌ Encountered ${errorCount} errors`)
  }
}

/**
 * Run the script only if called directly
 */
if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await checkDeletedGiveaways()
  }
}

export { checkDeletedGiveaways, isGiveawayDeleted, shouldCheckGiveaway }
