/** Which signal in the thread's starter message resolved the match, in priority order. */
export type IpbDiscordMatchSource =
  | 'giveaway_link'
  | 'app_link'
  | 'review_link'
  | 'title'
  | 'app_link_unique'
  | 'title_unique'

/** One "I Play Bro" verification thread matched to a group win. */
export interface IpbDiscordWinEntry {
  thread_id: string
  url: string
  thread_name: string
  matched_by: IpbDiscordMatchSource
  /** Present only when matched_by is 'review_link'. */
  review_url?: string
  owner_discord_name: string
  thread_created_at: string
  /**
   * Whether this win currently carries `i_played_bro` or `required_play`.
   * The flag is set by a mod only after verifying, so `false` here means
   * this thread is a pending verification submission.
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
