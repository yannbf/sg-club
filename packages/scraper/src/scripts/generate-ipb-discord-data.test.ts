import { describe, expect, it } from 'vitest'
import { mergeSteamForumSeed } from './generate-ipb-discord-data'
import type { IpbDiscordWinEntry } from '../types/ipb-discord.js'

const DISCORD_ENTRY: IpbDiscordWinEntry = {
  thread_id: '111',
  url: 'https://discord.com/channels/1/2/111',
  thread_name: 'Discord Win',
  matched_by: 'title',
  owner_discord_name: 'someone',
  thread_created_at: '2026-01-01T00:00:00.000Z',
  win_flagged: false,
}

const seed = (wins: Record<string, unknown>) => ({
  source: 'steam_forum' as const,
  thread_url: 'https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/1',
  first_comment_id: '1',
  harvested_at: '2026-09-11',
  wins: wins as Record<
    string,
    {
      comment_id: string
      url: string
      game_name: string
      steam_poster_name: string
      posted_at: string
    }
  >,
})

describe('mergeSteamForumSeed', () => {
  it('maps a seed entry to the forum-flavored win fields', () => {
    const result = mergeSteamForumSeed(
      {},
      seed({
        '76561198069420656::Bunwq/carrion': {
          comment_id: '673976371230386113',
          url: 'https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/1/?ctp=25#c673976371230386113',
          game_name: 'CARRION',
          steam_poster_name: 'Metalhead8489',
          posted_at: '2025-10-20T22:18:00.000Z',
        },
      }),
      () => ({ link: 'Bunwq/carrion', name: 'CARRION', giveawayName: 'CARRION', flagged: true }),
    )

    expect(result.merged).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.wins['76561198069420656::Bunwq/carrion']).toEqual({
      source: 'steam_forum',
      thread_id: '673976371230386113',
      url: 'https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/1/?ctp=25#c673976371230386113',
      thread_name: 'CARRION',
      matched_by: 'steam_forum',
      owner_discord_name: 'Metalhead8489',
      thread_created_at: '2025-10-20T22:18:00.000Z',
      win_flagged: true,
    })
  })

  it('derives win_flagged as false when the candidate win is unflagged', () => {
    const result = mergeSteamForumSeed(
      {},
      seed({
        '76561198069420656::Bunwq/carrion': {
          comment_id: '1',
          url: 'https://example.com/1',
          game_name: 'CARRION',
          steam_poster_name: 'Metalhead8489',
          posted_at: '2025-10-20T22:18:00.000Z',
        },
      }),
      () => ({ link: 'Bunwq/carrion', name: 'CARRION', giveawayName: undefined, flagged: false }),
    )

    expect(result.wins['76561198069420656::Bunwq/carrion'].win_flagged).toBe(false)
  })

  it('leaves an existing Discord-matched entry untouched on key collision', () => {
    const key = '76561198069420656::Bunwq/carrion'
    const result = mergeSteamForumSeed(
      { [key]: DISCORD_ENTRY },
      seed({
        [key]: {
          comment_id: '673976371230386113',
          url: 'https://example.com/forum',
          game_name: 'CARRION',
          steam_poster_name: 'Metalhead8489',
          posted_at: '2025-10-20T22:18:00.000Z',
        },
      }),
      () => ({ link: 'Bunwq/carrion', name: 'CARRION', giveawayName: undefined, flagged: true }),
    )

    expect(result.merged).toBe(0)
    expect(result.wins[key]).toBe(DISCORD_ENTRY)
  })

  it('skips a seed entry whose win no longer exists in the candidate map', () => {
    const result = mergeSteamForumSeed(
      {},
      seed({
        '76561198069420656::Bunwq/carrion': {
          comment_id: '1',
          url: 'https://example.com/1',
          game_name: 'CARRION',
          steam_poster_name: 'Metalhead8489',
          posted_at: '2025-10-20T22:18:00.000Z',
        },
      }),
      () => undefined,
    )

    expect(result.merged).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.wins).toEqual({})
  })
})
