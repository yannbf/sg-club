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
  /** Optional promotional poster art (portrait) shown in the event header. */
  bannerUrl?: string
  /** Challenge data file slug (challenge events only). */
  challengeSlug?: string
  /** Special/link events carry their own fixed dates + headline (no giveaway data). */
  startTimestamp?: number
  endTimestamp?: number
  /** Headline number for special events (e.g. "550+" giveaways). */
  headlineStat?: { value: string; label: string }
  /** Label for the external CTA button (special events). */
  linkLabel?: string
  /** Heading for the steps card (defaults to "How to contribute"). */
  howToTitle?: string
  /** Ways members can contribute / take part in a community-goal event. */
  howToContribute?: string[]
  /** The reward rule for a community-goal event. */
  rewardRule?: string
  /**
   * Grand finale details for a community-goal event. `subtitle` and `note`
   * default to the June anniversary copy when omitted.
   */
  finale?: { label: string; subtitle?: string; note?: string; items?: string[] }
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
    bannerUrl: '/events/may_2026.png',
  },
  april_event_2026: {
    eventType: 'april_event_2026',
    name: 'April Event',
    tagline: 'The Big Bingo Bash',
    description:
      'Gus drank too much kool-aid and dreamed up the most chaotic bingo night in TGC history — The Big Bingo Bash! 🎉\n\n' +
      "Here's the deal: create a giveaway with the usual Exclusive settings and you're IN — you get a bingo card and a shot at the prizes. Want MORE cards? MORE chances? MORE chaos? Create more giveaways and stack up those bingo cards. The more you give, the more you play.\n\n" +
      'The wildest, most unhinged bingo went down April 26th at 16:00 UTC — loud, fast, and absolutely LOCO. The biggest themed event of the season, and a fitting send-off.',
    websiteUrl: null,
    monthly: true,
    accent: 'var(--accent-yellow)',
    emoji: '🫘',
    bannerUrl: '/events/april_2026.png',
  },
  march_event_2026: {
    eventType: 'march_event_2026',
    name: 'March Event',
    tagline: 'Mystery Month',
    description:
      'All March long, The Giveaways Club celebrated the thrill of investigation — Mystery Month! 🔍\n\n' +
      'To take part, members created a giveaway for a game tagged Detective, Mystery, or both, and included "MARCH EVENT ENTRY" in the description so it counted as an official entry.\n\n' +
      'The month closed with a live finale on March 29th at 16:00 UTC: a mystery-themed competition to test your detective knowledge, win great prizes, and have an amazing time with the community. Magnifying glass ready, clues followed, case solved.',
    websiteUrl: null,
    monthly: true,
    accent: 'var(--accent-rose)',
    emoji: '🐰',
    bannerUrl: '/events/march_2026.png',
  },
  january_event_2026: {
    eventType: 'january_event_2026',
    name: 'January Event',
    tagline: 'Cozy Game Event',
    description:
      'New-year energy, fresh starts, and lots of coziness to ease into 2026. 🎆 The Giveaways Club hosted a Cozy Game Event open to everyone.\n\n' +
      'To join, members created a Steam giveaway using the Steam "Cozy" tag and added "JANUARY EVENT ENTRY" in the description. Every entry that followed those steps was included.\n\n' +
      'The selection was drawn randomly and live on January 25th at 16:00 UTC on our Discord, alongside three special Bingo games — a follow-up to the popular December bingo. A month focused on cozy games, community, and a good time together.',
    websiteUrl: null,
    monthly: true,
    accent: 'var(--info)',
    emoji: '🎆',
  },
  november_event: {
    eventType: 'november_event',
    name: 'November Event',
    tagline: 'Month of the Unknown',
    description:
      'Month of the Unknown — a celebration of the hidden gems we only ever get to enjoy because we discovered them on SteamGifts. 💎\n\n' +
      'During November, members added one or more giveaways for a never-before-seen game† with at least 100 reviews rated "Positive" (mostly positive or higher), including "NOVEMBER EVENT ENTRY" in the description for our bot to pick up. Entries could start any time after November 1st 00:00 UTC and had to end before November 25th 00:00 UTC.\n\n' +
      'The raffle winner chose between a wishlisted game or a Fanatical mystery box (also unknown!), up to €30. Each eligible giveaway earned one entry. The live drawing was held November 29th, with an end-of-month Discord event full of minigames and surprises.\n\n' +
      '† A never-before-seen game is one never given on SteamGifts — games whose past giveaways drew fewer than 10 entries also counted. Giveaways created within the group, and DLCs, were ineligible.',
    websiteUrl: null,
    monthly: true,
    accent: 'var(--accent-purple)',
    emoji: '🧸',
  },
  october_event: {
    eventType: 'october_event',
    name: 'October Event',
    tagline: 'Halloween Time',
    description:
      'Spooky season at The Giveaways Club — a month of horror, prizes, and a whole patch of pumpkins. 🎃\n\n' +
      'To take part, members created an exclusive giveaway with a user-defined "Horror" tag (Survival Horror, Psychological Horror, etc. all counted) and added "OCTOBER EVENT" in the description so our bot could pick it up. Giveaways could start after the announcement (to allow day-one Steam Autumn Sale entries) but had to end in October.\n\n' +
      'When a giveaway ended and was activated by the winner, you got a code to crack open one of 100 pumpkins — each hiding a random game. The prize pool: 5 high-quality indies, 15 medium-quality indies, and 80 miscellaneous indies. One pumpkin per participant, limited to the first 100 eligible giveaways and claimable once the win was marked received.\n\n' +
      'More surprise pumpkins and scares happened on Discord, where the five high-quality indie winners were announced. The full list of possible games: https://justpaste.it/cjhoq',
    websiteUrl: null,
    monthly: true,
    accent: 'var(--warning)',
    emoji: '🎃',
    bannerUrl: '/events/october_2025.png',
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
    bannerUrl: '/events/june_2026.png',
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
  {
    slug: 'february-event-2026',
    name: 'February Event',
    tagline: 'Play & Complete · backlog Secret Santa',
    description:
      'Throughout February, The Giveaways Club hosts a community event to help members play their wins and enjoy their libraries together — Secret Santa style, but for playing games. 🎮\n\n' +
      "Each participant chooses a reasonable, playable game from another participant's backlog for them to play. The game must be a win from TGC or SG (or, if all wins are already played, a game from their Steam library), shouldn't be especially long or difficult, and it's one game per participant.\n\n" +
      'Complete the event by finishing the game or reaching 50% of its achievements. Players who complete the challenge earn a spin on the Wheel of Fortune and a place in the final games. Proof and coordination happen on Discord.',
    websiteUrl: null,
    kind: 'special',
    monthly: false,
    accent: 'var(--accent-rose)',
    emoji: '🎮',
    bannerUrl: '/events/february_2026.png',
    startTimestamp: Date.UTC(2026, 1, 1, 0) / 1000,
    endTimestamp: Date.UTC(2026, 1, 28, 16) / 1000,
    howToTitle: 'How to take part',
    howToContribute: [
      'Sign up on Discord (February 1–7)',
      'Get your assigned game on February 8',
      'Play it — one game per participant',
      'Finish it, or reach 50% of its achievements',
    ],
    rewardRule:
      'Complete the challenge to earn a spin on the Wheel of Fortune — with prizes — and a spot in the final games.',
    finale: {
      label: 'February 28',
      subtitle: 'Final games & Wheel of Fortune · 16:00 UTC',
      note: 'Finish your game or hit 50% achievements to spin the Wheel of Fortune and join the final games. Proof and coordination happen on our Discord server.',
      items: ['🎡 Wheel of Fortune', '🏆 Final games', '🎁 Prizes'],
    },
  },
  {
    slug: 'december-event-2025',
    name: 'December Event',
    tagline: 'Happy holidays · Secret Santa',
    description:
      "This Christmas we're not hosting an internal competitive event — instead, a heartfelt thank-you to everyone and a warm reminder of how fantastic this community is. 🎄\n\n" +
      "We're running a small Secret Santa for anyone who wants to join. The big day is December 21st, right in the middle of the Steam sales. Spend between €5 and €10 on your giftee, picking a game from their Steam wishlist — sent as a regular Steam gift or a region-appropriate key. Assignments go out one week in advance.\n\n" +
      'As a bonus, three lucky members are randomly chosen for a second Secret Santa surprise. 🎁 Enjoy the season, and most importantly — be happy and have fun!',
    websiteUrl: null,
    kind: 'special',
    monthly: false,
    accent: 'var(--accent-green)',
    emoji: '🎄',
    startTimestamp: Date.UTC(2025, 11, 1, 0) / 1000,
    endTimestamp: Date.UTC(2025, 11, 21, 12) / 1000,
    howToTitle: 'How to join the Secret Santa',
    howToContribute: [
      'Sign up on Discord (or reply to the announcement) with your region',
      'Get matched with your giftee one week before December 21',
      'Pick a game from their Steam wishlist (€5–€10)',
      'Send it as a Steam gift or a region-appropriate key',
    ],
    rewardRule:
      'As a bonus, three lucky members are randomly chosen for a second Secret Santa surprise. 🎁',
    finale: {
      label: 'December 21',
      subtitle: 'The big gift-exchange day',
      note: "Pick a game from your giftee's wishlist (€5–€10) and send it as a Steam gift or region key. Sign up on Discord and don't forget to share your region. 🎄",
      items: ['🎁 Gift exchange', '🎄 Holiday cheer', '✨ Bonus surprises'],
    },
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
