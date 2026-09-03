'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Eye, Lock } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SteamSignInButton } from '@/components/SteamSignInButton'

export function ProfileGate({
  ownerSteamId,
  ownerUsername,
  children,
}: {
  ownerSteamId: string
  ownerUsername: string
  children: React.ReactNode
}) {
  const { user, isAdmin, isRealAdmin, isReady, apiUnavailable, viewAs, setViewAs } = useAuth()
  const pathname = usePathname() ?? '/'

  if (!isReady) {
    return <div className="h-64" aria-hidden />
  }

  const allowed = isAdmin || user?.steamId === ownerSteamId

  if (!allowed) {
    return (
      <Card className="flex flex-col items-center gap-4 p-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-card-background-hover">
          <Lock className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <h2 className="font-display text-lg font-semibold">Private profile</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            {user ? (
              <>
                You&apos;re signed in as {user.username ?? user.steamId}. You can
                only view your own profile.
              </>
            ) : (
              'This profile is private. Sign in with Steam to view your own profile.'
            )}
          </p>
          {apiUnavailable && !user && (
            <p className="max-w-sm text-xs text-muted-foreground">
              Steam sign-in only works on the deployed site.
            </p>
          )}
        </div>
        {user ? (
          user.username && (
            <Link
              href={`/users/${encodeURIComponent(user.username)}/`}
              className="text-sm text-accent underline-offset-4 hover:underline"
            >
              Go to your profile
            </Link>
          )
        ) : (
          <SteamSignInButton next={pathname} size="sm" />
        )}
      </Card>
    )
  }

  return (
    <>
      {isRealAdmin && !viewAs && (
        <div className="mb-3 flex justify-end">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setViewAs({ steamId: ownerSteamId, username: ownerUsername })}
            title="Render this page the way this member sees it"
          >
            <Eye className="h-3.5 w-3.5" />
            View as {ownerUsername}
          </Button>
        </div>
      )}
      {children}
    </>
  )
}
