// Shared severity classification + rendering for the two mod-facing warning
// surfaces: the scraper-side weekly digest (discord-warn-digest.ts, errors
// only) and the on-demand /mod-report slash command (interactions.ts, errors
// + warnings). Both consume `collectGroupWarningFindings`, which loads
// group_users.json via loadDataFile — so it works both on Vercel (host mode)
// and in the scraper (filesystem fallback, no host). Both surfaces render one
// block per member via `renderMemberBlock`, with per-finding detail strings
// from `buildFindingDetails` as sub-bullets.
//
// Ex-member entry checks are deliberately NOT included here: that detector
// (check-ex-member-entries.ts) additionally needs giveaways.json and
// user_entries.json, which together with ex_members.json push per-invocation
// data loading well past what's reasonable for an on-demand serverless
// command — so it stays scraper-only, wired into the weekly digest alone.

import { loadDataFile } from './data.js'
import {
  DEADLINE_WARNING_DAYS,
  isUnfulfilledRequiredPlay,
  requiredPlayDeadlineSec,
  type RequiredPlayWin,
} from './required-play.js'

export type Severity = 'error' | 'warn'

/** Maps each group-user warning code to its severity. Unknown codes default to 'warn'. */
export const SEVERITY: Record<string, Severity> = {
  illegal_entered_required_play_giveaways: 'error',
  illegal_entered_any_giveaways: 'error',
  required_play_deadline_expired: 'error',
  zero_play_rate_with_wins: 'error',
  required_plays_need_review: 'warn',
  // 2 unfulfilled required-play wins is the cap the rules allow, not a
  // breach — the breach codes are the two illegal_entered_* codes above and
  // required_play_deadline_expired.
  unplayed_required_play_giveaways: 'warn',
  required_play_deadline_within_15_days: 'warn',
  low_play_rate_many_wins: 'warn',
  inactive_play_but_active: 'warn',
  no_giveaway_created_in_6_months: 'warn',
}

export function severityFor(code: string): Severity {
  return SEVERITY[code] ?? 'warn'
}

export const WARNING_LABELS: Record<string, string> = {
  unplayed_required_play_giveaways: 'Unplayed required-play wins',
  illegal_entered_required_play_giveaways: 'Entered a required-play giveaway while ineligible',
  illegal_entered_any_giveaways: 'Entered a giveaway while ineligible',
  required_plays_need_review: 'Required-play wins that may already be done',
  required_play_deadline_within_15_days: 'Required-play deadline within 15 days',
  required_play_deadline_expired: 'Required-play deadline expired',
  zero_play_rate_with_wins: 'Zero play rate despite wins',
  low_play_rate_many_wins: 'Low play rate with many wins',
  inactive_play_but_active: 'Inactive playtime but active on SG',
  no_giveaway_created_in_6_months: 'No giveaway created in 6 months',
}

/**
 * Every finding code, most to least important, used by /mod-report to order
 * a member's finding labels and to order members within a section. Not used
 * by the weekly digest (its per-member rendering is unaffected by this
 * ranking).
 *
 * `ex_member_entries` is a pseudo-code for the ex-member-entries check
 * (discord-warn-digest.ts) — it never actually appears in `/mod-report`
 * findings (that detector needs data too heavy to load on-demand, see the
 * file header), but is listed here for a complete, documented ranking.
 *
 * Unknown codes (not present in this list) rank just above
 * `no_giveaway_created_in_6_months` — the least important known code — via
 * `importanceRank` below.
 */
export const IMPORTANCE_ORDER: string[] = [
  // errors, most to least important
  'illegal_entered_any_giveaways',
  'illegal_entered_required_play_giveaways',
  'unplayed_required_play_giveaways',
  // needs-review outranks deadline-expired because it's more actionable even
  // though it's warn-severity — importance and severity are separate axes.
  'required_plays_need_review',
  'required_play_deadline_expired',
  'zero_play_rate_with_wins',
  'ex_member_entries',
  // warnings, most to least important
  'required_play_deadline_within_15_days',
  'low_play_rate_many_wins',
  'inactive_play_but_active',
  'no_giveaway_created_in_6_months',
]

