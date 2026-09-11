import { describe, expect, it, vi } from 'vitest'
import {
  buildFindingDetails,
  buildModReportLines,
  chunkMessage,
  collectGroupWarningFindings,
  groupFindingsByMemberForReport,
  importanceRank,
  renderMemberLine,
  severityFor,
  type GroupWarningFinding,
} from './mod-report.js'

vi.mock('./data', () => ({
  loadDataFile: vi.fn(async (name: string) => {
    if (name === 'group_users.json') {
      return {
        users: {
          '1': {
            username: 'alice',
            steam_id: '1',
            warnings: ['required_play_deadline_expired', 'no_giveaway_created_in_6_months'],
          },
          '2': { username: 'bob', steam_id: '2', warnings: ['required_plays_need_review'] },
          '3': { username: 'carol', steam_id: '3', warnings: [] },
          '4': { username: 'dave', steam_id: '4', warnings: ['some_unknown_code'] },
          '5': {
            username: 'erin',
            steam_id: '5',
            warnings: ['unplayed_required_play_giveaways'],
            giveaways_won: [
              {
                name: 'Sonic Frontiers',
                // Any past end date works: the detail only lists the name.
                end_timestamp: 1_700_000_000,
                required_play: true,
                required_play_meta: {},
              },
            ],
          },
          '6': {
            username: 'frank',
            steam_id: '6',
            warnings: ['zero_play_rate_with_wins'],
            kicked_pending_sync: true,
          },
        },
      }
    }
    throw new Error(`unexpected data file ${name}`)
  }),
}))

describe('severityFor', () => {
  it('classifies the four error codes as error', () => {
    for (const code of [
      'illegal_entered_required_play_giveaways',
      'illegal_entered_any_giveaways',
      'required_play_deadline_expired',
      'zero_play_rate_with_wins',
    ]) {
      expect(severityFor(code)).toBe('error')
    }
  })

  it('classifies the six warn codes as warn', () => {
    for (const code of [
      'required_plays_need_review',
      'unplayed_required_play_giveaways',
      'required_play_deadline_within_15_days',
      'low_play_rate_many_wins',
      'inactive_play_but_active',
      'no_giveaway_created_in_6_months',
    ]) {
      expect(severityFor(code)).toBe('warn')
    }
  })

  it('defaults unknown codes to warn', () => {
    expect(severityFor('made_up_code')).toBe('warn')
  })
})

describe('collectGroupWarningFindings', () => {
  it('flattens each member warning into one finding, with label + severity attached', async () => {
    const findings = await collectGroupWarningFindings()

    expect(findings).toContainEqual({
      username: 'alice',
      code: 'required_play_deadline_expired',
      label: 'Required-play deadline expired',
      severity: 'error',
      detail: undefined,
    })
    expect(findings).toContainEqual({
      username: 'alice',
      code: 'no_giveaway_created_in_6_months',
      label: 'No giveaway created in 6 months',
      severity: 'warn',
      detail: 'never created one',
    })
    expect(findings).toContainEqual({
      username: 'bob',
      code: 'required_plays_need_review',
      label: 'Required-play wins that may already be done',
      severity: 'warn',
      detail: undefined,
    })
  })

  it('skips members with no warnings', async () => {
    const findings = await collectGroupWarningFindings()
    expect(findings.some((f) => f.username === 'carol')).toBe(false)
  })

  it('falls back to the raw code as the label for unrecognized codes, and defaults to warn severity', async () => {
    const findings = await collectGroupWarningFindings()
    expect(findings).toContainEqual({
      username: 'dave',
      code: 'some_unknown_code',
      label: 'some_unknown_code',
      severity: 'warn',
      detail: undefined,
    })
  })

  it('attaches game-name details when the member has giveaways_won data', async () => {
    const findings = await collectGroupWarningFindings()
    const erin = findings.find((f) => f.username === 'erin')
    expect(erin?.code).toBe('unplayed_required_play_giveaways')
    expect(erin?.detail).toBe('Sonic Frontiers (not launched)')
  })

  it('skips members already kicked and pending a SteamGifts sync', async () => {
    const findings = await collectGroupWarningFindings()
    expect(findings.some((f) => f.username === 'frank')).toBe(false)
  })
})

