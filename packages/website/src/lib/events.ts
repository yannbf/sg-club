import type { Giveaway } from '@/types'

/**
 * Every event is declared here in the registry (GIVEAWAY_EVENT_META,
 * CHALLENGE_EVENTS, SPECIAL_EVENTS) — listings are built from the registry, not
 * from whatever tags happen to be in the data, so an unregistered tag never
 * produces an orphaned card/404.
 *
 * Which giveaways belong to an event is declared by its `match` rule
 * (`selectEventGiveaways`):
 *  - **Giveaway events** match by `event_type` tag (e.g. `rpg_august`).
 *  - **Special events** can match by an end-date window (`endsBetween`), e.g.
 *    the June anniversary counts every valid GA ending in calendar June.
 *  - **Challenge events** are standalone (not giveaway-backed), powered by a
 *    challenge data file (e.g. public/data/challenge_backpack_hero.json).
 *
 * How long an event lingers in "Happening now" after it ends is controlled by
 * `keepLiveForDays` / `keepLiveUntil` (`eventLingerUntil`).
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
   * Rule selecting which giveaways belong to this event. A (valid-ratio,
   * non-deleted) giveaway qualifies if it satisfies ANY provided sub-rule:
   *  - `eventType`: the giveaway carries this `event_type` tag.
   *  - `endsBetween`: the giveaway's end falls in [start, end).
   * This is the single source of truth for event membership — it replaces the
   * old split between tag-grouping and the special-event date window.
   */
  match?: {
    eventType?: string
    endsBetween?: { start: number; end: number }
  }
  /** Last year's comparison window for a community-goal event's record. */
  recordWindow?: { start: number; end: number; label: string }
  /**
   * How long the event keeps showing in "Happening now" after it would
   * otherwise stop being live — i.e. after its giveaway/date window closes, or
   * (for challenges) after a winner is recorded. `keepLiveForDays` is relative
   * to that moment; `keepLiveUntil` is an absolute unix-seconds override. The
   * later of the two wins. Omit both for no linger (the default).
   */
  keepLiveForDays?: number
  keepLiveUntil?: number
  /** Member testimonials (anniversary train). `author` is a SteamGifts username. */
  testimonials?: { author: string; text: string }[]
}

/**
 * A "valid ratio" giveaway is one that counts toward a member's contributor
 * value: public (not whitelist-only), not shared, full CV, and not a
 * decreased-ratio giveaway. Mirrors the rule used by <CvStatusIndicator/>.
 * Events only surface these so the lists and stats reflect real contributions.
 */
export function isValidRatioGiveaway(g: Giveaway): boolean {
  return (
    !g.is_shared &&
    !g.whitelist &&
    g.cv_status === 'FULL_CV' &&
    !g.decreased_ratio_info
  )
}

/**
 * The "date" ordering used by the giveaways page, shared so event pages list
 * giveaways in the same order. With `groupByStatus` (the "all statuses" view):
 * open giveaways first (upcoming ones leading, then by soonest end), ended
 * giveaways last (most recently ended first).
 */
