/** Where a game's beaten-marker achievement was determined from. */
export type BeatenMarkerSource = 'steamhunters' | 'heuristic'

/**
 * Why no beaten-marker achievement could be determined for a game.
 * "package" — the win only has a package_id (no app_id); marker detection is
 * not attempted for packages in v1.
 */
export type NoMarkerReason =
  | 'package'
  | 'no_achievements'
  | 'no_marker_found'
  | 'schema_unavailable'

/** Why a winner's beaten status could not be determined. */
export type NoBeatenDataReason =
  | 'profile_private'
  | 'no_stats'
  | 'marker_missing_from_player_data'

export interface BeatenMarker {
  apiname: string
  name: string
  description: string
  global_percent: number
  source: BeatenMarkerSource
  /**
   * Whether the DLC and difficulty/challenge filters over Steam Hunters
   * story-tag candidates left at least one survivor to pick from. `false`
   * means every candidate was filtered out and this marker is an unfiltered
   * fallback pick. Absent for heuristic-sourced markers.
   */
  filtered?: boolean
}

export interface BeatenGameEntry {
  marker: BeatenMarker | null
  no_marker_reason: NoMarkerReason | null
  /** Number of Main Storyline-tagged achievements found on Steam Hunters (0 when heuristic/none). */
  story_tag_count: number
  checked_at: string
  /**
   * Set when this appId is a DLC/soundtrack with no achievement schema of
   * its own and marker detection was re-run against its base game. `marker`
   * and `story_tag_count` describe that base game, not `resolved_app_id`
   * itself — the game entry stays keyed by the original (DLC) appId.
   */
  resolved_app_id?: number
  resolved_app_name?: string
}

export interface BeatenWinEntry {
  beaten: boolean | null
  unlock_time: number | null
  no_data_reason: NoBeatenDataReason | null
  checked_at: string
}

export interface BeatenGamesData {
  last_updated: string
  games: Record<string, BeatenGameEntry>
  wins: Record<string, BeatenWinEntry>
}
