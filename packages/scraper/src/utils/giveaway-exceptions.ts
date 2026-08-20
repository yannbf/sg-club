import type { Giveaway } from '../types/steamgifts'

/**
 * Giveaways the mods ruled to count as normal group giveaways even though
 * SteamGifts shows them as whitelist and/or shared — typically created with
 * the wrong audience by accident. Keyed by giveaway id, value is the reason
 * (for humans; only the key is used programmatically).
 *
 * The exception is applied by clearing the `whitelist`/`is_shared` flags at
 * data-generation time, so every downstream consumer (member CV stats, the
 * website's ratio-valid filters, CV badges) counts these giveaways without
 * needing its own exception logic. It must be re-applied on every scrape
 * because the whitelist flag is read fresh from SteamGifts each run.
 */
export const RATIO_VALID_EXCEPTIONS: Record<string, string> = {
  '5SPoO':
    'It Takes Two by yannbz — accidentally created as a whitelist giveaway; ruled an honest mistake and counts as a regular group giveaway',
}

/** Clears the whitelist/shared flags on excepted giveaways, in place. */
export function applyGiveawayExceptions(giveaways: Giveaway[]): void {
  for (const g of giveaways) {
    if (RATIO_VALID_EXCEPTIONS[g.id]) {
      delete g.whitelist
      delete g.is_shared
    }
  }
}
