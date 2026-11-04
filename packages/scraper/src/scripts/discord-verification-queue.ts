import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// Cross-package relative import — see discord-close-signups.ts / DISCORD-BOT.md.
import { createMessage } from '../../../website/api/_lib/discord-rest.js'
import { TEST_ANNOUNCE_CHANNEL_ID } from '../../../website/api/_lib/constants.js'
import { SITE_BASE } from '../../../website/api/_lib/mod-report.js'
import {
  buildPlayRequiredRows,
  matchesIpbCard,
  matchesPrCard,
  type PlayRequiredRow,
} from '../../../website/src/lib/beaten.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(__dirname, '../../..', 'website/public/data')

const VERIFICATION_URL = `${SITE_BASE}/verification/`
const NOT_IN_SHEET_URL = `${VERIFICATION_URL}?tab=play-required&card=not-in-sheet`
const PR_PENDING_URL = `${VERIFICATION_URL}?tab=play-required`
const IPB_PENDING_URL = `${VERIFICATION_URL}?tab=ipb`

export interface VerificationQueueCounts {
  notInSheet: number
  /** Pending Play Required wins with Steam or heuristic evidence of completion. */
  pendingLikelyBeaten: number
  ipbPending: number
}

/**
 * Counts current members' wins only, matching what /verification shows by
 * default. Each count uses the same card predicate as the page's sub-tabs.
 */
export function countVerificationQueue(rows: PlayRequiredRow[]): VerificationQueueCounts {
  const members = rows.filter((row) => !row.winner.isExMember)
  const playRequired = members.filter((row) => row.isPlayRequired)
  const ipb = members.filter((row) => row.isIpb)

  return {
    notInSheet: playRequired.filter((row) => matchesPrCard(row, 'not_in_sheet')).length,
    pendingLikelyBeaten: playRequired.filter(
      (row) =>
        matchesPrCard(row, 'pending_verification') &&
        (row.beaten.verdict === 'beaten_verified' || row.likelyBeaten.isLikely)
    ).length,
    ipbPending: ipb.filter((row) => matchesIpbCard(row, 'pending_verification')).length,
  }
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`

/**
 * One bullet per non-empty queue, each linking to the sub-tab holding it. The
 * `(<url>)` form suppresses Discord's link preview. Returns null when every
 * queue is empty, so the caller stays silent.
 */
export function buildVerificationQueueMessage(counts: VerificationQueueCounts): string | null {
  const lines: string[] = []
  if (counts.notInSheet > 0) {
    lines.push(
      `- Play Required, not registered in the sheet: [**${plural(counts.notInSheet, 'win')}**](<${NOT_IN_SHEET_URL}>)`
    )
  }
  if (counts.pendingLikelyBeaten > 0) {
    lines.push(
      `- Play Required, pending verification: [**${plural(counts.pendingLikelyBeaten, 'win')}, likely beaten**](<${PR_PENDING_URL}>)`
    )
  }
  if (counts.ipbPending > 0) {
    lines.push(
      `- I Play Bro, pending verification: [**${plural(counts.ipbPending, 'submission')}**](<${IPB_PENDING_URL}>)`
    )
  }
  return lines.length > 0 ? ['**Verification Queue**', ...lines].join('\n') : null
}

function readData<T>(fileName: string): T {
  return JSON.parse(readFileSync(path.join(dataDir, fileName), 'utf-8')) as T
}

type BuildRowsParams = Parameters<typeof buildPlayRequiredRows>[0]
type UsersFile = { users: Record<string, BuildRowsParams['memberUsers'][number]> }

function loadRows(): PlayRequiredRow[] {
  return buildPlayRequiredRows({
    memberUsers: Object.values(readData<UsersFile>('group_users.json').users),
    exMemberUsers: Object.values(readData<UsersFile>('ex_members.json').users),
    giveaways: readData<{ giveaways: BuildRowsParams['giveaways'] }>('giveaways.json').giveaways,
    gameData: readData<BuildRowsParams['gameData']>('game_data.json'),
    beatenGames: readData<BuildRowsParams['beatenGames']>('beaten_games.json'),
    ipbDiscord: readData<BuildRowsParams['ipbDiscord']>('ipb_discord.json'),
  })
}

export async function postVerificationQueue(): Promise<void> {
  const counts = countVerificationQueue(loadRows())
  const content = buildVerificationQueueMessage(counts)

  if (!content) {
    console.log('Verification queues are empty — staying silent.')
    return
  }

  const channelId = process.env.WARN_CHANNEL_ID ?? TEST_ANNOUNCE_CHANNEL_ID
  await createMessage(channelId, { content, flags: 4 })
  console.log('Posted verification queue:', counts)
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await postVerificationQueue()
  }
}
