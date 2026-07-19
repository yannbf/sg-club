import { fileURLToPath } from 'node:url'
import { getAppId, getBotToken, GUILD_ID } from '../../../website/api/_lib/constants.js'

// "Manage Server" permission bit — non-admins never even see these commands.
const MANAGE_GUILD_PERMISSION = '32'

const commands = [
  {
    name: 'challenge-setup',
    description: 'Announce a new challenge and open signups',
    default_member_permissions: MANAGE_GUILD_PERMISSION,
    options: [
      {
        name: 'slug',
        description: 'Short id, e.g. neo-cab (lowercase letters, numbers, hyphens, max 40 chars)',
        type: 3, // STRING
        required: true,
      },
      { name: 'name', description: 'Challenge display name', type: 3, required: true },
      {
        name: 'intro',
        description: 'Intro text for the announcement (multi-line ok)',
        type: 3,
        required: true,
      },
      {
        name: 'start',
        description: 'Start date: YYYY-MM-DD, YYYY-MM-DD HH:mm, or ISO 8601 (UTC unless offset given)',
        type: 3,
        required: true,
      },
      { name: 'end', description: 'End date (same formats as start)', type: 3, required: true },
      {
        name: 'signup_deadline',
        description: 'Signup deadline (defaults to start)',
        type: 3,
        required: false,
      },
      {
        name: 'channel',
        description: 'Channel to post the announcement in (defaults to this channel)',
        type: 7, // CHANNEL
        required: false,
      },
      {
        name: 'image',
        description: 'Optional banner image for the announcement embed',
        type: 11, // ATTACHMENT
        required: false,
      },
    ],
  },
  {
    name: 'challenge-list',
    description: 'List current signups for a challenge',
    default_member_permissions: MANAGE_GUILD_PERMISSION,
    options: [{ name: 'slug', description: 'Challenge slug', type: 3, required: true }],
  },
]

/** Registers the two guild commands via PUT — guild commands propagate instantly (no ~1h global-command delay). */
async function registerCommands(): Promise<void> {
  const appId = getAppId()
  const token = getBotToken()

  const res = await fetch(
    `https://discord.com/api/v10/applications/${appId}/guilds/${GUILD_ID}/commands`,
    {
      method: 'PUT',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
    }
  )

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to register commands: ${res.status} ${body}`)
  }

  const data = await res.json()
  console.log(`✅ Registered ${Array.isArray(data) ? data.length : 0} guild commands.`)
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    await registerCommands()
  }
}
