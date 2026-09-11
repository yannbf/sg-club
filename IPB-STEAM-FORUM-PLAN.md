# Plan: backfill "I Play Bro" submissions from the Steam forum thread

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
