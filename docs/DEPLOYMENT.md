# Data Update Automation Guide

This guide explains how to set up automated data generation for your SteamGifts website using GitHub Actions.

## Overview

The automated data update process:
1. **Runs every 12 hours** (at 00:00 and 12:00 UTC)
2. **Generates fresh data** by running all scrapers
3. **Updates website data files** with the latest information
4. **Commits changes** back to the repository

## Setup

### Repository Permissions

The workflow needs write permissions to commit changes. This is already configured in the workflow file:
- `contents: write` - to read the repository and commit changes

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

## Manual Data Update

You can trigger a data update manually:

1. Go to the "Actions" tab in your repository
2. Select "Update Website Data"
3. Click "Run workflow"
4. Choose the branch and click "Run workflow"

## Monitoring

- **View update logs**: Go to Actions tab and click on any workflow run
- **Check for new commits**: After the workflow runs, check the repository for new commits with updated data files
- **Update status**: Each step shows success/failure status

## What Gets Updated

The workflow updates these files:
- `website/public/data/all_giveaways_html.json` - Latest giveaway data (generated directly to website)
- `website/public/data/group_users.json` - Updated user statistics (generated directly to website)
- `data/group_insights.txt` - Generated insights (for analysis)
- `data/user_insights.txt` - User insights (for analysis)

## Schedule Customization

To change the update schedule, edit the cron expression in `.github/workflows/deploy.yml`:

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

1. **Workflow fails**: Check the Actions logs for specific error messages
2. **Data not updating**: Ensure scrapers are working and environment variables are set
3. **No commits created**: Check if there were actually changes to commit
4. **Permission errors**: Ensure the repository has Actions enabled and write permissions

### Debug Steps

1. Check the workflow logs in the Actions tab
2. Verify all dependencies are correctly installed
3. Test the `npm run run-all-with-website` command locally
4. Check if the generated files actually have changes

## Cost Considerations

- GitHub Actions provides 2000 minutes/month for free on public repositories
- Each data update run takes approximately 5-10 minutes
- Running every 12 hours = ~60 runs/month = ~300-600 minutes/month
- This should fit comfortably within the free tier 