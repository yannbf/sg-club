# Plan: backfill "I Play Bro" submissions from the Steam forum thread and the archived Discord channel

## Context

Before the Discord forum channel existed, members proved they played a win by posting in the
Steam group discussion ["playtest here"](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/).
The `/verification` → *I Play Bro* tab only knows about Discord threads (`ipb_discord.json`), so
every forum-only submission shows as **Not submitted** even though the proof is public.

This is a one-time backfill. Every post from Metalhead8489's Carrion post
(comment `673976371230386113`, page 25) to the end of the thread (page 33, 482 comments as of
2026-09-11) was read. From now on only Discord submissions count; the forum is not re-scraped.

## What the pass found

| Bucket | Count |
|---|---|
| Comments after (and including) the Carrion post | 112 |
| Distinct group wins referenced with a giveaway link | 129 |
| … none carry the sheet's `i_played_bro` flag, so all 129 are pending I Play Bro verification | 129 |
| … of which 36 already passed a *Play Required* check (`requirements_met`), a separate verification | 36 |
| Wins already in `ipb_discord.json` (would collide) | 0 |
| Excluded: giveaways that are not group giveaways (invite-only event GAs by gus09) | 2 |
| Posts hidden by Steam's content check, content supplied by the poster and added | 2 |

Every poster was resolved to a SteamID64 via their profile URL and matched to the **winner of that
giveaway with the same SteamID** — for multi-copy giveaways (Carrion, Astrologaster, Detroit,
Hellblade II, Wigmund, Koira, Hades II, Duskfade, A Highland Song) only the poster's own copy is
included. No post claimed a win belonging to someone else.

Seed data: [`packages/scraper/data/ipb-steam-forum.json`](packages/scraper/data/ipb-steam-forum.json)
— 129 entries keyed `<steamId>::<giveawayLink>`, each with the comment permalink, poster name,
game name and post time (Steam shows anonymous viewers Pacific time; converted to UTC).

## Design

Keep one verification-submission file and one row type; add a `source` discriminator.

1. **Types** (`packages/scraper/src/types/ipb-discord.ts`, `packages/website/src/types/ipb-discord.ts`)
   - `IpbDiscordWinEntry.source?: 'discord' | 'steam_forum'` — absent means `discord`, so the
     committed JSON and existing tests stay valid.
   - `matched_by` gains `'steam_forum'`.
   - Field reuse for forum entries: `thread_id` = Steam comment id, `url` = comment permalink,
     `thread_name` = game name, `owner_discord_name` = Steam display name of the poster,
     `thread_created_at` = post time. Document the mapping in the type comments.

2. **Generator** (`packages/scraper/src/scripts/generate-ipb-discord-data.ts`)
   - After Discord matching, load `data/ipb-steam-forum.json` and merge its `wins` into the
     output map. A Discord entry for the same key wins (it is the newer, canonical submission).
   - `win_flagged` for forum entries is computed with the same `findCandidateWin` lookup, so the
     pending/verified split works unchanged.
   - Log the merged count in the summary line.
   - No new CI step: the `verification` job already runs `ipb-discord` and commits
     `ipb_discord.json` + `packages/scraper/data/`.

3. **Row model** (`packages/website/src/lib/beaten.ts`) — `ipbStatus` keys on `i_played_bro` only:
   `verified` when the sheet's IPB tab flag is set, `submitted` when a submission (Discord or forum)
   exists without it, `not_submitted` otherwise. Play Required `requirements_met` no longer counts as
   I Play Bro verified; the two are separate verifications. The generator's `win_flagged` follows the
   same rule.

4. **UI** (`packages/website/src/app/verification/PlayRequiredClient.tsx`)
   - `LinksCell` and `SignOffCell`: when `source === 'steam_forum'` render a **Steam** link
     (Steam-styled colour, external-link icon) instead of the Discord link, pointing at the comment
     permalink so the reviewer opens the actual post.
   - Verify call: send `discordThreadId` only when `source !== 'steam_forum'` so the API doesn't
     try to react on a Steam comment id (`verify.ts` treats a missing id as `discord: 'skipped'`).
   - Optional: a small "Steam" filter chip next to the existing cards; skip unless it is cheap.

5. **Verify API** (`packages/website/api/verify.ts`) — no change needed beyond the client guard.

5b. **User win page** (`packages/website/src/app/users/[username]/WonGiveawaysClient.tsx`) — a win
   with a submission but no `i_played_bro` flag shows an amber "I played, bro — pending verification"
   badge linking to the submission (Discord thread or Steam post). Once a mod verifies it in the sheet
   the existing green badge takes over. The server page passes the user's own submissions down.

6. **Tests**
   - `beaten.test.ts`: a `steam_forum` entry yields `submitted` / `verified` like a Discord one.
   - Generator: merge keeps a Discord entry over a forum entry for the same key; forum-only keys
     are added with `win_flagged` derived from the sheet flags.
   - `verify.test.ts`: request without `discordThreadId` still verifies and reports
     `discord: 'skipped'`.

7. **Rollout**
   - Run `pnpm --filter scraper ipb-discord` locally (needs `DISCORD_BOT_TOKEN`) to regenerate
     `ipb_discord.json` with the merged entries and check the *I Play Bro* tab shows 129 new
     **Submitted** rows with Steam links.
   - Mods then verify rows from the site as usual; verifying writes the IPB sheet tab, after which
     `win_flagged` flips and the row becomes **Verified**.

## Second legacy source: the archived Discord channel

