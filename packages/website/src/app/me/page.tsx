'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { UserX } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

export default function MePage() {
  const router = useRouter()
  const { user, isReady, logout } = useAuth()

  useEffect(() => {
    if (!isReady) return
    if (!user) {
      router.replace('/login/?next=%2Fme%2F')
      return
    }
    if (user.username && (user.isMember || user.isExMember)) {
      router.replace('/users/' + encodeURIComponent(user.username) + '/')
    }
  }, [isReady, user, router])

  if (!isReady || !user) {
    return <div className="h-64" aria-hidden />
  }

  if (user.username && (user.isMember || user.isExMember)) {
    return <div className="h-64" aria-hidden />
  }

  return (
    <div className="mx-auto max-w-sm py-12">
      <Card className="flex flex-col items-center gap-4 p-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-card-background-hover">
          <UserX className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <h2 className="font-display text-lg font-semibold">No profile to show</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Your Steam account isn&apos;t a member of The Giveaways Club, so
            there is no profile to show.
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => logout()}>
          Sign out
        </Button>
      </Card>
    </div>
  )
}
