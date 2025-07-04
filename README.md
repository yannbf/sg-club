# SteamGifts Scraper

A modern TypeScript ESM application for scraping SteamGifts group giveaways with full pagination support.

## Features

- 🚀 **Modern ESM** - Uses ES Modules throughout
- 🔄 **Incremental Updates** - Optimized for cron jobs, only fetches new data
- 🎯 **TypeScript** - Fully typed with comprehensive interfaces
- ⏰ **Smart Cutoff** - Stops fetching when reaching giveaways that ended 2+ weeks ago
- 📁 **Data Persistence** - Updates existing JSON file instead of recreating
- ⚡ **Built-in Fetch** - Uses Node.js native fetch (no external dependencies)
- 🔗 **Deduplication** - Prevents duplicate entries and updates existing ones
- 🎮 **CV Status Detection** - Automatically determines Community Value status (FULL_CV, REDUCED_CV, NO_CV)
- 🔄 **Unlimited Mode** - Optional mode to fetch all historical giveaways until the last page

## Requirements

- Node.js >= 22.0.0
- TypeScript support

## Installation

```bash
npm install
```

## Usage

### Fetch All Giveaways

```bash
npm run fetch-giveaways
```

### Development Mode (with watch)

```bash
npm run dev
```

### Build TypeScript

```bash
npm run build
```

### Cron Job Setup

For automated updates, add to your crontab:

```bash
# Run every 30 minutes
*/30 * * * * cd /path/to/gusbot && npm run fetch-giveaways

# Or run every hour
0 * * * * cd /path/to/gusbot && npm run fetch-giveaways
```

## Scripts

- `npm run fetch-giveaways` - Run the giveaway fetcher
- `npm run dev` - Run in development mode with file watching
- `npm run build` - Compile TypeScript to JavaScript
- `npm run start` - Run the original Playwright scraper
- `npm run install-playwright` - Install Playwright dependencies

## API Response Structure

The script fetches data from the SteamGifts API with the following structure:

```typescript
interface SteamGiftsResponse {
  success: boolean
  page: number
  per_page: number
  group: Group
  results: Giveaway[]
}

interface Giveaway {
  id: number
  name: string
  points: number
  copies: number
  app_id: number | null
  package_id: number | null
  link: string
  created_timestamp: number
  start_timestamp: number
  end_timestamp: number
  region_restricted: boolean
  invite_only: boolean
  whitelist: boolean
  group: boolean
  contributor_level: number
  comment_count: number
  entry_count: number
  creator: Creator
  cv_status?: 'FULL_CV' | 'REDUCED_CV' | 'NO_CV'
}
```

## Output

The script generates:
- Console output with update statistics and latest giveaways
- `all_giveaways.json` - Updated dataset with new giveaways, sorted by creation date
- Shows active/ended status for each giveaway

## Configuration

The script is optimized for cron job usage:
- **Group**: The Giveaways Club
- **Cookie**: Configured for authentication
- **Cutoff**: Stops at giveaways that ended 2+ weeks ago (can be overridden)
- **Delay**: 3 seconds between requests to avoid rate limiting
- **Incremental**: Loads existing data and only fetches new pages

### Environment Variables

- `FETCH_ALL_PAGES=true` - Enable unlimited fetching mode. Instead of stopping at giveaways that ended 2+ weeks ago, continues fetching until reaching the last page (detected by duplicate page content)

#### Examples:

```bash
# Normal mode (stops at 2 weeks ago)
npm run fetch-giveaways

# Unlimited mode (fetch everything until last page)
FETCH_ALL_PAGES=true npm run fetch-giveaways
```

## Development

This project uses:
- **ESM** (ES Modules) - Modern JavaScript module system
- **tsx** - TypeScript execution engine
- **Built-in fetch** - No external HTTP dependencies
- **Strict TypeScript** - Full type safety 