describe('buildFindingDetails', () => {
  const DAY = 24 * 60 * 60
  // End timestamp chosen mid-month so the +2-months default deadline math is
  // not affected by month-length edge cases.
  const END = Math.floor(new Date(2026, 0, 15).getTime() / 1000)
  const win = (overrides: object) => ({
    name: 'Sonic Frontiers',
    end_timestamp: END,
    required_play: true,
    required_play_meta: {},
    ...overrides,
  })
  const userWith = (giveaways_won: object[], overrides: object = {}) => ({
    username: 'u',
    steam_id: '1',
    giveaways_won: giveaways_won as never,
    ...overrides,
  })

  it('returns no required-play details when the member has no unmet required-play wins', () => {
    const details = buildFindingDetails(userWith([]), END)
    expect(details.unplayed_required_play_giveaways).toBeUndefined()
    expect(details.required_play_deadline_expired).toBeUndefined()
    expect(details.required_play_deadline_within_15_days).toBeUndefined()
    expect(details.required_plays_need_review).toBeUndefined()

    expect(
      buildFindingDetails(userWith([win({ required_play_meta: { requirements_met: true } })]), END)
        .unplayed_required_play_giveaways
    ).toBeUndefined()
  })

  it('lists unmet required-play wins by name with play evidence, joined with commas', () => {
    const details = buildFindingDetails(
      userWith([
        win({ steam_play_data: { playtime_minutes: 662, achievements_percentage: 60.4 } }),
        win({ name: 'Hollow Knight: Silksong' }),
      ]),
      END
    )
    expect(details.unplayed_required_play_giveaways).toBe(
      'Sonic Frontiers (11h played, 60.4% achievements), Hollow Knight: Silksong (not launched)'
    )
  })

  it('marks a win as deadline-expired using end date + deadline_in_months (default 2), merging play evidence and the deadline into one parenthetical', () => {
    const deadline = new Date(END * 1000)
    deadline.setMonth(deadline.getMonth() + 2)
    const deadlineSec = Math.floor(deadline.getTime() / 1000)

    const expiredNow = deadlineSec + 275 * DAY
    const details = buildFindingDetails(userWith([win({})]), expiredNow)
    expect(details.required_play_deadline_expired).toBe(
      `Sonic Frontiers (not launched, deadline <t:${deadlineSec}:R>)`
    )
    expect(details.required_play_deadline_within_15_days).toBeUndefined()
  })

  it('honors an explicit dd.MM.yyyy deadline over the months-based one', () => {
    const explicit = Math.floor(new Date(2026, 5, 30, 23, 59, 59, 999).getTime() / 1000)
    const details = buildFindingDetails(
      userWith([win({ required_play_meta: { deadline: '30.06.2026', deadline_in_months: 6 } })]),
      explicit + DAY
    )
    expect(details.required_play_deadline_expired).toBe(
      `Sonic Frontiers (not launched, deadline <t:${explicit}:R>)`
    )
  })

  it('classifies a deadline in the next 15 days as due-soon, not expired', () => {
    const deadline = new Date(END * 1000)
    deadline.setMonth(deadline.getMonth() + 2)
    const now = Math.floor(deadline.getTime() / 1000) - 10 * DAY

    const details = buildFindingDetails(userWith([win({})]), now)
    expect(details.required_play_deadline_within_15_days).toContain('Sonic Frontiers')
    expect(details.required_play_deadline_expired).toBeUndefined()
  })

  it('lists ALL unmet required-play wins with play evidence for needs-review, without re-deriving the scraper\'s threshold', () => {
    const details = buildFindingDetails(
      userWith([
        win({ steam_play_data: { playtime_minutes: 662, achievements_percentage: 60.4 } }),
        win({ name: 'Barely Touched', steam_play_data: { playtime_minutes: 30 } }),
        win({ name: 'Not Launched Yet' }),
      ]),
      END
    )
    expect(details.required_plays_need_review).toBe(
      'Sonic Frontiers (11h played, 60.4% achievements), Barely Touched (0.5h played), Not Launched Yet (not launched)'
    )
  })

  it('reports "not launched" when there is no recorded playtime, with no achievements clause', () => {
    const details = buildFindingDetails(userWith([win({})]), END)
    expect(details.unplayed_required_play_giveaways).toBe('Sonic Frontiers (not launched)')
  })

  it('omits the achievements clause when the percentage is unknown', () => {
    const details = buildFindingDetails(
      userWith([win({ steam_play_data: { playtime_minutes: 120 } })]),
      END
    )
    expect(details.unplayed_required_play_giveaways).toBe('Sonic Frontiers (2h played)')
  })

  it('computes a play-rate fraction for both play-rate codes, excluding unreleased wins', () => {
    const details = buildFindingDetails(
      userWith([
        // Played: has Steam stats and wasn't never-played.
        { name: 'Played Game', steam_play_data: {} },
        // Unplayed: never_played is set.
        { name: 'Unplayed Game', steam_play_data: { never_played: true } },
        // Excluded from the total: not released yet.
        { name: 'Unreleased Game', unreleased: true },
      ]),
      END
    )
    expect(details.low_play_rate_many_wins).toBe('1 of 2 wins played (50%)')
    expect(details.zero_play_rate_with_wins).toBe('1 of 2 wins played (50%)')
  })

  it('counts i_played_bro and requirements_met as played even with no Steam stats', () => {
    const details = buildFindingDetails(
      userWith([
        { name: 'Attested', i_played_bro: true },
        { name: 'Required play met', required_play_meta: { requirements_met: true } },
      ]),
      END
    )
    expect(details.zero_play_rate_with_wins).toBe('2 of 2 wins played (100%)')
  })

  it('omits play-rate details when the member has no wins', () => {
    const details = buildFindingDetails(userWith([]), END)
    expect(details.low_play_rate_many_wins).toBeUndefined()
    expect(details.zero_play_rate_with_wins).toBeUndefined()
  })

  it('reports the last-created timestamp, or "never created one" when absent', () => {
    const withStats = buildFindingDetails(
      userWith([], { stats: { last_giveaway_created_at: 1_700_000_000 } }),
      END
    )
    expect(withStats.no_giveaway_created_in_6_months).toBe('last created <t:1700000000:R>')

    const withoutStats = buildFindingDetails(userWith([]), END)
    expect(withoutStats.no_giveaway_created_in_6_months).toBe('never created one')
  })

  it('reports the last-played timestamp (converted from milliseconds) only when set', () => {
    const withLastPlayed = buildFindingDetails(userWith([], { last_played_at: 1_700_000_000_000 }), END)
    expect(withLastPlayed.inactive_play_but_active).toBe('last played <t:1700000000:R>')

    const withoutLastPlayed = buildFindingDetails(userWith([]), END)
    expect(withoutLastPlayed.inactive_play_but_active).toBeUndefined()
  })
})

