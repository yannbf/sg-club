import type { Giveaway } from '@/types'

/**
 * Events are surfaced two ways:
 *  - **Giveaway events** are derived from `giveaway.event_type` tags already in
 *    the data (e.g. `rpg_august`, `may_event_2026`). Their dates/stats are
 *    computed from the giveaways that belong to them.
 *  - **Challenge events** are standalone (not giveaway-backed). Right now that's
 *    "Gaming Challenge #1 — Backpack Hero", powered by
 *    public/data/challenge_backpack_hero.json.
 *
 * Website links are placeholders (`websiteUrl: null`) — fill them in here when
 * available; the UI renders a link only when one is set.
 */

export type EventKind = 'giveaway' | 'challenge' | 'special'

export interface EventMeta {
  /** URL slug (used at /events/[slug]). */
  slug: string
  /** Matches `giveaway.event_type` for giveaway events; undefined for challenges. */
  eventType?: string
  name: string
  /** Short subtitle / theme line (e.g. "Month of the RPGs"). */
  tagline?: string
  description: string
  /** Fill in later — UI shows a link only when non-null. */
  websiteUrl: string | null
  kind: EventKind
  /** Recurring monthly event (drives the "monthly" highlight). */
  monthly: boolean
  /** Tailwind/CSS accent color variable used for the card accent + chrome. */
  accent: string
  emoji: string
  /** Optional image shown in the icon slot instead of the emoji (e.g. a game's Steam art). */
  imageUrl?: string
  /** Challenge data file slug (challenge events only). */
  challengeSlug?: string
  /** Special/link events carry their own fixed dates + headline (no giveaway data). */
  startTimestamp?: number
  endTimestamp?: number
  /** Headline number for special events (e.g. "550+" giveaways). */
  headlineStat?: { value: string; label: string }
  /** Label for the external CTA button (special events). */
  linkLabel?: string
  /** Ways members can contribute toward a community-goal event. */
  howToContribute?: string[]
  /** The reward rule for a community-goal event. */
  rewardRule?: string
  /** Grand finale details for a community-goal event. */
  finale?: { label: string; items?: string[] }
  /**
   * For special events counted by giveaway end-date (rather than `event_type`):
   * any non-deleted giveaway whose end falls in [start, end) is an event
   * giveaway. `record` is last year's comparison window.
   */
  giveawayWindow?: { start: number; end: number }
  recordWindow?: { start: number; end: number; label: string }
}

/** Per-event descriptive metadata, keyed by `event_type`. */
const GIVEAWAY_EVENT_META: Record<string, Omit<EventMeta, 'slug' | 'kind'>> = {
  may_event_2026: {
    eventType: 'may_event_2026',
    name: 'May Event',
    tagline: 'Flor Frenzy',
    description:
      'A great moment leading up to our group anniversary — a full month of blooming giveaways across every genre.',
    websiteUrl: 'https://flor-frenzy.lovable.app/',
    monthly: true,
    accent: 'var(--accent-green)',
    emoji: '🌷',
  },
  april_event_2026: {
    eventType: 'april_event_2026',
    name: 'April Event',
    tagline: 'Month of the BINGO MADNESS',
    description:
      'Gus drank too much kool aid and came up with the most chaotic bingo experience you can ever have xD. The biggest themed event in TGC history — a fitting send-off for the season.',
    websiteUrl: null,
    monthly: true,
    accent: 'var(--accent-yellow)',
    emoji: '🫘',
  },
  march_event_2026: {
    eventType: 'march_event_2026',
    name: 'March Event',
    tagline: 'Mystery month',
    description:
      'Detective and mystery games to entice everyone — a month of whodunnits, puzzles, and creeping dread.',
    websiteUrl: null,
    monthly: true,
    accent: 'var(--accent-rose)',
    emoji: '🐰',
  },
  january_event_2026: {
    eventType: 'january_event_2026',
    name: 'January Event',
    tagline: 'Cozy month',
    description:
      'New-year energy, fresh starts, and lots of coziness — wholesome, warm games to ease into 2026.',
    websiteUrl: null,
    monthly: true,
    accent: 'var(--info)',
    emoji: '🎆',
  },
  november_event: {
    eventType: 'november_event',
    name: 'November Event',
    tagline: 'Month of the unknown',
    description:
      'A month full of first-ever given games on SG — proper hidden gems the group had never gifted before. 💎',
    websiteUrl: null,
    monthly: true,
    accent: 'var(--accent-purple)',
    emoji: '🧸',
  },
  october_event: {
    eventType: 'october_event',
    name: 'October Event',
    tagline: 'Spooky month',
    description:
      'Spooky season, horror games, and survival nightmares — the scariest month on the calendar.',
    websiteUrl: null,
    monthly: true,
    accent: 'var(--warning)',
    emoji: '🎃',
  },
  rpg_august: {
    eventType: 'rpg_august',
    name: 'RPG August',
    tagline: 'Month of the RPGs',
    description:
      'Our first themed event. A whole month of RPGs, JRPGs, and tactical adventures shared as giveaways for the group to dive into.',
    websiteUrl: null,
    monthly: true,
    accent: 'var(--accent-rose)',
    emoji: '🎲',
  },
}

