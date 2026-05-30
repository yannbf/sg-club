import { SteamIdMap } from '@/types'

/**
 * Resolves giveaway `creator` and winner `name` fields against `steam_id_map.json`.
 *
 * Why this exists: the scraper writes `creator` as a steam_id whenever it can
 * resolve the username, but for users whose SG account no longer exists (e.g.
 * accounts that were deleted altogether) it falls back to writing the raw
 * username string. The same situation applies to a few renamed users we
 * haven't yet learned about. Without consolidation, those records inflate our
 * unique-contributor counts vs what SG itself shows.
 *
 * The resolver exposes:
 *  - `canonicalSteamId(raw)` — best-effort mapping of any creator/winner field
 *    to a stable steam_id key. Returns the raw string unchanged if we can't
 *    map it (so leaderboards still show *some* identity).
 *  - `isDeletedAccount(raw)` — whether the resolved entity has been marked as
 *    a deleted SG account. Counts that compare against SG's group page should
 *    exclude these.
 *  - `displayName(raw)` — the user-facing username (post-rename) for any raw
 *    value, falling back to the raw value when unknown.
 */
export function createCreatorResolver(steamIdMap: SteamIdMap) {
  // username (current OR previous) → steam_id
  const usernameToSteamId = new Map<string, string>()
  for (const [steamId, entry] of Object.entries(steamIdMap)) {
    usernameToSteamId.set(entry.current.toLowerCase(), steamId)
    for (const prev of entry.previous) {
      usernameToSteamId.set(prev.username.toLowerCase(), steamId)
    }
  }

  const looksLikeSteamId = (val: string) =>
    /^\d{17}$/.test(val) || val.startsWith('username:')

  const canonicalSteamId = (raw: string | undefined | null): string => {
    if (!raw) return ''
    if (looksLikeSteamId(raw)) return raw
    return usernameToSteamId.get(raw.toLowerCase()) || raw
  }

  const isDeletedAccount = (raw: string | undefined | null): boolean => {
    const id = canonicalSteamId(raw)
    return steamIdMap[id]?.deleted_sg_account === true
  }

  const displayName = (raw: string | undefined | null): string => {
    if (!raw) return ''
    const id = canonicalSteamId(raw)
    return steamIdMap[id]?.current || raw
  }

  return { canonicalSteamId, isDeletedAccount, displayName }
}

export type CreatorResolver = ReturnType<typeof createCreatorResolver>
