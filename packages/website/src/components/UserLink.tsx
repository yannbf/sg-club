'use client'

import Link from 'next/link'
import { useIsAdmin } from '@/lib/auth'

interface Props
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  username: string
  children: React.ReactNode
}

export function steamGiftsProfile(username: string) {
  return `https://www.steamgifts.com/user/${encodeURIComponent(username)}`
}

export function UserLink({ username, children, ...rest }: Props) {
  const isAdmin = useIsAdmin()

  if (isAdmin) {
    return (
      <Link href={`/users/${username}`} {...rest}>
        {children}
      </Link>
    )
  }

  return (
    <a
      href={steamGiftsProfile(username)}
      target="_blank"
      rel="noopener noreferrer"
      {...rest}
    >
      {children}
    </a>
  )
}