Before the forum-thread channel, members posted in the `i-play-bro-archive` text channel
(`1385400003127803995`). Every message after the last verified report
([message 1460313124178624703](https://discord.com/channels/1385346341848350810/1385400003127803995/1460313124178624703),
12 Jan 2026) up to the channel's last message (1 Jun 2026) was swept with the bot token.

| Bucket | Count |
|---|---|
| Messages after the last verified report | 146 |
| Group wins matched (poster resolved via the Discord handle map, giveaway or store link matched to their own win) | 97 |
| … already flagged `i_played_bro` or already in the list | 0 |
| Skipped: not group giveaways (Discord key-drop gifts, Secret Santa, invite-only or whitelist GAs) | 11 |
| Skipped: replies, quotes and follow-ups with no link | 38 |

Seed data: [`packages/scraper/data/ipb-discord-archive.json`](packages/scraper/data/ipb-discord-archive.json),
same entry shape as the forum seed, `source: 'discord'`, `url` = message permalink. Both seeds are
merged by the generator; a live Discord-thread match wins on any key collision, then the forum seed,
then the archive seed.

The 12 skipped messages that carried a link are listed on the verification page under
"Unmatched submissions that need extra verification" (from the seed's `unmatched` list):
- Jztr, STAR WARS Jedi: Fallen Order (16 Jan) — no giveaway link and Jztr is not a winner of the linked giveaway's copies.
- VinroyIsViral, Assassin's Creed Origins (7 Feb) — store link only; no matching group win.
- Vin3: Amanda the Adventurer, Frog Detective 1 & 2, EMPTY SHELL, XIII, Papetura — Discord key drops or non-group giveaways.
- DanielStoSve, God of War (15 Jan) — Discord key-drop event.
- Sakakino, ENDER LILIES (18 Feb) — Secret Santa.
- Thexder, Wonderputt Forever (`JBBQS`); SoullessSoup, Astroneer (`6s8vg`); vampiresska, COCOON (`rEk42`) — not group giveaways.

## Decisions

- **Play Required vs I Play Bro are separate.** The 36 rows that passed a Play Required check are
  still pending I Play Bro; they are included.
- **Ex-member rows** (insideAfireball ×5, UnknownEAK ×5, TexWilleri ×2, AllTracTurbo ×1): kept,
  hidden behind the existing "show ex-members" toggle.

## Out of scope / not recoverable

- Blue Prince (`4PPt2`) by PoeticKatana and Alone in the Dark (`cOUeZ`) by vot4ol: invite-only
  event giveaways created by gus09, not group giveaways, so they have no win in the site data.
  [Post](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=30#c806849643178666734) ·
  [Post](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=30#c838375062933513865)
- Two Metalhead8489 posts are stuck in Steam's "awaiting analysis" state and show no content to
  other viewers; the poster supplied their content (One-Eyed Likho, 27 May 2026; Gorogoa, 16 Aug 2026)
  and both are in the seed file with their comment permalinks.

## Appendix A — 93 wins pending, no other verification

| Poster | Game | Giveaway | Playtime / achievements | Forum post |
|---|---|---|---|---|
| Metalhead8489 | CARRION | Bunwq/carrion | 6 hours 20 minutes / 100% ach | [20 Oct, 2025 3:18pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=25#c673976371230386113) |
| RePlay.be (SG: RePlayBe) | The Medium | Wewko/the-medium | 13 hours 34 minutes / 89.7% ach | [22 Oct, 2025 7:50am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=25#c601918959991738947) |
| rufioh32 (SG: rufioh) | FISH FEAR ME | Sz9gt/fish-fear-me | 16 hours 20 minutes / 35.1% ach | [22 Oct, 2025 2:47pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=25#c601918959991764012) |
| insideAfireball · ex-member | Mouthwashing | ujWUc/mouthwashing | 5 hours 11 minutes / 88.9% ach | [23 Oct, 2025 12:46am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=26#c601918959991797344) |
| MrOuiOui | COCOON | MBiIb/cocoon | 4 hours 49 minutes / 76.5% ach | [23 Oct, 2025 7:52am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=26#c601918959991844977) |
| Metalhead8489 | Still Wakes the Deep | hlGQm/still-wakes-the-deep | 14 hours 39 minutes / 100% ach | [24 Oct, 2025 2:00pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=26#c601918959991978403) |
| insideAfireball · ex-member | Beyond Hanwell | WKEKg/beyond-hanwell | 14 hours 31 minutes / 100% ach | [29 Oct, 2025 1:41am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=26#c667221787907490016) |
| Makki | Dead Space | mCzgs/dead-space | 28 hours 47 minutes / 83% ach | [4 Nov, 2025 9:36am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=26#c725769023703406032) |
| ithamore | The Library of Babel | KXxPT/the-library-of-babel | 16 hours 49 minutes / 74.3% ach | [4 Nov, 2025 3:49pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=26#c659341126368495049) |
| Stephen Hawkingmeister (SG: Hawkingmeister) | Onimusha: Warlords | Y0mFW/onimusha-warlords | 23 hours 25 minutes / 94.5% ach | [7 Nov, 2025 3:08am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=26#c659341126368745296) |
| Stephen Hawkingmeister (SG: Hawkingmeister) | Darkblade Ascent | tISOX/darkblade-ascent | 12 hours 25 minutes / 83.3% ach | [7 Nov, 2025 3:08am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=26#c659341126368745296) |
| insideAfireball · ex-member | JoJo's Bizarre Adventure: All-Star Ba... | 2xC8O/jojos-bizarre-adventure-all-star-battle-r | 30 hours 53 minutes / 100% ach | [7 Nov, 2025 7:53pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=26#c659341126368804796) |
| MrOuiOui | 103 | f9vcO/103 | 1 hour 15 minutes / 80% ach | [8 Nov, 2025 4:21am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=26#c659341126368869177) |
| Metalhead8489 | Ys I & II Chronicles+ | loJYz/ys-i-ii-chronicles | 15 hours 33 minutes / 100% ach | [11 Nov, 2025 2:02pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=26#c659341490666136515) |
| Makki | Strange Jigsaws | UGNMi/strange-jigsaws | 6 hours 20 minutes / 100% ach | [15 Nov, 2025 4:15pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=27#c680733951028163458) |
| UnknownEAK · ex-member | Tangle Tower | iqY11/tangle-tower | 8 hours 46 minutes / 100% ach | [16 Nov, 2025 11:10pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=27#c680734305648928388) |
| UnknownEAK · ex-member | Buckshot Roulette | sdLKb/buckshot-roulette | 12 hours 55 minutes / 100% ach | [16 Nov, 2025 11:10pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=27#c680734305648928388) |
| UnknownEAK · ex-member | Alisa | TFjDC/alisa | 20 hours 40 minutes / 100% ach | [16 Nov, 2025 11:10pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=27#c680734305648928388) |
| UnknownEAK · ex-member | Crow Country | 04241/crow-country | 47 hours 11 minutes / 100% ach | [16 Nov, 2025 11:10pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=27#c680734305648928388) |
| UnknownEAK · ex-member | Lost in Random | KDJOV/lost-in-random | 50 hours 49 minutes / 100% ach | [16 Nov, 2025 11:10pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=27#c680734305648928388) |
| vot4ol | Lost But Found | MGIhA/lost-but-found | 10 hours 24 minutes / 95.7% ach | [19 Nov, 2025 4:33pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=27#c687489892274465325) |
| vot4ol | Dustborn | QAoxi/dustborn | 17 hours 56 minutes / 84.6% ach | [19 Nov, 2025 4:33pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=27#c687489892274465325) |
| vot4ol | Bramble: The Mountain King | Fq2P7/bramble-the-mountain-king | 10 hours 34 minutes / 100% ach | [19 Nov, 2025 4:33pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=27#c687489892274465325) |
| vot4ol | Hidden Shapes - Cat Realm | 0rhhl/hidden-shapes-cat-realm | 4 hours 36 minutes / 100% ach | [5 Dec, 2025 1:30pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=27#c689743223076163034) |
| MrOuiOui | UNCHARTED: Legacy of Thieves Collection | Fe8oz/uncharted-legacy-of-thieves-collection | 22 hours 23 minutes / 27.7% ach | [4 Jan 11:50am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=27#c686368182958609514) |
| ev (SG: eeev) | Wilmot Works It Out | GN2ZK/wilmot-works-it-out | 7 hours 16 minutes / 88% ach | [4 Jan 1:58pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=27#c686368182958619369) |
| Metalhead8489 | The Legend of Heroes: Trails of Cold ... | 2ux2y/the-legend-of-heroes-trails-of-cold-steel-ii | 20 hours 52 minutes / 7.8% ach | [4 Jan 2:28pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=27#c686368182958621124) |
| Makki | Spilled! | rqtcz/spilled | 1 hour 3 minutes / 100% ach | [7 Jan 11:41am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=27#c684116632207945365) |
| Orionid | Astrologaster | VF4W1/astrologaster | 1 hour 3 minutes / 100% ach | [8 Jan 6:10am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=27#c684116726010382951) |
| DoubleOMURFY | Slay the Princess — The Pristine Cut | y5fUs/slay-the-princess-the-pristine-cut | 7 hours 52 minutes / 20.6% ach | [13 Jan 10:00am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=28#c684117136054012933) |
| Bronadui (SG: LightningCount) | Marvel’s Spider-Man Remastered | 9CTj4/marvels-spider-man-remastered | 21 hours 26 minutes / 48.7% ach | [16 Jan 10:40am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=28#c734782866781754116) |
| vot4ol | Detroit: Become Human | YAl6F/detroit-become-human | 26 hours 44 minutes / 100% ach | [22 Jan 7:59pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=28#c685243980153107257) |
| Metalhead8489 | Onimusha: Warlords | ucrAs/onimusha-warlords | 7 hours 56 minutes / 85.5% ach | [23 Jan 3:59am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=28#c685243980153128469) |
| Makki | Hidden Through Time | jZU7K/hidden-through-time | 4 hours 19 minutes / 89.5% ach | [23 Jan 10:32am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=28#c685243980153157394) |
| Metalhead8489 | Pilo and the Holobook | sreFi/pilo-and-the-holobook | 4 hours 35 minutes / 100% ach | [24 Jan 1:38pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=28#c685243980153245610) |
| -TexWiller- (SG: TexWilleri) · ex-member | The Medium | sTNPH/the-medium | 9 hours 51 minutes / 100% ach | [26 Jan 12:48am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=28#c685243980153353023) |
| -TexWiller- (SG: TexWilleri) · ex-member | Hollow Knight: Silksong | zUI5T/hollow-knight-silksong | 111 hours 9 minutes / 61.5% ach | [26 Jan 1:42am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=28#c685243980153355773) |
| Xan (SG: DrTenma) | Teddy's Haven - A Fantasy Inspired Sh... | 5tG8F/teddys-haven-a-fantasy-inspired-shop-simulator | 19 hours 59 minutes / 84.4% ach | [27 Jan 9:29am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=28#c685244313961047650) |
| Metalhead8489 | One-Eyed Likho | v7PSW/one-eyed-likho | 7 hours 42 minutes / 100% ach | [27 May 4:05pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=31#c655981814410722450) |
| Metalhead8489 | Gorogoa | 4z2uu/gorogoa | 2 hours 41 minutes / 100% ach | [16 Aug 4:03am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=32#c588435120315247600) |
| Makki | Hauntii | Euio3/hauntii | 17 hours 34 minutes / 100% ach | [30 Jan 10:07am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=29#c731406330847491271) |
| PoeticKatana | ASTRONEER | GNgMO/astroneer | 73 hours 25 minutes / 85.7% ach | [3 Feb 4:18pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=29#c762932162500496265) |
| DoubleOMURFY | Please, Touch The Artwork | UOSPZ/please-touch-the-artwork | 3 hours 52 minutes / 100% ach | [12 Feb 8:52am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=29#c756177397086281329) |
| VenomousNyx | Senua’s Saga: Hellblade II | nziDb/senuas-saga-hellblade-ii | 22 hours 50 minutes / 100% ach | [12 Feb 11:11pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=29#c785450979403252242) |
| DoubleOMURFY | THRESHOLD | SE1hr/threshold | 4 hours 43 minutes / 100% ach | [13 Feb 2:14am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=29#c785450979403259661) |
| rufioh32 (SG: rufioh) | A Game About Digging A Hole | Jk41u/a-game-about-digging-a-hole | 6 hours 43 minutes / 60% ach | [20 Feb 10:21am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=29#c766311130382734670) |
| Xan (SG: DrTenma) | Doloc Town | H8Mq0/doloc-town | 20 hours 45 minutes / 18.8% ach | [21 Feb 6:43am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=29#c766311130382796802) |
| Orionid | Senua’s Saga: Hellblade II | cXK9L/senuas-saga-hellblade-ii | 7 hours 31 minutes / 91.7% ach | [23 Feb 4:42pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=29#c766311475521461916) |
| AllTracTurbo · ex-member | Hogwarts Legacy | Gbj8P/hogwarts-legacy | 87 hours 35 minutes / 77.8% ach | [25 Feb 5:16am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=29#c766311764553939479) |
| Bronadui (SG: LightningCount) | Lil' Guardsman | Grbf6/lil-guardsman | 8 hours 46 minutes / 58.3% ach | [28 Feb 5:10am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=29#c766311764554248170) |
| MrOuiOui | Alone in the Dark | aAoPl/alone-in-the-dark | 8 hours 27 minutes / 63.2% ach | [4 Mar 4:11pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=29#c804592995637737947) |
| Makki | The Last Case of John Morley | T305K/the-last-case-of-john-morley | 3 hours 51 minutes / 81.8% ach | [8 Mar 9:57am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=29#c804593328318412625) |
| Atro | SIGNALIS | 3KIdG/signalis | 10 hours 34 minutes / 100% ach | [11 Mar 11:33am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=30#c798964126635332269) |
| Orionid | DOOM: The Dark Ages | 2QIgh/doom-the-dark-ages | 23 hours 47 minutes / 71.1% ach | [22 Mar 10:06am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=30#c806846367620292078) |
| VenomousNyx | Depth of Extinction | mEvsI/depth-of-extinction | 47 hours 41 minutes / 100% ach | [23 Mar 7:18pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=30#c806846367620456297) |
| DoubleOMURFY | Lil' Guardsman | bLQst/lil-guardsman | 15 hours 4 minutes / 56.3% ach | [4 Apr 9:02am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=30#c806847640195068283) |
| Orionid | inbento | S4T30/inbento | 1 hour 9 minutes / 100% ach | [11 Apr 8:13pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=30#c806848332664153159) |
| insideAfireball · ex-member | Age of Mythology: Retold | kJiX2/age-of-mythology-retold | 3 hours 40 minutes / 3.8% ach | [21 Apr 12:38pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=30#c805723292794135842) |
| Metalhead8489 | Tangle Tower | hLWVI/tangle-tower | 6 hours 38 minutes / 100% ach | [25 Apr 2:44pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=30#c806849453058298659) |
| PoeticKatana | Storyteller | aj0hb/storyteller | 4 hours 32 minutes / 100% ach | [26 Apr 1:25pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=30#c806849643178666734) |
| PoeticKatana | Arco | mu3D7/arco | 27 hours 25 minutes / 87% ach | [26 Apr 1:25pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=30#c806849643178666734) |
| DoubleOMURFY | Mindcop | xEKmx/mindcop | 9 hours 32 minutes / 56.3% ach | [29 Apr 10:33am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=30#c838375062933400093) |
| Makki | Radiolight | klFCr/radiolight | 4 hours 54 minutes / 81.8% ach | [3 May 12:52pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=30#c838375444718877239) |
| Makki | BALL x PIT | JJxC6/ball-x-pit | 57 hours 46 minutes / 100% ach | [3 May 12:52pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=30#c838375444718877239) |
| Makki | Boomerang X | xndj0/boomerang-x | 5 hours 52 minutes / 48.3% ach | [4 May 6:08am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=30#c838375444718936049) |
| Chibi (SG: quinnix) | Catto's Post Office | lU5MA/cattos-post-office | 1 hour 26 minutes / 100% ach | [7 May 8:59am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=31#c838375696283891046) |
| Chibi (SG: quinnix) | Tangle Tower | pmrFq/tangle-tower | 6 hours 4 minutes / 100% ach | [7 May 8:59am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=31#c838375696283891046) |
| Chibi (SG: quinnix) | When The Past Was Around | TIzer/when-the-past-was-around | 2 hours / 100% ach | [7 May 8:59am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=31#c838375696283891046) |
| DoubleOMURFY | Viewfinder | jw611/viewfinder | 9 hours 34 minutes / 100% ach | [7 May 9:31am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=31#c838375696283893585) |
| Makki | Planet of Lana II | Ya6rS/planet-of-lana-ii | 7 hours 41 minutes / 64% ach | [7 May 11:47am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=31#c838375696283904781) |
| Makki | Card Shark | y9XdP/card-shark | 19 hours 22 minutes / 94.2% ach | [10 May 1:27am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=31#c838375928581205345) |
| DoubleOMURFY | Gunbrella | Y65Pa/gunbrella | 14 hours 12 minutes / 83.3% ach | [21 May 5:32pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=31#c844006470562505121) |
| DoubleOMURFY | Shape of Dreams | vMA0B/shape-of-dreams | 16 hours 19 minutes / 16.5% ach | [30 May 1:25pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=31#c655982159560980847) |
| vot4ol | Projected Dreams | jnLrl/projected-dreams | 4 hours 28 minutes / 100% ach | [31 May 2:07am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=31#c655982159561030041) |
| vot4ol | Wigmund | lHdre/wigmund | 17 hours 8 minutes / 100% ach | [10 Jun 12:16pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=31#c573792389464918596) |
| DoubleOMURFY | Neva | yVohx/neva | 7 hours 24 minutes / 100% ach | [12 Jun 1:14pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=31#c573792389465120272) |
| DoubleOMURFY | Gambonanza | Fj7ba/gambonanza | 6 hours 4 minutes / 22.6% ach | [19 Jun 5:04pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=31#c570415324159329649) |
| DoubleOMURFY | Manifold Garden | joflP/manifold-garden | 8 hours 22 minutes / 84% ach | [19 Jun 5:08pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=31#c570415324159329879) |
| Makki | Kena: Bridge of Spirits | G59bp/kena-bridge-of-spirits | 15 hours 14 minutes / 70.7% ach | [11 Jul 4:38am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=31#c580550507183059796) |
| DoubleOMURFY | ENDER MAGNOLIA: Bloom in the Mist | CPSae/ender-magnolia-bloom-in-the-mist | 19 hours 27 minutes / 47.5% ach | [13 Jul 6:58am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=32#c580550781202119981) |
| Makki | Cult of the Lamb | FjmF6/cult-of-the-lamb | 12 hours 58 minutes / 52.6% ach | [16 Jul 3:01am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=32#c571543760192773830) |
| Makki | FINAL FANTASY IX | ycGpf/final-fantasy-ix | 63 hours 15 minutes / 90.6% ach | [27 Jul 12:09pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=32#c590684983954467572) |
| Makki | MOUSE: P.I. For Hire | Pvwk8/mouse-pi-for-hire | 27 hours 9 minutes / 100% ach | [16 Aug 4:11am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=32#c588435120315248057) |
| Xan (SG: DrTenma) | Solasta: Crown of the Magister | 21gND/solasta-crown-of-the-magister | 15 hours 4 minutes / 20.5% ach | [16 Aug 9:21am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=32#c588435120315269643) |
| Xan (SG: DrTenma) | Gothic 1 Remake | qDCRq/gothic-1-remake | 41 hours 35 minutes / 40.5% ach | [16 Aug 9:21am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=32#c588435120315269643) |
| Metalhead8489 | Mina the Hollower | JxA43/mina-the-hollower | 42 hours 35 minutes / 72% ach | [18 Aug 8:40am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=32#c588435120315441587) |
| Kalimero (SG: OndrejVasicek) | Outer Wilds | yBt9a/outer-wilds | 37 hours 29 minutes / 29% ach | [21 Aug 8:04am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=32#c586183630899100251) |
| Kalimero (SG: OndrejVasicek) | Resident Evil Village | CRTyZ/resident-evil-village | 32 hours 33 minutes / 46.4% ach | [21 Aug 9:30am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=32#c586183630899105800) |
| vot4ol | Escape Machine City: Airborne | vVCu3/escape-machine-city-airborne | 1 hour 13 minutes / 100% ach | [23 Aug 1:04pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=32#c586183940257225228) |
| PoeticKatana | Hades II | rVqdW/hades-ii | 121 hours 7 minutes / 100% ach | [27 Aug 12:53am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=32#c588436064418527014) |
| PoeticKatana | Hohokum | DnDIo/hohokum | 7 hours 46 minutes / 91.7% ach | [27 Aug 12:53am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=32#c588436064418527014) |
| Makki | Servant of the Lake | Cj0Bf/servant-of-the-lake | 8 hours 17 minutes / 100% ach | [29 Aug 8:50am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=32#c588436355615341313) |
| Kalimero (SG: OndrejVasicek) | The Alters | 04BRa/the-alters | 44 hours 15 minutes / 50.8% ach | [30 Aug 8:25am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=32#c588436355615425207) |

## Appendix B — 36 wins pending I Play Bro that already passed Play Required

| Poster | Game | Giveaway | Playtime / achievements | Forum post |
|---|---|---|---|---|
| AllTracTurbo · ex-member | ELDEN RING | 6bAih/elden-ring | 170 hours 4 minutes / 66.7% ach | [21 Oct, 2025 3:18am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=25#c673976371230430639) |
| rufioh32 (SG: rufioh) | Detroit: Become Human | brU3r/detroit-become-human | 13 hours 53 minutes / 64.6% ach | [22 Oct, 2025 2:46pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=25#c601918959991764005) |
| TheJumboOne (SG: mathisgreat) | Sea of Stars | pGXxc/sea-of-stars | 34 hours 18 minutes / 77.8% ach | [24 Oct, 2025 11:46pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=26#c601918959992009286) |
| Makki | METAL GEAR SOLID Δ: SNAKE EATER | cX2Q6/metal-gear-solid-d-snake-eater | 30 hours 10 minutes / 80% ach | [30 Oct, 2025 4:51pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=26#c725768672857158217) |
| Bronadui (SG: LightningCount) | FINAL FANTASY X/X-2 HD Rema... | KWn9J/final-fantasy-xx-2-hd-remaster | 57 hours 16 minutes / 20.3% ach | [31 Oct, 2025 4:31pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=26#c725768672857262076) |
| Russell (SG: RussellCZ) · ex-member | Days Gone | HDHEv/days-gone | 43 hours 25 minutes / 41.8% ach | [3 Nov, 2025 4:18pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=26#c725769023703326953) |
| ruslan-k (SG: philipdick) · ex-member | SIGNALIS | lC08w/signalis | 11 hours 57 minutes / 53.8% ach | [8 Nov, 2025 6:29pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=26#c659341490665823215) |
| Atro | Hollow Knight: Silksong | 5tm7d/hollow-knight-silksong | 103 hours 41 minutes / 100% ach | [14 Nov, 2025 7:07am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=27#c680733951028022227) |
| Orionid | Hollow Knight: Silksong | lEARS/hollow-knight-silksong | 14 hours 16 minutes / 19.2% ach | [16 Nov, 2025 3:39am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=27#c680733951028221540) |
| Atro | Whisper of the House | Neds2/whisper-of-the-house | 7 hours 31 minutes / 100% ach | [25 Nov, 2025 3:02pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=27#c687490430047148772) |
| Metalhead8489 | Dying Light 2 Stay Human: Reloaded Ed... | 4a4gX/dying-light-2-stay-human-reloaded-edition | 23 hours 17 minutes / 24.6% ach | [28 Nov, 2025 3:32pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=27#c690868475627855769) |
| vot4ol | Wavetale | lrqfE/wavetale | 4 hours 42 minutes / 100% ach | [5 Dec, 2025 1:30pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=27#c689743223076163034) |
| Xan (SG: DrTenma) | Keep Driving | H5fHj/keep-driving | 6 hours 53 minutes / 41.2% ach | [4 Jan 10:57am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=27#c686368182958605640) |
| MrOuiOui | Silly Polly Beast | tjlcw/silly-polly-beast | 7 hours 13 minutes / 65.6% ach | [5 Jan 9:07am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=27#c686368182958679295) |
| DrBeckett | Ratchet & Clank: Rift Apart | YoS0o/ratchet-clank-rift-apart | 23 hours 37 minutes / 100% ach | [10 Jan 6:53pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=28#c684116795952649450) |
| insideAfireball · ex-member | The Pathless | tkXVV/the-pathless | 24 hours 40 minutes / 100% ach | [14 Jan 10:48pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=28#c734782866781643513) |
| DoubleOMURFY | Is This Seat Taken? | YNepN/is-this-seat-taken | 8 hours 59 minutes / 100% ach | [17 Jan 12:39pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=28#c734782866781834680) |
| PoeticKatana | Minami Lane | 7u0t5/minami-lane | 4 hours 14 minutes / 100% ach | [23 Jan 10:58am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=28#c685243980153159301) |
| Bainsol | ASTRONEER | hgI0B/astroneer | 17 hours 10 minutes / 10.7% ach | [24 Jan 2:23pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=28#c685243980153247990) |
| Makki | Pine Hearts | 2PJM0/pine-hearts | 4 hours 31 minutes / 94.6% ach | [27 Jan 3:51pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=28#c731406330847299511) |
| Metalhead8489 | The Artful Escape | 60pLK/the-artful-escape | 5 hours 7 minutes / 100% ach | [3 Feb 4:47am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=29#c731406598414810707) |
| MrOuiOui | The Pathless | uvlsU/the-pathless | 11 hours 35 minutes / 86% ach | [16 Feb 4:18am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=29#c785450979403540475) |
| VenomousNyx | Isles of Sea and Sky | FKg0p/isles-of-sea-and-sky | 19 hours / 61.9% ach | [16 Feb 2:27pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=29#c785451333487429838) |
| Metalhead8489 | Lies of P | lgIq0/lies-of-p | 55 hours 23 minutes / 75.5% ach | [11 Mar 3:31pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=30#c798964126635352330) |
| DoubleOMURFY | Sea of Stars | TeZXk/sea-of-stars | 88 hours 7 minutes / 90.7% ach | [14 Mar 8:21am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=30#c798964455929029736) |
| MrOuiOui | Slay the Princess — The Pristine Cut | KNJgj/slay-the-princess-the-pristine-cut | 10 hours 43 minutes / 67.9% ach | [12 Apr 5:54pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=30#c806848332664236017) |
| Chibi (SG: quinnix) | A Highland Song | VdFHc/a-highland-song | 7 hours 8 minutes / 47.2% ach | [7 May 8:59am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=31#c838375696283891046) |
| vot4ol | Still Wakes the Deep | dTO7K/still-wakes-the-deep | 6 hours 33 minutes / 50.8% ach | [25 May 11:31am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=31#c844006988894444100) |
| Metalhead8489 | Crimson Desert | PvPiW/crimson-desert | 60 hours 16 minutes / 11.8% ach | [25 Jun 3:14pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=31#c565912359497014633) |
| vot4ol | The Talos Principle 2 | aITya/the-talos-principle-2 | 29 hours 19 minutes / 60.9% ach | [19 Jul 7:58pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=32#c571544064825129461) |
| Metalhead8489 | Koira | OE5mq/koira | 4 hours 43 minutes / 100% ach | [28 Jul 12:49pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=32#c590685251875959047) |
| vot4ol | The House of Da Vinci 2 | VWBjg/the-house-of-da-vinci-2 | 4 hours 2 minutes / 100% ach | [23 Aug 1:04pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=32#c586183940257225228) |
| PoeticKatana | Neva | 5veuO/neva | 5 hours 14 minutes / 100% ach | [27 Aug 12:53am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=32#c588436064418527014) |
| PoeticKatana | Mina the Hollower | oEs0E/mina-the-hollower | 45 hours 38 minutes / 60% ach | [27 Aug 12:53am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=32#c588436064418527014) |
| Metalhead8489 | Duskfade | Fsazo/duskfade | 26 hours 7 minutes / 100% ach | [30 Aug 1:23pm](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=33#c588436355615446020) |
| Metalhead8489 | NINJA GAIDEN: Ragebound | p3wZW/ninja-gaiden-ragebound | 11 hours 44 minutes / 61.1% ach | [7 Sep 3:26am](https://steamcommunity.com/groups/TheGiveawaysClub/discussions/1/597404744772814603/?ctp=33#c588437021425583792) |

## Appendix C — 97 wins from the archived Discord channel, pending I Play Bro

| Poster | Game | Giveaway | Playtime / achievements | Discord message |
|---|---|---|---|---|
| damianea103 (SG: damianea103) | Chants of Sennaar | GyLLW/chants-of-sennaar | 12 hours 31 minutes / 100% ach | [2026-01-13](https://discord.com/channels/1385346341848350810/1385400003127803995/1460706829561626785) |
| shofuking (SG: TwixClub) | BALL x PIT | aGeHO/ball-x-pit | 24 hours 12 minutes / 63.5% ach | [2026-01-14](https://discord.com/channels/1385346341848350810/1385400003127803995/1460985603536584845) |
| legolas0041 (SG: mourinhos86(EX)) | Many Nights a Whisper | oHf9d/many-nights-a-whisper | 3 hours 36 minutes / 100% ach | [2026-01-15](https://discord.com/channels/1385346341848350810/1385400003127803995/1461201913986158734) |
| notvini (SG: Vini1) | Days Gone | A1QCm/days-gone | 53 hours 11 minutes / 67.2% ach | [2026-01-15](https://discord.com/channels/1385346341848350810/1385400003127803995/1461347554175488143) |
| tikkachanceonme (SG: SunnySideVp) | Hades | gVX47/hades | 14 hours 59 minutes / 57.1% ach | [2026-01-16](https://discord.com/channels/1385346341848350810/1385400003127803995/1461630942698410088) |
| puninup (SG: puninup) | Detroit: Become Human | vFkSK/detroit-become-human | 29 hours 12 minutes / 100% ach | [2026-01-17](https://discord.com/channels/1385346341848350810/1385400003127803995/1461890319724314737) |
| soullesssoup (SG: SoullessSoup) | Distant Bloom | e0HH7/distant-bloom | 11 hours 56 minutes / 100% ach | [2026-01-21](https://discord.com/channels/1385346341848350810/1385400003127803995/1463628886154678461) |
| thexder. (SG: Thexder) | The Evil Within 2 | N0eBD/the-evil-within-2 | 33 hours 51 minutes / 68.6% ach | [2026-01-22](https://discord.com/channels/1385346341848350810/1385400003127803995/1463998987580215570) |
| psychoapeman (SG: PsychoApeMan) | Lost in Play | lfRFO/lost-in-play | 4 hours 26 minutes / 100% ach | [2026-01-22](https://discord.com/channels/1385346341848350810/1385400003127803995/1464004339998789642) |
| foxmonstrous (SG: Foxmonster) | Heart of the Woods | bHEYl/heart-of-the-woods | 0 minutes / 100% ach | [2026-01-24](https://discord.com/channels/1385346341848350810/1385400003127803995/1464463507469631608) |
| patzl (SG: Patzl) | Pilo and the Holobook | i0c8M/pilo-and-the-holobook | 3 hours 26 minutes / 100% ach | [2026-01-24](https://discord.com/channels/1385346341848350810/1385400003127803995/1464608448141328529) |
| shughes91 (SG: Shughes91) | What Remains of Edith Finch | 5NcQG/what-remains-of-edith-finch | 2 hours 6 minutes / 100% ach | [2026-01-25](https://discord.com/channels/1385346341848350810/1385400003127803995/1464984517319200789) |
| sakaki_aya (SG: Sakakino) | Absolum | V0zsS/absolum | 21 hours 23 minutes / 100% ach | [2026-01-27](https://discord.com/channels/1385346341848350810/1385400003127803995/1465507903262822504) |
| thexder. (SG: Thexder) | Tales of Arise | Pgiwm/tales-of-arise | 88 hours 5 minutes / 60.3% ach | [2026-01-28](https://discord.com/channels/1385346341848350810/1385400003127803995/1466202409910014084) |
| biotagger (SG: Jztr) | A Little to the Left | dm76c/a-little-to-the-left | 8 hours 53 minutes / 47.7% ach | [2026-01-29](https://discord.com/channels/1385346341848350810/1385400003127803995/1466408641052807199) |
| biotagger (SG: Jztr) | Organized Inside | vdMOz/organized-inside | 9 hours 10 minutes / 59.1% ach | [2026-01-29](https://discord.com/channels/1385346341848350810/1385400003127803995/1466410302659624970) |
| sakaki_aya (SG: Sakakino) | Dead Island 2 Ultimate Edition | pNKZC/dead-island-2-ultimate-edition | 35 hours 46 minutes / 74.6% ach | [2026-02-03](https://discord.com/channels/1385346341848350810/1385400003127803995/1468125719069724714) |
| numaya231_72104 (SG: Almostn33t) | Assassin's Creed Valhalla | snaIZ/assassins-creed-valhalla | 109 hours 3 minutes / 41.3% ach | [2026-02-07](https://discord.com/channels/1385346341848350810/1385400003127803995/1469586687498649631) |
| damianea103 (SG: damianea103) | Please, Touch The Artwork | 1xDFh/please-touch-the-artwork | 2 hours 21 minutes / 100% ach | [2026-02-08](https://discord.com/channels/1385346341848350810/1385400003127803995/1469910655841730685) |
| ignition365 (SG: Ignition365) | SANABI | 0wfh1/sanabi | 15 hours 49 minutes / 81% ach | [2026-02-16](https://discord.com/channels/1385346341848350810/1385400003127803995/1472774826333569148) |
| shofuking (SG: TwixClub) | The Talos Principle 2 | aYXIf/the-talos-principle-2 | 32 hours 1 minute / 100% ach | [2026-02-16](https://discord.com/channels/1385346341848350810/1385400003127803995/1472790589828239460) |
| thexder. (SG: Thexder) | Resident Evil Village | PwHLJ/resident-evil-village | 26 hours 9 minutes / 53.6% ach | [2026-02-17](https://discord.com/channels/1385346341848350810/1385400003127803995/1473386845823041763) |
| akfas (SG: akfas) | UNCHARTED: Legacy of Thieves Collection | usZTD/uncharted-legacy-of-thieves-collection | 22 hours 16 minutes / 23.8% ach | [2026-02-17](https://discord.com/channels/1385346341848350810/1385400003127803995/1473402176855343396) |
| psychoapeman (SG: PsychoApeMan) | STAR WARS Jedi: Fallen Order | eb8XB/star-wars-jedi-fallen-order | 28 hours 11 minutes / 59% ach | [2026-02-17](https://discord.com/channels/1385346341848350810/1385400003127803995/1473425006443892883) |
| randalgrvs (SG: RGVS(EX)) | STAR WARS Jedi: Fallen Order | eb8XB/star-wars-jedi-fallen-order | 15 hours 51 minutes / 51.3% ach | [2026-02-17](https://discord.com/channels/1385346341848350810/1385400003127803995/1473438153745633280) |
| chusto. (SG: Vin3) | S4U: CITYPUNK 2011 AND LOVE PUNCH | TL20k/s4u-citypunk-2011-and-love-punch | 10 hours 33 minutes / 50% ach | [2026-02-19](https://discord.com/channels/1385346341848350810/1385400003127803995/1474003743103258796) |
| yannbf (SG: yannbz) | Clair Obscur: Expedition 33 | 4HS8t/clair-obscur-expedition-33 | 80 hours 51 minutes / 81.8% ach | [2026-02-19](https://discord.com/channels/1385346341848350810/1385400003127803995/1474088593399218258) |
| melxnmancer (SG: TempR) | Creatures of Ava | ZDLck/creatures-of-ava | 23 hours 22 minutes / 100% ach | [2026-02-20](https://discord.com/channels/1385346341848350810/1385400003127803995/1474308137631613129) |
| shughes91 (SG: Shughes91) | Webbed | v0LgJ/webbed | 9 hours 22 minutes / 94.7% ach | [2026-02-20](https://discord.com/channels/1385346341848350810/1385400003127803995/1474471981653950566) |
| zarisha (SG: MedinaRoscoe) | Cattails: Wildwood Story | jEe8X/cattails-wildwood-story | 44 hours 16 minutes / 100% ach | [2026-02-21](https://discord.com/channels/1385346341848350810/1385400003127803995/1474868743619219456) |
| _yukisuna_ (SG: Yukisuna) | The Last Faith | QnjlH/the-last-faith | 25 hours 3 minutes / 100% ach | [2026-02-21](https://discord.com/channels/1385346341848350810/1385400003127803995/1474891952884420792) |
| shughes91 (SG: Shughes91) | Mouthwashing | a5sXa/mouthwashing | 3 hours 56 minutes / 100% ach | [2026-02-21](https://discord.com/channels/1385346341848350810/1385400003127803995/1474908483332739103) |
| yannbf (SG: yannbz) | Detroit: Become Human | YAl6F/detroit-become-human | 19 hours 17 minutes / 70.8% ach | [2026-02-22](https://discord.com/channels/1385346341848350810/1385400003127803995/1475224050329714718) |
| melxnmancer (SG: TempR) | Catto's Post Office | XZg7H/cattos-post-office | 1 hour 12 minutes / 100% ach | [2026-02-24](https://discord.com/channels/1385346341848350810/1385400003127803995/1475690099525161173) |
| carenard (SG: Carenard) | FINAL FANTASY X/X-2 HD Remaster | 48DZ1/final-fantasy-xx-2-hd-remaster | 66 hours 16 minutes / 34.8% ach | [2026-02-27](https://discord.com/channels/1385346341848350810/1385400003127803995/1476795874104447017) |
| shofuking (SG: TwixClub) | Escape from Ever After | mckUU/escape-from-ever-after | 30 hours 8 minutes / 100% ach | [2026-02-28](https://discord.com/channels/1385346341848350810/1385400003127803995/1477235662829785120) |
| thexder. (SG: Thexder) | Child of Light | GLy5A/child-of-light | 16 hours 35 minutes / 0% ach | [2026-02-28](https://discord.com/channels/1385346341848350810/1385400003127803995/1477383329975373886) |
| shofuking (SG: TwixClub) | Alisa | q41bc/alisa | 6 hours 22 minutes / 48% ach | [2026-03-02](https://discord.com/channels/1385346341848350810/1385400003127803995/1477849769727492287) |
| beebeecee (SG: VinroyIsViral) | The Medium | 1iy2V/the-medium | 9 hours 40 minutes / 100% ach | [2026-03-02](https://discord.com/channels/1385346341848350810/1385400003127803995/1478106343544979536) |
| shofuking (SG: TwixClub) | Duck Detective: The Secret Salami | L12sg/duck-detective-the-secret-salami | 2 hours 9 minutes / 100% ach | [2026-03-06](https://discord.com/channels/1385346341848350810/1385400003127803995/1479593502118776864) |
| ivannes55 (SG: Ivannes) | The 18th Attic - Paranormal Anomaly H... | 8pRCV/the-18th-attic-paranormal-anomaly-hunting-game | 3 hours 19 minutes / 100% ach | [2026-03-08](https://discord.com/channels/1385346341848350810/1385400003127803995/1480190293767884863) |
| lumpycreature (SG: LumpyCreature) | A Game About Digging A Hole | 4q9Fo/a-game-about-digging-a-hole | 6 hours 4 minutes / 100% ach | [2026-03-08](https://discord.com/channels/1385346341848350810/1385400003127803995/1480337360385478888) |
| blazinghobgoblin (SG: BorjaGRouco) | Gorogoa | t1xqy/gorogoa | 2 hours / 63.6% ach | [2026-03-09](https://discord.com/channels/1385346341848350810/1385400003127803995/1480550174081290344) |
| _yukisuna_ (SG: Yukisuna) | Clair Obscur: Expedition 33 | 8pQQQ/clair-obscur-expedition-33 | 96 hours 51 minutes / 100% ach | [2026-03-11](https://discord.com/channels/1385346341848350810/1385400003127803995/1481334372668932286) |
| desdope (SG: schmoan) | Kingdom Come: Deliverance II | vkdPo/kingdom-come-deliverance-ii | 46 hours 14 minutes / 8.4% ach | [2026-03-12](https://discord.com/channels/1385346341848350810/1385400003127803995/1481554425146511391) |
| thexder. (SG: Thexder) | Inscryption | v4RGZ/inscryption | 13 hours 24 minutes / 57.5% ach | [2026-03-13](https://discord.com/channels/1385346341848350810/1385400003127803995/1481861651199426743) |
| sakaki_aya (SG: Sakakino) | Rogue Legacy 2 | syQU2/rogue-legacy-2 | 42 hours 45 minutes / 100% ach | [2026-03-13](https://discord.com/channels/1385346341848350810/1385400003127803995/1481862970635190511) |
| shivachettri (SG: elysium1988) | ASTRONEER | GbaZI/astroneer | 17 hours 55 minutes / 30.4% ach | [2026-03-13](https://discord.com/channels/1385346341848350810/1385400003127803995/1482153557045149778) |
| venomousnyx (SG: VenomousNyx) | The Unfinished Swan | yCyEc/the-unfinished-swan | 6 hours 19 minutes / 100% ach | [2026-03-14](https://discord.com/channels/1385346341848350810/1385400003127803995/1482247271881117696) |
| thexder. (SG: Thexder) | Life is Strange Remastered Collection | yD71f/life-is-strange-remastered-collection | 30 hours 27 minutes / 81.9% ach | [2026-03-16](https://discord.com/channels/1385346341848350810/1385400003127803995/1483226399031427286) |
| carenard (SG: Carenard) | The Unfinished Swan | vlVj2/the-unfinished-swan | 4 hours 13 minutes / 100% ach | [2026-03-21](https://discord.com/channels/1385346341848350810/1385400003127803995/1484809402610352239) |
| surlent. (SG: BaconChizBurger) | Staffer Case: A Supernatural Mystery ... | BvcTM/staffer-case-a-supernatural-mystery-adventure | 21 hours 18 minutes / 100% ach | [2026-03-26](https://discord.com/channels/1385346341848350810/1385400003127803995/1486760535633428511) |
| lumpycreature (SG: LumpyCreature) | Wattam | tVIMH/wattam | 6 hours 11 minutes / 100% ach | [2026-03-29](https://discord.com/channels/1385346341848350810/1385400003127803995/1487718929118924901) |
| venomousnyx (SG: VenomousNyx) | Gorogoa | YEk8i/gorogoa | 3 hours 38 minutes / 100% ach | [2026-03-30](https://discord.com/channels/1385346341848350810/1385400003127803995/1488093990015336478) |
| p0ch4cc0. (SG: MikeWithAnI) | Öoo | cRFrA/ooo | 0 minutes / 100% ach | [2026-03-30](https://discord.com/channels/1385346341848350810/1385400003127803995/1488133620810911815) |
| shofuking (SG: TwixClub) | Teenage Mutant Ninja Turtles: Splinte... | IzHVI/teenage-mutant-ninja-turtles-splintered-fate | 10 hours 32 minutes / 39% ach | [2026-04-01](https://discord.com/channels/1385346341848350810/1385400003127803995/1488958546807882011) |
| numaya231_72104 (SG: Almostn33t) | Unheard - Voices of Crime | RjTyP/unheard-voices-of-crime | 6 hours 2 minutes / 100% ach | [2026-04-02](https://discord.com/channels/1385346341848350810/1385400003127803995/1489160332294492181) |
| venomousnyx (SG: VenomousNyx) | Paper Perjury | HIWSi/paper-perjury | 17 hours 46 minutes / 95.8% ach | [2026-04-04](https://discord.com/channels/1385346341848350810/1385400003127803995/1490101623664410635) |
| puninup (SG: puninup) | STAR WARS Jedi: Survivor | gQcEd/star-wars-jedi-survivor | 72 hours 36 minutes / 100% ach | [2026-04-05](https://discord.com/channels/1385346341848350810/1385400003127803995/1490482064372273153) |
| rinocap (SG: Rinocap) | Detroit: Become Human | vFkSK/detroit-become-human | 13 hours 3 minutes / 54.2% ach | [2026-04-06](https://discord.com/channels/1385346341848350810/1385400003127803995/1490777845775990887) |
| modestm005e (SG: Grogglz) | Tall Trails | Rtkl2/tall-trails | 7 hours 29 minutes / 56.3% ach | [2026-04-07](https://discord.com/channels/1385346341848350810/1385400003127803995/1491088750422265938) |
| desdope (SG: schmoan) | Anxiety Puppy | VnuU9/anxiety-puppy | 1 hour 6 minutes / 100% ach | [2026-04-08](https://discord.com/channels/1385346341848350810/1385400003127803995/1491402878714253423) |
| chusto. (SG: Vin3) | Nocturnal | pVuN1/nocturnal | 4 hours 2 minutes / 100% ach | [2026-04-14](https://discord.com/channels/1385346341848350810/1385400003127803995/1493546172156219533) |
| patzl (SG: Patzl) | Ni no Kuni Wrath of the White Witch R... | c7UB8/ni-no-kuni-wrath-of-the-white-witch-remastered | 85 hours 25 minutes / 100% ach | [2026-04-14](https://discord.com/channels/1385346341848350810/1385400003127803995/1493653577556820148) |
| venomousnyx (SG: VenomousNyx) | Tangle Tower | yHH5g/tangle-tower | 10 hours 58 minutes / 100% ach | [2026-04-14](https://discord.com/channels/1385346341848350810/1385400003127803995/1493683007217995787) |
| carenard (SG: Carenard) | Star Fire: Eternal Cycle | 1jT5c/star-fire-eternal-cycle | 17 hours 54 minutes / 100% ach | [2026-04-14](https://discord.com/channels/1385346341848350810/1385400003127803995/1493753555088314530) |
| randalgrvs (SG: RGVS(EX)) | The Case of the Golden Idol | 8OnYg/the-case-of-the-golden-idol | 7 hours 16 minutes / 64.7% ach | [2026-04-15](https://discord.com/channels/1385346341848350810/1385400003127803995/1494029512562708631) |
| randalgrvs (SG: RGVS(EX)) | The Rise of the Golden Idol | k7dbh/the-rise-of-the-golden-idol | 13 hours 44 minutes / 54.3% ach | [2026-04-15](https://discord.com/channels/1385346341848350810/1385400003127803995/1494029512562708631) |
| venomousnyx (SG: VenomousNyx) | Bahnsen Knights | az1L2/bahnsen-knights | 4 hours / 100% ach | [2026-04-16](https://discord.com/channels/1385346341848350810/1385400003127803995/1494196420209676358) |
| blazinghobgoblin (SG: BorjaGRouco) | Dogpile | kSFo4/dogpile | 11 hours 12 minutes / 73.7% ach | [2026-04-17](https://discord.com/channels/1385346341848350810/1385400003127803995/1494724695742746865) |
| griske14 (SG: Griske14(EX)) | No, I'm not a Human | oiJFV/no-im-not-a-human | 3 hours 45 minutes / 23.3% ach | [2026-04-17](https://discord.com/channels/1385346341848350810/1385400003127803995/1494814244175351948) |
| quinlanlj (SG: QuinlanLJ) | COCOON | ly6yL/cocoon | 5 hours 26 minutes / 58.8% ach | [2026-04-17](https://discord.com/channels/1385346341848350810/1385400003127803995/1494831278535741530) |
| venomousnyx (SG: VenomousNyx) | I Am Your Beast | PItmd/i-am-your-beast | 17 hours 47 minutes / 100% ach | [2026-04-19](https://discord.com/channels/1385346341848350810/1385400003127803995/1495360516670099526) |
| thexder. (SG: Thexder) | Star Trek: Resurgence | DRwPF/star-trek-resurgence | 11 hours 26 minutes / 44.4% ach | [2026-04-23](https://discord.com/channels/1385346341848350810/1385400003127803995/1497020835477717032) |
| sakaki_aya (SG: Sakakino) | SANABI | wIJRB/sanabi | 22 hours 45 minutes / 100% ach | [2026-04-24](https://discord.com/channels/1385346341848350810/1385400003127803995/1497381904410869781) |
| carenard (SG: Carenard) | SANABI | HPqD5/sanabi | 11 hours 13 minutes / 76.2% ach | [2026-04-29](https://discord.com/channels/1385346341848350810/1385400003127803995/1498869465599705099) |
| patzl (SG: Patzl) | Gloomy Eyes | IffkT/gloomy-eyes | 5 hours 3 minutes / 100% ach | [2026-05-04](https://discord.com/channels/1385346341848350810/1385400003127803995/1500946116517036125) |
| quinlanlj (SG: QuinlanLJ) | Dungeon Clawler | AkdcD/dungeon-clawler | 22 hours 2 minutes / 43.2% ach | [2026-05-05](https://discord.com/channels/1385346341848350810/1385400003127803995/1501292632926588939) |
| lumpycreature (SG: LumpyCreature) | The Room | xdrlN/the-room | 2 hours 21 minutes / 100% ach | [2026-05-09](https://discord.com/channels/1385346341848350810/1385400003127803995/1502657803733569587) |
| randalgrvs (SG: RGVS(EX)) | Steve's Warehouse: Physics. Roguelike... | fUGm9/steves-warehouse-physics-roguelike-chaos | 7 hours 15 minutes / 45.5% ach | [2026-05-11](https://discord.com/channels/1385346341848350810/1385400003127803995/1503458200618405978) |
| chusto. (SG: Vin3) | Picayune Dreams | aEzYc/picayune-dreams | 73 hours 13 minutes / 100% ach | [2026-05-12](https://discord.com/channels/1385346341848350810/1385400003127803995/1503850249385541632) |
| venomousnyx (SG: VenomousNyx) | Fear the Spotlight | qL2sS/fear-the-spotlight | 7 hours 1 minute / 100% ach | [2026-05-18](https://discord.com/channels/1385346341848350810/1385400003127803995/1505829249242763385) |
| chusto. (SG: Vin3) | Tails of Iron | RzdWw/tails-of-iron | 18 hours 18 minutes / 97.2% ach | [2026-05-18](https://discord.com/channels/1385346341848350810/1385400003127803995/1505850722250653778) |
| quinlanlj (SG: QuinlanLJ) | The Inheritance of Crimson Manor | lNvsr/the-inheritance-of-crimson-manor | 4 hours 37 minutes / 100% ach | [2026-05-18](https://discord.com/channels/1385346341848350810/1385400003127803995/1506068946002907316) |
| numaya231_72104 (SG: Almostn33t) | Danganronpa V3: Killing Harmony | BK013/danganronpa-v3-killing-harmony | 94 hours 54 minutes / 100% ach | [2026-05-19](https://discord.com/channels/1385346341848350810/1385400003127803995/1506191236392816680) |
| surlent. (SG: BaconChizBurger) | The Last Gas Station | HxJcQ/the-last-gas-station | 13 hours 40 minutes / 73.5% ach | [2026-05-19](https://discord.com/channels/1385346341848350810/1385400003127803995/1506318407572783164) |
| shofuking (SG: TwixClub) | Mixtape | kamUt/mixtape | 5 hours 10 minutes / 100% ach | [2026-05-19](https://discord.com/channels/1385346341848350810/1385400003127803995/1506384689739595816) |
| akfas (SG: akfas) | Dispatch | SSpeu/dispatch | 11 hours 45 minutes / 58.3% ach | [2026-05-22](https://discord.com/channels/1385346341848350810/1385400003127803995/1507357232503718010) |
| blazinghobgoblin (SG: BorjaGRouco) | Hozy | bRKHB/hozy | 3 hours 32 minutes / 100% ach | [2026-05-22](https://discord.com/channels/1385346341848350810/1385400003127803995/1507406680496017618) |
| quinlanlj (SG: QuinlanLJ) | Still Wakes the Deep | RTfAk/still-wakes-the-deep | 7 hours 5 minutes / 54.2% ach | [2026-05-23](https://discord.com/channels/1385346341848350810/1385400003127803995/1507860566100938803) |
| venomousnyx (SG: VenomousNyx) | Is this Game Trying to Kill Me? | dWBW0/is-this-game-trying-to-kill-me | 3 hours 45 minutes / 100% ach | [2026-05-26](https://discord.com/channels/1385346341848350810/1385400003127803995/1508747040534953994) |
| psychoapeman (SG: PsychoApeMan) | Koira | ZWpwQ/koira | 5 hours 48 minutes / 75% ach | [2026-05-27](https://discord.com/channels/1385346341848350810/1385400003127803995/1509028418660991077) |
| _atro_ (SG: Atro) | Clair Obscur: Expedition 33 | f8WwV/clair-obscur-expedition-33 | 85 hours 12 minutes / 100% ach | [2026-05-27](https://discord.com/channels/1385346341848350810/1385400003127803995/1509336748981878905) |
| carenard (SG: Carenard) | Neva | KGerm/neva | 6 hours 11 minutes / 100% ach | [2026-05-28](https://discord.com/channels/1385346341848350810/1385400003127803995/1509433560157786233) |
| toanlish (SG: imminiman) | A Game About Digging A Hole | ul7lp/a-game-about-digging-a-hole | 10 hours 18 minutes / 100% ach | [2026-05-29](https://discord.com/channels/1385346341848350810/1385400003127803995/1509968731818688604) |
| patzl (SG: Patzl) | Ni no Kuni Wrath of the White Witch R... | c7UB8/ni-no-kuni-wrath-of-the-white-witch-remastered | 85 hours 25 minutes / 100% ach | [2026-05-31](https://discord.com/channels/1385346341848350810/1385400003127803995/1510645613010882621) |
| vampiresska (SG: vampiresska) | The Talos Principle 2 | hvvAM/the-talos-principle-2 | 43 hours 7 minutes / 62.1% ach | [2026-06-01](https://discord.com/channels/1385346341848350810/1385400003127803995/1510990415799521501) |
| surlent. (SG: BaconChizBurger) | Tainted Grail: The Fall of Avalon | Yl2od/tainted-grail-the-fall-of-avalon | 67 hours 50 minutes / 75.4% ach | [2026-06-01](https://discord.com/channels/1385346341848350810/1385400003127803995/1511016257468633170) |
