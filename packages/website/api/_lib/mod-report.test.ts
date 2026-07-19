import { describe, expect, it, vi } from 'vitest'
import {
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
        },
      }
    }
    throw new Error(`unexpected data file ${name}`)
  }),
}))

describe('severityFor', () => {
  it('classifies the five error codes as error', () => {
    for (const code of [
      'illegal_entered_required_play_giveaways',
      'illegal_entered_any_giveaways',
      'unplayed_required_play_giveaways',
      'required_play_deadline_expired',
      'zero_play_rate_with_wins',
    ]) {
      expect(severityFor(code)).toBe('error')
    }
  })

  it('classifies the five warn codes as warn', () => {
    for (const code of [
      'required_plays_need_review',
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
    })
    expect(findings).toContainEqual({
      username: 'alice',
      code: 'no_giveaway_created_in_6_months',
      label: 'No giveaway created in 6 months',
      severity: 'warn',
    })
    expect(findings).toContainEqual({
      username: 'bob',
      code: 'required_plays_need_review',
      label: 'Required-play win(s) need review',
      severity: 'warn',
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
    })
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
})

describe('groupFindingsByMemberForReport', () => {
  const findings: GroupWarningFinding[] = [
    { username: 'zack', code: 'zero_play_rate_with_wins', label: 'Zero play rate', severity: 'error' },
    { username: 'zack', code: 'low_play_rate_many_wins', label: 'Low play rate', severity: 'warn' },
    { username: 'amy', code: 'required_plays_need_review', label: 'Needs review', severity: 'warn' },
  ]

  it('splits each member into error vs warn (code, label) buckets', () => {
    const grouped = groupFindingsByMemberForReport(findings)
    const zack = grouped.find((m) => m.username === 'zack')
    expect(zack).toEqual({
      username: 'zack',
      errorFindings: [{ code: 'zero_play_rate_with_wins', label: 'Zero play rate' }],
      warnFindings: [{ code: 'low_play_rate_many_wins', label: 'Low play rate' }],
    })
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
  const findings: GroupWarningFinding[] = [
    { username: 'zack', code: 'zero_play_rate_with_wins', label: 'Zero play rate', severity: 'error' },
    { username: 'zack', code: 'low_play_rate_many_wins', label: 'Low play rate', severity: 'warn' },
    { username: 'amy', code: 'required_plays_need_review', label: 'Needs review', severity: 'warn' },
  ]

  it('places a member with any error finding in Need attention, listing labels in importance order', () => {
    const lines = buildModReportLines(findings)
    const needAttentionIdx = lines.findIndex((l) => l.startsWith('**Need attention**'))
    const zackLine = lines.find((l) => l.includes('[zack]'))!
    const zackIdx = lines.indexOf(zackLine)
    const warningsIdx = lines.findIndex((l) => l.startsWith('**Warnings**'))

    expect(zackIdx).toBeGreaterThan(needAttentionIdx)
    expect(zackIdx).toBeLessThan(warningsIdx)
    expect(zackLine).toBe(
      'Zero play rate · Low play rate: [zack](<https://sg-club.vercel.app/users/zack/>)'
    )
  })

  it('places a member whose findings are all warn-level in Warnings only', () => {
    const lines = buildModReportLines(findings)
    const amyLine = lines.find((l) => l.includes('[amy]'))!
    const warningsIdx = lines.findIndex((l) => l.startsWith('**Warnings**'))
    expect(lines.indexOf(amyLine)).toBeGreaterThan(warningsIdx)
  })

  it('reports accurate member counts in each section header', () => {
    const lines = buildModReportLines(findings)
    expect(lines).toContain('**Need attention** (1 members)')
    expect(lines).toContain('**Warnings** (1 members)')
  })

  it('ends with the ex-member note', () => {
    const lines = buildModReportLines(findings)
    expect(lines.at(-1)).toBe('Ex-member entry checks run in the weekly digest only.')
  })

  it('renders no emojis anywhere', () => {
    const lines = buildModReportLines(findings)
    const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
    expect(emojiPattern.test(lines.join('\n'))).toBe(false)
  })

  it('shows empty-section placeholders and zero counts when there are no findings', () => {
    const lines = buildModReportLines([])
    expect(lines).toContain('**Need attention** (0 members)')
    expect(lines).toContain('**Warnings** (0 members)')
    expect(lines.filter((l) => l === '_none_')).toHaveLength(2)
  })

  describe('combo grouping', () => {
    it('groups ≥2 members sharing the exact same single-code combo onto one unbulleted line', () => {
      const shared: GroupWarningFinding[] = [
        { username: 'bob', code: 'required_plays_need_review', label: 'Needs review', severity: 'warn' },
        { username: 'amy', code: 'required_plays_need_review', label: 'Needs review', severity: 'warn' },
      ]
      const lines = buildModReportLines(shared)
      // Label line, then a bulleted member list; needs-review is a
      // play-required code so members get the Won-tab deep link.
      expect(lines).toContain(
        'Needs review:\n- [amy](<https://sg-club.vercel.app/users/amy/?tab=won&filter=play-required>), [bob](<https://sg-club.vercel.app/users/bob/?tab=won&filter=play-required>)\n'
      )
    })

    it('groups ≥2 members sharing the exact same multi-code combo, with labels in importance order', () => {
      const shared: GroupWarningFinding[] = [
        { username: 'zack', code: 'low_play_rate_many_wins', label: 'Low play rate', severity: 'warn' },
        { username: 'zack', code: 'zero_play_rate_with_wins', label: 'Zero play rate', severity: 'error' },
        { username: 'amy', code: 'zero_play_rate_with_wins', label: 'Zero play rate', severity: 'error' },
        { username: 'amy', code: 'low_play_rate_many_wins', label: 'Low play rate', severity: 'warn' },
      ]
      const lines = buildModReportLines(shared)
      expect(lines).toContain(
        'Zero play rate · Low play rate:\n- [amy](<https://sg-club.vercel.app/users/amy/>), [zack](<https://sg-club.vercel.app/users/zack/>)\n'
      )
    })

    it('renders a combo unique to 1 member as a single unbulleted line', () => {
      const unique: GroupWarningFinding[] = [
        { username: 'amy', code: 'required_plays_need_review', label: 'Needs review', severity: 'warn' },
      ]
      const lines = buildModReportLines(unique)
      expect(lines).toContain(
        'Needs review: [amy](<https://sg-club.vercel.app/users/amy/?tab=won&filter=play-required>)'
      )
    })

    it('does not group members whose code sets differ even if labels overlap', () => {
      const different: GroupWarningFinding[] = [
        { username: 'amy', code: 'required_plays_need_review', label: 'Needs review', severity: 'warn' },
        { username: 'bob', code: 'required_plays_need_review', label: 'Needs review', severity: 'warn' },
        { username: 'bob', code: 'inactive_play_but_active', label: 'Inactive', severity: 'warn' },
      ]
      const lines = buildModReportLines(different)
      expect(lines).toContain(
        'Needs review: [amy](<https://sg-club.vercel.app/users/amy/?tab=won&filter=play-required>)'
      )
      expect(lines).toContain(
        'Needs review · Inactive: [bob](<https://sg-club.vercel.app/users/bob/?tab=won&filter=play-required>)'
      )
    })

    it('deep-links only members whose combo includes a play-required code', () => {
      const mixed: GroupWarningFinding[] = [
        { username: 'zed', code: 'zero_play_rate_with_wins', label: 'Zero play rate', severity: 'error' },
        { username: 'pat', code: 'unplayed_required_play_giveaways', label: 'Unplayed', severity: 'error' },
      ]
      const lines = buildModReportLines(mixed)
      expect(lines).toContain('Zero play rate: [zed](<https://sg-club.vercel.app/users/zed/>)')
      expect(lines).toContain(
        'Unplayed: [pat](<https://sg-club.vercel.app/users/pat/?tab=won&filter=play-required>)'
      )
    })

    it('orders combo lines by importance of the most important code, then member count, then first member', () => {
      const findings: GroupWarningFinding[] = [
        // Unique, no_giveaway (least important) — should sort last.
        {
          username: 'zed',
          code: 'no_giveaway_created_in_6_months',
          label: 'No giveaway created in 6 months',
          severity: 'warn',
        },
        // Shared pair, required_plays_need_review (more important) — should sort first.
        { username: 'amy', code: 'required_plays_need_review', label: 'Needs review', severity: 'warn' },
        { username: 'bob', code: 'required_plays_need_review', label: 'Needs review', severity: 'warn' },
      ]
      const lines = buildModReportLines(findings)
      const warningsIdx = lines.findIndex((l) => l.startsWith('**Warnings**'))
      const sharedLineIdx = lines.findIndex((l) => l.startsWith('Needs review:'))
      const zedLineIdx = lines.findIndex((l) => l.includes('[zed]'))

      expect(sharedLineIdx).toBeGreaterThan(warningsIdx)
      expect(sharedLineIdx).toBeLessThan(zedLineIdx)
    })
  })
})
