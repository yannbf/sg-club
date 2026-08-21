/**
 * Group membership classification shared by every chart/table that shows a
 * winner, creator, or member chip. Three kinds of people show up in the
 * data:
 *
 * - "member": in group_users.json (no badge).
 * - "ex-member": was a member and left — anyone in ex_members.json, plus any
 *   id/username with no record in either file that's attached to a
 *   non-shared, non-whitelist group giveaway. Winning or creating a
 *   group-only giveaway required being a member at the time, so an unknown
 *   id there predates ex-member tracking rather than never having been a
 *   member.
 * - "non-member": never a member — only possible on a shared/whitelist
 *   giveaway, whose audience extends outside the group entirely.
 */
export type PersonKind = 'member' | 'ex-member' | 'non-member'

export interface PersonClassifyContext {
  isCurrentMember: boolean
  isExMember: boolean
  /** True when the giveaway context is shared or whitelist (audience outside the group). */
  isSharedOrWhitelist: boolean
}

export function classifyPerson(ctx: PersonClassifyContext): PersonKind {
  if (ctx.isCurrentMember) return 'member'
  if (ctx.isExMember) return 'ex-member'
  return ctx.isSharedOrWhitelist ? 'non-member' : 'ex-member'
}

/** Badge text for a classified person — `undefined` for a current member (no badge shown). */
export function personBadgeText(kind: PersonKind): string | undefined {
  if (kind === 'member') return undefined
  return kind === 'ex-member' ? 'ex member' : 'non-member'
}
