// Resolves a Steam id (the only thing a verified session proves) into the
// profile info the client needs to render itself: display name, avatar, and
// group membership.

import { loadDataFile } from './data.js'
import { isAdminSteamId } from './constants.js'

export interface SteamUser {
  steamId: string
  username: string | null
  avatarUrl: string | null
  isMember: boolean
  isExMember: boolean
  isAdmin: boolean
}

interface SteamIdMapEntry {
  current: string
  previous: { username: string; changed_at: string }[]
}

type SteamIdMap = Record<string, SteamIdMapEntry>

interface GroupUser {
  username: string
  avatar_url?: string
}

interface GroupUsersData {
  users: Record<string, GroupUser>
}

/** Loads a data file, treating any failure (missing file, bad host, etc.) as "no data" so one broken file can't take the whole handler down. */
async function loadOrEmpty<T>(name: string, host: string | undefined, empty: T): Promise<T> {
  try {
    return await loadDataFile<T>(name, host)
  } catch {
    return empty
  }
}

export async function resolveSteamUser(steamId: string, host?: string): Promise<SteamUser> {
  const [steamIdMap, groupUsers, exMembers] = await Promise.all([
    loadOrEmpty<SteamIdMap>('steam_id_map.json', host, {}),
    loadOrEmpty<GroupUsersData>('group_users.json', host, { users: {} }),
    loadOrEmpty<GroupUsersData>('ex_members.json', host, { users: {} }),
  ])

  const groupUser = groupUsers.users[steamId]
  const exMember = exMembers.users[steamId]
  const matchedUser = groupUser ?? exMember

  const username = steamIdMap[steamId]?.current ?? matchedUser?.username ?? null
  const avatarUrl = matchedUser?.avatar_url ?? null

  return {
    steamId,
    username,
    avatarUrl,
    isMember: Boolean(groupUser),
    isExMember: Boolean(exMember),
    isAdmin: isAdminSteamId(steamId),
  }
}
