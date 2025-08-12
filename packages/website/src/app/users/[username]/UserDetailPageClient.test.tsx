import { describe, it, expect, vi } from 'vitest'
import { generateWarningMessage } from './UserDetailPageClient'
import type { User, Giveaway, UserEntry } from '@/types'

// mock date so the test is deterministic
vi.useFakeTimers({
  now: new Date('2025-08-11').getTime(),
})

const baseUser = {
  'username': 'JohnDoe',
  'stats': {
    'total_sent_count': 18,
    'total_sent_value': 481.82,
    'total_received_count': 25,
    'total_received_value': 487.75,
    'total_gift_difference': -7,
    'total_value_difference': -5.93,
    'fcv_sent_count': 15,
    'rcv_sent_count': 3,
    'ncv_sent_count': 0,
    'fcv_received_count': 25,
    'rcv_received_count': 0,
    'ncv_received_count': 0,
    'fcv_gift_difference': -10,
    'real_total_sent_value': 414.1,
    'real_total_received_value': 487.7500000000001,
    'real_total_value_difference': -73.65,
    'real_total_sent_count': 15,
    'real_total_received_count': 25,
    'real_total_gift_difference': -10,
    'giveaway_ratio': 8.333333333333332,
    'shared_sent_count': 0,
    'shared_received_count': 0,
    'giveaways_created': 19,
    'giveaways_with_no_entries': 0,
    'last_giveaway_created_at': 1754662378,
    'last_giveaway_won_at': 1754665200,
    'total_achievements_percentage': 9,
    'average_achievements_percentage': 15,
    'real_total_achievements_percentage': 9,
    'real_average_achievements_percentage': 15,
    'has_missing_achievements_data': true
  },
  'steam_profile_is_private': false,
  'giveaways_won': [],
  'giveaways_created': [
    {
      'name': 'Sea of Stars',
      'link': 'osi3a/sea-of-stars',
      'cv_status': 'FULL_CV',
      'entries': 29,
      'copies': 1,
      'created_timestamp': 1754662378,
      'end_timestamp': 1755011460,
      'required_play': false,
      'is_shared': false
    }
  ]
} as unknown as User

