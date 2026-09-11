import { describe, expect, it } from 'vitest'
import {
  applyShLinkPrecedence,
  buildOverrideKey,
  checkAnyOfApinamesBeaten,
  parseOverrideSteamHuntersLink,
  parseOverrideSteamLink,
  resolveOverrideAchievement,
} from './generate-beaten-data'

// The real BEATEN_OVERRIDES row for FINAL FANTASY VII REMAKE INTERGRADE, used
// to verify parsing against actual sheet data.
const FF7R_STEAM_LINK =
  'https://store.steampowered.com/app/1462040/FINAL_FANTASY_VII_REMAKE_INTERGRADE/'
const FF7R_SH_LINK =
  'https://steamhunters.com/apps/1462040/achievements/19/users?unlocked=true'

describe('parseOverrideSteamLink', () => {
  it('parses a store app URL', () => {
    expect(parseOverrideSteamLink(FF7R_STEAM_LINK)).toEqual({ kind: 'app', appId: 1462040 })
  })

  it('parses a store sub URL', () => {
    expect(parseOverrideSteamLink('https://store.steampowered.com/sub/12345/SomeBundle/')).toEqual({
      kind: 'sub',
      packageId: 12345,
    })
  })

  it('parses a steamcommunity app URL', () => {
    expect(parseOverrideSteamLink('https://steamcommunity.com/app/730')).toEqual({
      kind: 'app',
      appId: 730,
    })
  })

  it('parses a bare app id', () => {
    expect(parseOverrideSteamLink('440')).toEqual({ kind: 'app', appId: 440 })
  })

  it('ignores surrounding whitespace', () => {
    expect(parseOverrideSteamLink('  440  ')).toEqual({ kind: 'app', appId: 440 })
  })

  it('returns null for garbage input', () => {
    expect(parseOverrideSteamLink('not a link')).toBeNull()
    expect(parseOverrideSteamLink('https://example.com/app/440')).toBeNull()
    expect(parseOverrideSteamLink('')).toBeNull()
  })
})

const SCHEMA = [
  { name: 'ACH_ENDING', displayName: "Destiny's Crossroads" },
  { name: 'ACH_SECRET_ENDING', displayName: 'True Ending' },
  { name: 'ACH_NO_DISPLAY_NAME' },
]

describe('resolveOverrideAchievement', () => {
  it('matches by display name, case-insensitively', () => {
    expect(resolveOverrideAchievement("destiny's crossroads", SCHEMA)).toEqual({
      apinames: ['ACH_ENDING'],
    })
  })

  it('matches by apiname when no display name matches', () => {
    expect(resolveOverrideAchievement('ach_no_display_name', SCHEMA)).toEqual({
      apinames: ['ACH_NO_DISPLAY_NAME'],
    })
  })

  it('resolves multiple | separated alternatives', () => {
    expect(resolveOverrideAchievement("Destiny's Crossroads | True Ending", SCHEMA)).toEqual({
      apinames: ['ACH_ENDING', 'ACH_SECRET_ENDING'],
    })
  })

  it('treats NONE case-insensitively as "no valid ending achievement"', () => {
    expect(resolveOverrideAchievement('none', SCHEMA)).toEqual({ none: true })
    expect(resolveOverrideAchievement('NONE', SCHEMA)).toEqual({ none: true })
  })

  it('returns null when an alternative cannot be resolved', () => {
    expect(resolveOverrideAchievement('Nonexistent Achievement', SCHEMA)).toBeNull()
    expect(resolveOverrideAchievement("Destiny's Crossroads | Nonexistent", SCHEMA)).toBeNull()
  })
})

describe('parseOverrideSteamHuntersLink', () => {
  it('parses appId and achievementId from the real FF7R link', () => {
    expect(parseOverrideSteamHuntersLink(FF7R_SH_LINK)).toEqual({
      appId: 1462040,
      achievementId: 19,
    })
  })

  it('returns null for a non-matching URL', () => {
    expect(parseOverrideSteamHuntersLink('https://steamhunters.com/apps/1462040')).toBeNull()
  })
})

describe('buildOverrideKey', () => {
  it('builds a NONE signature', () => {
    expect(buildOverrideKey(1462040, { none: true })).toBe('1462040:NONE')
  })

  it('sorts apinames so order does not affect the signature', () => {
    expect(buildOverrideKey(730, { apinames: ['B', 'A'] })).toBe(
      buildOverrideKey(730, { apinames: ['A', 'B'] }),
    )
  })

  it('differs when the apiname set differs', () => {
    expect(buildOverrideKey(730, { apinames: ['A'] })).not.toBe(
      buildOverrideKey(730, { apinames: ['A', 'B'] }),
    )
  })
})

describe('applyShLinkPrecedence', () => {
  it('keeps the name-resolved apinames when there is no SH link', () => {
    expect(applyShLinkPrecedence(['ACH_ENDING'], undefined)).toEqual({
      apinames: ['ACH_ENDING'],
      disagreed: false,
    })
  })

  it('keeps the apinames when the SH link agrees', () => {
    expect(applyShLinkPrecedence(['ACH_ENDING'], 'ACH_ENDING')).toEqual({
      apinames: ['ACH_ENDING'],
      disagreed: false,
    })
  })

  it('the link wins when it disagrees with the name match', () => {
    expect(applyShLinkPrecedence(['ACH_ENDING'], 'ACH_OTHER')).toEqual({
      apinames: ['ACH_OTHER'],
      disagreed: true,
    })
  })
})

const achievement = (apiname: string, achieved: 0 | 1, unlocktime = 0) => ({
  apiname,
  achieved,
  unlocktime,
})

describe('checkAnyOfApinamesBeaten', () => {
  it('is beaten when the single apiname is unlocked', () => {
    expect(checkAnyOfApinamesBeaten([achievement('A', 1, 100)], ['A'])).toEqual({
      found: true,
      beaten: true,
      unlock_time: 100,
    })
  })

  it('is not beaten when the single apiname is locked', () => {
    expect(checkAnyOfApinamesBeaten([achievement('A', 0)], ['A'])).toEqual({
      found: true,
      beaten: false,
      unlock_time: null,
    })
  })

  it('is beaten when any listed apiname is unlocked', () => {
    const achievements = [achievement('A', 0), achievement('B', 1, 200)]
    expect(checkAnyOfApinamesBeaten(achievements, ['A', 'B'])).toEqual({
      found: true,
      beaten: true,
      unlock_time: 200,
    })
  })

  it('uses the earliest unlock time among the unlocked alternatives', () => {
    const achievements = [achievement('A', 1, 300), achievement('B', 1, 100)]
    expect(checkAnyOfApinamesBeaten(achievements, ['A', 'B'])).toEqual({
      found: true,
      beaten: true,
      unlock_time: 100,
    })
  })

  it('found is false when none of the apinames appear in player data at all', () => {
    expect(checkAnyOfApinamesBeaten([achievement('C', 1, 100)], ['A', 'B'])).toEqual({
      found: false,
      beaten: false,
      unlock_time: null,
    })
  })

  it('found is true but beaten is false when apinames appear but are all locked', () => {
    const achievements = [achievement('A', 0), achievement('B', 0)]
    expect(checkAnyOfApinamesBeaten(achievements, ['A', 'B'])).toEqual({
      found: true,
      beaten: false,
      unlock_time: null,
    })
  })
})
