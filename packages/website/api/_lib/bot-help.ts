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
  `**/challenge-setup** — Opens a form to create a challenge: name, description, challenge month, signups-close date, congrats channel. "Challenge month" is when the challenge is played: just the month (e.g. "October" runs Oct 1 through Oct 31, UTC), or a range like "Oct 5 to Oct 25". Signups open as soon as it's announced and, unless "Signups close" says otherwise, close when the challenge starts. "Congrats channel" is optional: until one is set, finisher congrats go to the announcement channel, so skip it and add it with /challenge-edit once the challenge channel exists. A challenge that starts within a day and lasts under a week is rejected as a likely signup period entered as the challenge dates.\nPosts: the announcement widget (signup buttons + live counter) in ${ANNOUNCE_CHANNEL_TEXT}, no matter where you run the command. Your confirmation, which spells out the signup/run timeline, is private.`,
  '',
  "**/challenge-edit** — Pick a challenge, then a form prefilled with its current values (falls back to empty fields, all keeping their current value, if the prefill lookup times out). Edit a field to change it, or leave it as shown to keep it — a resubmitted field identical to what's shown counts as unchanged. Edits the widget in place (signups and counters are preserved; a closed challenge stays closed). Change name, description, challenge month, signups-close date (not shown once signups have closed), or congrats channel — same fields as /challenge-setup.\nPosts: nothing new — it updates the existing announcement. Your confirmation, which spells out the signup/run timeline, is private.",
  '',
  '**/challenge-list** — Pick a challenge (ongoing first), get the full signup roster: who wants the game, who has it, guests/unresolved.\nPosts: the roster in the channel you run it in.',
  '',
  "**/challenge-archive** — Pick a challenge to hide it from lists and all bot activity, and disable its signup buttons. Delete the announcement message manually if it was a mistake. Un-archive by deleting the ARCHIVED line in the bot log channel.\nPosts: nothing public. Your confirmation is private.",
  '',
  '**/raffle** — Draw N random winners. Pick a challenge (labeled signup phase / ongoing / ended) and a pool ("Want the game" is the default — the key-raffle case), or choose "Paste a list of names…" and paste names separated by commas or line breaks (for prize draws among finishers, copy the names from the results page).\nPosts: the winner announcement in the channel you run it in — run it where the winners should be announced. Every draw is also logged in the bot log channel.',
  '',
  '**/mod-report** — The full member-status report: "Need attention" (errors) then "Warnings", one block per member with per-finding specifics and links to member pages (required-play findings deep-link to the filtered Won tab).\nPosts: the report in the channel you run it in.',
  '',
  '**/bot-help** — This guide.\nPosts: nothing — only you can see it.',
  '',
  "**Automatic messages** (no command needed)\n- Signups close (hourly check): summary + disabled buttons on the announcement, plus a /raffle how-to in the admin channel.\n- 24h before a challenge ends and when it ends: notices in the challenge's announcement channel, plus a /raffle prize-draw how-to in the admin channel when it ends.\n- Member finishes a challenge (hourly): congrats in the challenge's congrats channel.\n- Weekly mod digest (Fridays 13:00 UTC): error-level findings in the warns channel.",
]

/** Renders the /bot-help guide as ≤1900-char message chunks, ready to send as the first `editOriginalResponse` and any subsequent `sendFollowup` calls. */
export function buildBotHelpMessages(): string[] {
  return chunkMessage(SEGMENTS, 1900)
}
