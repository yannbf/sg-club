import { describe, expect, it } from 'vitest'
import type { PlayRequiredRow } from '../../../website/src/lib/beaten'
import { buildVerificationQueueMessage, countVerificationQueue } from './discord-verification-queue'

function row(overrides: {
  isExMember?: boolean
  isPlayRequired?: boolean
  isIpb?: boolean
  prRegistered?: boolean
  confirmed?: boolean
  verdict?: PlayRequiredRow['beaten']['verdict']
  isLikely?: boolean
  ipbStatus?: PlayRequiredRow['ipbStatus']
}): PlayRequiredRow {
  return {
    winner: { isExMember: overrides.isExMember ?? false },
    isPlayRequired: overrides.isPlayRequired ?? false,
    isIpb: overrides.isIpb ?? false,
    prRegistered: overrides.prRegistered ?? true,
    prSheetStatus: null,
    attestation: { confirmed: overrides.confirmed ?? false },
    beaten: { verdict: overrides.verdict ?? 'not_beaten' },
    likelyBeaten: { isLikely: overrides.isLikely ?? false },
    ipbStatus: overrides.ipbStatus ?? 'not_submitted',
  } as PlayRequiredRow
}

describe('countVerificationQueue', () => {
  it('counts every unregistered Play Required win, beaten or not', () => {
    const counts = countVerificationQueue([
      row({ isPlayRequired: true, prRegistered: false }),
      row({ isPlayRequired: true, prRegistered: false, verdict: 'beaten_verified' }),
    ])
    expect(counts.notInSheet).toBe(2)
  })

  it('counts only pending Play Required wins with evidence of completion', () => {
    const counts = countVerificationQueue([
      row({ isPlayRequired: true, verdict: 'beaten_verified' }),
      row({ isPlayRequired: true, verdict: 'no_marker', isLikely: true }),
      row({ isPlayRequired: true, verdict: 'not_beaten' }),
      row({ isPlayRequired: true, verdict: 'beaten_verified', confirmed: true }),
    ])
    expect(counts.pendingLikelyBeaten).toBe(2)
  })

  it('counts submitted I Play Bro wins only', () => {
    const counts = countVerificationQueue([
      row({ isIpb: true, ipbStatus: 'submitted' }),
      row({ isIpb: true, ipbStatus: 'verified' }),
      row({ isIpb: true, ipbStatus: 'not_applicable' }),
    ])
    expect(counts.ipbPending).toBe(1)
  })

  it('ignores ex-members in every queue', () => {
    const counts = countVerificationQueue([
      row({ isExMember: true, isPlayRequired: true, prRegistered: false }),
      row({ isExMember: true, isPlayRequired: true, verdict: 'beaten_verified' }),
      row({ isExMember: true, isIpb: true, ipbStatus: 'submitted' }),
    ])
    expect(counts).toEqual({ notInSheet: 0, pendingLikelyBeaten: 0, ipbPending: 0 })
  })
})

describe('buildVerificationQueueMessage', () => {
  it('links each queue to its sub-tab without a link preview', () => {
    expect(
      buildVerificationQueueMessage({ notInSheet: 5, pendingLikelyBeaten: 2, ipbPending: 56 })
    ).toBe(
      [
        '**Verification Queue**',
        '- Play Required, not registered in the sheet: [**5 wins**](<https://sg-club.vercel.app/verification/?tab=play-required&card=not-in-sheet>)',
        '- Play Required, pending verification: [**2 wins, likely beaten**](<https://sg-club.vercel.app/verification/?tab=play-required>)',
        '- I Play Bro, pending verification: [**56 submissions**](<https://sg-club.vercel.app/verification/?tab=ipb>)',
      ].join('\n')
    )
  })

  it('uses singular nouns and drops empty queues', () => {
    expect(
      buildVerificationQueueMessage({ notInSheet: 0, pendingLikelyBeaten: 1, ipbPending: 1 })
    ).toBe(
      [
        '**Verification Queue**',
        '- Play Required, pending verification: [**1 win, likely beaten**](<https://sg-club.vercel.app/verification/?tab=play-required>)',
        '- I Play Bro, pending verification: [**1 submission**](<https://sg-club.vercel.app/verification/?tab=ipb>)',
      ].join('\n')
    )
  })

  it('returns null when every queue is empty', () => {
    expect(
      buildVerificationQueueMessage({ notInSheet: 0, pendingLikelyBeaten: 0, ipbPending: 0 })
    ).toBeNull()
  })
})
