import { describe, expect, it } from 'vitest'
import { mergeIpbSeed } from './generate-ipb-discord-data'
import type { IpbDiscordMatchSource, IpbDiscordWinEntry } from '../types/ipb-discord.js'

const DISCORD_ENTRY: IpbDiscordWinEntry = {
  thread_id: '111',
  url: 'https://discord.com/channels/1/2/111',
  thread_name: 'Discord Win',
  matched_by: 'title',
  owner_discord_name: 'someone',
  thread_created_at: '2026-01-01T00:00:00.000Z',
  win_flagged: false,
}

const seed = (source: 'steam_forum' | 'discord', wins: Record<string, unknown>) => ({
  source,
  wins: wins as Record<
    string,
    {
      id: string
      url: string
      game_name: string
      poster_name: string
      posted_at: string
      matched_by: IpbDiscordMatchSource
    }
  >,
})

describe('mergeIpbSeed', () => {
  it('maps a seed entry to the win fields, tagged with the seed source', () => {
    const result = mergeIpbSeed(
      {},
      seed('steam_forum', {
        '76561198069420656::Bunwq/carrion': {
          id: '673976371230386113',
          url: 'https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/1/?ctp=25#c673976371230386113',
          game_name: 'CARRION',
          poster_name: 'Metalhead8489',
          posted_at: '2025-10-20T22:18:00.000Z',
          matched_by: 'steam_forum',
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

  it('takes source and matched_by from the seed for a discord-archive entry', () => {
    const result = mergeIpbSeed(
      {},
      seed('discord', {
        '76561198069420656::Bunwq/carrion': {
          id: '1460706829561626785',
          url: 'https://discord.com/channels/1385346341848350810/1385400003127803995/1460706829561626785',
          game_name: 'CARRION',
          poster_name: 'Metalhead8489',
          posted_at: '2025-10-20T22:18:00.000Z',
          matched_by: 'giveaway_link',
        },
      }),
      () => ({ link: 'Bunwq/carrion', name: 'CARRION', giveawayName: 'CARRION', flagged: false }),
    )

    expect(result.wins['76561198069420656::Bunwq/carrion']).toMatchObject({
      source: 'discord',
      matched_by: 'giveaway_link',
    })
  })

  it('derives win_flagged as false when the candidate win is unflagged', () => {
    const result = mergeIpbSeed(
      {},
      seed('steam_forum', {
        '76561198069420656::Bunwq/carrion': {
          id: '1',
          url: 'https://example.com/1',
          game_name: 'CARRION',
          poster_name: 'Metalhead8489',
          posted_at: '2025-10-20T22:18:00.000Z',
          matched_by: 'steam_forum',
        },
      }),
      () => ({ link: 'Bunwq/carrion', name: 'CARRION', giveawayName: undefined, flagged: false }),
    )

    expect(result.wins['76561198069420656::Bunwq/carrion'].win_flagged).toBe(false)
  })

  it('leaves an existing Discord-matched entry untouched on key collision', () => {
    const key = '76561198069420656::Bunwq/carrion'
    const result = mergeIpbSeed(
      { [key]: DISCORD_ENTRY },
      seed('steam_forum', {
        [key]: {
          id: '673976371230386113',
          url: 'https://example.com/forum',
          game_name: 'CARRION',
          poster_name: 'Metalhead8489',
          posted_at: '2025-10-20T22:18:00.000Z',
          matched_by: 'steam_forum',
        },
      }),
      () => ({ link: 'Bunwq/carrion', name: 'CARRION', giveawayName: undefined, flagged: true }),
    )

    expect(result.merged).toBe(0)
    expect(result.wins[key]).toBe(DISCORD_ENTRY)
  })

  it('skips a seed entry whose win no longer exists in the candidate map', () => {
    const result = mergeIpbSeed(
      {},
      seed('steam_forum', {
        '76561198069420656::Bunwq/carrion': {
          id: '1',
          url: 'https://example.com/1',
          game_name: 'CARRION',
          poster_name: 'Metalhead8489',
          posted_at: '2025-10-20T22:18:00.000Z',
          matched_by: 'steam_forum',
        },
      }),
      () => undefined,
    )

    expect(result.merged).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.wins).toEqual({})
  })

  it('keeps the earlier seed entry when a later seed targets the same key (seed order precedence)', () => {
    const key = '76561198069420656::Bunwq/carrion'
    const findCandidateWin = () => ({
      link: 'Bunwq/carrion',
      name: 'CARRION',
      giveawayName: undefined,
      flagged: false,
    })

    const forumResult = mergeIpbSeed(
      {},
      seed('steam_forum', {
        [key]: {
          id: 'forum-comment-1',
          url: 'https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/1/#c1',
          game_name: 'CARRION',
          poster_name: 'Metalhead8489',
          posted_at: '2025-10-20T22:18:00.000Z',
          matched_by: 'steam_forum',
        },
      }),
      findCandidateWin,
    )

    const archiveResult = mergeIpbSeed(
      forumResult.wins,
      seed('discord', {
        [key]: {
          id: 'archive-message-1',
          url: 'https://discord.com/channels/1385346341848350810/1385400003127803995/1',
          game_name: 'CARRION',
          poster_name: 'someone-else',
          posted_at: '2025-01-01T00:00:00.000Z',
          matched_by: 'giveaway_link',
        },
      }),
      findCandidateWin,
    )

    expect(archiveResult.merged).toBe(0)
    expect(archiveResult.wins[key]).toEqual(forumResult.wins[key])
    expect(archiveResult.wins[key].source).toBe('steam_forum')
    expect(archiveResult.wins[key].thread_id).toBe('forum-comment-1')
  })
})
