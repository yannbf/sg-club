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

type AuthContextValue = {
  user: SteamUser | null
  isAdmin: boolean
  isReady: boolean
  apiUnavailable: boolean
  loginWithSteam: (next?: string) => void
  logout: () => Promise<void>
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

  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
      localStorage.removeItem(LEGACY_ADMIN_SECRET_STORAGE_KEY)
    } catch {}

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

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    } catch {}
    setUser(null)
  }, [])

  const value: AuthContextValue = {
    user,
    isAdmin: user?.isAdmin ?? false,
    isReady,
    apiUnavailable,
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
      isReady: false,
      apiUnavailable: false,
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
