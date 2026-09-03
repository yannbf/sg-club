// Shared `next=` sanitizer for the Steam login/callback pair — both must
// agree on what counts as a safe same-origin redirect target.

export const DEFAULT_NEXT_PATH = '/me/'

/** Only same-origin, non-protocol-relative paths are allowed — anything else falls back to the default. */
export function sanitizeNextPath(next: string | null | undefined): string {
  if (!next) return DEFAULT_NEXT_PATH
  if (!next.startsWith('/')) return DEFAULT_NEXT_PATH
  if (next.startsWith('//')) return DEFAULT_NEXT_PATH
  if (next.includes('\\')) return DEFAULT_NEXT_PATH
  return next
}
