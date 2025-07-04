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

#### API Approach (Recommended)
```bash
npm run fetch-giveaways
```

#### HTML Scraping Approach
```bash
npm run fetch-giveaways-html
```

### Fetch Group Users

```bash
npm run fetch-users
```

### Development Mode (with watch)

#### API Approach
```bash
npm run dev
```

#### HTML Scraping Approach
```bash
npm run dev-html
```

#### User Fetching
```bash
npm run dev-users
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

- `npm run fetch-giveaways` - Run the API-based giveaway fetcher (recommended)
- `npm run fetch-giveaways-html` - Run the HTML scraping giveaway fetcher
- `npm run fetch-users` - Run the user statistics fetcher
- `npm run dev` - Run API fetcher in development mode with file watching
- `npm run dev-html` - Run HTML scraper in development mode with file watching
- `npm run dev-users` - Run user fetcher in development mode with file watching
- `npm run build` - Compile TypeScript to JavaScript
- `npm run start` - Run the original Playwright scraper
- `npm run install-playwright` - Install Playwright dependencies

## Two Approaches

This project offers two different methods for fetching giveaway data:

### 1. API Approach (`fetch-steamgifts.ts`)
- **Recommended** for regular use
- Uses SteamGifts JSON API endpoints
- Faster and more efficient
- Includes CV (Community Value) status detection
- Generates `all_giveaways.json`
- Structured data with consistent format

### 2. HTML Scraping Approach (`fetch-steamgifts-html.ts`)
- Alternative method using HTML parsing
- Scrapes the actual web pages using Cheerio
- **Unique advantages**: 
  - Includes winner information for ended giveaways
  - Detects winner feedback status (received/not received/awaiting)
  - **Detailed multi-copy winner tracking** - automatically fetches individual winner status for giveaways with >3 copies
  - Proper whitelist/region restriction detection
  - Handles paginated winner lists
- **Same features as API approach**: CV status detection with caching
- Generates `all_giveaways_html.json`
- Slightly slower but provides additional data
- Better for historical analysis with winner data

Both approaches support:
- Incremental updates
- 2-week cutoff or unlimited mode (`FETCH_ALL_PAGES=true`)
- Rate limiting
- Deduplication
- CV (Community Value) status detection with caching
- TypeScript with full type safety

### 3. User Fetching Approach (`fetch-users.ts`)
- Fetches group member statistics
- Scrapes HTML user table data
- Tracks gift-giving contributions
- **Automatically augments with Steam information** - fetches Steam ID and profile URL for each user
- Includes detailed statistics and rankings
- **Smart user management** - removes users no longer in the group
- Generates `group_users.json`
- Full pagination support with rate limiting

## Data Structure

### Giveaway Data Structure

Both approaches generate giveaway data with the following structure:

```typescript
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
  cv_status?: 'FULL_CV' | 'REDUCED_CV' | 'NO_CV'  // Both approaches
  // HTML scraping specific fields
  hasWinners?: boolean           // HTML approach only
  winners?: Array<{              // HTML approach only - unified winner structure
    name: string | null          // Winner's username, null for anonymous/awaiting feedback
    status: 'received' | 'not_received' | 'awaiting_feedback'
  }>
}
```

### Winner Structure (HTML approach only)

The HTML scraping approach provides detailed winner information for ended giveaways. Winners are represented as an array of objects with consistent structure:

#### Single Winner Example:
```json
{
  "hasWinners": true,
  "winners": [
    {
      "name": "Griske14",
      "status": "received"
    }
  ]
}
```

#### Multiple Winners Example:
```json
{
  "hasWinners": true,
  "winners": [
    {
      "name": "elysium1988",
      "status": "received"
    },
    {
      "name": "ManowGamer",
      "status": "received"
    }
  ]
}
```

#### Anonymous Winners (Awaiting Feedback):
```json
{
  "hasWinners": true,
  "winners": [
    {
      "name": null,
      "status": "awaiting_feedback"
    }
  ]
}
```

#### Mixed Status Winners:
```json
{
  "hasWinners": true,
  "winners": [
    {
      "name": "user1",
      "status": "received"
    },
    {
      "name": "user2", 
      "status": "not_received"
    },
    {
      "name": null,
      "status": "awaiting_feedback"
    }
  ]
}
```

**Winner Status Values:**
- `"received"` - Winner confirmed they received the game
- `"not_received"` - Winner confirmed they did NOT receive the game
- `"awaiting_feedback"` - Winner hasn't provided feedback yet (shows as anonymous)

### API Response Structure (API approach)

```typescript
interface SteamGiftsResponse {
  success: boolean
  page: number
  per_page: number
  group: Group
  results: Giveaway[]
}
```

### User Data Structure (User fetching approach)

```typescript
interface User {
  username: string
  profile_url: string
  avatar_url: string
  sent_count: number
  sent_value: number
  received_count: number
  received_value: number
  gift_difference: number
  value_difference: number
  steam_id?: string | null
  steam_profile_url?: string | null
}
```

#### User Data Fields:
- `username` - SteamGifts username
- `profile_url` - Relative URL to user's profile
- `avatar_url` - URL to user's Steam avatar image
- `sent_count` - Number of gifts sent by the user
- `sent_value` - Total dollar value of gifts sent
- `received_count` - Number of gifts received by the user
- `received_value` - Total dollar value of gifts received
- `gift_difference` - Net gift balance (sent - received)
- `value_difference` - Net value balance in dollars (sent - received)
- `steam_id` - Steam 64-bit ID (if available)
- `steam_profile_url` - Full Steam profile URL (if available)

## Output

The giveaway scripts generate:
- Console output with update statistics and latest giveaways
- `all_giveaways.json` - Updated dataset with new giveaways, sorted by creation date
- Shows active/ended status for each giveaway

The user fetching script generates:
- Console output with user statistics and top contributors
- `group_users.json` - Updated dataset with user statistics, sorted by value contribution
- Shows gift/value differences and contribution rankings
- **Steam information augmentation** - automatically fetches Steam IDs and profile URLs for users
- **Dynamic user management** - removes users no longer in the group

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