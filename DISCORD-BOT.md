# Discord Bot

A serverless Discord bot for The Giveaways Club (TGC) server that runs challenge
signups: an admin announces a challenge, members click a button (or fill in a
tiny modal if the bot can't recognize their Discord account), and mods get a
roster + a weekly digest of things that need attention.

**No database.** All state lives in Discord messages (an append-only log
channel) and a couple of small JSON files committed alongside the rest of the
site's data.

## Architecture

```
packages/website/api/
├── _lib/                      # shared logic, not exposed as an endpoint
│   ├── constants.ts           # Discord IDs, env accessors, raw interaction/response type numbers
│   ├── discord-rest.ts        # fetch-based Discord REST helper (no discord.js)
│   ├── custom-id.ts           # button/modal custom_id encode+decode
│   ├── dates.ts                # admin date parsing/validation
│   ├── signup-log.ts          # the log-channel protocol (see below)
│   ├── identity.ts            # Discord user <-> SG username resolution
│   ├── data.ts                # loads public/data/*.json (fetch or fs, cached)
│   ├── mod-report.ts          # severity model + shared rendering for the digest and /mod-report (see below)
│   └── render.ts              # the announcement embed/buttons, and plain-markdown close-summary/challenge-list content
└── discord/
    └── interactions.ts        # the actual Vercel Function — Discord's Interactions Endpoint

packages/scraper/src/scripts/
├── discord-close-signups.ts       # cron: close expired signups
├── discord-challenge-congrats.ts  # cron: announce challenge completions
├── discord-challenge-milestones.ts # cron: 24h-left warning + "challenge over" notice
├── discord-warn-digest.ts         # cron: weekly mod digest (errors only)
└── discord-register-commands.ts   # one-off: register the four slash commands

.github/workflows/discord-bot.yml  # workflow_dispatch runner for the three cron scripts
```

The scraper-side cron scripts import the `_lib/` modules directly via a
relative path (`../../../website/api/_lib/...`) rather than duplicating the
REST/log-parsing logic — this is a single pnpm monorepo, so there's no
packaging boundary to work around, and `tsx` resolves the cross-package `.ts`
imports at runtime without any build step.

### Why a plain `/api` directory and not Next.js API routes

The website is a static export (`output: 'export'`), which normally means no
server-side routes at all. But Vercel treats any top-level `/api/*.ts` file in
a project as a generic Node.js Serverless Function — independent of whatever
frontend framework is being built — as long as the project root points at
`packages/website` (which it already does for this monorepo). So
`packages/website/api/discord/interactions.ts` deploys as
`https://<site>/api/discord/interactions` without touching Next.js routing at
all. The handler uses the plain Node.js `(req, res)` signature (not the
`@vercel/node` helper types) so no extra dependency was needed for that part.

**This is the one part of the setup that could not be verified end-to-end
in this environment** — see Risks below.

## The log-channel protocol

Every event is a single message posted to the log channel (`#bot-test-logs`
in test phase), one event per line:

```
CHALLENGE {"slug":"neo-cab","channel_id":"...","message_id":"...","deadline":1700000000,"start":1700000100,"end":1700100000,"name":"Neo Cab"}
SIGNUP {"slug":"neo-cab","choice":"want","discord_id":"...","discord_handle":"...","sg_username":"yannbf","guest":false,"ts":1700000050}
CLOSED {"slug":"neo-cab","ts":1700000500}
REMINDER24 {"slug":"neo-cab","ts":1700086400}
ENDED {"slug":"neo-cab","ts":1700100000}
ARCHIVED {"slug":"neo-cab","ts":1700200000}
```

- `CHALLENGE` — posted once by `/challenge-setup`, records where the
  announcement lives and its dates. `link` is a vestigial optional field —
  `/challenge-setup` no longer collects a per-challenge event link (see the
  Slash commands section below), but `ChallengeMeta.link` and the parser stay
  tolerant of old log lines that still have it. `congrats_channel_id` is
  another optional field — see [Two-channel challenge
  messages](#two-channel-challenge-messages) below — absent on old lines and
  on any setup that didn't pick a split channel.
- `SIGNUP` — posted on every button click / modal submit. `choice` is one of
  `want` / `have` / `out`.
- `CLOSED` — posted once signups are closed for a slug (marks it done so the
  close-signups cron doesn't reprocess it).
- `REMINDER24` — posted by `discord-challenge-milestones.ts` once a challenge
  is within 24h of its end, so the "24h left" warning is never repeated.
- `ENDED` — posted by `discord-challenge-milestones.ts` once a challenge's end
  has passed and the "challenge over" notice has gone out, so it's never
  repeated either.
- `ARCHIVED` — posted by `/challenge-archive` once an admin archives a
  challenge. An archived challenge is hidden from both pickers
  (`/challenge-list`, `/challenge-archive` itself) and skipped entirely by
  every cron script (`discord:close-signups`, `discord:milestones`,
  `discord:congrats`) — see their entries below. **Un-archiving** is manual:
  delete the `ARCHIVED` line from the log channel (there's no un-archive
  command).

The parser (`signup-log.ts`) is tolerant: any message that isn't a
well-formed protocol line (human chat, an old pre-protocol bot message,
garbage) is simply skipped.

`buildRoster(messages, slug)` dedupes `SIGNUP` events per `discord_id`,
keeping the one with the highest `ts` (not array order — Discord's message
list API returns newest-first, so relying on `ts` as the source of truth
keeps the result correct regardless of pagination order). A user whose latest
choice is `out` is dropped entirely; a user can rejoin after withdrawing by
clicking a button again.

`collectChallengeIndex(messages)` builds the per-slug "current state of every
challenge" view shared by the `/challenge-list` and `/challenge-archive`
pickers and the three cron scripts: the newest `CHALLENGE` meta per slug
(same newest-first dedupe convention as `buildRoster`) plus which of the four
marker types (`closed`/`reminded`/`ended`/`archived`) have been posted for
it.

## Custom IDs

Buttons and modals encode their context directly in `custom_id`, since
there's no database to look anything up in:

```
su|<slug>|<choice>|<deadlineEpoch>   # signup button
sg|<slug>|<choice>|<deadlineEpoch>   # guest-username modal
csetup                               # the /challenge-setup form modal (includes the congrats-channel picker)
clist                                # the /challenge-list challenge picker (string select)
carch                                # the /challenge-archive challenge picker (string select)
```

`choice` is `want` / `have` / `out`. `handleModalSubmit` routes the plain
`csetup` custom_id to the challenge-setup flow; anything else falls through
to the `sg|...` decoder. `handleMessageComponent` checks for the fixed
`clist`/`carch` ids first (neither has pipes, so `decodeCustomId` would
reject them) before falling through to the `su|...` decoder. Slugs are auto-generated
from the challenge name via `slugify()` (lowercase, non-alphanumeric runs →
`-`, trimmed, max 40 chars) and validated (`^[a-z0-9-]{1,40}$`) so the
encoded ID never exceeds Discord's 100-char `custom_id` limit.

## The core invariant

**A button click or modal submit after the signup deadline records nothing.**
No log message is posted; the user just gets an ephemeral "signups closed"
reply. This is checked with a synchronous `isPastDeadline` comparison before
any Discord REST call is made, and is covered directly in
`packages/website/api/discord/interactions.test.ts`.

## Slash commands

- **`/challenge-setup`** (admin-only via `default_member_permissions`) — takes
  no options and opens a **components-v2 modal form** (`custom_id: csetup`)
  directly. Every field is a Label component (type 18) wrapping its input:
  Challenge name, Description, a combined **Dates (UTC)** field
  (`"<start> → <end>"`, also accepting `->` or the standalone word `to` /
  `till` / `until` as the separator — each side parsed leniently, see
  [Accepted date formats](#accepted-date-formats) below), an optional Signup
  deadline (UTC, defaults to the start date — or to the **end** date when the
  start is an immediate one, see [Immediate starts](#immediate-starts) below —
  same lenient parsing), and an optional **congrats channel** picker (a
  Channel Select, type 8, text channels only — see [Two-channel challenge
  messages](#two-channel-challenge-messages) below), all inside the same
  form instead of being threaded in through a slash-command option. On submit
  the bot slugifies the name, rejects the setup if a `CHALLENGE` with the same
  slug already exists in the log, splits and validates the dates field
  (`parseDateRangeField`/`validateChallengeDates` in `_lib/dates.ts`), then
  posts the Dyno-style announcement embed + buttons **to the channel the
  command was invoked in**, and records a `CHALLENGE` line in the log
  channel — including `congrats_channel_id` when one was picked. Any
  parse/validation failure is surfaced as a friendly `❌ ...` ephemeral error
  instead of posting anything. (There's no image option — the banner image is
  a fixed constant, and the "View Event" button now points at a fixed events
  URL — see below.) The ephemeral success confirmation mentions the congrats
  channel (`Congrats will post in <#channelId>`) when one was picked.
  `extractModalValue` (in `interactions.ts`) is tolerant of both the legacy
  action-row modal-submit shape (`data.components[].components[].value`) and
  the components-v2 shape (top-level entries carrying `custom_id` directly,
  with `value` for text inputs or `values[0]` for the channel select).
- **`/challenge-list`** — an interactive picker, no options. Reads the whole
  log channel (via `collectChallengeIndex`), excludes any slug carrying an
  `ARCHIVED` marker, and splits the rest into two groups: **ongoing**
  (`meta.end` is still in the future AND no `ENDED` marker) sorted
  newest-first, then **ended** sorted newest-first — ongoing challenges are
  listed first. Capped at the 25 most recent — Discord's per-select-menu
  option limit — with ongoing challenges prioritized into the cap ahead of
  ended ones. Replies **ephemerally** with `Pick a challenge:` plus a
  string-select component (`custom_id: clist`, one option per challenge:
  label = name, value = slug, description = `ongoing · <slug>` or
  `ended · <slug>`). If there are no eligible challenges it replies
  ephemerally `No challenges found.` instead. Picking an option fires a
  `MESSAGE_COMPONENT` interaction (`custom_id: clist`, routed ahead of the
  `su|`/`sg|` decoder since it isn't pipe-delimited) that renders the roster
  for the chosen slug exactly as before: **plain-markdown content** (no
  embed), a `**<name> — signups**` header, `Want the game (N)` / `Already
  have it (M)` codeblocks (comma-separated, for easy copy-paste), an
  `Unresolved/guests (K): ...` plain list, and a `Total: X` line. Emoji-free,
  non-ephemeral, chunked into ≤1900-char messages when the roster is large.
- **`/challenge-archive`** (admin-only) — an interactive picker, no options,
  the counterpart to `/challenge-list` for hiding a challenge instead of
  viewing it. Reads the log channel (same `collectChallengeIndex`), builds a
  picker of every **non-archived** challenge — ongoing or ended, no
  ongoing/ended split needed here since the point is just to pick one —
  deduped by slug (newest meta), capped at 25, label = name, description =
  slug. Replies ephemerally `Pick a challenge to archive:` with a
  string-select (`custom_id: carch`), or `No challenges to archive.` when
  none are eligible. Picking an option posts an `ARCHIVED` marker to the log
  channel, then edits the same ephemeral picker message (`DEFERRED_UPDATE_MESSAGE`
  ack) to `Archived **<name>**. It will no longer appear in lists or bot
  activity. (Un-archive by deleting the ARCHIVED line in the log channel.)`
  with the select menu removed. There's no un-archive command by design —
  deleting the `ARCHIVED` log line is the whole mechanism.
- **`/mod-report`** (admin-only) — the on-demand counterpart to the weekly
  digest below: a full member-status report covering **both** errors and
  warnings (unlike the digest, which only ever shows errors). Non-ephemeral,
  deferred. Content: a `**Mod Report**` header, a
  `‼️ **Need attention** (N members)` section (every member with ≥1
  error-severity finding, listing *all* their findings — error labels first,
  then warn labels), a `👀 **Warnings** (M members)` section (every member
  whose findings are all warn-level), and a closing line noting that
  ex-member entry checks aren't included (see
  [Severity model](#severity-model--mod-report) below for why). Within each
  section, members sharing the *exact same set* of finding codes are grouped
  onto one combo block instead of one bullet each — see `renderSection`
  below. The two section headers are the **only** emoji in the output
  (owner request); everything else — finding labels, member lines, the
  closing note — stays emoji-free. Chunked into as few messages as fit under
  a 1990-char budget (see [Packing into the fewest
  messages](#packing-into-the-fewest-messages) below).

### Two-channel challenge messages

A challenge's messages can optionally split across two channels sharing the
same `CHALLENGE` log entry (mod-approved design):

- **Announcement channel** — wherever `/challenge-setup` was invoked
  (`ChallengeMeta.channel_id`, unchanged). This is the only channel involved
  by default, and keeps: the signup widget (the announcement embed +
  buttons), the signups-closed summary (`discord:close-signups`), the 24h
  reminder, and the challenge-over message (both from
  `discord:milestones`) — see the [Cron scripts](#cron-scripts) entries
  below, which all still post to `meta.channel_id` unchanged.
- **Congrats channel** — optional, picked via the **Congrats channel** field
  inside `/challenge-setup`'s modal form and recorded as
  `ChallengeMeta.congrats_channel_id`. When set, it's the *only* channel that
  receives the "X just finished the challenge!" posts from
  `discord:congrats` (`resolveChannelForSlug`/`pickCongratsChannel` in
  `discord-challenge-congrats.ts` prefer `congrats_channel_id` over
  `channel_id` once a `CHALLENGE` meta is matched; the `CONGRATS_CHANNEL_ID`
  env var / test-channel fallback only kicks in when no meta matches at
  all).

**Default (no channel picked):** everything — including the congrats
posts — stays in the invoking channel, exactly as before this feature
existed.

Because congrats posts can land in a channel distinct from the
announcement, **the bot needs Send Messages / Embed Links access to both
channels** when a split is used, not just the announcement channel.

### Accepted date formats

Both `parseAdminDate` inputs — each side of `/challenge-setup`'s **Dates
(UTC)** field, and the **Signup deadline** field — accept the following,
case-insensitively, all interpreted as UTC. Parsing never depends on the
server's local timezone.

| Form | Examples | Notes |
|---|---|---|
| ISO-ish | `2026-08-01`, `2026-08-01 18:30`, `2026-08-01T18:30:00-05:00` | Original formats, unchanged. Bare `YYYY-MM-DD[ HH:mm]` is UTC; full ISO 8601 honors an explicit offset. |
| Month name | `Aug 1`, `August 1`, `1 Aug`, `1 August`, `Aug 1 2026`, `Aug 1 18:00`, `Aug 1 at 18` | Day-first or month-first, full name or 3-letter abbreviation. Without a year, resolves to the next occurrence: this year if today-or-future (UTC calendar date), else next year. |
| Today / tomorrow | `today`, `tomorrow`, `tomorrow 18:00`, `today at 10:00` | Midnight UTC, or the given time. |
| Next weekday | `next friday`, `next friday 09:00`, `next friday at 9` | The next occurrence of that weekday **strictly after today** (UTC) — if today is Friday, "next friday" is 7 days out, not today. |
| Relative offset | `+2d`, `+3w`, `+1m` | Days/weeks/months. Anchored to midnight UTC of *now* for the start side and the signup-deadline field; anchored to the **parsed start date** for the end side of a range (so `"aug 1 to +30d"` means Aug 31, not 30 days from today). |

Everywhere a time suffix is accepted above, plus after a plain
`YYYY-MM-DD` date (`2026-08-01 at 18`, `2026-08-01 at 18:30`), the time may:

- be preceded by the word **`at`** (`today at 10:00`, `July 13 at 12`,
  `2026-08-01 at 18`), and/or
- be a **bare hour** with no minute (`12` → `12:00`), validated 0-23 just
  like the minute-bearing form — `today at 25` is rejected.

**Deliberately rejected:** bare numeric slash dates like `1/8` or
`08/01/2026` — the group is international and D/M vs M/D is genuinely
ambiguous, so the parser never guesses; it returns the friendly error
instead. Every failure mode returns a friendly error listing example
accepted forms rather than a raw parse exception.

### Immediate starts

`validateChallengeDates` (`_lib/dates.ts`) allows a start date **anywhere
within today's UTC calendar day**, even if it's already earlier today by
clock time (`"today"`, or `"July 20"` typed on July 20) — this is treated as
the challenge starting immediately. A start strictly before today is
rejected (`"Start date must be today or in the future."`); the end date must
still be strictly after start **and** strictly in the future
(`"End date must be in the future."` otherwise).

When `signup_deadline` is left blank, it defaults to `start` as before — 
**unless** the resolved start is already at-or-before `now` (an immediate
start), in which case it defaults to **`end`** instead, so signups stay open
for the rest of an already-running challenge (owner-approved). A
future-dated start keeps defaulting to `start`, unchanged. An *explicitly*
given `signup_deadline` is always checked against the old `deadline <= start`
ordering rule, regardless of immediate-start-ness — so an explicit deadline
after start is still an error even when the challenge starts immediately.

### Severity model & /mod-report

`packages/website/api/_lib/mod-report.ts` is shared by the weekly digest
(scraper-side) and `/mod-report` (the interactions endpoint) — it's the one
place that knows how to turn `group_users.json`'s per-member `warnings`
codes into human-readable, severity-classified findings, and how to render
a member's findings as a link + bullet line. It works in both environments
because it goes through `loadDataFile` (fetch-by-host on Vercel, filesystem
fallback in the scraper).

- **`SEVERITY`** classifies each warning code as `'error'` or `'warn'`
  (unknown codes default to `'warn'`): illegal/unplayed required-play
  giveaways, an expired required-play deadline, and zero play rate despite
  wins are `error`; needs-review, a deadline within 15 days, low play rate,
  inactive-but-active, and no giveaway in 6 months are `warn`.
- **`collectGroupWarningFindings(host?)`** loads `group_users.json` and
  flattens every member's `warnings` array into one finding
  (`{ username, code, label, severity }`) per member per code.
- **`renderMemberLine`** and **`chunkMessage`** are the shared rendering
  primitives (member bullet formatting, chunking a segment list into as few
  messages as fit without splitting a segment) reused by the digest,
  `/mod-report`, and the plain-markdown `render.ts` outputs (close-summary,
  `/challenge-list`). See [Packing into the fewest
  messages](#packing-into-the-fewest-messages) for the chunking budget.
- **`renderSection`** (used only by `/mod-report`, not the digest) groups a
  section's members by their *exact* set of finding codes and renders each
  combo — including a combo unique to a single member — uniformly as one
  block: a label line (labels joined by ` · `, importance-ordered), a
  bulleted, alphabetical (case-insensitive) member list on the next line,
  and a trailing blank line. Combo blocks are ordered by the combo's most
  important code, then by member count (larger first), then alphabetically.
  A member flagged with any required-play-compliance code gets their link
  deep-linked to `?tab=won&filter=play-required` on their member page.

**Ex-member entry checks are deliberately *not* part of `mod-report.ts`**,
and so don't appear in `/mod-report` — only in the weekly digest. That
detector (`check-ex-member-entries.ts`) needs `giveaways.json` and
`user_entries.json` in addition to `ex_members.json` (~5MB combined), which
is too much to fetch on every on-demand command invocation. `/mod-report`'s
output ends with a line making this explicit: *"Ex-member entry checks run
in the weekly digest only."*

### Announcement embed & buttons

`buildAnnouncementEmbed` (`_lib/render.ts`) renders a Dyno-style layout: a
plain title (the challenge name, no emoji), the admin's description text,
two **inline** fields side by side (`Signups close` → `<t:deadline:R>` and
`Challenge` → `<t:start:d> → <t:end:d>`, short date format), the fixed
banner image `https://sg-club.vercel.app/game-challenge-banner.png`, the
accent color, and a **footer** (`🎁 0 want · ✅ 0 have` initially) — the
footer renders as small text below the image, so the live counts don't
compete visually with the banner or the date fields.

`buildSignupComponents(slug, deadlineEpoch)` builds one action row with the
three signup buttons plus a trailing type-2/style-5 **link button** ("View
Event", no `custom_id`, just a fixed `url` pointing at
`https://sg-club.vercel.app/events/`) — 4 buttons total, under Discord's
5-per-row cap. The link is a fixed constant now, not per-challenge (the
`/challenge-setup` modal no longer collects an event link), so the button is
always present. The withdraw button's label is the plain text glyph `✕
Withdraw` (U+2715), not the ❌ emoji — the emoji renders red-on-red against
the button's DANGER (red) background and is hard to read; the text glyph
renders white.

### Live signup counter

After every recorded signup event (button click or guest-modal submit) the
endpoint — in a fire-and-forget `waitUntil` continuation, after the
ephemeral confirmation has already been sent — rebuilds the roster from the
log and PATCHes only the `embeds` field on the announcement message
(`withUpdatedSignupCounts` rewrites `embed.footer.text` to the new counts,
everything else on the embed preserved). The PATCH payload never includes
`components`, so the buttons — including the link button — are left exactly
as Discord already has them. The announcement is located via
`interaction.message` when present (button clicks) or the `CHALLENGE` log
entry otherwise (modal submits). No extra messages are posted to the
channel.

All four are **guild** commands (instant propagation, no ~1h
global-command delay) registered via `pnpm --filter scraper discord:register`.

## No-embed policy

The announcement is the one message that stays an embed — it's a live
widget (countdown, signup counter, buttons) and needs the structured fields.
Every other bot-posted message that carries plain `content` (the weekly
digest, `/mod-report`, the close-signups summary, `/challenge-list`, and the
challenge-completion congrats messages) is sent with `flags: 4`
(`SUPPRESS_EMBEDS`) so a member/challenge link in the text never spawns an
unwanted link-preview card. The digest, the close-summary, and
`/challenge-list` are additionally emoji-free; `/mod-report` is emoji-free
apart from the two section-header emojis (‼️/👀 — see
[Severity model](#severity-model--mod-report)) (the congrats message keeps
its 🎉/`pandaparty` celebration — that one wasn't in scope). The close-summary
has one more deliberate exception: its final message ends with an
owner-requested farewell paragraph, `Let's get to gaming! Best of luck to you
all <3` (verbatim, heart included) — see the close-signups cron entry below.

## Packing into the fewest messages

`chunkMessage(segments, maxLength)` (`_lib/mod-report.ts`) joins an ordered
list of atomic segments into as few `≤maxLength` messages as possible: it
adds each segment to the running message unless doing so would overflow,
which is provably optimal for minimizing message count when segments must
stay in order and can't be split — so packing tightness is purely a function
of the budget, not the algorithm. Every caller passes segments that are
already atomic *and* individually within budget: a segment never straddles
two messages, and a single line that could itself be too long (a big
comma-separated name list) is pre-split by the caller at comma boundaries
(`splitNamesIntoChunks` / `chunkedNamesLine` in `render.ts`) before it ever
reaches `chunkMessage`, so `chunkMessage` itself never needs to split
mid-segment.

Budgets, all comfortably under Discord's real ~2000-char message cap:

- **`/mod-report`** calls `chunkMessage` with no explicit budget, so it gets
  the default of **1990** (10 chars of headroom) — the widest budget of any
  caller, since `/mod-report` combo blocks tend to run long.
- The **weekly digest**, the **close-signups summary**, and
  **`/challenge-list`** all pass an explicit **1900**-char budget
  (`MAX_MESSAGE_LENGTH` / `CODEBLOCK_CHUNK_LIMIT`), unchanged.

## Cron scripts

Run manually via the `discord-bot.yml` workflow (`workflow_dispatch`, pick a
`job`), or locally with the pnpm scripts below.

- **`pnpm --filter scraper discord:close-signups`** — finds `CHALLENGE`s whose
  deadline has passed with no `CLOSED` marker yet, posts a plain-markdown
  closed-summary (`**Signups closed — <name>**` then `Want the game (N): ...`
  / `Already have it (M): ...` lines, full name lists, then a final owner-requested
  farewell paragraph — `Let's get to gaming! Best of luck to you all <3` — the
  one deliberate emoji-policy exception on this output), disables
  **only the three signup buttons** on the announcement (`buildDisabledComponents`
  always leaves the fixed "View Event" link button enabled and clickable
  after close), and posts `CLOSED`. Idempotent: a challenge is only touched
  while it has no `CLOSED` marker. Archived challenges (`ARCHIVED` marker)
  are treated like already-closed ones — skipped entirely, no summary, no
  button-disable edit, no `CLOSED` marker.
- **`pnpm --filter scraper discord:milestones`** — reads the log channel once
  and, for every `CHALLENGE` meta, posts up to two milestone messages (each
  gated by its own marker so it's never repeated):
  1. **24h-left warning** — once `end - now <= 24h` (and `end` hasn't passed),
     with no `REMINDER24` marker yet: posts `Only 24h until the <phrase> is
     over!` to the challenge's own channel, where `<phrase>` is
     `challengePhrase(name)` — the name as-is if it already ends with the
     word "challenge" (case-insensitive), otherwise the name with " challenge"
     appended (avoids "Test Challenge challenge"). If a local
     `challenge_*.json` matches the meta (by slug, else
     `slugify(gameName)`/`slugify(name)` in either direction), a second
     sentence is appended — `We've got <N> qualified members so far!`, `N`
     being the same `is_complete && !completed_before_start` qualifying rule
     `discord-challenge-congrats.ts` uses. No match means the second sentence
     is omitted entirely (never a fabricated `0`), and a console note is
     logged. Then posts `REMINDER24`.
  2. **Challenge-over notice** — once `end <= now` with no `ENDED` marker yet:
     posts `The <phrase> is over! Click [here](<https://sg-club.vercel.app/events/>)
     to see the results` (the `(<url>)` form suppresses the link-preview
     embed) to the challenge's own channel, then posts `ENDED`.

  Both message kinds are posted **before** their marker (crash → safe retry,
  worst case a duplicate post, never a missed one), same convention as
  `discord:close-signups`. No state file to commit — everything derives from
  the log channel. Archived challenges are skipped entirely — neither
  milestone message is ever posted for one, regardless of where it sits in
  its 24h/ended windows.
- **`pnpm --filter scraper discord:congrats`** — scans local `challenge_*.json`
  files (skipping `challengeOver: true` ones) for participants who are
  `is_complete` and not `completed_before_start`, diffs against
  `packages/website/public/data/discord_announce_state.json`
  (`{ announced: { [slug]: string[] } }`), and announces each new completion
  exactly once. Completions are **batched into one message per challenge**
  (`🎉 **A**, **B** and **C** just finished the **<game>** challenge!`),
  splitting into multiple messages only past ~1900 chars; state is saved
  after each batch post. The congrats emoji is the guild's custom
  `pandaparty` emoji (looked up once per run via `GET /guilds/{id}/emojis`,
  animated variants handled), falling back to `🐼🎉` if it's missing or the
  fetch fails. Target channel resolution
  (`resolveChannelForSlug`/`pickCongratsChannel`) prefers a matched
  `CHALLENGE` meta's `congrats_channel_id` over its `channel_id` — see
  [Two-channel challenge messages](#two-channel-challenge-messages) above —
  falling back to `CONGRATS_CHANNEL_ID` / the test channel only when no meta
  matches the slug at all. When the matched `CHALLENGE` meta carries an
  `ARCHIVED` marker, `resolveCongratsChannel` returns `null` and the whole
  challenge is skipped for that run (console note logged) — an archived
  challenge never gets a congrats post even if its local `challenge_*.json`
  still shows newly-qualifying participants. This is a best-effort check
  driven by the same log-channel read as the channel lookup — an odd
  "archived but the local JSON still says active" state isn't otherwise
  reconciled.
- **`pnpm --filter scraper discord:warn-digest`** — the first job on a real
  `schedule:` trigger (`discord-bot.yml` runs it automatically Friday 13:00
  UTC, in addition to the usual `workflow_dispatch`; every other job is
  still dispatch-only). **Still posts to the `#bot-test` test channel** until
  `WARN_CHANNEL_ID` is pointed at the real `#warns` channel — see
  Environment variables below. Runs a small set of pluggable detectors, diffs
  against
  `packages/website/public/data/discord_warn_state.json`
  (`{ items: { [fingerprint]: { firstSeen } } }`) to track every finding's
  `firstSeen` date, and posts a **plain markdown, emoji-free digest**
  (`flags: 4`, no embed) — but **error-severity findings only** (see
  [Severity model](#severity-model--mod-report) — for the full picture,
  including warnings, use `/mod-report`). State tracking covers *all*
  findings regardless of severity, so a warn-level finding never loses its
  `firstSeen` history even though it's filtered out of the posted message.
  Format: a `**Weekly Mod Digest**` header, then **one bullet per member
  with ≥1 error finding** — a member never appears twice; all of *their
  error findings* (never their warn findings) are merged onto their bullet,
  each suffixed `(new)` or `(since <t:X:R>)`, and the member name links to
  their `https://sg-club.vercel.app/users/<username>/` page. Members with any
  new finding sort first, then alphabetically. Long digests split into
  multiple ≤1900-char messages at bullet boundaries (header only on the
  first). Stays silent (posts nothing) when there are zero error-level
  findings — but state is still saved. Two detectors are wired up:
  1. **Ex-member entries** — reuses the core check from
     `check-ex-member-entries.ts` (ex-members who still have entries in
     active group-exclusive giveaways, exploiting SteamGifts' membership-sync
     delay). Always error-severity. Scraper-only — see
     [Severity model](#severity-model--mod-report) for why it isn't in
     `mod-report.ts` / `/mod-report`.
  2. **Group-user rule warnings** — delegates to
     `collectGroupWarningFindings` in `mod-report.ts` (shared with
     `/mod-report`), which surfaces the per-member `warnings` array
     `group_users.json` already computes (`calculateUserWarnings` in
     `group-members.ts`), classified error/warn per the severity model.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Vercel + GitHub Actions secret | Bot token for REST calls |
| `DISCORD_PUBLIC_KEY` | Vercel env | Verifies interaction request signatures |
| `DISCORD_APP_ID` | Vercel env + local (for `discord:register`) | Used for followup webhooks and command registration |
| `LOG_CHANNEL_ID` | optional | Overrides the signup-log channel (defaults to `#bot-test-logs`) |
| `DATA_BASE_URL` | optional | Overrides where `data.ts` fetches `public/data/*.json` from |
| `CONGRATS_CHANNEL_ID` | optional | Fallback channel for `discord:congrats` when no `CHALLENGE` meta is found for a slug (defaults to `#bot-test`) |
| `WARN_CHANNEL_ID` | optional | Channel for the weekly digest (defaults to `#bot-test`) |

## Switching from test channels to production channels

Everything defaults to the two test channels
(`TEST_ANNOUNCE_CHANNEL_ID` / `TEST_LOG_CHANNEL_ID` in `constants.ts`). To go
live:

1. Set `LOG_CHANNEL_ID`, `CONGRATS_CHANNEL_ID`, and `WARN_CHANNEL_ID` env vars
   to the real channels (Vercel for the interactions endpoint, GitHub Actions
   secrets/vars for the cron scripts).
2. `/challenge-setup` posts its announcement to whatever channel the command
   is invoked in, so an admin targets a channel just by running it there.
3. `warn-digest` already runs on a `schedule:` trigger (Friday 13:00 UTC) —
   pointing `WARN_CHANNEL_ID` at `#warns` is the only remaining step for it.
   The other jobs (`close-signups`, `congrats`, `milestones`,
   `register-commands`) are still `workflow_dispatch`-only, intentionally,
   while in test phase; once
   confident, add `schedule:` entries for them too, mirroring deploy.yml's
   staggering approach.

## Manual setup steps (for Yann)

1. Create a Discord application at
   [discord.com/developers](https://discord.com/developers/applications)
   (accept the developer ToS), add a bot user, and **disable "Public Bot"**.
2. Add `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY`, and `DISCORD_BOT_TOKEN` to the
   Vercel project's environment variables, and `DISCORD_BOT_TOKEN` as a
   GitHub Actions repository secret.
3. Invite the bot to the server with an OAuth2 URL using scopes `bot` +
   `applications.commands` and permissions: Send Messages, Embed Links, Read
   Message History, Attach Files. Make sure it has access to the two private
   test channels (`#bot-test`, `#bot-test-logs`).
4. Push to deploy, then set the app's **Interactions Endpoint URL** (in the
   Discord developer portal) to `https://<site>/api/discord/interactions`.
   Discord will send a PING to verify it immediately — the endpoint must be
   live first.
5. Run `pnpm --filter scraper discord:register` to register the four guild
   slash commands.
6. Test the full flow in `#bot-test`: `/challenge-setup`, click each button,
   try the guest-modal path with a Discord account that isn't in
   `discord_members.json`, then `/challenge-list`, then `/challenge-archive`
   (and confirm the archived challenge disappears from both pickers), then
   `/mod-report`, then run `discord:close-signups` manually (or wait for the
   deadline).

## Risks / things that couldn't be verified here

- **Vercel's raw-body behavior for plain `/api` functions.** Signature
  verification needs the *raw* request body, so `interactions.ts` exports
  `config = { api: { bodyParser: false } }` and reads the body itself via
  stream iteration. This convention is well-documented for Next.js
  `pages/api` routes and widely used in Discord-on-Vercel examples for plain
  `/api` functions too, but it could not be exercised against a real Vercel
  deployment from this environment — verify in step 4 above (a failed PING
  means the body was parsed/consumed before signature verification could run).
- **Deferred-command continuation lifetime.** `/challenge-setup`,
  `/challenge-list`, and `/mod-report` send an initial ack (`res.end()`) and
  then keep doing Discord REST calls in the same function invocation before
  finally returning. This relies on Vercel keeping the invocation alive until the
  handler's promise resolves (not until `res.end()` is called) — the
  intended and commonly-used behavior for Node.js Functions, bounded by
  `maxDuration: 60`, but also not exercised against a live deployment.
- **Cross-package imports for type-checking.** The scraper's cron scripts
  import `_lib/` modules from the website package via a relative path. This
  works fine at runtime through `tsx` (which doesn't care about `tsconfig`
  `rootDir`), and `packages/scraper/tsconfig.json` had its `rootDir` removed
  so `tsc --noEmit` doesn't flag it either — but `tsc` already reports several
  pre-existing, unrelated errors on `main` (in `generate-challenge-data.ts`
  and `group-members.test.ts`), so type-checking isn't currently a green gate
  for this package regardless.
