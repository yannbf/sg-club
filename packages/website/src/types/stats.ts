import { Giveaway } from './index'

export interface GiveawayLeaver {
  joined_at_timestamp: string
  ga_link: string
  leave_detected_at: number
  time_difference_hours: number
  giveaway?: Giveaway
}
