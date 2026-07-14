import { notFound } from 'next/navigation'
import {
  getAllGiveaways,
  getAllUsers,
  getExMembers,
  getGameData,
  getSteamIdMap,
  getChallengeData,
  getWishlist,
} from '@/lib/data'
import { createCreatorResolver, type CreatorResolver } from '@/lib/creator-resolver'
import {
  allEventSlugs,
  compareGiveawaysByDate,
  getEventBySlug,
  isValidRatioGiveaway,
  isCountedGiveaway,
  selectEventGiveaways,
} from '@/lib/events'
import type { GameData, Giveaway, UserGroupData } from '@/types'
import EventDetailClient, { type EventLeader } from './EventDetailClient'
import ChallengeClient from './ChallengeClient'
import SpecialEventClient, {
  type ResolvedTestimonial,
} from './SpecialEventClient'

export function generateStaticParams() {
  return allEventSlugs().map((slug) => ({ slug }))
}

/**
 * Resolves every creator/winner raw value in `giveaways` to a display name,
 * avatar (from active OR ex members), and ex-member flag. Returns the maps the
 * client needs plus a steam_id→avatar lookup for leaders.
 */
function buildIdentityMaps(
  giveaways: Giveaway[],
  allUsers: UserGroupData | null,
  exMembers: UserGroupData | null,
  resolver: CreatorResolver,
) {
  const avatarBySteamId = new Map<string, string>()
  const exSteamIds = new Set<string>()
  for (const u of Object.values(allUsers?.users ?? {})) {
    if (u.avatar_url) avatarBySteamId.set(u.steam_id, u.avatar_url)
  }
  for (const u of Object.values(exMembers?.users ?? {})) {
    if (u.avatar_url && !avatarBySteamId.has(u.steam_id))
      avatarBySteamId.set(u.steam_id, u.avatar_url)
    exSteamIds.add(u.steam_id)
  }

  const nameByRaw: Record<string, string> = {}
  const avatarByRaw: Record<string, string> = {}
  const exByRaw: Record<string, boolean> = {}
  const register = (raw: string | null | undefined) => {
    if (!raw || raw in nameByRaw) return
    nameByRaw[raw] = resolver.displayName(raw)
    const steamId = resolver.canonicalSteamId(raw)
    const avatar = avatarBySteamId.get(steamId)
    if (avatar) avatarByRaw[raw] = avatar
    if (exSteamIds.has(steamId) || resolver.isDeletedAccount(raw))
      exByRaw[raw] = true
  }
  for (const g of giveaways) {
    register(g.creator)
    for (const w of g.winners ?? []) register(w.name)
  }

  return { nameByRaw, avatarByRaw, exByRaw, avatarBySteamId }
}

