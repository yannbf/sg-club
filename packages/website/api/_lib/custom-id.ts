// Encode/decode button + modal custom_ids for the challenge signup flow.
//
//   Button:  su|<slug>|<choice>|<deadlineEpoch>
//   Modal:   sg|<slug>|<choice>|<deadlineEpoch>
//
// choice is one of want|have|out. Discord caps custom_id at 100 chars, so
// slugs are validated at /challenge-setup time via validateSlugForCustomId.

export type SignupChoice = 'want' | 'have' | 'out'

export const SLUG_PATTERN = /^[a-z0-9-]{1,40}$/

const CUSTOM_ID_MAX_LENGTH = 100

function isSignupChoice(value: string): value is SignupChoice {
  return value === 'want' || value === 'have' || value === 'out'
}

export class CustomIdTooLongError extends Error {
  constructor(id: string) {
    super(`custom_id exceeds ${CUSTOM_ID_MAX_LENGTH} chars (${id.length}): ${id}`)
    this.name = 'CustomIdTooLongError'
  }
}

function assertLength(id: string): string {
  if (id.length > CUSTOM_ID_MAX_LENGTH) throw new CustomIdTooLongError(id)
  return id
}

export function encodeSignupCustomId(
  slug: string,
  choice: SignupChoice,
  deadlineEpoch: number
): string {
  return assertLength(`su|${slug}|${choice}|${deadlineEpoch}`)
}

export function encodeModalCustomId(
  slug: string,
  choice: SignupChoice,
  deadlineEpoch: number
): string {
  return assertLength(`sg|${slug}|${choice}|${deadlineEpoch}`)
}

export interface DecodedCustomId {
  kind: 'button' | 'modal'
  slug: string
  choice: SignupChoice
  deadlineEpoch: number
}

/** Tolerant decoder — returns null for anything that isn't a well-formed custom_id. */
export function decodeCustomId(customId: string): DecodedCustomId | null {
  const parts = customId.split('|')
  if (parts.length !== 4) return null
  const [prefix, slug, choice, deadlineStr] = parts
  if (prefix !== 'su' && prefix !== 'sg') return null
  if (!SLUG_PATTERN.test(slug)) return null
  if (!isSignupChoice(choice)) return null
  if (!/^\d+$/.test(deadlineStr)) return null
  const deadlineEpoch = Number(deadlineStr)
  if (!Number.isSafeInteger(deadlineEpoch)) return null

  return { kind: prefix === 'su' ? 'button' : 'modal', slug, choice, deadlineEpoch }
}

/**
 * Validates a slug is safe to embed in every custom_id the setup command
 * will generate. Returns a user-facing error string, or null if OK.
 */
export function validateSlugForCustomId(slug: string): string | null {
  if (!SLUG_PATTERN.test(slug)) {
    return 'Slug must be 1-40 lowercase letters, numbers, or hyphens.'
  }
  // Worst case: the 'have' choice (longest) + a 10-digit epoch.
  const worstCase = `sg|${slug}|have|9999999999`
  if (worstCase.length > CUSTOM_ID_MAX_LENGTH) {
    return 'Slug is too long once encoded into a Discord custom_id.'
  }
  return null
}
