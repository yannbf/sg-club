import type { Giveaway, User } from '@/types'

export const getUserRatio = (
  ratio = 0
): 'contributor' | 'receiver' | 'neutral' => {
  if (ratio > 0) {
    return 'contributor'
  } else if (ratio <= -1) {
    return 'receiver'
  }

  return 'neutral'
}

/**
 * A giveaway "counts" as a real full-CV contribution only when it is a
 * group-exclusive (not shared, not whitelist), FULL_CV giveaway that actually
 * ran — i.e. it wasn't deleted and had at least one entry. Deleted, empty,
 * shared, or whitelist giveaways are ignored everywhere we surface a member's
 * "last full-CV giveaway created".
 */
export function isValidFcvGiveaway(g: Giveaway): boolean {
  return (
    g.cv_status === 'FULL_CV' &&
    !g.deleted &&
    (g.entry_count ?? 0) > 0 &&
    g.group === true &&
    !g.is_shared &&
    !g.whitelist
  )
}

/** The set of giveaway links that qualify as valid full-CV contributions. */
export function buildValidFcvLinks(giveaways: Giveaway[]): Set<string> {
  return new Set(giveaways.filter(isValidFcvGiveaway).map((g) => g.link))
}

/**
 * Links of giveaways that were deleted on SG. Deleted giveaways stay visible
 * for inspection but must be excluded from every count/statistic. Filter user
 * array entries with `isCountedGa(entry, deletedGaLinks)` — the link set
 * covers data generated before the `deleted` flag was propagated onto the
 * per-user giveaway entries.
 */
export function buildDeletedGaLinks(giveaways: Giveaway[]): Set<string> {
  return new Set(giveaways.filter((g) => g.deleted).map((g) => g.link))
}

/** Whether a per-user giveaway entry should be included in counts. */
export function isCountedGa(
  g: { link: string; deleted?: boolean },
  deletedGaLinks?: Set<string>
): boolean {
  return !g.deleted && !deletedGaLinks?.has(g.link)
}

/**
 * The member's most recent valid full-CV giveaway created, or null. Pass the
 * set from buildValidFcvLinks() (computed where the giveaway list is available).
 */
export function lastValidFcvCreated(
  user: User,
  validFcvLinks: Set<string>
): NonNullable<User['giveaways_created']>[number] | null {
  const created = user.giveaways_created ?? []
  let latest: NonNullable<User['giveaways_created']>[number] | null = null
  for (const g of created) {
    if (!validFcvLinks.has(g.link)) continue
    if (latest === null || g.created_timestamp > latest.created_timestamp) {
      latest = g
    }
  }
  return latest
}