const LEAST_IMPORTANT_KNOWN_RANK = IMPORTANCE_ORDER.indexOf('no_giveaway_created_in_6_months')

/**
 * Numeric importance rank for a finding code (lower = more important). Known
 * codes get their index in `IMPORTANCE_ORDER`; unknown codes rank just above
 * `no_giveaway_created_in_6_months`.
 */
export function importanceRank(code: string): number {
  const idx = IMPORTANCE_ORDER.indexOf(code)
  return idx !== -1 ? idx : LEAST_IMPORTANT_KNOWN_RANK - 0.5
}

interface WonGiveaway extends RequiredPlayWin {
  name: string
  steam_play_data?: {
    playtime_minutes?: number
    achievements_percentage?: number
    /** Set when Steam reports the game as never launched. */
    never_played?: boolean
    /** Set when the member's Steam profile/game details are private or otherwise unreadable. */
    has_no_available_stats?: boolean
  }
  /** A mod-recorded proof-of-play attestation, counted as played regardless of Steam data. */
  i_played_bro?: boolean
}

interface GroupUser {
  username: string
  steam_id: string
  warnings?: string[]
  giveaways_won?: WonGiveaway[]
  stats?: {
    last_giveaway_created_at?: number | null
  }
  /** Milliseconds since epoch; null/absent means no play activity is on record. */
  last_played_at?: number | null
  /** Already kicked from the Steam group; the roster entry survives until
   * SteamGifts' next sync catches up, at which point they drop out entirely. */
  kicked_pending_sync?: boolean
}

interface GroupUsersData {
  users: Record<string, GroupUser>
}

export interface GroupWarningFinding {
  username: string
  code: string
  label: string
  severity: Severity
  /** Optional per-member specifics for the label — the game name(s) behind
   * the finding, a play-rate fraction, or a last-activity timestamp, with
   * Discord relative timestamps where one is involved (e.g. "Sonic Frontiers
   * (deadline <t:…:R>)"). Rendered by both the weekly digest and
   * /mod-report as a sub-bullet under the member's finding label. */
  detail?: string
}

/**
 * The play evidence for one won giveaway, as a parenthesized suffix for a
 * game name: " (not launched)" when there's no recorded playtime, otherwise
 * " (<X>h played)" with ", <Y>% achievements" appended when known. `extra`
 * (e.g. a deadline clause) is folded into the same parenthetical rather than
 * getting its own, so a game with both reads as one clause: "Factorio (1.2h
 * played, 1% achievements, deadline <t:…:R>)".
 */
function playEvidence(g: WonGiveaway, extra?: string): string {
  const minutes = g.steam_play_data?.playtime_minutes
  const parts: string[] = []
  if (!minutes) {
    parts.push('not launched')
  } else {
    parts.push(`${Math.round(minutes / 6) / 10}h played`)
    const pct = g.steam_play_data?.achievements_percentage
    if (typeof pct === 'number') parts.push(`${pct}% achievements`)
  }
  if (extra) parts.push(extra)
  return ` (${parts.join(', ')})`
}

/**
 * Per-code detail strings for one member, derived from their `giveaways_won`,
 * `stats`, and `last_played_at` fields (already in group_users.json — no
 * extra data needed). Codes whose evidence lives elsewhere (entries) get no
 * detail and render as label-only lines.
 */
