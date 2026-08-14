# AGENTS.md - sg-club (The Giveaways Club Analytics)

## Project Overview

Analytics dashboard for "The Giveaways Club" - a SteamGifts group. Combines automated web scraping with a Next.js frontend to display group statistics: giveaway activity, user contributions, gaming stats, and community health metrics.

All data is JSON-based (no database). A scraper generates JSON files that the website reads at build time for static export.

**Production URL:** https://sg-club.vercel.app/ (deployed on Vercel via its native Git integration — a push to `main` triggers a build+deploy; the disabled `deploy_vercel.old_yml` is the retired Action-based hook). This is the canonical origin — use it for `metadataBase`, Open Graph / social share image URLs, and any absolute-link needs.

## Architecture

```
sg-club/                          # pnpm monorepo (pnpm-workspace.yaml)
├── packages/
│   ├── scraper/                  # Data scraping & generation (Node.js, Cheerio, tsx)
│   │   ├── src/api/              # External API integrations (Steam, game prices)
│   │   ├── src/scrapers/         # HTML scrapers for SteamGifts (Cheerio-based)
│   │   ├── src/scripts/          # Data generation pipelines
│   │   ├── src/types/            # Shared type definitions
│   │   └── src/utils/            # Helpers (HTTP fetching, error logging, insights)
│   └── website/                  # Next.js 15 frontend (React 19, Tailwind CSS)
│       ├── src/app/              # App Router pages (/, /games, /giveaways, /users, /stats)
│       ├── src/components/       # Reusable UI components
│       ├── src/lib/              # Data loading (data.ts) and hooks
│       ├── src/types/            # Frontend type definitions
│       └── public/data/          # Generated JSON data files (output of scraper)
├── .github/workflows/deploy.yml  # CI: runs scraper every 8 hours, auto-commits data
└── .env                          # SG_COOKIE, SG_TOKEN, STEAM_API_KEY
```

## Tech Stack

- **Monorepo:** pnpm workspaces
- **Runtime:** Node.js >= 22, ESM modules
- **Language:** TypeScript (strict mode)
- **Frontend:** Next.js 15 (App Router, static export), React 19, Tailwind CSS 3
- **UI libs:** Radix UI (Tooltip), React Virtuoso (virtualized lists), Masonic (masonry grid)
- **Scraping:** Cheerio (HTML parsing), native fetch
- **Testing:** Vitest
- **Linting:** ESLint 9
- **CI/CD:** GitHub Actions (scheduled every 8 hours)

## Data Flow

1. **Scraper** fetches HTML from SteamGifts (authenticated via `SG_COOKIE`/`SG_TOKEN`)
2. **Steam API** enriches data with playtime, achievements, game metadata (`STEAM_API_KEY`)
3. **JSON files** written to `packages/website/public/data/` (giveaways.json, group_users.json, game_data.json, user_entries.json, etc.)
4. **Next.js build** reads JSON at build time -> static HTML export (`out/` directory)

## Key Commands

```bash
# Development
pnpm dev                    # Start Next.js dev server (Turbopack)

# Data generation (requires .env credentials)
pnpm data                   # Generate all data (giveaways + members + games)
pnpm playtime               # Generate Steam playtime/achievement data only

# Build
pnpm website:build          # Lint + generate data + Next.js static build
pnpm website:serve          # Serve the built static site

# Testing
cd packages/scraper && pnpm test        # Scraper tests
cd packages/website && pnpm test        # Website tests

# Individual scraper scripts
pnpm --filter scraper generate-giveaways-data
pnpm --filter scraper members
pnpm --filter scraper generate-game-data
pnpm --filter scraper get-playtime-data
pnpm --filter scraper fetch-game-prices
pnpm --filter scraper check-deleted-giveaways
```

## Environment Variables

| Variable | Purpose |
|---|---|
| `SG_COOKIE` | SteamGifts session cookie (`PHPSESSID=...`) for authenticated scraping |
| `SG_TOKEN` | SteamGifts XSRF/form token |
| `STEAM_API_KEY` | Steam Web API key for playtime and achievement data |

These are set in `.env` locally and as GitHub Actions secrets for CI.

## Pages

| Route | Description |
|---|---|
| `/` | Dashboard with group analytics, rankings, activity summaries |
| `/games` | Game analytics grid (masonry layout) with playtime/achievement stats |
| `/giveaways` | Searchable/filterable giveaway table (virtualized) |
| `/users` | User directory sorted by contribution metrics |
| `/users/[username]` | Individual user profile with detailed stats |
| `/stats` | Leaver/activity investigation data |

## CI/CD

GitHub Actions workflow (`.github/workflows/deploy.yml`) runs every 8 hours:
1. **website-data job:** Generates giveaway/user/game data, commits to repo
2. **playtime-data job:** Enriches with Steam playtime data (depends on job 1), commits to repo

Both jobs auto-commit to the current branch if data changed.

## Key Patterns

