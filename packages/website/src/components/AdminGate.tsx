'use client'

import Link from 'next/link'
import { Lock } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { Card } from '@/components/ui/Card'
import { buttonVariants } from '@/components/ui/Button'

export function AdminGate({ children }: { children: React.ReactNode }) {
  const { isAdmin, isReady } = useAuth()

  if (!isReady) {
    return <div className="h-64" aria-hidden />
  }

  if (!isAdmin) {
    return (
      <Card className="flex flex-col items-center gap-4 p-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-card-background-hover">
          <Lock className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <h2 className="font-display text-lg font-semibold">Admin only</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            This section contains member-sensitive information. Sign in as an
            admin to view it.
          </p>
        </div>
        <Link
          href="/login"
          className={buttonVariants({ variant: 'primary', size: 'sm' })}
        >
          Sign in
        </Link>
      </Card>
    )
  }

  return <>{children}</>
}