export function buildFindingDetails(
  user: GroupUser,
  nowSec: number
): Partial<Record<string, string>> {
  const details: Partial<Record<string, string>> = {}
  const named = (games: WonGiveaway[], suffix: (g: WonGiveaway) => string = () => ''): string =>
    games.map((g) => `${g.name}${suffix(g)}`).join(', ')

  const unmet = (user.giveaways_won ?? []).filter(isUnfulfilledRequiredPlay)
  if (unmet.length > 0) {
    details.unplayed_required_play_giveaways = named(unmet, (g) => playEvidence(g))

    const expired = unmet.filter((g) => requiredPlayDeadlineSec(g) < nowSec)
    if (expired.length > 0) {
      details.required_play_deadline_expired = named(expired, (g) =>
        playEvidence(g, `deadline <t:${requiredPlayDeadlineSec(g)}:R>`)
      )
    }

    const dueSoon = unmet.filter((g) => {
      const deadline = requiredPlayDeadlineSec(g)
      return (
        deadline >= nowSec && deadline < nowSec + DEADLINE_WARNING_DAYS * 24 * 60 * 60
      )
    })
    if (dueSoon.length > 0) {
      details.required_play_deadline_within_15_days = named(dueSoon, (g) =>
        playEvidence(g, `deadline <t:${requiredPlayDeadlineSec(g)}:R>`)
      )
    }

    // The scraper decides required_plays_need_review from data we don't load
    // here (HLTB main-story hours), so we can't re-derive which of the
    // member's unmet wins tripped it — the detail lists all of them with
    // their play evidence and leaves the judgment call to the mod.
    details.required_plays_need_review = named(unmet, (g) => playEvidence(g))
  }

  // Play rate: share of won games (excluding unreleased ones) the member has
  // evidence of having played. Shared between the two play-rate codes since
  // only one of them is ever present in a given member's warnings.
  const wins = (user.giveaways_won ?? []).filter((g) => !g.unreleased)
  if (wins.length > 0) {
    const played = wins.filter(
      (g) =>
        g.i_played_bro ||
        g.required_play_meta?.requirements_met ||
        (g.steam_play_data && !g.steam_play_data.never_played && !g.steam_play_data.has_no_available_stats)
    )
    const pct = Math.round((played.length / wins.length) * 100)
    const playRateDetail = `${played.length} of ${wins.length} wins played (${pct}%)`
    details.low_play_rate_many_wins = playRateDetail
    details.zero_play_rate_with_wins = playRateDetail
  }

  details.no_giveaway_created_in_6_months = user.stats?.last_giveaway_created_at
    ? `last created <t:${user.stats.last_giveaway_created_at}:R>`
    : 'never created one'

  if (user.last_played_at != null) {
    details.inactive_play_but_active = `last played <t:${Math.floor(user.last_played_at / 1000)}:R>`
  }

  return details
}

/**
 * Loads group_users.json and flattens every member's `warnings` array into
 * one finding per member per warning code, attaching per-game details where
 * the won-giveaways data supports them.
 */
export async function collectGroupWarningFindings(host?: string): Promise<GroupWarningFinding[]> {
  const groupUsers = await loadDataFile<GroupUsersData>('group_users.json', host)
  const nowSec = Math.floor(Date.now() / 1000)

  const findings: GroupWarningFinding[] = []
  for (const user of Object.values(groupUsers.users)) {
    if (!user.warnings?.length) continue
    // Already kicked from the Steam group; the roster entry disappears once
    // SteamGifts' sync catches up, so their warnings are moot until then.
    if (user.kicked_pending_sync) continue
    const details = buildFindingDetails(user, nowSec)
    for (const code of user.warnings) {
      findings.push({
        username: user.username,
        code,
        label: WARNING_LABELS[code] ?? code,
        severity: severityFor(code),
        detail: details[code],
      })
    }
  }
  return findings
}

export const SITE_BASE = 'https://sg-club.vercel.app'

/**
 * Finding codes about required-play compliance. Members flagged with any of
 * these get a deep link straight to their Won tab with the "Play required"
 * filter pre-enabled (the user page reads ?tab=won&filter=play-required).
 */
export const PLAY_REQUIRED_CODES = new Set([
  'illegal_entered_required_play_giveaways',
  'unplayed_required_play_giveaways',
  'required_plays_need_review',
  'required_play_deadline_expired',
  'required_play_deadline_within_15_days',
])

