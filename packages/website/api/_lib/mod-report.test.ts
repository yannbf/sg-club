import { describe, expect, it, vi } from 'vitest'
import {
  buildModReportLines,
  chunkMessage,
  collectGroupWarningFindings,
  groupFindingsByMemberForReport,
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

  it('splits each member into error vs warn label buckets', () => {
    const grouped = groupFindingsByMemberForReport(findings)
    const zack = grouped.find((m) => m.username === 'zack')
    expect(zack).toEqual({ username: 'zack', errorLabels: ['Zero play rate'], warnLabels: ['Low play rate'] })
  })

  it('sorts members alphabetically', () => {
    const grouped = groupFindingsByMemberForReport(findings)
    expect(grouped.map((m) => m.username)).toEqual(['amy', 'zack'])
  })
})

describe('buildModReportLines', () => {
  const findings: GroupWarningFinding[] = [
    { username: 'zack', code: 'zero_play_rate_with_wins', label: 'Zero play rate', severity: 'error' },
    { username: 'zack', code: 'low_play_rate_many_wins', label: 'Low play rate', severity: 'warn' },
    { username: 'amy', code: 'required_plays_need_review', label: 'Needs review', severity: 'warn' },
  ]

  it('places a member with any error finding in Errors, listing error labels before warn labels', () => {
    const lines = buildModReportLines(findings)
    const errorsIdx = lines.findIndex((l) => l.startsWith('**Errors**'))
    const zackLine = lines.find((l) => l.includes('[zack]'))!
    const zackIdx = lines.indexOf(zackLine)
    const warningsIdx = lines.findIndex((l) => l.startsWith('**Warnings**'))

    expect(zackIdx).toBeGreaterThan(errorsIdx)
    expect(zackIdx).toBeLessThan(warningsIdx)
    expect(zackLine).toBe(
      '- [zack](<https://sg-club.vercel.app/users/zack/>) — Zero play rate · Low play rate'
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
    expect(lines).toContain('**Errors** (1 members)')
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
    expect(lines).toContain('**Errors** (0 members)')
    expect(lines).toContain('**Warnings** (0 members)')
    expect(lines.filter((l) => l === '_none_')).toHaveLength(2)
  })
})
