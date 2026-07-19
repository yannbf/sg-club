// Resolves a Discord user to a SteamGifts username using the hand-maintained
// discord_members.json map, and validates guest-entered SG usernames against
// the scraped group_users.json roster.

import { loadDataFile } from './data'

export interface DiscordMembersData {
  members: Record<string, boolean>
  // SG username -> Discord account handle (stable handle, not display name).
  handles: Record<string, string>
}

interface GroupUser {
  username: string
  steam_id: string
}

interface GroupUsersData {
  users: Record<string, GroupUser>
}

/**
 * Reverse-looks-up a Discord handle (case-insensitive) in discord_members.json's
 * handles map to find the SG username it belongs to. Returns null if no
 * current member's handle matches — the caller should fall back to the guest
 * flow (modal prompt).
 */
export async function resolveDiscordUserToSgUsername(
  discordHandle: string,
  host?: string
): Promise<string | null> {
  const discordMembers = await loadDataFile<DiscordMembersData>(
    'discord_members.json',
    host
  )
  const lower = discordHandle.toLowerCase()
  for (const [sgUsername, handle] of Object.entries(discordMembers.handles)) {
    if (handle.toLowerCase() === lower) return sgUsername
  }
  return null
}

/**
 * Validates a guest-entered SG username against group_users.json, matching
 * case-insensitively and trimmed. Returns the canonical (correctly-cased)
 * username, or null if it isn't a current group member (treated as a guest).
 */
export async function validateSgUsername(
  input: string,
  host?: string
): Promise<string | null> {
  const trimmed = input.trim()
  if (!trimmed) return null

  const groupUsers = await loadDataFile<GroupUsersData>('group_users.json', host)
  const lower = trimmed.toLowerCase()
  for (const user of Object.values(groupUsers.users)) {
    if (user.username.toLowerCase() === lower) return user.username
  }
  return null
}
