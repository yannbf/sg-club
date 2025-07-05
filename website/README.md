# SteamGifts Group Analytics Website

A Next.js static website that provides comprehensive analytics for SteamGifts group activities.

## Features

- **Overview Dashboard**: Key statistics and community health metrics
- **Giveaways Browser**: Browse all giveaways with advanced filtering and sorting
- **User Profiles**: Detailed user statistics including Steam integration
- **Steam Analytics**: Game ownership, playtime, and achievement data
- **Responsive Design**: Works on desktop and mobile devices

## Getting Started

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the website.

### Building for Production

```bash
npm run build
```

This creates a static export in the `out/` directory that can be deployed to any static hosting service.

### Serving the Built Site

```bash
npm run start
# or
npx serve out
```

## Data Sources

The website reads from JSON data files in the `public/data/` directory:

- `all_giveaways_html.json` - Complete giveaway data
- `group_users.json` - User statistics and Steam integration data

These files are automatically copied from the main project's `data/` directory during build.

## Deployment

The website is built as a static export and can be deployed to:

- GitHub Pages
- Netlify
- Vercel
- Any static hosting service
- Or served locally

## Pages

### Overview (`/`)
- Total statistics
- Community health metrics
- Quick navigation

### Giveaways (`/giveaways`)
- All giveaways with search and filters
- Sort by date, entries, or points
- Filter by CV status
- Links to individual giveaway creators

### Users (`/users`)  
- All group members with statistics
- Filter by contributor type
- Sort by various metrics
- Steam integration indicators

### User Details (`/users/[username]`)
- Detailed user statistics
- Complete list of games won with Steam data
- List of giveaways created
- Steam activity metrics

## Technologies

- **Next.js 15** - React framework with static export
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Static Generation** - No server required
