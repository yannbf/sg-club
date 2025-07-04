# Setup Guide

## Environment Variables

To use all features of this project, you'll need to configure some environment variables:

### Steam API Key (Required for Steam Game Checker)

1. **Get your Steam API key**:
   - Visit [https://steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)
   - Log in with your Steam account
   - Enter a domain name (can be anything like `localhost` for personal use)
   - Copy the generated API key

2. **Set the environment variable**:
   ```bash
   # Option 1: Export in your shell
   export STEAM_API_KEY=your_api_key_here
   
   # Option 2: Create a .env file in the project root (recommended)
   echo "STEAM_API_KEY=your_api_key_here" > .env
   ```

   **Note**: The script automatically loads `.env` files, so option 2 is recommended for persistent configuration.

### Optional Environment Variables

- **FETCH_ALL_PAGES**: Set to `true` to enable unlimited fetching mode
  ```bash
  export FETCH_ALL_PAGES=true
  ```

## Example .env file

Create a `.env` file in the project root with:

```env
# Steam Web API Key - Required for Steam game checker
STEAM_API_KEY=your_steam_api_key_here

# Optional: Enable unlimited fetching mode for giveaways
# FETCH_ALL_PAGES=true
```

## Testing Your Setup

Once you've configured your Steam API key, test it with:

```bash
# Test with a known user and game (example: Dota 2)
npm run check-steam-game 76561198054649894 570
```

This should show game ownership and stats if the user's profile is public.

## Common Issues

### "Steam API key not found"
- Make sure you've set the `STEAM_API_KEY` environment variable
- Verify the API key is correct (no extra spaces or quotes)

### "Could not access user's game library"
- The Steam user's profile must be public
- Check that the Steam ID is correct (64-bit format)

### "User does not own this game"
- The user genuinely doesn't own the game
- Double-check the App ID is correct

## Finding Steam IDs and App IDs

### Steam ID (64-bit format):
- Visit the user's Steam profile
- Look in the URL: `https://steamcommunity.com/profiles/76561198054649894`
- The long number is the Steam ID

### App ID:
- Visit the game's Steam store page
- Look in the URL: `https://store.steampowered.com/app/570/Dota_2/`
- The number after `/app/` is the App ID 