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
│   └── render.ts              # embeds, buttons, the /challenge-list output
└── discord/
    └── interactions.ts        # the actual Vercel Function — Discord's Interactions Endpoint

packages/scraper/src/scripts/
├── discord-close-signups.ts       # cron: close expired signups
├── discord-challenge-congrats.ts  # cron: announce challenge completions
├── discord-warn-digest.ts         # cron: weekly mod digest
└── discord-register-commands.ts   # one-off: register the two slash commands

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
```

- `CHALLENGE` — posted once by `/challenge-setup`, records where the
  announcement lives and its dates.
- `SIGNUP` — posted on every button click / modal submit. `choice` is one of
  `want` / `have` / `out`.
- `CLOSED` — posted once signups are closed for a slug (marks it done so the
  close-signups cron doesn't reprocess it).

The parser (`signup-log.ts`) is tolerant: any message that isn't a
well-formed protocol line (human chat, an old pre-protocol bot message,
garbage) is simply skipped.

`buildRoster(messages, slug)` dedupes `SIGNUP` events per `discord_id`,
keeping the one with the highest `ts` (not array order — Discord's message
list API returns newest-first, so relying on `ts` as the source of truth
keeps the result correct regardless of pagination order). A user whose latest
choice is `out` is dropped entirely; a user can rejoin after withdrawing by
clicking a button again.

## Custom IDs

Buttons and modals encode their context directly in `custom_id`, since
there's no database to look anything up in:

```
su|<slug>|<choice>|<deadlineEpoch>   # signup button
sg|<slug>|<choice>|<deadlineEpoch>   # guest-username modal
csetup                               # the /challenge-setup form modal
```

`choice` is `want` / `have` / `out`. `handleModalSubmit` routes by
`custom_id` prefix: `csetup` goes to the challenge-setup flow, anything else
falls through to the `sg|...` decoder. Slugs are auto-generated from the
challenge name via `slugify()` (lowercase, non-alphanumeric runs → `-`,
trimmed, max 40 chars) and validated (`^[a-z0-9-]{1,40}$`) so the encoded ID
never exceeds Discord's 100-char `custom_id` limit.

## The core invariant

**A button click or modal submit after the signup deadline records nothing.**
No log message is posted; the user just gets an ephemeral "signups closed"
reply. This is checked with a synchronous `isPastDeadline` comparison before
any Discord REST call is made, and is covered directly in
`packages/website/api/discord/interactions.test.ts`.

## Slash commands

- **`/challenge-setup`** (admin-only via `default_member_permissions`) — takes
  no options; it opens a **modal form** (`custom_id: csetup`) with five text
  inputs: Challenge name, Description, Start date (UTC), End date (UTC), and
  an optional Signup deadline (UTC, defaults to the start date). On submit
  the bot slugifies the name, rejects the setup if a `CHALLENGE` with the
  same slug already exists in the log, then posts the announcement embed +
  the three signup buttons **to the channel the command was invoked in**,
  and records a `CHALLENGE` line in the log channel. (There are no
  channel/image options anymore.)
- **`/challenge-list <slug>`** — reads the whole log channel, builds the
  roster, and posts an embed + comma-separated codeblock lists (want / all
  participants), marking unresolved/guest entries with ⚠️.

### Live signup counter

The announcement embed carries a **"Signups so far"** field (initially
`🎁 0 want · ✅ 0 have`). After every recorded signup event (button click or
guest-modal submit) the endpoint — in a fire-and-forget `waitUntil`
continuation, after the ephemeral confirmation has already been sent —
rebuilds the roster from the log and PATCHes that one field on the
announcement message (upserted by field name, everything else preserved).
The announcement is located via `interaction.message` when present (button
clicks) or the `CHALLENGE` log entry otherwise (modal submits). No extra
messages are posted to the channel.

Both are **guild** commands (instant propagation, no ~1h global-command
delay) registered via `pnpm --filter scraper discord:register`.

## Cron scripts

Run manually via the `discord-bot.yml` workflow (`workflow_dispatch`, pick a
`job`), or locally with the pnpm scripts below.

- **`pnpm --filter scraper discord:close-signups`** — finds `CHALLENGE`s whose
  deadline has passed with no `CLOSED` marker yet, posts a closed-summary
  embed, disables the announcement's buttons, and posts `CLOSED`. Idempotent:
  a challenge is only touched while it has no `CLOSED` marker.
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
  fetch fails.
- **`pnpm --filter scraper discord:warn-digest`** — runs a small set of
  pluggable detectors and posts a **plain markdown digest** (no embed),
  tracked in `packages/website/public/data/discord_warn_state.json`
  (`{ items: { [fingerprint]: { firstSeen } } }`). Format: a
  `📋 **Weekly Mod Digest**` header, then **one bullet per member** — a
  member never appears twice; all their findings are merged onto their
  bullet, each prefixed `🆕` (new this week) or `⏳` (lingering, with
  `(since <t:X:R>)`), and the member name links to their
  `https://sg-club.vercel.app/users/<username>/` page. Members with any 🆕
  finding sort first, then alphabetically. Long digests split into multiple
  ≤1900-char messages at bullet boundaries (header only on the first). Stays
  silent if there are zero findings. Two detectors are wired up:
  1. **Ex-member entries** — reuses the core check from
     `check-ex-member-entries.ts` (ex-members who still have entries in
     active group-exclusive giveaways, exploiting SteamGifts' membership-sync
     delay).
  2. **Group-user rule warnings** — surfaces the per-member `warnings` array
     `group_users.json` already computes (`calculateUserWarnings` in
     `group-members.ts`): unplayed required-play wins, expired required-play
     deadlines, zero/low play rate with wins, no giveaway created in 6
     months, etc.

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
3. Once confident, add a `schedule:` trigger to `discord-bot.yml` (it's
   `workflow_dispatch`-only right now, intentionally, while in test phase).

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
5. Run `pnpm --filter scraper discord:register` to register the two guild
   slash commands.
6. Test the full flow in `#bot-test`: `/challenge-setup`, click each button,
   try the guest-modal path with a Discord account that isn't in
   `discord_members.json`, then `/challenge-list`, then run
   `discord:close-signups` manually (or wait for the deadline).

## Risks / things that couldn't be verified here

- **Vercel's raw-body behavior for plain `/api` functions.** Signature
  verification needs the *raw* request body, so `interactions.ts` exports
  `config = { api: { bodyParser: false } }` and reads the body itself via
  stream iteration. This convention is well-documented for Next.js
  `pages/api` routes and widely used in Discord-on-Vercel examples for plain
  `/api` functions too, but it could not be exercised against a real Vercel
  deployment from this environment — verify in step 4 above (a failed PING
  means the body was parsed/consumed before signature verification could run).
- **Deferred-command continuation lifetime.** `/challenge-setup` and
  `/challenge-list` send an initial ack (`res.end()`) and then keep doing
  Discord REST calls in the same function invocation before finally
  returning. This relies on Vercel keeping the invocation alive until the
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
