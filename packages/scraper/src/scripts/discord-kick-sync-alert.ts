import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// Cross-package relative import — see discord-close-signups.ts / DISCORD-BOT.md.
import { createMessage } from '../../../website/api/_lib/discord-rest.js'
import { getAdminChannelId } from '../../../website/api/_lib/constants.js'
import { checkExMemberEntries, type FlaggedExMember } from './check-ex-member-entries.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(__dirname, '../../..', 'website/public/data')
const statePath = path.join(dataDir, 'discord_kick_alert_state.json')

const BASE_URL = 'https://www.steamgifts.com/giveaway'

export interface KickSyncAlertState {
  alerted: Record<string, string[]>
}

function loadState(): KickSyncAlertState {
  if (!existsSync(statePath)) return { alerted: {} }
  return JSON.parse(readFileSync(statePath, 'utf-8'))
}

function saveState(state: KickSyncAlertState): void {
  writeFileSync(statePath, JSON.stringify(state, null, 2))
}

export interface PendingAlert {
  member: FlaggedExMember
  newLinks: string[]
}

/**
 * Pure diff, split out for testability: for each flagged member, which of
 * their active-entry links haven't already been alerted on. A member with
 * nothing new (every link already recorded in state) is dropped entirely.
 */
export function diffNewLinks(
  flagged: FlaggedExMember[],
  state: KickSyncAlertState,
): PendingAlert[] {
  return flagged
    .map((member) => {
      const alreadyAlerted = new Set(state.alerted[member.steam_id] ?? [])
      const newLinks = member.active_entries
        .map((entry) => entry.link)
        .filter((link) => !alreadyAlerted.has(link))
      return { member, newLinks }
    })
    .filter((pending) => pending.newLinks.length > 0)
}

/**
 * Builds one plain-markdown message covering every member with new links to
 * alert on. Each line distinguishes a kicked-but-not-yet-synced member from
 * a real ex-member SG has already synced out, and links only the entries
 * that haven't been alerted on before — angle brackets suppress link
 * previews so the message stays short.
 */
export function buildKickSyncAlertMessage(pending: PendingAlert[]): string {
  const lines = pending.map(({ member, newLinks }) => {
    const status = member.pending_sync
      ? 'kicked, not yet synced'
      : 'left (synced)'
    const linkList = newLinks
      .map((link) => `<${BASE_URL}/${link}/>`)
      .join(', ')
    const count = member.active_entries.length
    return `🏴‍☠️ **${member.username}** (${status}) — ${count} active entr${count === 1 ? 'y' : 'ies'} total, new: ${linkList}`
  })
  return ['**Kick-sync alert — members entered in group giveaways they no longer qualify for**', ...lines].join('\n')
}

/**
 * Cross-references ex-members and kicked-but-not-yet-synced members against
 * active group-exclusive giveaway entries (via `checkExMemberEntries`), and
 * posts ONE admin alert covering every giveaway link not already alerted on.
 * Stays silent — but still runs cleanly with no state change — when nothing
 * new turns up.
 */
export async function postKickSyncAlert(): Promise<void> {
  const state = loadState()
  const flagged = checkExMemberEntries()
  const pending = diffNewLinks(flagged, state)

  if (pending.length === 0) {
    console.log('✅ No new kick-sync-relevant giveaway entries to alert on.')
    return
  }

  await createMessage(getAdminChannelId(), {
    content: buildKickSyncAlertMessage(pending),
    flags: 4,
  })

  for (const { member, newLinks } of pending) {
    const alreadyAlerted = new Set(state.alerted[member.steam_id] ?? [])
    for (const link of newLinks) alreadyAlerted.add(link)
    state.alerted[member.steam_id] = [...alreadyAlerted]
  }
  saveState(state)

  console.log(
    `🏴‍☠️ Posted kick-sync alert for ${pending.length} member(s).`,
  )
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await postKickSyncAlert()
  }
}
