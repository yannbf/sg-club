# Deployment Guide

This guide explains how to set up automated deployment of your SteamGifts website using GitHub Actions and GitHub Pages.

## Overview

The deployment process:
1. **Runs every 12 hours** (at 00:00 and 12:00 UTC)
2. **Generates fresh data** by running all scrapers
3. **Builds the website** with the latest data
4. **Deploys automatically** to GitHub Pages

## GitHub Pages Setup

### 1. Enable GitHub Pages

1. Go to your repository settings on GitHub
2. Scroll down to the "Pages" section
3. Under "Source", select **GitHub Actions**
4. Save the settings

### 2. Repository Permissions

The workflow needs proper permissions to deploy to GitHub Pages. These are already configured in the workflow file:
- `contents: read` - to read the repository
- `pages: write` - to write to GitHub Pages
- `id-token: write` - for secure authentication

## Environment Variables

Your scrapers require a Steam API key to fetch user play data and achievements. You need to set this up in GitHub secrets:

### Required Setup

1. **Get a Steam API Key**:
   - Go to https://steamcommunity.com/dev/apikey
   - Register for a Steam API key (free)
   - Copy the API key

2. **Add to GitHub Secrets**:
   - Go to your repository settings
   - Navigate to "Secrets and variables" > "Actions"
   - Click "New repository secret"
   - Name: `STEAM_API_KEY`
   - Value: Your Steam API key from step 1
   - Click "Add secret"

### Optional: Skip Steam API

If you don't want to use Steam API functionality, you can skip it entirely:

1. In the workflow file (`.github/workflows/deploy.yml`), uncomment this line:
   ```yaml
   SKIP_STEAM_API: true
   ```

2. Comment out the Steam API key line:
   ```yaml
   # STEAM_API_KEY: ${{ secrets.STEAM_API_KEY }}
   ```

### Environment Variables Used

- `STEAM_API_KEY` - Required for Steam API functionality
- `FETCH_ALL_PAGES` - Set to `true` to fetch all giveaway pages
- `SKIP_STEAM_API` - Set to `true` to skip Steam API calls entirely
- `NODE_ENV` - Set to `production` for the build

## Manual Deployment

You can trigger a deployment manually:

1. Go to the "Actions" tab in your repository
2. Select "Deploy Website with Data Update"
3. Click "Run workflow"
4. Choose the branch and click "Run workflow"

## Monitoring

- **View deployment logs**: Go to Actions tab and click on any workflow run
- **Check website**: After deployment, your site will be available at `https://[username].github.io/[repository-name]`
- **Deployment status**: Each step shows success/failure status

## Schedule Customization

To change the deployment schedule, edit the cron expression in `.github/workflows/deploy.yml`:

```yaml
schedule:
  - cron: '0 0,12 * * *'  # Every 12 hours at 00:00 and 12:00 UTC
```

Common cron patterns:
- `0 */6 * * *` - Every 6 hours
- `0 0 * * *` - Daily at midnight
- `0 0 * * 1` - Weekly on Mondays
- `0 0 1 * *` - Monthly on the 1st

## Troubleshooting

### Common Issues

1. **Deployment fails**: Check the Actions logs for specific error messages
2. **Data not updating**: Ensure scrapers are working and environment variables are set
3. **Website not loading**: Verify the Next.js build completed successfully

### Debug Steps

1. Check the workflow logs in the Actions tab
2. Verify all dependencies are correctly installed
3. Test the `npm run run-all-with-website` command locally
4. Ensure GitHub Pages is enabled and configured correctly

## Cost Considerations

- GitHub Actions provides 2000 minutes/month for free on public repositories
- Each deployment run takes approximately 5-10 minutes
- Running every 12 hours = ~60 runs/month = ~300-600 minutes/month
- This should fit comfortably within the free tier 