- **Static generation only** - no server-side runtime; the site is a static export
- **JSON as data layer** - all data lives in `public/data/*.json`, version-controlled in git
- **Scraper types are the source of truth** - `packages/scraper/src/types/` defines core models (`Giveaway`, `User`, `GameData`, `SteamPlayData`); website types mirror them
- **Cheerio for scraping** - HTML is fetched with native fetch + parsed with Cheerio, no headless browser needed
- **Virtualized rendering** - large lists use React Virtuoso for performance
- **CSS variables for theming** - Tailwind config uses CSS custom properties (accent, card-background, etc.)

## Analysing members (leechers, warnings, spring cleaning)

### Group vocabulary

The group is **The Giveaways Club (TGC)**. A **valid group giveaway** — the unit
of contribution every activity metric is built on — is one that is:

- not `deleted`, and did not end with `entry_count === 0`
  (`isCountedGiveaway` in `packages/website/src/lib/events.ts`), **and**
- `cv_status === 'FULL_CV'`, **and**
- not `is_shared` and not `whitelist` (`isValidRatioGiveaway`).

`is_shared` means the giveaway's group is not TGC — it reaches members through
another group, or a whitelist. Consequences that are easy to get wrong:

- **Shared giveaways are not contributions.** A member can create hundreds of
  them and still have created zero valid group giveaways. Check
  `createdValid`, never a raw `giveaways_created` count or
  `last_giveaway_created_at` (which counts deleted and zero-entry giveaways).
- **Ex-members legitimately appear in shared giveaways.** Entries only need
  chasing on group-*exclusive* giveaways; `check-ex-member-entries.ts` already
  encodes this and is the check to run, rather than a fresh cross-reference.
- **Farming only the shared pool is still a leech signal.** A member who
  creates no valid group giveaway and whose entries lean on shared/whitelist
  giveaways is taking from the group without feeding it, even though every
  individual entry is legal.

### Rules that apply here, and rules that do not

TGC enforces contribution recency, play rate, required-play compliance, and
giveaway ratio. It does **not** enforce a Value Difference floor — the
`-$50` rule documented for other SteamGifts groups is not a TGC rule, and
applying it flags a large share of the membership including long-standing
contributors. Before acting on any rule, sanity-check the hit rate: a
criterion that flags tens of percent of the group is a wrong criterion, not a
crisis.

### Reuse the existing analysis code

These already encode the agreed thresholds and are the source of truth. Extend
them rather than writing a parallel scoring scheme:

| Where | What it decides |
| --- | --- |
| `packages/website/src/lib/spring-cleaning.ts` | Full expel/warn analysis with tuned thresholds; pure, runnable from Node |
| `calculateUserWarnings` in `scrapers/group-members.ts` | Per-member rule warnings persisted to `user.warnings` |
| `scripts/check-ex-member-entries.ts` | Ex-members holding entries in active group-exclusive giveaways |
| `website/api/_lib/mod-report.ts` | Shared severity classification for the Discord digest and `/mod-report` |

### Judging play evidence

- **Steam playtime is evidence; attestation is not.** `i_played_bro` and
  `required_play_meta.requirements_met` are self-reported. Report them
  separately from Steam-verified playtime — folding them in silently credits a
  member with their own word.
- **Wins with unreadable stats are neither played nor unplayed.** Count them as
  a third category; treating them as unplayed manufactures a 0% play rate.
- **`has_no_available_stats` does not mean "no evidence".** It also covers
  `no_steam_stats`, where the library read fine and playtime is real but the
  game exposes no achievements. Test the numbers (`playtime_minutes`,
  `achievements_unlocked`), not the flag.
- **Check progress before calling a play requirement unmet.** Compare playtime
  against `hltb_main_story_hours` in `game_data.json` and the achievement
  percentage. Many unfulfilled play-required wins are finished games that were
  never marked, and they count toward the "2 unfulfilled ⇒ stop entering" rule
  until someone marks them. `required_plays_need_review` is the scraper already
  saying so.
- **Play-requirement deadlines are hand-entered** and appear as `dd.MM.yyyy`,
  `dd-MM-yyyy`, and occasionally with an out-of-range month. Parse defensively
  and fall back to `end_timestamp + deadline_in_months`.

### Steam data is intermittent — never regress it

`GetOwnedGames` returns an empty library both when a member hides their game
details and when the request simply fails, and the resulting snapshot has zero
playtime and `no_stats_reason: 'library_unavailable'`. Persisting that over a
good snapshot destroys proven history and makes an active member read as a
never-played hoarder indefinitely.

Anywhere Steam data is written, treat progress as **monotonic**: a pull with no
evidence must not replace a snapshot that had some, and playtime and
achievements only ratchet up. `mergePlayData` (`group-members.ts`) does this
for wins; `generate-challenge-data.ts` does it for challenge progress. Both
exist because the same bug was found twice — when adding a new place that
stores Steam results, apply the invariant there too.

Because `public/data/*.json` is committed on every scrape, **git history is a
recovery tool**: walking `git log` for a data file recovers high-water values
that a bad pull erased.

### Keep scraper modules importable

Do not read data files or call `process.exit` at module scope. Load JSON lazily
and memoize it, and resolve required env vars on first use. Module-level side
effects make a file impossible to import in tests — `group-members.ts` and
`fetch-steam-data.ts` both had to be reworked for exactly this reason.
