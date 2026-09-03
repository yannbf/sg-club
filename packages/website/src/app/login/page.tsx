'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Lock } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { Card } from '@/components/ui/Card'
import { SteamSignInButton } from '@/components/SteamSignInButton'

/** A same-origin, relative path — anything else is ignored to avoid an open redirect. */
function safeNextPath(raw: string | null): string | null {
  if (!raw) return null
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  return raw
}

function LoginPageContent() {
  const router = useRouter()
  const { user, isReady } = useAuth()
  const searchParams = useSearchParams()
  const next = safeNextPath(searchParams.get('next')) ?? '/me/'
  const hasError = searchParams.get('error') === 'steam'

  useEffect(() => {
    if (isReady && user) {
      router.replace(next)
    }
  }, [isReady, user, next, router])

  return (
    <div className="mx-auto max-w-sm py-12">
      <Card className="p-6">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-card-background-hover">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="font-display text-xl font-semibold">Sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Use your Steam account. TGC members can view their own profile;
              admins get the admin pages.
            </p>
          </div>
        </div>

        {hasError && (
          <p className="mb-4 text-center text-sm text-error-foreground" role="alert">
            Steam sign-in failed or was cancelled. Try again.
          </p>
        )}

        <SteamSignInButton next={next} className="w-full" />
      </Card>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="h-64" aria-hidden />}>
      <LoginPageContent />
    </Suspense>
  )
}