export function compareGiveawaysByDate(
  a: Giveaway,
  b: Giveaway,
  now: number,
  sortDirection: 'asc' | 'desc' = 'asc',
  groupByStatus = true,
): number {
  const aIsEnded = a.end_timestamp < now
  const bIsEnded = b.end_timestamp < now
  if (groupByStatus && aIsEnded !== bIsEnded) return aIsEnded ? 1 : -1

  const aStartInFuture = a.start_timestamp > now
  const bStartInFuture = b.start_timestamp > now
  if (sortDirection === 'asc' && aStartInFuture !== bStartInFuture) {
    return aStartInFuture ? -1 : 1
  }

  const comparison =
    groupByStatus && aIsEnded && bIsEnded
      ? b.end_timestamp - a.end_timestamp
      : a.end_timestamp - b.end_timestamp
  return sortDirection === 'asc' ? comparison : -comparison
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
    // Keep it highlighted in "Happening now" for a week after the winner is
    // recorded, even though the challenge is already won.
    keepLiveForDays: 7,
  },
  {
    slug: 'gaming-challenge-2-kill-the-crows',
    name: 'Gaming Challenge #2 — Kill The Crows',
    description:
      'Our second community gaming challenge — a completion race! There’s no single winner this time: everyone who unlocks 100% of the achievements AND logs over 2 hours of play during the challenge (by the 30th of June) wins. Achievements earned before the challenge count too, so longtime fans can join in. The leaderboard records the exact moment each member hits 100%.',
    websiteUrl: null,
    kind: 'challenge',
    monthly: false,
    accent: 'var(--accent-rose)',
    emoji: '🐦‍⬛',
    imageUrl:
      'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2441270/header.jpg',
    challengeSlug: 'kill-the-crows',
    // Keep it highlighted in "Happening now" for a week after the deadline.
    keepLiveForDays: 7,
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
    // Any valid giveaway ending in calendar June 2026 counts; the record is
    // calendar June 2025's tally.
    match: {
      endsBetween: { start: Date.UTC(2026, 5, 1) / 1000, end: Date.UTC(2026, 6, 1) / 1000 },
    },
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
    testimonials: [
      {
        author: 'schmoan',
        text:
          'Thank you for this great recap of a wonderful year with TGC! It was really quite the ride and I am looking forward to many more happy memories and lovely people.\n\n' +
          "And while numbers clearly aren't the important part of this group, it is still interesting to see. Some of it is just mind boggling.\n\n" +
          'I am just very grateful to Gus for creating this group in the first place, and for all the great people who help run this show, be it as mods or members.\n' +
          'And of course a special thank you to you, Yann, for all the work you do and for coming up with these stats - and, more importantly, for being such a wonderful and positive person. 💖',
      },
      {
        author: 'Vin3',
        text:
          'One year?! Dang, time went by fast haha\n' +
          "I love this group to bits. But the main reason is not the giveaways, it's the people. It would not be the same -not even close- without our chats.\n" +
          "Thank you, gus, for accepting me into this group and to everybody I've talked to for being so nice ❤️\n" +
          'Love you all ❤️',
      },
      {
        author: 'QuinlanLJ',
        text:
          "I'm a sucker for some juicy stats. Thank you for bringing them to us! The group is amazing. I'm not a social butterfly in the group, I don't engage too much, but I try and contribute in any way I can, because this is a great group not just because the GA requirements are so damn good, but the people and the monthly themes and the incentive to play your wins make a greatly packaged group. It makes one want to give back. All I can say is keep it up to every one! It's been a great year.",
      },
      {
        author: 'Patzl',
        text:
          "It's truly an amazing group. Tons of quality games, and even more impressive: so many people who actually dive into them right away.\n\n" +
          "I'm mostly a quiet lurker on Discord, not always jumping into conversations, but whenever I do, I feel included. I also try to join every event, and the bingo events are definitely my favourites.\n\n" +
          "Thanks to all the people of TGC for an amazing, wholesome year - and here's to many more! :)",
      },
      {
        author: 'TempR',
        text:
          'The community honestly has been a highlight, even if I am often a quiet lurker. The members are really kind and generous folks and its cool to meet people with similar interests and hobbies, but also different lives and hobbies that are a lot of fun to learn about. The events, even if they may not necessarily all be ones I have much interest in, have all been really cool to watch unfold and see all the effort and creativity placed into them. Like, all the little games and little community get togethers are cool to see happen.\n\n' +
          "Even with so much going on all the time, its also a place that allows me to do something I find really really rare -- to breathe, relax, and take my time and be myself. There isn't any excess pressure beyond just being kind and enjoying yourself. People have been supportive, understanding and helpful as they can manage. And there seems a real effort to want to have the place be safe and welcoming. How often do we really find places like that, really?\n\n" +
          "Dunno. I've been out of the loop socially with most things. But, because of TGC, I've met and made friends I wouldn't have otherwise, and that means a lot.\n\n" +
          'Thank you to everyone who has made this place what it is\n' +
          'Thank you to all the friendly and warm-hearted people for giving me a chance to meet and know you\n' +
          'Thank you to all the moderators and contributors for all your efforts and time in building and keeping this place going',
      },
      {
        author: 'Ignition365',
        text:
          'Wonderful + hectic + chaos.\n\n' +
          "So wonderful to see so many people give and so many people play, but also I get to spend so much time sifting through data to track play (Eternally grateful for the internal app you've made)\n\n" +
          "Every month's end of month event is always so chaotic and fun, it's always something to look forward to at the end of each month. None of which would be possible without gus!\n\n" +
          'So much fun chatting with everyone on the discord day in and day out, and always thinking about those folks we loved chatting with who needed some time and space for themselves. Always take care of yourselves people.\n\n' +
          'Thanks for the camaraderie everyone!',
      },
      {
        author: 'damianea103',
        text:
          "Thank you to everyone for making this such a welcoming and enjoyable group to be a part of. I've had my ups and (mostly) downs over the past year which have caused me to lose some interest in SG, and gaming in general, but TGC has been there, in the background, keeping the flame still burning for me, hopefully until things settle down and i regain my passion. So thanks, once again, for being such a great group of people, all of you, especially those active in the discord, hopefully for many more years to come <3",
      },
      {
        author: 'yugimax',
        text:
          "I won't write much; I just want to say that I feel happy to be part of this group of misfits—in the best possible sense.\n" +
          'thx Gus, Herbesdeprovence, Ignition365, grampa Schmoan, yannbz and everyone else to make this group feel like a home and hope we have many years to come :)\n' +
          'Special thx to yannbz for all the status and infos, take me 1h to stop in each car to read all lol',
      },
      {
        author: 'Grogglz',
        text:
          "Thank you for the write up! I'm not allllways in Discord, and certainly most things about a complicated or themed event go right over my head, and WOW has this past one (IRL) been a year of.... mixed fortunes, but TGC is always poppin and always fun",
      },
    ],
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
  if (base)
    return {
      ...base,
      slug: eventTypeToSlug(eventType),
      kind: 'giveaway',
      match: { eventType },
    }
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
    match: { eventType },
  }
}

