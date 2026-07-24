// Discord IDs and env accessors shared by the interactions endpoint and the
// scraper-side cron scripts (which import this file directly via a relative
// path — see packages/scraper/src/scripts/discord-*.ts).

export const GUILD_ID = '1385346341848350810'

// #bot-test — used for admin-triggered announcements/summaries in test phase,
// and as the default fallback for CONGRATS_CHANNEL_ID / WARN_CHANNEL_ID.
export const TEST_ANNOUNCE_CHANNEL_ID = '1528319391391813652'

// #bot-test-logs — the append-only signup-log protocol channel (see
// signup-log.ts). Default for LOG_CHANNEL_ID.
export const TEST_LOG_CHANNEL_ID = '1528319538016555128'

export function getBotToken(): string {
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) throw new Error('DISCORD_BOT_TOKEN is not set')
  return token
}

export function getPublicKey(): string {
  const key = process.env.DISCORD_PUBLIC_KEY
  if (!key) throw new Error('DISCORD_PUBLIC_KEY is not set')
  return key
}

export function getAppId(): string {
  const id = process.env.DISCORD_APP_ID
  if (!id) throw new Error('DISCORD_APP_ID is not set')
  return id
}

/** Signup-log channel. Defaults to the #bot-test-logs test channel. */
export function getLogChannelId(): string {
  return process.env.LOG_CHANNEL_ID ?? TEST_LOG_CHANNEL_ID
}

/** Optional override so data.ts fetches JSON from a specific origin instead of the request host. */
export function getDataBaseUrl(): string | undefined {
  return process.env.DATA_BASE_URL
}

// Raw Discord interaction/response type + flag numbers. Hardcoded rather than
// imported from `discord-interactions` so we're not coupled to that package's
// export surface for anything beyond `verifyKey`.
export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
} as const

export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  MODAL: 9,
} as const

export const MessageFlags = {
  EPHEMERAL: 1 << 6,
} as const

export const ComponentType = {
  ACTION_ROW: 1,
  BUTTON: 2,
  STRING_SELECT: 3,
  TEXT_INPUT: 4,
  CHANNEL_SELECT: 8,
  LABEL: 18,
} as const

export const ButtonStyle = {
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4,
  LINK: 5,
} as const

export const TextInputStyle = {
  SHORT: 1,
  PARAGRAPH: 2,
} as const
