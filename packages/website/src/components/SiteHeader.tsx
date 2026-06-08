'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  BarChart3,
  CalendarDays,
  Gamepad2,
  Gift,
  Heart,
  LogIn,
  LogOut,
  Menu,
  Shield,
  Users,
  X,
} from 'lucide-react'
import * as React from 'react'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/cn'

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  adminOnly?: boolean
}

const NAV: NavItem[] = [
  { href: '/', label: 'Overview', icon: BarChart3 },
  { href: '/games', label: 'Games', icon: Gamepad2 },
  { href: '/giveaways', label: 'Giveaways', icon: Gift },
  { href: '/events', label: 'Events', icon: CalendarDays },
  { href: '/wishlist', label: 'Wishlist', icon: Heart },
  { href: '/users', label: 'Users', icon: Users, adminOnly: true },
  { href: '/ex-members', label: 'Ex members', icon: LogOut, adminOnly: true },
  { href: '/stats', label: 'Leavers', icon: BarChart3, adminOnly: true },
  // Spring Cleaning is intentionally not listed — it's reachable only by URL
  // (/spring-cleaning), still behind the admin gate.
]

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(href + '/')
}

export function SiteHeader() {
  const pathname = usePathname() ?? '/'
  const [open, setOpen] = React.useState(false)
  const { isAdmin, isReady, logout } = useAuth()

  const visibleNav = NAV.filter((item) => !item.adminOnly || isAdmin)

  return (
    <header className="sticky top-0 z-40 w-full border-b border-card-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/65">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-4 px-4">
        <a
          href="https://www.steamgifts.com/group/WlYTQ/thegiveawaysclub"
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-shrink-0 items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md"
        >
          <Image
            width={32}
            height={32}
            src="https://avatars.fastly.steamstatic.com/13cc7998f870155897fd892086cfcee14670c978_full.jpg"
            alt="The Giveaways Club"
            className="h-8 w-8 rounded-full object-cover ring-1 ring-card-border"
          />
        </a>
        <Link
          href="/"
          className="hidden flex-shrink-0 text-sm font-semibold tracking-tight text-foreground md:block"
        >
          The Giveaways Club
        </Link>
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-foreground md:hidden"
        >
          TGC
        </Link>

        <nav className="ml-auto hidden items-center gap-1 lg:flex">
          {visibleNav.map((item) => {
            const active = isActive(pathname, item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'group inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors',
                  active
                    ? 'bg-card-background-hover text-foreground'
                    : 'text-muted-foreground hover:bg-card-background-hover hover:text-foreground',
                )}
              >
                <Icon
                  className={cn(
                    'h-4 w-4 transition-colors',
                    active ? 'text-primary-hi' : 'text-subtle group-hover:text-foreground',
                  )}
                />
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          {isReady &&
            (isAdmin ? (
              <button
                type="button"
                onClick={logout}
                title="Sign out of admin"
                className="hidden h-9 items-center gap-1.5 rounded-md border border-card-border bg-card-background px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-card-background-hover hover:text-foreground sm:inline-flex"
              >
                <Shield className="h-3.5 w-3.5 text-primary-hi" />
                Admin
                <LogOut className="h-3.5 w-3.5" />
              </button>
            ) : (
              <Link
                href="/login"
                className="hidden h-9 items-center gap-1.5 rounded-md border border-card-border bg-card-background px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-card-background-hover hover:text-foreground sm:inline-flex"
              >
                <LogIn className="h-3.5 w-3.5" />
                Sign in
              </Link>
            ))}
          <ThemeToggle />
          <button
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-card-border bg-card-background text-muted-foreground transition-colors hover:bg-card-background-hover hover:text-foreground lg:hidden"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Mobile nav */}
      <div
        className={cn(
          'overflow-hidden border-t border-card-border bg-card-background lg:hidden',
          open ? 'max-h-[28rem]' : 'max-h-0',
          'transition-[max-height] duration-200 ease-out',
        )}
      >
        <nav className="mx-auto flex max-w-screen-2xl flex-col gap-1 p-3">
          {visibleNav.map((item) => {
            const active = isActive(pathname, item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-card-background-hover text-foreground'
                    : 'text-muted-foreground hover:bg-card-background-hover hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}
          {isReady && (
            <div className="mt-2 border-t border-card-border pt-2">
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => {
                    logout()
                    setOpen(false)
                  }}
                  className="inline-flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-card-background-hover hover:text-foreground"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out of admin
                </button>
              ) : (
                <Link
                  href="/login"
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-card-background-hover hover:text-foreground"
                >
                  <LogIn className="h-4 w-4" />
                  Admin sign in
                </Link>
              )}
            </div>
          )}
        </nav>
      </div>
    </header>
  )
}