const DAY_SECONDS = 86400

/**
 * The moment an event stops being "live" in "Happening now", given its natural
 * end (a window closing or a challenge win) plus any linger config. The later
 * of `end + keepLiveForDays` and `keepLiveUntil` wins; with neither set it is
 * just `end` (no linger).
 */
export function eventLingerUntil(end: number, meta: EventMeta): number {
  return Math.max(
    end + (meta.keepLiveForDays ?? 0) * DAY_SECONDS,
    meta.keepLiveUntil ?? Number.NEGATIVE_INFINITY,
  )
}

/**
 * The giveaways belonging to an event per its `match` rule. A giveaway
 * qualifies when it is a valid-ratio, non-deleted GA AND satisfies any provided
 * sub-rule (tag or end-date window). Returns [] when the event has no rule.
 */
export function selectEventGiveaways(
  meta: EventMeta,
  giveaways: Giveaway[],
): Giveaway[] {
  const m = meta.match
  if (!m) return []
  return giveaways.filter((g) => {
    if (g.deleted || !isValidRatioGiveaway(g)) return false
    if (m.eventType && g.event_type === m.eventType) return true
    if (
      m.endsBetween &&
      g.end_timestamp >= m.endsBetween.start &&
      g.end_timestamp < m.endsBetween.end
    )
      return true
    return false
  })
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
  /**
   * True when the event's natural end has passed but it's still shown in
   * "Happening now" during its linger window — render an "Ended" badge instead
   * of "Live".
   */
  hasEnded?: boolean
  /** Challenge-only extras (filled by the page from the challenge data file). */
  participantCount?: number
  winnerUsername?: string | null
  /** Completion challenges: how many members have reached 100% (multiple winners). */
  winnerCount?: number
}

/**
 * Builds one summary per *registered* giveaway event (the keys of
 * GIVEAWAY_EVENT_META), with dates and aggregate stats, using each event's
 * `match` rule to pull its giveaways. Sorted most-recent first.
 *
 * Note: this is driven by the registry, not by whatever `event_type` tags
 * happen to be in the data. An unregistered tag therefore produces no card
 * (and no orphaned 404 page) — register it here to surface it.
 */
export function buildGiveawayEventSummaries(
  giveaways: Giveaway[],
  now: number = Date.now() / 1000,
): EventSummary[] {
  const summaries: EventSummary[] = []
  for (const eventType of Object.keys(GIVEAWAY_EVENT_META)) {
    const meta = getGiveawayEventMeta(eventType)
    const list = selectEventGiveaways(meta, giveaways)
    if (list.length === 0) continue
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
      now <= eventLingerUntil(endTimestamp, meta)
    // Past its real end but still lingering in "Happening now".
    const hasEnded =
      isOngoing && endTimestamp != null && now > endTimestamp

    summaries.push({
      meta,
      giveawayCount: list.length,
      totalCopies: list.reduce((s, g) => s + (g.copies ?? 1), 0),
      totalEntries: list.reduce((s, g) => s + (g.entry_count ?? 0), 0),
      uniqueCreators: creators.size,
      winnersCount,
      startTimestamp,
      endTimestamp,
      isOngoing,
      hasEnded,
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

  // Giveaway-window special events (e.g. the June challenge) count any valid
  // giveaway selected by the event's `match` rule.
  const giveawayCount =
    meta.match?.endsBetween && giveaways
      ? selectEventGiveaways(meta, giveaways).length
      : 0

  const isOngoing =
    start != null &&
    end != null &&
    now >= start &&
    now <= eventLingerUntil(end, meta)

  return {
    meta,
    giveawayCount,
    totalCopies: 0,
    totalEntries: 0,
    uniqueCreators: 0,
    winnersCount: 0,
    startTimestamp: start,
    endTimestamp: end,
    isOngoing,
    // Past its real end but still lingering in "Happening now".
    hasEnded: isOngoing && end != null && now > end,
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