describe('renderMemberLine', () => {
  it('links to the member page with a preview-suppressing <url> and joins findings with " · "', () => {
    expect(renderMemberLine('yannbf', ['Finding A', 'Finding B'])).toBe(
      '- [yannbf](<https://sg-club.vercel.app/users/yannbf/>) — Finding A · Finding B'
    )
  })

  it('contains no emojis', () => {
    const line = renderMemberLine('yannbf', ['Finding A'])
    const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
    expect(emojiPattern.test(line)).toBe(false)
  })
})

describe('chunkMessage', () => {
  it('joins short segments into a single message', () => {
    expect(chunkMessage(['a', 'b', 'c'])).toEqual(['a\nb\nc'])
  })

  it('returns an empty array for zero segments', () => {
    expect(chunkMessage([])).toEqual([])
  })

  it('never splits a segment across two messages and stays under maxLength', () => {
    const segments = Array.from({ length: 40 }, (_, i) => `segment-${i}-${'x'.repeat(50)}`)
    const chunks = chunkMessage(segments, 500)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(500)
    }
    // Reconstructing all segments from all chunks yields the original list.
    const reconstructed = chunks.flatMap((c) => c.split('\n'))
    expect(reconstructed).toEqual(segments)
  })

  it('lets an over-length single segment stand alone rather than dropping it', () => {
    const huge = 'x'.repeat(2000)
    expect(chunkMessage([huge], 1900)).toEqual([huge])
  })

  it('defaults to a 1990-char budget (10 chars of headroom under Discord\'s 2000 cap)', () => {
    // Two 900-char segments (1801 total joined) always fit one message; the
    // interesting case is content that only fits with the wider budget.
    const a = 'a'.repeat(900)
    const b = 'b'.repeat(900)
    expect(chunkMessage([a, b])).toEqual([`${a}\n${b}`])
  })

  it('packs greedily to the full budget instead of splitting early: two segments that fit', () => {
    // 950 + 1 (separator) + 950 = 1901 chars — this exceeds the old 1900
    // default (which would have forced 2 messages) but fits the current
    // 1990 default in one message.
    const a = 'a'.repeat(950)
    const b = 'b'.repeat(950)
    const chunks = chunkMessage([a, b])
    expect(chunks).toEqual([`${a}\n${b}`])
    expect(chunks).toHaveLength(1)
  })

  it('only splits into a new message when the next segment truly does not fit', () => {
    // Three segments where the first two fit together but the third would
    // push the running message over budget — greedy packing should keep
    // segments 1+2 together and only start a new message for segment 3.
    const seg1 = 'a'.repeat(1000)
    const seg2 = 'b'.repeat(950) // 1000+1+950 = 1951, still under 1990
    const seg3 = 'c'.repeat(950) // adding this would push to 2902
    const chunks = chunkMessage([seg1, seg2, seg3])
    expect(chunks).toEqual([`${seg1}\n${seg2}`, seg3])
  })
})

