'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'

const ADMIN_USERNAME_HASH =
  'f4c68ba2e61f090da58340b7ff657a533138351d448c99f0c1c4a0502fa3a546'
const ADMIN_PASSWORD_HASH =
  '6b837c7727e37dba3422039d85bef22205135c954844410f9b3ad6e7cc7c93b4'
const STORAGE_KEY = 'sg-club-admin'

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

type AuthContextValue = {
  isAdmin: boolean
  isReady: boolean
  login: (username: string, password: string) => Promise<boolean>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    try {
      setIsAdmin(localStorage.getItem(STORAGE_KEY) === '1')
    } catch {}
    setIsReady(true)
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const [userHash, passHash] = await Promise.all([
      sha256(username),
      sha256(password),
    ])
    if (userHash === ADMIN_USERNAME_HASH && passHash === ADMIN_PASSWORD_HASH) {
      try {
        localStorage.setItem(STORAGE_KEY, '1')
      } catch {}
      setIsAdmin(true)
      return true
    }
    return false
  }, [])

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {}
    setIsAdmin(false)
  }, [])

  return (
    <AuthContext.Provider value={{ isAdmin, isReady, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    return {
      isAdmin: false,
      isReady: false,
      login: async () => false,
      logout: () => {},
    }
  }
  return ctx
}

export function useIsAdmin(): boolean {
  return useAuth().isAdmin
}