/**
 * The two deep-link targets a member line can point at instead of the plain
 * profile: the Won tab with the Play required filter on (required-play
 * findings), or the Entered tab filtered to open giveaways (ex-members still
 * holding entries). The user page reads these query params client-side.
 */
export type DeepLink = 'play-required' | 'entered-open'

const DEEP_LINK_QUERIES: Record<DeepLink, string> = {
  'play-required': '?tab=won&filter=play-required',
  'entered-open': '?tab=entered&filter=open',
}

/**
 * A member's page link in the `[name](<url>)` no-preview form. Shared by
 * `renderMemberLine` and `renderMemberBlock`. `deepLink` points the link at a
 * pre-filtered tab of the member's page instead of the plain profile.
 */
function memberLink(username: string, deepLink?: DeepLink): string {
  const query = deepLink ? DEEP_LINK_QUERIES[deepLink] : ''
  const url = `${SITE_BASE}/users/${username}/${query}`
  return `[${username}](<${url}>)`
}

/**
 * Renders one member's bullet line: a link to their member page followed by
 * their finding texts joined with " · ". The `(<url>)` form suppresses
 * Discord's link-preview embed. No emojis — used by both the digest and
 * /mod-report.
 */
export function renderMemberLine(
  username: string,
  findingTexts: string[],
  deepLink?: DeepLink
): string {
  return `- ${memberLink(username, deepLink)} — ${findingTexts.join(' · ')}`
}

/**
 * Renders one member as a bullet with their findings as sub-bullets, rather
 * than run together on a single line. `headline` sits next to the name and is
 * where per-member context goes (how long they've been on the list). Returns
 * ONE segment containing newlines, so `chunkMessage` still keeps a member's
 * findings together in a single message.
 */
export function renderMemberBlock(
  username: string,
  headline: string,
  findingTexts: string[],
  deepLink?: DeepLink
): string {
  const head = `- ${memberLink(username, deepLink)} — ${headline}`
  return [head, ...findingTexts.map((text) => `  - ${text}`)].join('\n')
}

/**
 * Joins `segments` (each an atomic, possibly multi-line unit — a bullet, a
 * header, a fenced codeblock) into as few ≤maxLength messages as possible,
 * never splitting a segment across two messages: each message is a maximal
 * run of segments (a segment is added unless doing so would overflow), which
 * is provably optimal for minimizing message count given order-preserving,
 * atomic segments — so the only lever for packing more tightly is the
 * budget itself. Default of 1990 leaves 10 chars of headroom under
 * Discord's real 2000-char cap (previously 1900, which wasted 100 chars of
 * every message for no reason and could force an extra message).
 */
export function chunkMessage(segments: string[], maxLength = 1990): string[] {
  const messages: string[] = []
  let current: string[] = []

  for (const segment of segments) {
    const prospective = current.length > 0 ? `${current.join('\n')}\n${segment}` : segment
    if (current.length > 0 && prospective.length > maxLength) {
      messages.push(current.join('\n'))
      current = [segment]
    } else {
      current.push(segment)
    }
  }
  if (current.length > 0) messages.push(current.join('\n'))

  return messages
}

export interface MemberFinding {
  code: string
  label: string
  detail?: string
}

export interface MemberReportEntry {
  username: string
  errorFindings: MemberFinding[]
  warnFindings: MemberFinding[]
}

/**
 * Groups findings by member, splitting each member's (code, label, detail)
 * triples into error vs warn buckets. Sorted alphabetically by username.
 */
export function groupFindingsByMemberForReport(
  findings: GroupWarningFinding[]
): MemberReportEntry[] {
  const byUser = new Map<string, MemberReportEntry>()

  for (const finding of findings) {
    let entry = byUser.get(finding.username)
    if (!entry) {
      entry = { username: finding.username, errorFindings: [], warnFindings: [] }
      byUser.set(finding.username, entry)
    }
    const item: MemberFinding = { code: finding.code, label: finding.label, detail: finding.detail }
    if (finding.severity === 'error') entry.errorFindings.push(item)
    else entry.warnFindings.push(item)
  }

  return [...byUser.values()].sort((a, b) => a.username.localeCompare(b.username))
}

