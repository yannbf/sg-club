# SteamGifts Group Analytics

A comprehensive analytics system for SteamGifts group activities, featuring data scraping, Steam API integration, insights generation, and a beautiful web interface.

## 🌟 Features

### Data Collection
- **Giveaway Scraping**: Fetch all group giveaways with detailed metadata
- **User Analytics**: Track member statistics and gift exchange patterns
- **Steam Integration**: Real playtime and achievement data for won games
- **Smart Rate Limiting**: Respectful API usage with configurable delays

### Analytics & Insights
- **Community Health Metrics**: Track contributor vs receiver ratios
- **CV Analysis**: Full/Reduced/No CV distribution analysis
- **Steam Engagement**: Game ownership and playtime analytics
- **Automated Reports**: Generated insights with recommendations
- **Historical Tracking**: Compare group activity over time

### Web Interface
- **📊 Overview Dashboard**: Key statistics and community health
- **🎁 Giveaways Browser**: Search, filter, and sort all giveaways
- **👥 User Profiles**: Detailed member statistics with Steam data
- **📱 Responsive Design**: Works on desktop and mobile
- **⚡ Static Export**: Fast loading, deployable anywhere

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation
```bash
git clone <repository-url>
cd gusbot
npm install
```

### Configuration
1. Copy `.env.example` to `.env`
2. Add your Steam API key:
   ```
   STEAM_API_KEY=your_steam_api_key
   ```

### Usage

#### Run Complete Analysis Pipeline
```bash
# Data collection + insights generation
npm run run-all

# Include website build
npm run run-all-with-website
```

#### Individual Commands
```bash
# Fetch giveaways data
npm run fetch-giveaways

# Analyze users and Steam data
npm run fetch-users

# Analyze users without Steam API calls (faster)
SKIP_STEAM_API=true npm run fetch-users

# Generate insights report
npm run generate-insights

# Website development
npm run website:dev

# Build static website
npm run website:build

# Serve built website
npm run website:serve
```

## 📁 Project Structure

```
gusbot/
├── src/
│   ├── scrapers/          # Data collection scripts
│   ├── utils/             # Analytics and insights
│   └── types/             # TypeScript definitions
├── data/                  # Generated data files
├── website/               # Next.js web interface
│   ├── src/app/          # App router pages
│   ├── src/lib/          # Utilities and data loading
│   └── public/data/      # Static data files
└── docs/                  # Documentation
```

## 📊 Data Output

### Generated Files
- `data/all_giveaways_html.json` - Complete giveaway database
- `data/group_users.json` - User statistics with Steam integration
- `data/group_insights.txt` - Automated analytics report

### Data Features
- **Giveaway Data**: Name, points, entries, CV status, winners, timestamps
- **User Statistics**: Gifts sent/received, value tracking, CV analysis
- **Steam Integration**: Game ownership, playtime, achievements for won games
- **Timestamps**: All data includes creation and end dates

## 🎮 Steam Integration

The system integrates with Steam API to track:
- **Game Ownership**: Whether users own games they won
- **Playtime Data**: Hours played for each game
- **Achievement Progress**: Unlocked vs total achievements
- **Engagement Analysis**: Never-played games detection

### Features
- Rate-limited API calls (1 request/second)
- 2-month cutoff for playtime checks (configurable)
- Caching to avoid redundant API calls
- Error handling for private profiles

## 🌐 Web Interface

The static website provides:

### Pages
- **Overview** (`/`) - Dashboard with key metrics
- **Giveaways** (`/giveaways`) - Searchable giveaway database
- **Users** (`/users`) - Member directory with statistics
- **User Details** (`/users/[username]`) - Individual profiles

### Features
- Advanced filtering and sorting
- Steam activity visualization
- Responsive design for all devices
- Fast static generation (no server required)

## 📈 Analytics

### Community Health Metrics
- Net contributor vs receiver analysis
- Gift exchange balance tracking
- Member activity patterns
- Value flow analysis

### Steam Engagement
- Game ownership rates
- Playtime distribution
- Achievement hunter identification
- Inactive game detection

### CV Analysis
- Full/Reduced/No CV distribution
- Member contribution patterns
- Community value tracking

## 🛠️ Configuration

### Environment Variables
```env
STEAM_API_KEY=your_steam_api_key
FETCH_ALL_PAGES=true          # Fetch complete dataset
SKIP_STEAM_API=true           # Skip Steam API calls for faster execution
```

### Customization
- Modify scraping intervals in `src/scrapers/`
- Adjust Steam API rate limits in `src/utils/`
- Customize insights generation in `src/utils/generate-insights.ts`
- Theme and styling in `website/src/app/globals.css`

## 📋 Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run fetch-giveaways` | Scrape giveaway data |
| `npm run fetch-users` | Analyze users + Steam data |
| `npm run generate-insights` | Create analytics report |
| `npm run run-all` | Complete data pipeline |
| `npm run run-all-with-website` | Full pipeline + website |
| `npm run website:dev` | Start website development |
| `npm run website:build` | Build static website |
| `npm run website:serve` | Serve built website |

## 🚀 Deployment

### Website Deployment
The website builds to a static export that can be deployed to:
- GitHub Pages
- Netlify
- Vercel
- Any static hosting service

```bash
npm run website:build
# Deploy the 'website/out' directory
```

### Automation
Set up scheduled runs using:
- GitHub Actions
- Cron jobs
- Task schedulers

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with `npm run run-all-with-website`
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🔗 Related

- [SteamGifts](https://www.steamgifts.com/) - The platform being analyzed
- [Steam Web API](https://steamcommunity.com/dev) - For game data integration
- [Next.js](https://nextjs.org/) - Web framework used 