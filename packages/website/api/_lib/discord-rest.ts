// Minimal fetch-based Discord REST helper. No discord.js — raw REST only.

import type { ServerResponse } from 'node:http'
import { getBotToken } from './constants.js'

const API_BASE = 'https://discord.com/api/v10'

const MAX_RATE_LIMIT_RETRIES = 5

async function discordFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getBotToken()
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
    if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const body = (await res.json().catch(() => ({}))) as { retry_after?: number }
      const waitMs = Math.ceil((body.retry_after ?? 1) * 1000) + 250
      await new Promise((resolve) => setTimeout(resolve, waitMs))
      continue
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Discord API ${init.method ?? 'GET'} ${path} failed: ${res.status} ${body}`)
    }
    return res
  }
}

export interface DiscordMessage {
  id: string
  channel_id: string
  content: string
  timestamp: string
  embeds?: Record<string, unknown>[]
}

export async function createMessage(
  channelId: string,
  payload: Record<string, unknown>
): Promise<DiscordMessage> {
  const res = await discordFetch(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return (await res.json()) as DiscordMessage
}

export async function editMessage(
  channelId: string,
  messageId: string,
  payload: Record<string, unknown>
): Promise<DiscordMessage> {
  const res = await discordFetch(`/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
  return (await res.json()) as DiscordMessage
}

export async function getMessage(channelId: string, messageId: string): Promise<DiscordMessage> {
  const res = await discordFetch(`/channels/${channelId}/messages/${messageId}`)
  return (await res.json()) as DiscordMessage
}

export interface DiscordEmoji {
  id: string
  name: string
  animated?: boolean
}

/** GET /guilds/{id}/emojis — used to look up custom emoji (e.g. `pandaparty`) by name. */
export async function getGuildEmojis(guildId: string): Promise<DiscordEmoji[]> {
  const res = await discordFetch(`/guilds/${guildId}/emojis`)
  return (await res.json()) as DiscordEmoji[]
}

export async function getChannelMessages(
  channelId: string,
  options: { before?: string; limit?: number } = {}
): Promise<DiscordMessage[]> {
  const params = new URLSearchParams()
  params.set('limit', String(options.limit ?? 100))
  if (options.before) params.set('before', options.before)

  const res = await discordFetch(`/channels/${channelId}/messages?${params.toString()}`)
  return (await res.json()) as DiscordMessage[]
}

/**
 * Fetches all messages in a channel (newest-first, Discord's native order),
 * paginating with `before` until exhausted or maxMessages is hit.
 */
export async function getAllChannelMessages(
  channelId: string,
  maxMessages = 2000
): Promise<DiscordMessage[]> {
  const all: DiscordMessage[] = []
  let before: string | undefined

  while (all.length < maxMessages) {
    const batch = await getChannelMessages(channelId, { before, limit: 100 })
    if (batch.length === 0) break
    all.push(...batch)
    before = batch[batch.length - 1]?.id
    if (batch.length < 100) break
  }

  return all.slice(0, maxMessages)
}

// --- Interaction response helpers ---

/** Writes a JSON interaction response directly on the endpoint's HTTP response. */
export function respondJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

/** POSTs a followup message for a deferred interaction. */
export async function sendFollowup(
  appId: string,
  interactionToken: string,
  payload: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`${API_BASE}/webhooks/${appId}/${interactionToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Discord followup failed: ${res.status} ${body}`)
  }
}

/** Edits the original deferred interaction response. */
export async function editOriginalResponse(
  appId: string,
  interactionToken: string,
  payload: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`${API_BASE}/webhooks/${appId}/${interactionToken}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Discord edit-original failed: ${res.status} ${body}`)
  }
}
