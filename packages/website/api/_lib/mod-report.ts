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
 * Renders one member's bullet line: a link to their member page followed by
 * their finding texts joined with " · ". The `(<url>)` form suppresses
 * Discord's link-preview embed. No emojis — used by both the digest and
 * /mod-report.
 */
export function renderMemberLine(username: string, findingTexts: string[]): string {
  const url = `${SITE_BASE}/users/${username}/`
  return `- [${username}](<${url}>) — ${findingTexts.join(' · ')}`
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

export interface MemberReportEntry {
  username: string
  errorLabels: string[]
  warnLabels: string[]
}

/**
 * Groups findings by member, splitting each member's labels into error vs
 * warn buckets. Sorted alphabetically by username.
 */
export function groupFindingsByMemberForReport(
  findings: GroupWarningFinding[]
): MemberReportEntry[] {
  const byUser = new Map<string, MemberReportEntry>()

  for (const finding of findings) {
    let entry = byUser.get(finding.username)
    if (!entry) {
      entry = { username: finding.username, errorLabels: [], warnLabels: [] }
      byUser.set(finding.username, entry)
    }
    if (finding.severity === 'error') entry.errorLabels.push(finding.label)
    else entry.warnLabels.push(finding.label)
  }

  return [...byUser.values()].sort((a, b) => a.username.localeCompare(b.username))
}

export const EX_MEMBER_NOTE = 'Ex-member entry checks run in the weekly digest only.'

/**
 * Builds the full /mod-report content as an array of line/segment strings
 * (not yet chunked — pass through `chunkMessage` for that): a header, an
 * **Errors** section (members with ≥1 error finding, all their findings
 * listed error-first then warn), a **Warnings** section (members whose
 * findings are all warn-level), and a closing note about ex-member checks.
 */
export function buildModReportLines(findings: GroupWarningFinding[]): string[] {
  const members = groupFindingsByMemberForReport(findings)
  const errorMembers = members.filter((m) => m.errorLabels.length > 0)
  const warnOnlyMembers = members.filter(
    (m) => m.errorLabels.length === 0 && m.warnLabels.length > 0
  )

  const lines: string[] = ['**Mod Report**', '']

  lines.push(`**Errors** (${errorMembers.length} members)`)
  if (errorMembers.length === 0) {
    lines.push('_none_')
  } else {
    for (const member of errorMembers) {
      lines.push(renderMemberLine(member.username, [...member.errorLabels, ...member.warnLabels]))
    }
  }

  lines.push('')
  lines.push(`**Warnings** (${warnOnlyMembers.length} members)`)
  if (warnOnlyMembers.length === 0) {
    lines.push('_none_')
  } else {
    for (const member of warnOnlyMembers) {
      lines.push(renderMemberLine(member.username, member.warnLabels))
    }
  }

  lines.push('')
  lines.push(EX_MEMBER_NOTE)

  return lines
}
