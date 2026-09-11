/**
 * Pre-paint auth hint: `<html data-auth-hint>` is stamped by an inline
 * script (see `authHintScript`) from the non-HttpOnly `sg_ui` cookie before
 * the header renders, so admin-only nav doesn't pop in after the
 * `/api/auth/me` fetch resolves. `AuthProvider` overwrites the attribute
 * once that fetch completes — this module's output is a hint, not a
 * source of truth; all real gating stays with the HttpOnly `sg_session`
 * cookie checked server-side.
 */

export const AUTH_HINT_ATTR = 'data-auth-hint'

/** sessionStorage key for the admin "view as a member" target; also used by `src/lib/auth.tsx`. */
export const VIEW_AS_STORAGE_KEY = 'sg-club-view-as'

/**
 * Plain ES5-safe JS for inline use in the root layout, before any bundled
 * script runs. Mirrors `decodeUiHintFlags` in `api/_lib/session.ts`: an
 * `sg_ui` cookie matching /^[0-9a-f]{17}$/ decodes to
 * `parseInt(v[16],16) ^ parseInt(v[0],16)`, where bit 1 (2) means admin.
 * An admin impersonating a member (see `VIEW_AS_STORAGE_KEY`) is shown the
 * member header, matching what `AuthProvider` renders once it takes over.
 */
export const authHintScript = `
(function () {
  try {
    var match = document.cookie.match(/(?:^|; )sg_ui=([^;]*)/);
    if (!match) return;
    var value = decodeURIComponent(match[1]);
    if (!/^[0-9a-f]{17}$/.test(value)) return;
    var flags = parseInt(value[16], 16) ^ parseInt(value[0], 16);
    if (!flags) return;
    var isAdmin = Boolean(flags & 2);
    if (isAdmin && sessionStorage.getItem('${VIEW_AS_STORAGE_KEY}') !== null) {
      isAdmin = false;
    }
    document.documentElement.setAttribute('${AUTH_HINT_ATTR}', isAdmin ? 'admin' : 'member');
  } catch (e) {}
})();
`

export function applyAuthHint(value: 'admin' | 'member' | null): void {
  if (value) {
    document.documentElement.setAttribute(AUTH_HINT_ATTR, value)
  } else {
    document.documentElement.removeAttribute(AUTH_HINT_ATTR)
  }
}
