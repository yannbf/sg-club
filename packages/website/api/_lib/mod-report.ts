// Shared severity classification + rendering for the two mod-facing warning
// surfaces: the scraper-side weekly digest (discord-warn-digest.ts, errors
// only) and the on-demand /mod-report slash command (interactions.ts, errors
// + warnings). Both consume `collectGroupWarningFindings`, which loads
// group_users.json via loadDataFile — so it works both on Vercel (host mode)
// and in the scraper (filesystem fallback, no host).
//
// Ex-member entry checks are deliberately NOT included here: that detector
// (check-ex-member-entries.ts) additionally needs giveaways.json and
// user_entries.json, which together with ex_members.json push per-invocation
// data loading well past what's reasonable for an on-demand serverless
// command — so it stays scraper-only, wired into the weekly digest alone.

import { loadDataFile } from './data.js'

export type Severity = 'error' | 'warn'

/** Maps each group-user warning code to its severity. Unknown codes default to 'warn'. */
export const SEVERITY: Record<string, Severity> = {
  illegal_entered_required_play_giveaways: 'error',
  illegal_entered_any_giveaways: 'error',
  unplayed_required_play_giveaways: 'error',
  required_play_deadline_expired: 'error',
  zero_play_rate_with_wins: 'error',
  required_plays_need_review: 'warn',
  required_play_deadline_within_15_days: 'warn',
  low_play_rate_many_wins: 'warn',
  inactive_play_but_active: 'warn',
  no_giveaway_created_in_6_months: 'warn',
}

export function severityFor(code: string): Severity {
  return SEVERITY[code] ?? 'warn'
}

export const WARNING_LABELS: Record<string, string> = {
  unplayed_required_play_giveaways: 'Unplayed required-play win(s)',
  illegal_entered_required_play_giveaways: 'Entered required-play GA despite unmet requirement',
  illegal_entered_any_giveaways: 'Entered a giveaway while ineligible',
  required_plays_need_review: 'Required-play win(s) need review',
  required_play_deadline_within_15_days: 'Required-play deadline within 15 days',
  required_play_deadline_expired: 'Required-play deadline expired',
  zero_play_rate_with_wins: 'Zero play rate despite wins',
  low_play_rate_many_wins: 'Low play rate with many wins',
  inactive_play_but_active: 'Inactive playtime but active on SG',
  no_giveaway_created_in_6_months: 'No giveaway created in 6 months',
}

/**
 * Every finding code, most to least important, used by /mod-report to order
 * labels within a combo and combos within a section. Not used by the weekly
 * digest (its per-member rendering is unaffected by this ranking).
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
  // needs-review outranks deadline-expired (Yann: it's more actionable) even
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

interface GroupUser {
  username: string
  steam_id: string
  warnings?: string[]
}

interface GroupUsersData {
  users: Record<string, GroupUser>
}

export interface GroupWarningFinding {
  username: string
  code: string
  label: string
  severity: Severity
}

/**
 * Loads group_users.json and flattens every member's `warnings` array into
 * one finding per member per warning code.
 */
