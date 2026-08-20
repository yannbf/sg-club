import type { Giveaway } from '@/types'

/**
 * The subset of a won-game record needed to tell whether play was confirmed
 * out-of-band — matches both `User['giveaways_won'][number]` and
 * `WonGiveawaysClient`'s local `WonGiveaway` alias.
 */
export interface ConfirmedPlaySignal {
  /** Winner posted the "I played, bro!" attestation and a mod confirmed it. */
  i_played_bro?: boolean
  required_play_meta?: Pick<
    NonNullable<Giveaway['required_play_meta']>,
    'requirements_met'
  >
}

/**
 * A win is confirmed played when a mod signed off on "I played, bro" or on a
 * play-requirement's proof of play — regardless of what Steam's playtime/
 * achievement data says (the game may have been played elsewhere, or the
 * profile may be private). This is the single source of truth for that
 * signal; every "never played" / play-rate computation in the app must defer
 * to it instead of re-deriving the same two fields.
 */
export function isConfirmedPlayed(win: ConfirmedPlaySignal): boolean {
  return Boolean(win.i_played_bro || win.required_play_meta?.requirements_met)
}