function compareUsernamesCaseInsensitive(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' })
}

interface SectionMember {
  username: string
  findings: MemberFinding[]
}

/**
 * Renders a section as one block per member (see `renderMemberBlock`).
 * A member with exactly one finding renders on a single line — the headline
 * is `<label>: <detail>` (or just `<label>` when there's no detail) and
 * there are no sub-bullets. A member with 2+ findings keeps the labels
 * joined with " · " as the headline, with a sub-bullet `<label>: <detail>`
 * for each finding that has a detail string. Members are ordered by the
 * importance rank of their most important finding, then by username
 * (case-insensitive).
 */
function renderSection(members: SectionMember[]): string[] {
  if (members.length === 0) return ['_none_']

  const sorted = [...members].sort((a, b) => {
    const rankA = Math.min(...a.findings.map((f) => importanceRank(f.code)))
    const rankB = Math.min(...b.findings.map((f) => importanceRank(f.code)))
    if (rankA !== rankB) return rankA - rankB
    return compareUsernamesCaseInsensitive(a.username, b.username)
  })

  return sorted.map((member) => {
    const orderedFindings = [...member.findings].sort(
      (a, b) => importanceRank(a.code) - importanceRank(b.code)
    )
    const deepLink = orderedFindings.some((f) => PLAY_REQUIRED_CODES.has(f.code))
      ? ('play-required' as const)
      : undefined

    if (orderedFindings.length === 1) {
      const finding = orderedFindings[0]!
      const headline = finding.detail ? `${finding.label}: ${finding.detail}` : finding.label
      return renderMemberBlock(member.username, headline, [], deepLink)
    }

    const headline = orderedFindings.map((f) => f.label).join(' · ')
    const findingTexts = orderedFindings
      .filter((f) => f.detail)
      .map((f) => `${f.label}: ${f.detail}`)
    return renderMemberBlock(member.username, headline, findingTexts, deepLink)
  })
}

export const EX_MEMBER_NOTE = 'Ex-member entry checks run in the weekly digest only.'

/**
 * Builds the full /mod-report content as an array of line/segment strings
 * (not yet chunked — pass through `chunkMessage` for that): a header, a
 * **Need attention** section (members with ≥1 error finding, all their
 * findings listed), a **Warnings** section (members whose findings are all
 * warn-level), and a closing note about ex-member checks. Each section
 * renders one block per member, with their finding-specific detail strings
 * as sub-bullets — see `renderSection`.
 *
 * The two section headers carry a leading emoji (‼️/👀, owner request) as
 * the sole exception to the otherwise emoji-free output — everything else
 * (finding labels, member lines, the note) stays plain.
 */
export function buildModReportLines(findings: GroupWarningFinding[]): string[] {
  const members = groupFindingsByMemberForReport(findings)
  const errorMembers = members.filter((m) => m.errorFindings.length > 0)
  const warnOnlyMembers = members.filter(
    (m) => m.errorFindings.length === 0 && m.warnFindings.length > 0
  )

  const lines: string[] = ['**Mod Report**', '']

  lines.push(`‼️ **Need attention** (${errorMembers.length} members)`)
  lines.push(
    ...renderSection(
      errorMembers.map((m) => ({
        username: m.username,
        findings: [...m.errorFindings, ...m.warnFindings],
      }))
    )
  )

  lines.push('')
  lines.push(`👀 **Warnings** (${warnOnlyMembers.length} members)`)
  lines.push(
    ...renderSection(warnOnlyMembers.map((m) => ({ username: m.username, findings: m.warnFindings })))
  )

  lines.push('')
  lines.push(EX_MEMBER_NOTE)

  return lines
}
