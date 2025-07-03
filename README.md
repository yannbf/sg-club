# SteamGifts Scraper

A modern TypeScript ESM application for scraping SteamGifts group giveaways with full pagination support.

## Features

- 🚀 **Modern ESM** - Uses ES Modules throughout
- 📊 **Complete Pagination** - Fetches all giveaways across all pages
- 🎯 **TypeScript** - Fully typed with comprehensive interfaces
- 🔄 **Smart Fetching** - Discovers last page automatically
- 📁 **Data Export** - Saves results to JSON format
- ⚡ **Built-in Fetch** - Uses Node.js native fetch (no external dependencies)

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
}
```

## Output

The script generates:
- Console output with summary statistics
- `all_giveaways.json` - Complete dataset of all giveaways, sorted by creation date

## Configuration

The script is configured to fetch from:
- **Group**: The Giveaways Club
- **Cookie**: Configured for authentication
- **Delay**: 100ms between requests to be respectful to the server

## Development

This project uses:
- **ESM** (ES Modules) - Modern JavaScript module system
- **tsx** - TypeScript execution engine
- **Built-in fetch** - No external HTTP dependencies
- **Strict TypeScript** - Full type safety 