describe('groupFindingsByMemberForReport', () => {
  const findings: GroupWarningFinding[] = [
    { username: 'zack', code: 'zero_play_rate_with_wins', label: 'Zero play rate', severity: 'error' },
    { username: 'zack', code: 'low_play_rate_many_wins', label: 'Low play rate', severity: 'warn' },
    {
      username: 'amy',
      code: 'required_plays_need_review',
      label: 'Needs review',
      severity: 'warn',
      detail: 'Some Game',
    },
  ]

  it('splits each member into error vs warn (code, label, detail) buckets', () => {
    const grouped = groupFindingsByMemberForReport(findings)
    const zack = grouped.find((m) => m.username === 'zack')
    expect(zack).toEqual({
      username: 'zack',
      errorFindings: [{ code: 'zero_play_rate_with_wins', label: 'Zero play rate', detail: undefined }],
      warnFindings: [{ code: 'low_play_rate_many_wins', label: 'Low play rate', detail: undefined }],
    })

    const amy = grouped.find((m) => m.username === 'amy')
    expect(amy?.warnFindings).toEqual([
      { code: 'required_plays_need_review', label: 'Needs review', detail: 'Some Game' },
    ])
  })

  it('sorts members alphabetically', () => {
    const grouped = groupFindingsByMemberForReport(findings)
    expect(grouped.map((m) => m.username)).toEqual(['amy', 'zack'])
  })
})

