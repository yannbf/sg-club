// Static help text for the /bot-help command — one segment per command (plus
// a header and an automatic-messages block), chunked to fit Discord's
// message-length cap via the same `chunkMessage` the mod-report and
// challenge-list surfaces use.

import { FORCED_ANNOUNCE_CHANNEL_ID } from './constants.js'
import { chunkMessage } from './mod-report.js'

// Mirrors /challenge-setup's own channel logic: once FORCED_ANNOUNCE_CHANNEL_ID
// is flipped on for production, every challenge announcement lands there
// regardless of the invoking channel; while it's null (test phase) the
// announcement follows wherever the command was run.
const ANNOUNCE_CHANNEL_TEXT = FORCED_ANNOUNCE_CHANNEL_ID
  ? `<#${FORCED_ANNOUNCE_CHANNEL_ID}>`
  : 'the channel you run it in'

const SEGMENTS: string[] = [
  '**TGC Bot — command guide** (admin/mod only; this message is only visible to you)',
  '',
  `**/challenge-setup** — Opens a form to create a challenge: name, description, dates, congrats channel. Dates accept e.g. "August 1 to August 30", "today to +2w", or just "August" for the whole month (UTC). The signup deadline is automatic: the challenge start (or the end, for challenges that start immediately) — adjust it later with /challenge-edit.\nPosts: the announcement widget (signup buttons + live counter) in ${ANNOUNCE_CHANNEL_TEXT}, no matter where you run the command. Your confirmation is private.`,
  '',
  '**/challenge-edit** — Pick a challenge, then a form where every empty field keeps its current value. Edits the widget in place (signups and counters are preserved; a closed challenge stays closed). Change name, description, dates, signup deadline, or congrats channel.\nPosts: nothing new — it updates the existing announcement. Your confirmation is private.',
  '',
  '**/challenge-list** — Pick a challenge (ongoing first), get the full signup roster: who wants the game, who has it, guests/unresolved.\nPosts: the roster in the channel you run it in.',
  '',
  "**/challenge-archive** — Pick a challenge to hide it from lists and all bot activity, and disable its signup buttons. Delete the announcement message manually if it was a mistake. Un-archive by deleting the ARCHIVED line in the bot log channel.\nPosts: nothing public. Your confirmation is private.",
  '',
  '**/raffle** — Draw N random winners. Pick a challenge (labeled signup phase / ongoing / ended) and a pool ("Want the game" is the default — the key-raffle case), or choose "Paste a list of names…" and paste names separated by commas or line breaks (for prize draws among finishers, copy the names from the results page).\nPosts: the winner announcement in the channel you run it in — run it where the winners should be announced. Every draw is also logged in the bot log channel.',
  '',
  '**/mod-report** — The full member-status report: "Need attention" (errors) then "Warnings", grouped by identical finding combos, with links to member pages (required-play findings deep-link to the filtered Won tab).\nPosts: the report in the channel you run it in.',
  '',
  '**/bot-help** — This guide.\nPosts: nothing — only you can see it.',
  '',
  "**Automatic messages** (no command needed)\n- Signups close (hourly check): summary + disabled buttons on the announcement, plus a /raffle how-to in the admin channel.\n- 24h before a challenge ends and when it ends: notices in the challenge's announcement channel, plus a /raffle prize-draw how-to in the admin channel when it ends.\n- Member finishes a challenge (hourly): congrats in the challenge's congrats channel.\n- Weekly mod digest (Fridays 13:00 UTC): error-level findings in the warns channel.",
]

/** Renders the /bot-help guide as ≤1900-char message chunks, ready to send as the first `editOriginalResponse` and any subsequent `sendFollowup` calls. */
export function buildBotHelpMessages(): string[] {
  return chunkMessage(SEGMENTS, 1900)
}