/** Map of app_id/package_id → GameData for the games referenced by `giveaways`. */
function buildGameMap(
  giveaways: Giveaway[],
  gameData: GameData[],
): Record<string, GameData> {
  const lookup = new Map<number, GameData>()
  for (const g of gameData) if (g.app_id != null) lookup.set(g.app_id, g)
  const gameById: Record<string, GameData> = {}
  for (const g of giveaways) {
    const key = g.app_id ?? g.package_id
    if (key != null && lookup.has(key)) gameById[key] = lookup.get(key)!
  }
  return gameById
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await props.params
  const event = getEventBySlug(slug)
  if (!event) return { title: 'Event — The Giveaways Club' }
  const title = `${event.name} — The Giveaways Club`
  // OG descriptions want a short blurb, not the full multi-paragraph writeup.
  const description =
    event.tagline ?? event.description.split('\n')[0].slice(0, 200)
  // The og:image / twitter:image come from opengraph-image.tsx automatically;
  // metadataBase (root layout) makes the image and url absolute.
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      url: `/events/${slug}/`,
      siteName: 'The Giveaways Club',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

export default async function EventDetailPage(props: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await props.params
  const event = getEventBySlug(slug)
  if (!event) notFound()

  // ---- Challenge event ----
  if (event.kind === 'challenge') {
    const [data, gameData] = await Promise.all([
      event.challengeSlug ? getChallengeData(event.challengeSlug) : null,
      getGameData(),
    ])
    const game =
      data != null
        ? (gameData.find((g) => g.app_id === data.appId) ?? null)
        : null
    return <ChallengeClient meta={event} data={data} game={game} />
  }

  // ---- Special event backed by a giveaway date-window (e.g. June challenge) ----
  if (event.kind === 'special' && event.match?.endsBetween) {
    const [giveaways, allUsers, exMembers, gameData, steamIdMap] =
      await Promise.all([
        getAllGiveaways(),
        getAllUsers(),
        getExMembers(),
        getGameData(),
        getSteamIdMap(),
      ])

    const now = Date.now() / 1000
    const windowGiveaways = selectEventGiveaways(event, giveaways).sort(
      (a, b) => compareGiveawaysByDate(a, b, now),
    )

    // The record window is a separate comparison range (last year), counted
    // with the same valid-ratio + counted rule.
    const recordCount = event.recordWindow
      ? giveaways.filter(
          (g) =>
            isCountedGiveaway(g, now) &&
            isValidRatioGiveaway(g) &&
            g.end_timestamp >= event.recordWindow!.start &&
            g.end_timestamp < event.recordWindow!.end,
        ).length
      : 0

    const resolver = createCreatorResolver(steamIdMap)
    const { nameByRaw, avatarByRaw, exByRaw } = buildIdentityMaps(
      windowGiveaways,
      allUsers,
      exMembers,
      resolver,
    )
    const gameById = buildGameMap(windowGiveaways, gameData)

    return (
      <SpecialEventClient
        meta={event}
        giveaways={windowGiveaways}
        currentCount={windowGiveaways.length}
        recordCount={recordCount}
        nameByRaw={nameByRaw}
        avatarByRaw={avatarByRaw}
        exByRaw={exByRaw}
        gameById={gameById}
      />
    )
  }

  // ---- Special / link-only event ----
  if (event.kind === 'special') {
    let testimonials: ResolvedTestimonial[] | undefined
    if (event.testimonials?.length) {
      const [allUsers, exMembers, steamIdMap] = await Promise.all([
        getAllUsers(),
        getExMembers(),
        getSteamIdMap(),
      ])
      const resolver = createCreatorResolver(steamIdMap)
      const avatarBySteamId = new Map<string, string>()
      for (const u of Object.values(allUsers?.users ?? {})) {
        if (u.avatar_url) avatarBySteamId.set(u.steam_id, u.avatar_url)
      }
      for (const u of Object.values(exMembers?.users ?? {})) {
        if (u.avatar_url && !avatarBySteamId.has(u.steam_id))
          avatarBySteamId.set(u.steam_id, u.avatar_url)
      }
      testimonials = event.testimonials.map((t) => ({
        author: resolver.displayName(t.author) || t.author,
        avatar: avatarBySteamId.get(resolver.canonicalSteamId(t.author)) ?? null,
        text: t.text,
      }))
    }
    return <SpecialEventClient meta={event} testimonials={testimonials} />
  }

  // ---- Giveaway event ----
  const [giveaways, allUsers, exMembers, gameData, steamIdMap, wishlist] =
    await Promise.all([
      getAllGiveaways(),
      getAllUsers(),
      getExMembers(),
      getGameData(),
      getSteamIdMap(),
      getWishlist(),
    ])

  // Only valid-ratio, counted giveaways: deleted, no-entry, shared,
  // whitelist-only and reduced-CV giveaways are excluded everywhere in events.
  const now = Date.now() / 1000
  const eventGiveaways = giveaways
    .filter(
      (g) =>
        g.event_type === event.eventType &&
        isCountedGiveaway(g, now) &&
        isValidRatioGiveaway(g),
    )
    .sort((a, b) => compareGiveawaysByDate(a, b, now))

  if (eventGiveaways.length === 0) notFound()

  const resolver = createCreatorResolver(steamIdMap)
  // Avatars from BOTH active members and ex-members; ex-member winners show
  // their real avatar with an "ex" tag instead of a generic fallback.
  const { nameByRaw, avatarByRaw, exByRaw, avatarBySteamId } = buildIdentityMaps(
    eventGiveaways,
    allUsers,
    exMembers,
    resolver,
  )
  const gameById = buildGameMap(eventGiveaways, gameData)

  // Aggregate stats
  const starts = eventGiveaways
    .map((g) => g.start_timestamp)
    .filter(Boolean) as number[]
  const ends = eventGiveaways
    .map((g) => g.end_timestamp)
    .filter(Boolean) as number[]
  const endTimestamp = ends.length ? Math.max(...ends) : null

  // Most prolific creator (by GAs created) and most decorated winner (by wins),
  // collapsed to canonical steam ids so renames don't fragment the count.
  const creatorCounts = new Map<string, number>()
  const winnerCounts = new Map<string, number>()
  for (const g of eventGiveaways) {
    const c = resolver.canonicalSteamId(g.creator)
    if (c) creatorCounts.set(c, (creatorCounts.get(c) ?? 0) + 1)
    for (const w of g.winners ?? []) {
      if (!w.name) continue
      const id = resolver.canonicalSteamId(w.name)
      winnerCounts.set(id, (winnerCounts.get(id) ?? 0) + 1)
    }
  }
  const topOf = (counts: Map<string, number>): EventLeader | null => {
    let bestId: string | null = null
    let best = 0
    for (const [id, n] of counts) {
      if (n > best) {
        best = n
        bestId = id
      }
    }
    if (!bestId) return null
    return {
      name: resolver.displayName(bestId),
      avatar: avatarBySteamId.get(bestId) ?? null,
      count: best,
    }
  }

  const stats = {
    giveawayCount: eventGiveaways.length,
    totalCopies: eventGiveaways.reduce((s, g) => s + (g.copies ?? 1), 0),
    totalEntries: eventGiveaways.reduce((s, g) => s + (g.entry_count ?? 0), 0),
    uniqueCreators: creatorCounts.size,
    winnersCount: eventGiveaways.reduce(
      (s: number, g: Giveaway) => s + (g.winners?.length ?? 0),
      0,
    ),
    startTimestamp: starts.length ? Math.min(...starts) : null,
    endTimestamp,
    topCreator: topOf(creatorCounts),
    topWinner: topOf(winnerCounts),
  }

  // Notable giveaways: games with > 25 current group wishlist entries. Only
  // surfaced once the event is over (to celebrate the highlights in hindsight).
  const wishlistByAppId = new Map<number, number>()
  for (const e of wishlist?.entries ?? []) {
    if (e.app_id != null) wishlistByAppId.set(e.app_id, e.wishlist_count)
  }
  const isOver = endTimestamp != null && endTimestamp < Date.now() / 1000
  const NOTABLE_THRESHOLD = 25
  const notableGiveaways = isOver
    ? eventGiveaways
        .filter(
          (g) =>
            g.app_id != null &&
            (wishlistByAppId.get(g.app_id) ?? 0) > NOTABLE_THRESHOLD,
        )
        .sort(
          (a, b) =>
            (wishlistByAppId.get(b.app_id!) ?? 0) -
            (wishlistByAppId.get(a.app_id!) ?? 0),
        )
    : []
  const wishlistCountById: Record<string, number> = {}
  for (const g of notableGiveaways) {
    if (g.app_id != null)
      wishlistCountById[g.id] = wishlistByAppId.get(g.app_id) ?? 0
  }

  return (
    <EventDetailClient
      meta={event}
      giveaways={eventGiveaways}
      notableGiveaways={notableGiveaways}
      wishlistCountById={wishlistCountById}
      stats={stats}
      nameByRaw={nameByRaw}
      avatarByRaw={avatarByRaw}
      exByRaw={exByRaw}
      gameById={gameById}
    />
  )
}