export async function collectGroupWarningFindings(host?: string): Promise<GroupWarningFinding[]> {
  const groupUsers = await loadDataFile<GroupUsersData>('group_users.json', host)

  const findings: GroupWarningFinding[] = []
  for (const user of Object.values(groupUsers.users)) {
    for (const code of user.warnings ?? []) {
      findings.push({
        username: user.username,
        code,
        label: WARNING_LABELS[code] ?? code,
        severity: severityFor(code),
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

const PLAY_REQUIRED_QUERY = '?tab=won&filter=play-required'

/**
 * A member's page link in the `[name](<url>)` no-preview form. Shared by
 * `renderMemberLine` (bulleted, single member) and the /mod-report combo
 * grouping (comma-separated, no bullet). `deepLinkPlayRequired` points the
 * link at the member's Won tab with the Play required filter on.
 */
function memberLink(username: string, deepLinkPlayRequired = false): string {
  const query = deepLinkPlayRequired ? PLAY_REQUIRED_QUERY : ''
  const url = `${SITE_BASE}/users/${username}/${query}`
  return `[${username}](<${url}>)`
}

/**
 * Renders one member's bullet line: a link to their member page followed by
 * their finding texts joined with " · ". The `(<url>)` form suppresses
 * Discord's link-preview embed. No emojis — used by both the digest and
 * /mod-report.
 */
export function renderMemberLine(username: string, findingTexts: string[]): string {
  return `- ${memberLink(username)} — ${findingTexts.join(' · ')}`
}

/**
 * Joins `segments` (each an atomic, possibly multi-line unit — a bullet, a
 * header, a fenced codeblock) into as few ≤maxLength messages as possible,
 * never splitting a segment across two messages. Mirrors Discord's ~2000
 * char message cap with headroom.
 */
export function chunkMessage(segments: string[], maxLength = 1900): string[] {
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
}

export interface MemberReportEntry {
  username: string
  errorFindings: MemberFinding[]
  warnFindings: MemberFinding[]
}

/**
 * Groups findings by member, splitting each member's (code, label) pairs
 * into error vs warn buckets. Sorted alphabetically by username.
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
    const item: MemberFinding = { code: finding.code, label: finding.label }
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

interface FindingCombo {
  labels: string[]
  codes: string[]
  usernames: string[]
  mostImportantRank: number
}

/**
 * Groups a section's members by their EXACT set of finding codes, then
 * renders each combo as one line:
 *  - shared by ≥2 members: `<Label A> · <Label B>: [m1], [m2]` (not
 *    bulleted), labels ordered by importance, members alphabetical
 *    (case-insensitive).
 *  - unique to 1 member: the existing bulleted `renderMemberLine` form.
 * Lines are ordered by the combo's most important code, then by member
 * count (larger first), then alphabetically by first member.
 */
function renderSection(members: SectionMember[]): string[] {
  if (members.length === 0) return ['_none_']

  const combosByKey = new Map<string, { codeLabels: Map<string, string>; usernames: string[] }>()
  for (const member of members) {
    // Use each finding's own label (not WARNING_LABELS) so unknown-code
    // fallbacks and any caller-supplied label stay intact.
    const codeLabels = new Map(member.findings.map((f) => [f.code, f.label] as const))
    const key = [...codeLabels.keys()].sort().join('|')
    let combo = combosByKey.get(key)
    if (!combo) {
      combo = { codeLabels, usernames: [] }
      combosByKey.set(key, combo)
    }
    combo.usernames.push(member.username)
  }

  const combos: FindingCombo[] = [...combosByKey.values()].map(({ codeLabels, usernames }) => {
    const orderedCodes = [...codeLabels.keys()].sort((a, b) => importanceRank(a) - importanceRank(b))
    return {
      labels: orderedCodes.map((code) => codeLabels.get(code)!),
      codes: orderedCodes,
      usernames: [...usernames].sort(compareUsernamesCaseInsensitive),
      mostImportantRank: importanceRank(orderedCodes[0]!),
    }
  })

  combos.sort((a, b) => {
    if (a.mostImportantRank !== b.mostImportantRank) return a.mostImportantRank - b.mostImportantRank
    if (a.usernames.length !== b.usernames.length) return b.usernames.length - a.usernames.length
    return compareUsernamesCaseInsensitive(a.usernames[0]!, b.usernames[0]!)
  })

  // Multi-member combos: label line, then a bulleted member list on the next
  // line. Single-member combos: everything on one line, no bullet.
  return combos.map((combo) => {
    const deep = combo.codes.some((code) => PLAY_REQUIRED_CODES.has(code))
    return combo.usernames.length >= 2
      ? `${combo.labels.join(' · ')}:\n- ${combo.usernames.map((u) => memberLink(u, deep)).join(', ')}\n`
      : `${combo.labels.join(' · ')}: ${memberLink(combo.usernames[0]!, deep)}`
  })
}

export const EX_MEMBER_NOTE = 'Ex-member entry checks run in the weekly digest only.'

/**
 * Builds the full /mod-report content as an array of line/segment strings
 * (not yet chunked — pass through `chunkMessage` for that): a header, a
 * **Need attention** section (members with ≥1 error finding, all their
 * findings listed), a **Warnings** section (members whose findings are all
 * warn-level), and a closing note about ex-member checks. Within each
 * section, members sharing the exact same set of finding codes are grouped
 * onto one line — see `renderSection`.
 */
export function buildModReportLines(findings: GroupWarningFinding[]): string[] {
  const members = groupFindingsByMemberForReport(findings)
  const errorMembers = members.filter((m) => m.errorFindings.length > 0)
  const warnOnlyMembers = members.filter(
    (m) => m.errorFindings.length === 0 && m.warnFindings.length > 0
  )

  const lines: string[] = ['**Mod Report**', '']

  lines.push(`**Need attention** (${errorMembers.length} members)`)
  lines.push(
    ...renderSection(
      errorMembers.map((m) => ({
        username: m.username,
        findings: [...m.errorFindings, ...m.warnFindings],
      }))
    )
  )

  lines.push('')
  lines.push(`**Warnings** (${warnOnlyMembers.length} members)`)
  lines.push(
    ...renderSection(warnOnlyMembers.map((m) => ({ username: m.username, findings: m.warnFindings })))
  )

  lines.push('')
  lines.push(EX_MEMBER_NOTE)

  return lines
}
