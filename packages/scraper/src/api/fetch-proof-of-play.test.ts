import { describe, expect, it } from 'vitest'
import { readSheetStatus } from './fetch-proof-of-play.js'

describe('readSheetStatus', () => {
  it('reads YES regardless of case or whitespace', () => {
    expect(readSheetStatus('YES')).toBe('yes')
    expect(readSheetStatus(' yes ')).toBe('yes')
  })

  it('reads NO', () => {
    expect(readSheetStatus('NO')).toBe('no')
    expect(readSheetStatus(' no ')).toBe('no')
  })

  it('reads every spelling of not-applicable the same way', () => {
    for (const raw of ['NA', 'N/A', 'n/a', 'N.A.', ' N / A ', 'n.a']) {
      expect(readSheetStatus(raw), raw).toBe('na')
    }
  })

  it('reads blank and anything else as null', () => {
    expect(readSheetStatus('')).toBeNull()
    expect(readSheetStatus('NAH')).toBeNull()
    expect(readSheetStatus('pending')).toBeNull()
  })
})
