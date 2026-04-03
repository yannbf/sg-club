# AGENTS.md - sg-club (The Giveaways Club Analytics)

## Project Overview

Analytics dashboard for "The Giveaways Club" - a SteamGifts group. Combines automated web scraping with a Next.js frontend to display group statistics: giveaway activity, user contributions, gaming stats, and community health metrics.

All data is JSON-based (no database). A scraper generates JSON files that the website reads at build time for static export.

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