describe('importanceRank', () => {
  it('ranks needs-review above deadline-expired (more actionable) but below illegal entries', () => {
    expect(importanceRank('required_plays_need_review')).toBeLessThan(
      importanceRank('required_play_deadline_expired')
    )
    expect(importanceRank('illegal_entered_any_giveaways')).toBeLessThan(
      importanceRank('required_plays_need_review')
    )
  })

  it('ranks no_giveaway_created_in_6_months last among known codes', () => {
    const knownCodes = [
      'illegal_entered_any_giveaways',
      'illegal_entered_required_play_giveaways',
      'unplayed_required_play_giveaways',
      'required_play_deadline_expired',
      'zero_play_rate_with_wins',
      'required_plays_need_review',
      'required_play_deadline_within_15_days',
      'low_play_rate_many_wins',
      'inactive_play_but_active',
    ]
    for (const code of knownCodes) {
      expect(importanceRank('no_giveaway_created_in_6_months')).toBeGreaterThan(importanceRank(code))
    }
  })

  it('ranks required_plays_need_review above no_giveaway_created_in_6_months', () => {
    expect(importanceRank('required_plays_need_review')).toBeLessThan(
      importanceRank('no_giveaway_created_in_6_months')
    )
  })

  it('ranks unknown codes just above no_giveaway_created_in_6_months, below every other known code', () => {
    const unknownRank = importanceRank('some_unknown_code')
    expect(unknownRank).toBeLessThan(importanceRank('no_giveaway_created_in_6_months'))
    expect(unknownRank).toBeGreaterThan(importanceRank('inactive_play_but_active'))
  })
})

