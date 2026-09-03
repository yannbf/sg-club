'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'

const LEGACY_STORAGE_KEY = 'sg-club-admin'
const LEGACY_ADMIN_SECRET_STORAGE_KEY = 'sg-club-admin-secret'

export type SteamUser = {
  steamId: string
  username: string | null
  avatarUrl: string | null
  isMember: boolean
  isExMember: boolean
  isAdmin: boolean
}

/** A member an admin is impersonating on screen, so the UI renders as that member would see it. */
export type ViewAs = { steamId: string; username: string; avatarUrl: string | null }

type AuthContextValue = {
  /** The effective user — the impersonated member while `viewAs` is set. */
  user: SteamUser | null
  /** Effective admin flag: false while impersonating, so admin-only UI hides. */
  isAdmin: boolean
  /** The signed-in admin's real status, unaffected by `viewAs`; gates the impersonation controls themselves. */
  isRealAdmin: boolean
  isReady: boolean
  apiUnavailable: boolean
  viewAs: ViewAs | null
  setViewAs: (target: ViewAs | null) => void
  loginWithSteam: (next?: string) => void
  logout: () => Promise<void>
}

const VIEW_AS_STORAGE_KEY = 'sg-club-view-as'

function readStoredViewAs(): ViewAs | null {
  try {
    const raw = sessionStorage.getItem(VIEW_AS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.steamId === 'string' && typeof parsed?.username === 'string') {
      return {
        steamId: parsed.steamId,
        username: parsed.username,
        avatarUrl: typeof parsed.avatarUrl === 'string' ? parsed.avatarUrl : null,
      }
    }
  } catch {}
  return null
}

const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * Synthesizes a signed-in user under `next dev`, where `/api/auth/*` doesn't
 * run (those functions are Vercel-only), so admin/profile pages stay
 * viewable locally. Controlled by three env vars, all optional:
 * - NEXT_PUBLIC_DEV_STEAM_ID: enables the fallback when set
 * - NEXT_PUBLIC_DEV_USERNAME: display name (defaults to null)
 * - NEXT_PUBLIC_DEV_ADMIN: '1' to also fake admin status
 */
function devFallbackUser(): SteamUser | null {
  if (process.env.NODE_ENV !== 'development') return null
  const steamId = process.env.NEXT_PUBLIC_DEV_STEAM_ID
  if (!steamId) return null
  return {
    steamId,
    username: process.env.NEXT_PUBLIC_DEV_USERNAME ?? null,
    avatarUrl: null,
    isMember: true,
    isExMember: false,
    isAdmin: process.env.NEXT_PUBLIC_DEV_ADMIN === '1',
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SteamUser | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [apiUnavailable, setApiUnavailable] = useState(false)
  const [viewAs, setViewAsState] = useState<ViewAs | null>(null)

  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
      localStorage.removeItem(LEGACY_ADMIN_SECRET_STORAGE_KEY)
    } catch {}
    setViewAsState(readStoredViewAs())

    let cancelled = false

    async function loadUser() {
      try {
        const res = await fetch('/api/auth/me', {
          credentials: 'same-origin',
          cache: 'no-store',
        })
        if (!res.ok) throw new Error(`Request failed (${res.status})`)
        const data = await res.json()
        if (cancelled) return
        setUser(data.user ?? null)
      } catch {
        if (cancelled) return
        setApiUnavailable(true)
        setUser(devFallbackUser())
      } finally {
        if (!cancelled) setIsReady(true)
      }
    }

    loadUser()
    return () => {
      cancelled = true
    }
  }, [])

  const loginWithSteam = useCallback((next?: string) => {
    const target = next ?? window.location.pathname
    window.location.assign('/api/auth/steam/login?next=' + encodeURIComponent(target))
  }, [])

  const setViewAs = useCallback((target: ViewAs | null) => {
    setViewAsState(target)
    try {
      if (target) sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify(target))
      else sessionStorage.removeItem(VIEW_AS_STORAGE_KEY)
    } catch {}
  }, [])

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    } catch {}
    setViewAs(null)
    setUser(null)
  }, [setViewAs])

  const isRealAdmin = user?.isAdmin ?? false
  // Impersonation is an admin-only lens; a stale stored target is ignored for
  // anyone else so a non-admin can never end up "viewing as" someone.
  const activeViewAs = isRealAdmin ? viewAs : null
  const effectiveUser: SteamUser | null = activeViewAs
    ? {
        steamId: activeViewAs.steamId,
        username: activeViewAs.username,
        avatarUrl: activeViewAs.avatarUrl,
        isMember: true,
        isExMember: false,
        isAdmin: false,
      }
    : user

  const value: AuthContextValue = {
    user: effectiveUser,
    isAdmin: effectiveUser?.isAdmin ?? false,
    isRealAdmin,
    isReady,
    apiUnavailable,
    viewAs: activeViewAs,
    setViewAs,
    loginWithSteam,
    logout,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    return {
      user: null,
      isAdmin: false,
      isRealAdmin: false,
      isReady: false,
      apiUnavailable: false,
      viewAs: null,
      setViewAs: () => {},
      loginWithSteam: () => {},
      logout: async () => {},
    }
  }
  return ctx
}

export function useIsAdmin(): boolean {
  return useAuth().isAdmin
}

export function useSteamUser(): SteamUser | null {
  return useAuth().user
}