describe('generateWarningMessage', () => {
  const requiredPlayGiveaway = {
    name: 'Test Game',
    link: 'abcde/test-game',
    creator: 'anotheruser',
    start_timestamp: 0,
    end_timestamp: Date.now() / 1000 + 3600,
    required_play: true,
    required_play_meta: {
      deadline_in_months: 2,
      requirements_met: false,
    },
  } as any

  const enteredGiveawayData: UserEntry[string] = [
    {
      link: 'abcde',
      joined_at: 1754816745,
    },
  ]

  const giveawaysWon = [
    {
      'name': 'Some game',
      'link': 'abcde/some-game',
      'end_timestamp': 1754665200,
      'required_play': true,
      'steam_play_data': {
        'playtime_minutes': 0,
        'playtime_formatted': '0 minutes',
        'achievements_unlocked': 0,
        'achievements_total': 17,
        'achievements_percentage': 0,
        'never_played': true,
        'is_playtime_private': false,
      },
      'required_play_meta': {
        'requirements_met': false,
        'deadline_in_months': 3
      }
    },
    {
      'name': 'Some other game',
      'link': 'fghij/some-other-game',
      'end_timestamp': 1754645200,
      'required_play': true,
      'steam_play_data': {
        'playtime_minutes': 0,
        'playtime_formatted': '0 minutes',
        'achievements_unlocked': 0,
        'achievements_total': 17,
        'achievements_percentage': 0,
        'never_played': true,
        'is_playtime_private': false,
      },
      'required_play_meta': {
        'requirements_met': false,
        'deadline_in_months': 3
      }
    },
  ]

  it('should return an empty string if there are no warnings', () => {
    const user = { ...baseUser }
    expect(generateWarningMessage(user, [], [])).toBe('')
  })

  it('should generate a message for unplayed_required_play_giveaways', () => {
    const user: User = {
      ...baseUser,
      warnings: ['unplayed_required_play_giveaways'],
      giveaways_won: [
        requiredPlayGiveaway,
        {...requiredPlayGiveaway, name: 'Some other game', link: 'fghij/some-other-game'},
      ],
    }
    expect(generateWarningMessage(user, [], [])).toMatchInlineSnapshot(`
      "Hi JohnDoe, this is a notice from The Giveaways Club.

      Please keep track of your PLAY REQUIRED giveaways. As per the rules, you are not allowed to enter any more PLAY REQUIRED giveaways if you have 2 unfulfilled PLAY REQUIRED wins:

      https://www.steamgifts.com/giveaway/abcde/test-game (61 days remaining for requirements: October 11, 2025)
      https://www.steamgifts.com/giveaway/fghij/some-other-game (61 days remaining for requirements: October 11, 2025)

      Please note the individual requirements for each giveaway won. If none are specified, then by default, we expect the game to be added into active rotation prior to the deadline.

      Please fulfill the giveaway requirements prior to joining any additional PLAY REQUIRED giveaways.

      Also do note that you have relatively low play rate within this group (0% - 0 out of 2 wins). While we don't require a 1:1 in this group, we are more stringent on ratios for lower play rate members."
    `)
  })

  it('should generate a message for illegal_entered_required_play_giveaways play giveaways', () => {
    const user: User = {
      ...baseUser,
      warnings: [
        'unplayed_required_play_giveaways',
        'illegal_entered_required_play_giveaways'
      ],
      giveaways_won: [
        requiredPlayGiveaway,
        {...requiredPlayGiveaway, name: 'Some other game', link: 'fghij/some-other-game'},
      ],
    }
    expect(generateWarningMessage(user, [
      {
        link: 'klmno/some-required-play-game',
        joined_at: new Date('2025-08-15').getTime() / 1000,
      },
    ], [{
      link: 'klmno/some-required-play-game',
      name: 'Some other game',
      end_timestamp: new Date('2025-08-15').getTime() / 1000,
      required_play: true,
    }] as any)).toMatchInlineSnapshot(`
      "Hi JohnDoe, this is a notice from The Giveaways Club.

      Please keep track of your PLAY REQUIRED giveaways. As per the rules, you are not allowed to enter any more PLAY REQUIRED giveaways if you have 2 unfulfilled PLAY REQUIRED wins:

      https://www.steamgifts.com/giveaway/abcde/test-game (61 days remaining for requirements: October 11, 2025)
      https://www.steamgifts.com/giveaway/fghij/some-other-game (61 days remaining for requirements: October 11, 2025)

      Please note the individual requirements for each giveaway won. If none are specified, then by default, we expect the game to be added into active rotation prior to the deadline.

      Please leave the following giveaways:
      https://www.steamgifts.com/giveaway/klmno/some-required-play-game

      Also do note that you have relatively low play rate within this group (0% - 0 out of 2 wins). While we don't require a 1:1 in this group, we are more stringent on ratios for lower play rate members."
    `)
  })

  it('should generate a message for illegal_entered_any_giveaways play giveaways', () => {
    const user: User = {
      ...baseUser,
      warnings: [
        'unplayed_required_play_giveaways',
        'illegal_entered_any_giveaways'
      ],
      giveaways_won: [
        requiredPlayGiveaway,
        {...requiredPlayGiveaway, name: 'Some other game', link: 'fghij/some-other-game'},
        {...requiredPlayGiveaway, name: 'Some other game', link: 'pqrst/yet-another-game'},
        { ...requiredPlayGiveaway, required_play: false, steam_play_data: {} },
        { ...requiredPlayGiveaway, required_play: false },
      ],
    }
    expect(generateWarningMessage(user,[
      {
        link: 'klmno/some-required-play-game',
        joined_at: new Date('2025-08-15').getTime() / 1000,
      },
      {
        link: 'pqrst/some-not-required-play-game',
        joined_at: new Date('2025-08-15').getTime() / 1000,
      },
    ], [{
      link: 'pqrst/some-not-required-play-game',
      name: 'Some other game',
      end_timestamp: new Date('2025-08-15').getTime() / 1000,
      required_play: true,
    }] as any)).toMatchInlineSnapshot(`
      "Hi JohnDoe, this is a notice from The Giveaways Club.

      Please keep track of your PLAY REQUIRED giveaways. As per the rules, you are not allowed to enter any more PLAY REQUIRED giveaways if you have 2 unfulfilled PLAY REQUIRED wins:

      https://www.steamgifts.com/giveaway/abcde/test-game (61 days remaining for requirements: October 11, 2025)
      https://www.steamgifts.com/giveaway/fghij/some-other-game (61 days remaining for requirements: October 11, 2025)
      https://www.steamgifts.com/giveaway/pqrst/yet-another-game (61 days remaining for requirements: October 11, 2025)

      Please note the individual requirements for each giveaway won. If none are specified, then by default, we expect the game to be added into active rotation prior to the deadline.

      As it seems that you have more than 2 unfulfilled PLAY REQUIRED wins, you are currently not allowed to enter **any** additional giveaways within the group. Once you are back down to 2 unfulfilled PLAY REQUIRED giveaways, you are allowed to join normal giveaways again but are still barred from joining PLAY REQUIRED until you only have 1 unfulfilled play required giveaway.

      Please leave the following giveaways:
      https://www.steamgifts.com/giveaway/pqrst/some-not-required-play-game

      Also do note that you have relatively low play rate within this group (20% - 1 out of 5 wins). While we don't require a 1:1 in this group, we are more stringent on ratios for lower play rate members."
    `)
  })
})
