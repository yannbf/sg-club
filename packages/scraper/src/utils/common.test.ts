import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isRateLimitedHtml } from './common'

function mock(filename: string): string {
  return readFileSync(join(process.cwd(), 'mocks', filename), 'utf-8')
}

describe('isRateLimitedHtml', () => {
  it('detects the Cloudflare 1015 rate-limit interstitial', () => {
    expect(isRateLimitedHtml(mock('sg-cloudflare-rate-limited.html'))).toBe(true)
  })

  it("detects SteamGifts' own native throttle page", () => {
    expect(isRateLimitedHtml(mock('sg-too-many-requests.html'))).toBe(true)
  })

  it('does not flag a normal giveaway page', () => {
    expect(isRateLimitedHtml(mock('sg-giveaway-page.html'))).toBe(false)
  })

  it('handles empty/nullish input', () => {
    expect(isRateLimitedHtml('')).toBe(false)
    expect(isRateLimitedHtml(null)).toBe(false)
    expect(isRateLimitedHtml(undefined)).toBe(false)
  })
})
