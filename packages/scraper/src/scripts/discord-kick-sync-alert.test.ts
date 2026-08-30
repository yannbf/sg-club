import { describe, expect, it } from 'vitest'
import type { FlaggedExMember } from './check-ex-member-entries'
import {
  buildKickSyncAlertMessage,
  diffNewLinks,
  type KickSyncAlertState,
} from './discord-kick-sync-alert'

const kickedMember: FlaggedExMember = {
  steam_id: '1',
  username: 'kickedUser',
  profile_url: '/user/kickedUser',
  left_at_timestamp: 1000,
  pending_sync: true,
  active_entries: [
    {
      link: 'abc123',
      name: 'Some Game',
      end_timestamp: 9999999999,
      joined_at: 500,
      entered_after_leaving: false,
    },
  ],
}

const exMember: FlaggedExMember = {
  steam_id: '2',
  username: 'leftUser',
  profile_url: '/user/leftUser',
  left_at_timestamp: 2000,
  pending_sync: false,
  active_entries: [
    {
      link: 'def456',
      name: 'Another Game',
      end_timestamp: 9999999999,
      joined_at: 500,
      entered_after_leaving: false,
    },
  ],
}

describe('diffNewLinks', () => {
  it('includes a member with no state yet — every link is new', () => {
    const state: KickSyncAlertState = { alerted: {} }
    const pending = diffNewLinks([kickedMember], state)
    expect(pending).toEqual([{ member: kickedMember, newLinks: ['abc123'] }])
  })

  it('drops a member whose links were all already alerted on', () => {
    const state: KickSyncAlertState = { alerted: { '1': ['abc123'] } }
    expect(diffNewLinks([kickedMember], state)).toEqual([])
  })

  it('only reports links not already in state', () => {
    const twoLinkMember: FlaggedExMember = {
      ...kickedMember,
      active_entries: [
        ...kickedMember.active_entries,
        {
          link: 'newlink',
          name: 'New Game',
          end_timestamp: 9999999999,
          joined_at: 500,
          entered_after_leaving: false,
        },
      ],
    }
    const state: KickSyncAlertState = { alerted: { '1': ['abc123'] } }
    expect(diffNewLinks([twoLinkMember], state)).toEqual([
      { member: twoLinkMember, newLinks: ['newlink'] },
    ])
  })
})

describe('buildKickSyncAlertMessage', () => {
  it('labels a kicked-pending-sync member and a real ex-member differently', () => {
    const message = buildKickSyncAlertMessage([
      { member: kickedMember, newLinks: ['abc123'] },
      { member: exMember, newLinks: ['def456'] },
    ])
    expect(message).toContain('kickedUser')
    expect(message).toContain('kicked, not yet synced')
    expect(message).toContain('leftUser')
    expect(message).toContain('ex-member, already synced')
    expect(message).toContain('\n- <https://www.steamgifts.com/giveaway/abc123/>')
    expect(message).toContain('\n- <https://www.steamgifts.com/giveaway/def456/>')
  })

  it('explains what "new" means and separates member blocks with a blank line', () => {
    const message = buildKickSyncAlertMessage([
      { member: kickedMember, newLinks: ['abc123'] },
      { member: exMember, newLinks: ['def456'] },
    ])
    expect(message).toContain('"New" lists only entries not alerted on before')
    expect(message.split('\n\n')).toHaveLength(3)
  })
})
