import type { Giveaway, GameData } from '@/types'
import { isConfirmedPlayed, type ConfirmedPlaySignal } from './play-status'

/**
 * Month-bucketing and CV-value-join helpers shared by the group stats page
 * (/stats) and the per-user stats section (/users/[username]). Every input
 * here is expected to already be filtered to counted giveaways
 * (`isCountedGiveaway` from `@/lib/events`) — this module does no
 * deleted/zero-entry filtering of its own.
 */

export interface MonthPoint {
  /** Sortable key, e.g. "2024-03". */
  month: string
  /** Display label, e.g. "Mar 24". */
  label: string
}

/** Unix seconds -> "YYYY-MM", using UTC so the bucket doesn't shift with the viewer's timezone. */
export function monthKey(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** "2024-03" -> "Mar 24" */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1, 1))
  return d.toLocaleDateString('en-US', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  })
}

/** Every month key from `startKey` to `endKey` inclusive, so gap months render as zero instead of being skipped. */
export function monthRange(startKey: string, endKey: string): string[] {
  const [sy, sm] = startKey.split('-').map(Number)
  const [ey, em] = endKey.split('-').map(Number)
  const out: string[] = []
  let y = sy
  let m = sm
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

/**
 * Sums (or averages) `getValue(item)` per calendar month of `getTimestamp(item)`,
 * skipping items with no timestamp. Returns a raw month -> number map — pass it
 * to `combineMonthlySeries` to line up several maps on one continuous axis.
 */
export function monthlyAggregate<T>(
  items: T[],
  getTimestamp: (item: T) => number | null | undefined,
  getValue: (item: T) => number = () => 1,
  agg: 'sum' | 'avg' = 'sum',
): Map<string, number> {
  const sums = new Map<string, number>()
  const counts = new Map<string, number>()
  for (const item of items) {
    const ts = getTimestamp(item)
    if (ts == null) continue
    const key = monthKey(ts)
    sums.set(key, (sums.get(key) ?? 0) + getValue(item))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  if (agg === 'sum') return sums
  const avgs = new Map<string, number>()
  for (const [key, sum] of sums) {
    avgs.set(key, sum / (counts.get(key) ?? 1))
  }
  return avgs
}

export type MonthRow = MonthPoint & Record<string, number | string>

/**
 * Lines up any number of named month->number maps onto one continuous month
 * axis (gap months filled with `fillValue`), so combo/multi-series charts can
 * share a single x-axis domain.
 */
export function combineMonthlySeries(
  maps: Record<string, Map<string, number>>,
  fillValue = 0,
): MonthRow[] {
  const allKeys = new Set<string>()
  for (const map of Object.values(maps)) {
    for (const key of map.keys()) allKeys.add(key)
  }
  if (allKeys.size === 0) return []
  const sorted = Array.from(allKeys).sort()
  const range = monthRange(sorted[0], sorted[sorted.length - 1])
  return range.map((key) => {
    const row: MonthRow = { month: key, label: monthLabel(key) }
    for (const [name, map] of Object.entries(maps)) {
      row[name] = map.get(key) ?? fillValue
    }
    return row
  })
}

/** Adds a running-total `${key}_cumulative` column for each requested key, in row order. */
export function withCumulative(rows: MonthRow[], keys: string[]): MonthRow[] {
  const running: Record<string, number> = Object.fromEntries(
    keys.map((k) => [k, 0]),
  )
  return rows.map((row) => {
    const out: MonthRow = { ...row }
    for (const key of keys) {
      running[key] += Number(row[key] ?? 0)
      out[`${key}_cumulative`] = running[key]
    }
    return out
  })
}

// --- CV value join (giveaway -> GameData by app_id, falling back to package_id) ---

export interface GameDataIndex {
  byAppId: Map<number, GameData>
  byPackageId: Map<number, GameData>
}

export function buildGameDataIndex(gameData: GameData[]): GameDataIndex {
  const byAppId = new Map<number, GameData>()
  const byPackageId = new Map<number, GameData>()
  for (const g of gameData) {
    if (g.app_id != null) byAppId.set(g.app_id, g)
    if (g.package_id != null) byPackageId.set(g.package_id, g)
  }
  return { byAppId, byPackageId }
}

export function findGameData(
  appId: number | null | undefined,
  packageId: number | null | undefined,
  index: GameDataIndex,
): GameData | undefined {
  if (appId != null) {
    const g = index.byAppId.get(appId)
    if (g) return g
  }
  if (packageId != null) return index.byPackageId.get(packageId)
  return undefined
}

/**
 * The per-copy CV value in dollars for a given cv_status against a resolved
 * GameData record. The price_usd_* fields are stored in cents.
 */
export function cvUnitPrice(
  cvStatus: Giveaway['cv_status'] | undefined,
  game: GameData | undefined,
): number {
  if (!game || !cvStatus || cvStatus === 'NO_CV') return 0
  const cents =
    cvStatus === 'FULL_CV'
      ? game.price_usd_full || 0
      : game.price_usd_reduced || 0
  return cents / 100
}

/** CV value of a full Giveaway record (has its own app_id/package_id/copies). */
export function giveawayCvValue(
  g: Pick<Giveaway, 'app_id' | 'package_id' | 'cv_status' | 'copies'>,
  index: GameDataIndex,
): number {
  const game = findGameData(g.app_id, g.package_id, index)
  return cvUnitPrice(g.cv_status, game) * (g.copies || 1)
}

/**
 * CV value for a per-user record (giveaways_created/giveaways_won entries)
 * that only carries a `link`, not app_id/package_id — resolves those via a
 * link -> Giveaway lookup built from the full giveaways list.
 */
export function cvValueForLink(
  link: string,
  cvStatus: Giveaway['cv_status'] | undefined,
  copies: number,
  giveawayByLink: Map<string, Pick<Giveaway, 'app_id' | 'package_id'>>,
  index: GameDataIndex,
): number {
  const ga = giveawayByLink.get(link)
  if (!ga) return 0
  const game = findGameData(ga.app_id, ga.package_id, index)
  return cvUnitPrice(cvStatus, game) * (copies || 1)
}

// --- Win play-status classification (for the per-user wins breakdown donut) ---

export type WinPlayStatus = 'finished' | 'played' | 'never_played' | 'unreleased'

/**
 * Buckets a won giveaway by play evidence for the wins-breakdown donut.
 * `unreleased` wins are never counted as played or unplayed (nobody can play
 * a game that hasn't shipped, per the group's play-requirement rules). A
 * mod-confirmed "I played, bro" or proof-of-play sign-off (`isConfirmedPlayed`)
 * always counts as at least "played", regardless of what Steam shows — Steam
 * may show it unplayed when it was played elsewhere or the profile is
 * private. "Finished" means every achievement has been *actually* unlocked;
 * everything else with recorded playtime is "played", and everything else is
 * "never played" (including missing/private Steam data, since there's no
 * evidence either way).
 */
export function classifyWinPlayStatus(
  win: ConfirmedPlaySignal & {
    unreleased?: boolean
    steam_play_data?: {
      never_played: boolean
      playtime_minutes: number
      achievements_unlocked: number
      achievements_total: number
    }
  },
): WinPlayStatus {
  if (win.unreleased) return 'unreleased'
  const play = win.steam_play_data
  const finished =
    !!play &&
    play.achievements_total > 0 &&
    play.achievements_unlocked >= play.achievements_total
  if (finished) return 'finished'
  if (isConfirmedPlayed(win)) return 'played'
  if (!play || play.never_played || play.playtime_minutes <= 0) {
    return 'never_played'
  }
  return 'played'
}