describe('buildModReportLines', () => {
  it('renders a member with detailed findings as a block: head line + sub-bullets, labels/details in importance order', () => {
    const findings: GroupWarningFinding[] = [
      {
        username: 'zack',
        code: 'zero_play_rate_with_wins',
        label: 'Zero play rate',
        severity: 'error',
        detail: '0 of 3 wins played (0%)',
      },
      {
        username: 'zack',
        code: 'illegal_entered_any_giveaways',
        label: 'Entered while ineligible',
        severity: 'error',
      },
    ]
    const lines = buildModReportLines(findings)
    const block = lines.find((l) => l.includes('[zack]'))!.split('\n')
    expect(block[0]).toBe(
      '- [zack](<https://sg-club.vercel.app/users/zack/>) — Entered while ineligible · Zero play rate'
    )
    expect(block[1]).toBe('  - Zero play rate: 0 of 3 wins played (0%)')
  })

  it('renders a member with no detailed findings as a head-only line, no sub-bullets', () => {
    const findings: GroupWarningFinding[] = [
      { username: 'amy', code: 'required_plays_need_review', label: 'Needs review', severity: 'warn' },
    ]
    const lines = buildModReportLines(findings)
    const block = lines.find((l) => l.includes('[amy]'))!.split('\n')
    expect(block).toEqual([
      '- [amy](<https://sg-club.vercel.app/users/amy/?tab=won&filter=play-required>) — Needs review',
    ])
  })

  it('folds a single finding with a detail into one line, "<label>: <detail>", with no sub-bullet', () => {
    const findings: GroupWarningFinding[] = [
      {
        username: 'amy',
        code: 'required_plays_need_review',
        label: 'Needs review',
        severity: 'warn',
        detail: 'Factorio (1.2h played, 1% achievements)',
      },
    ]
    const lines = buildModReportLines(findings)
    const block = lines.find((l) => l.includes('[amy]'))!.split('\n')
    expect(block).toEqual([
      '- [amy](<https://sg-club.vercel.app/users/amy/?tab=won&filter=play-required>) — Needs review: Factorio (1.2h played, 1% achievements)',
    ])
  })

  it('places a member with any error finding in Need attention, and one whose findings are all warn in Warnings', () => {
    const findings: GroupWarningFinding[] = [
      { username: 'zack', code: 'zero_play_rate_with_wins', label: 'Zero play rate', severity: 'error' },
      { username: 'amy', code: 'required_plays_need_review', label: 'Needs review', severity: 'warn' },
    ]
    const lines = buildModReportLines(findings)
    const needAttentionIdx = lines.findIndex((l) => l.startsWith('‼️ **Need attention**'))
    const warningsIdx = lines.findIndex((l) => l.startsWith('👀 **Warnings**'))
    const zackIdx = lines.findIndex((l) => l.includes('[zack]'))
    const amyIdx = lines.findIndex((l) => l.includes('[amy]'))

    expect(zackIdx).toBeGreaterThan(needAttentionIdx)
    expect(zackIdx).toBeLessThan(warningsIdx)
    expect(amyIdx).toBeGreaterThan(warningsIdx)
  })

  it('orders members within a section by importance rank of their most important finding, then by username', () => {
    const findings: GroupWarningFinding[] = [
      // Least important known code — should sort last.
      {
        username: 'zed',
        code: 'no_giveaway_created_in_6_months',
        label: 'No giveaway created in 6 months',
        severity: 'warn',
      },
      // More important — should sort first.
      { username: 'bob', code: 'required_plays_need_review', label: 'Needs review', severity: 'warn' },
      { username: 'amy', code: 'required_plays_need_review', label: 'Needs review', severity: 'warn' },
    ]
    const lines = buildModReportLines(findings)
    const amyIdx = lines.findIndex((l) => l.includes('[amy]'))
    const bobIdx = lines.findIndex((l) => l.includes('[bob]'))
    const zedIdx = lines.findIndex((l) => l.includes('[zed]'))

    expect(amyIdx).toBeLessThan(bobIdx) // same rank, alphabetical
    expect(bobIdx).toBeLessThan(zedIdx) // higher importance sorts first
  })

  it('deep-links only members whose findings include a play-required code', () => {
    const findings: GroupWarningFinding[] = [
      { username: 'zed', code: 'zero_play_rate_with_wins', label: 'Zero play rate', severity: 'error' },
      { username: 'pat', code: 'unplayed_required_play_giveaways', label: 'Unplayed', severity: 'warn' },
    ]
    const lines = buildModReportLines(findings)
    expect(lines.find((l) => l.includes('[zed]'))).toBe(
      '- [zed](<https://sg-club.vercel.app/users/zed/>) — Zero play rate'
    )
    expect(lines.find((l) => l.includes('[pat]'))).toBe(
      '- [pat](<https://sg-club.vercel.app/users/pat/?tab=won&filter=play-required>) — Unplayed'
    )
  })

  it('reports accurate member counts in each section header', () => {
    const findings: GroupWarningFinding[] = [
      { username: 'zack', code: 'zero_play_rate_with_wins', label: 'Zero play rate', severity: 'error' },
      { username: 'amy', code: 'required_plays_need_review', label: 'Needs review', severity: 'warn' },
    ]
    const lines = buildModReportLines(findings)
    expect(lines).toContain('‼️ **Need attention** (1 members)')
    expect(lines).toContain('👀 **Warnings** (1 members)')
  })

  it('ends with the ex-member note', () => {
    const lines = buildModReportLines([])
    expect(lines.at(-1)).toBe('Ex-member entry checks run in the weekly digest only.')
  })

  it('renders findings/note lines with no emojis, and carries ‼️/👀 only on the two section headers', () => {
    const findings: GroupWarningFinding[] = [
      { username: 'zack', code: 'zero_play_rate_with_wins', label: 'Zero play rate', severity: 'error' },
      { username: 'amy', code: 'required_plays_need_review', label: 'Needs review', severity: 'warn' },
    ]
    const lines = buildModReportLines(findings)
    const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u

    const needAttentionHeader = lines.find((l) => l.includes('Need attention'))!
    const warningsHeader = lines.find((l) => l.includes('**Warnings**'))!
    expect(needAttentionHeader.startsWith('‼️ ')).toBe(true)
    expect(warningsHeader.startsWith('👀 ')).toBe(true)

    const nonHeaderLines = lines.filter((l) => l !== needAttentionHeader && l !== warningsHeader)
    for (const line of nonHeaderLines) {
      expect(emojiPattern.test(line)).toBe(false)
    }
  })

  it('shows empty-section placeholders and zero counts when there are no findings', () => {
    const lines = buildModReportLines([])
    expect(lines).toContain('‼️ **Need attention** (0 members)')
    expect(lines).toContain('👀 **Warnings** (0 members)')
    expect(lines.filter((l) => l === '_none_')).toHaveLength(2)
  })
})