/** Standalone, non-giveaway events (challenges). */
export const CHALLENGE_EVENTS: EventMeta[] = [
  {
    slug: 'gaming-challenge-1-backpack-hero',
    name: 'Gaming Challenge #1 — Backpack Hero',
    description:
      'Our first community gaming challenge! Everyone plays Backpack Hero from a clean slate — only progress made after the challenge start counts. Climb the leaderboard by unlocking achievements, and the first member to earn the “Hero” achievement (discover at least 700 items) wins the challenge.',
    websiteUrl: null,
    kind: 'challenge',
    monthly: false,
    accent: 'var(--primary)',
    emoji: '🎒',
    imageUrl:
      'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1970580/header.jpg',
    challengeSlug: 'backpack-hero',
  },
]

/** Standalone, non-giveaway "link" events (e.g. the anniversary train). */
export const SPECIAL_EVENTS: EventMeta[] = [
  {
    slug: 'june-anniversary-challenge',
    name: 'June Anniversary Challenge',
    tagline: 'Anniversary Gymkhana · break last year’s record',
    description:
      'It’s anniversary month at The Giveaways Club, and this year we’re aiming to smash last year’s record! With the Steam Summer Sale approaching, it’s the perfect time to go BIG. To make sure everyone can take part, there are two ways to contribute to the community goal — every action helps.',
    websiteUrl: null,
    kind: 'special',
    monthly: false,
    accent: 'var(--accent-rose)',
    emoji: '🎉',
    startTimestamp: Date.UTC(2026, 5, 1, 12) / 1000,
    endTimestamp: Date.UTC(2026, 6, 4, 12) / 1000,
    howToContribute: [
      'Create exclusive TGC giveaways',
      'Play pending wins (TGC or SG)',
    ],
    rewardRule:
      'For every 5 giveaways created or pending wins played, 1 extra prize is added to the Anniversary Gymkhana. The more we contribute, the bigger the prize pool becomes for everyone.',
    finale: {
      label: 'July 4th',
      items: ['🎮 Minigames', '🏆 Challenges', '🎁 Extra prizes', '🎉 Community fun'],
    },
    // Any giveaway ending in June 2026 counts; the record is June 2025's tally.
    giveawayWindow: { start: Date.UTC(2026, 5, 1) / 1000, end: Date.UTC(2026, 6, 1) / 1000 },
    recordWindow: {
      start: Date.UTC(2025, 5, 1) / 1000,
      end: Date.UTC(2025, 6, 1) / 1000,
      label: 'June 2025',
    },
  },
  {
    slug: 'anniversary-train',
    name: 'Anniversary Train',
    tagline: 'First anniversary · 550+ giveaways',
    description:
      'We celebrated The Giveaways Club’s first anniversary with a giant giveaway train — over 550 giveaways from across the group, all aboard one glorious thread. 🎉🚂',
    websiteUrl:
      'https://www.steamgifts.com/discussion/qGqDV/anniversary-over-500-giveaways-celebrate-with-us-level-3',
    kind: 'special',
    monthly: false,
    accent: 'var(--accent-yellow)',
    emoji: '🚂',
    startTimestamp: Date.UTC(2026, 5, 1, 12) / 1000,
    endTimestamp: Date.UTC(2026, 5, 4, 12) / 1000,
    headlineStat: { value: '550+', label: 'giveaways in the train' },
    linkLabel: 'Open the anniversary thread',
  },
]

const eventTypeToSlug = (eventType: string) => eventType.replace(/_/g, '-')

