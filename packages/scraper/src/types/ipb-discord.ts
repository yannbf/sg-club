/** Which signal in the thread's starter message resolved the match, in priority order. */
export type IpbDiscordMatchSource =
  | 'giveaway_link'
  | 'app_link'
  | 'review_link'
  | 'title'
  | 'app_link_unique'
  | 'title_unique'
  | 'steam_forum'

/** Where an "I Play Bro" submission was posted. */
export type IpbSubmissionSource = 'discord' | 'steam_forum'

/**
 * One "I Play Bro" submission matched to a group win.
 *
 * For `source: 'steam_forum'` (the one-time backfill from the Steam group's
 * "playtest here" discussion) the Discord-named fields hold the forum
 * equivalents: `thread_id` is the Steam comment id, `url` the comment
 * permalink, `thread_name` the game name, `owner_discord_name` the poster's
 * Steam display name and `thread_created_at` the post time.
 */
export interface IpbDiscordWinEntry {
  /** Absent means `discord`. */
  source?: IpbSubmissionSource
  thread_id: string
  url: string
  thread_name: string
  matched_by: IpbDiscordMatchSource
  /** Present only when matched_by is 'review_link'. */
  review_url?: string
  owner_discord_name: string
  thread_created_at: string
  /**
   * Whether this win currently carries `i_played_bro`. The flag is set by
   * a mod only after verifying, so `false` here means this thread is a
   * pending verification submission.
   */
  win_flagged: boolean
}

/** A verification thread that couldn't be matched to a resolvable user or a win. */
export interface IpbDiscordUnmatchedThread {
  thread_id: string
  name: string
  url: string
  owner_discord_name: string
}

export interface IpbDiscordData {
  last_updated: string
  /** Keyed by `${steamId}::${giveawayLink}`. */
  wins: Record<string, IpbDiscordWinEntry>
  unmatched_threads: IpbDiscordUnmatchedThread[]
}