export function getGiveawayEventMeta(eventType: string): EventMeta {
  const base = GIVEAWAY_EVENT_META[eventType]
  if (base) return { ...base, slug: eventTypeToSlug(eventType), kind: 'giveaway' }
  // Fallback for any future event_type not yet described here.
  const title = eventType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
  return {
    slug: eventTypeToSlug(eventType),
    eventType,
    name: title,
    description: `Giveaways tagged “${eventType}”.`,
    websiteUrl: null,
    kind: 'giveaway',
    monthly: true,
    accent: 'var(--accent-purple)',
    emoji: '🎁',
  }
}

export interface EventSummary {
  meta: EventMeta
  giveawayCount: number
  totalCopies: number
  totalEntries: number
  uniqueCreators: number
  winnersCount: number
  startTimestamp: number | null
  endTimestamp: number | null
  isOngoing: boolean
  /** Challenge-only extras (filled by the page from the challenge data file). */
  participantCount?: number
  winnerUsername?: string | null
}

/**
 * Builds one summary per giveaway `event_type` present in the data, with dates
 * and aggregate stats. Sorted most-recent first.
 */
export function buildGiveawayEventSummaries(
  giveaways: Giveaway[],
  now: number = Date.now() / 1000,
): EventSummary[] {
  const byType = new Map<string, Giveaway[]>()
  for (const g of giveaways) {
    if (!g.event_type) continue
    if (g.deleted) continue // only valid giveaways count toward events
    const arr = byType.get(g.event_type) ?? []
    arr.push(g)
    byType.set(g.event_type, arr)
  }

  const summaries: EventSummary[] = []
  for (const [eventType, list] of byType) {
    const starts = list.map((g) => g.start_timestamp).filter(Boolean)
    const ends = list.map((g) => g.end_timestamp).filter(Boolean)
    const startTimestamp = starts.length ? Math.min(...starts) : null
    const endTimestamp = ends.length ? Math.max(...ends) : null
    const creators = new Set(list.map((g) => g.creator).filter(Boolean))
    const winnersCount = list.reduce(
      (sum, g) => sum + (g.winners?.length ?? 0),
      0,
    )
    const isOngoing =
      startTimestamp != null &&
      endTimestamp != null &&
      now >= startTimestamp &&
      now <= endTimestamp

    summaries.push({
      meta: getGiveawayEventMeta(eventType),
      giveawayCount: list.length,
      totalCopies: list.reduce((s, g) => s + (g.copies ?? 1), 0),
      totalEntries: list.reduce((s, g) => s + (g.entry_count ?? 0), 0),
      uniqueCreators: creators.size,
      winnersCount,
      startTimestamp,
      endTimestamp,
      isOngoing,
    })
  }

  summaries.sort(
    (a, b) => (b.startTimestamp ?? 0) - (a.startTimestamp ?? 0),
  )
  return summaries
}

export function getEventBySlug(slug: string): EventMeta | null {
  const challenge = CHALLENGE_EVENTS.find((e) => e.slug === slug)
  if (challenge) return challenge
  const special = SPECIAL_EVENTS.find((e) => e.slug === slug)
  if (special) return special
  // Map a giveaway-event slug back to its event_type.
  for (const eventType of Object.keys(GIVEAWAY_EVENT_META)) {
    if (eventTypeToSlug(eventType) === slug) return getGiveawayEventMeta(eventType)
  }
  return null
}

/** Build a summary for a special/link event straight from its metadata. */
export function buildSpecialEventSummary(
  meta: EventMeta,
  giveaways?: Giveaway[],
  now: number = Date.now() / 1000,
): EventSummary {
  const start = meta.startTimestamp ?? null
  const end = meta.endTimestamp ?? null

  // Giveaway-window special events (e.g. the June challenge) count any
  // non-deleted giveaway ending inside the window.
  let giveawayCount = 0
  if (meta.giveawayWindow && giveaways) {
    const { start: ws, end: we } = meta.giveawayWindow
    giveawayCount = giveaways.filter(
      (g) => !g.deleted && g.end_timestamp >= ws && g.end_timestamp < we,
    ).length
  }

  return {
    meta,
    giveawayCount,
    totalCopies: 0,
    totalEntries: 0,
    uniqueCreators: 0,
    winnersCount: 0,
    startTimestamp: start,
    endTimestamp: end,
    isOngoing: start != null && end != null && now >= start && now <= end,
  }
}

/** All static slugs for generateStaticParams (giveaway + challenge + special). */
export function allEventSlugs(): string[] {
  return [
    ...Object.keys(GIVEAWAY_EVENT_META).map(eventTypeToSlug),
    ...CHALLENGE_EVENTS.map((e) => e.slug),
    ...SPECIAL_EVENTS.map((e) => e.slug),
  ]
}
