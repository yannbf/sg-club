'use client'

import * as React from 'react'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/cn'

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => setMounted(true), [])

  const toggle = () => {
    if (!mounted) return
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  const icon = !mounted ? null : theme === 'dark' ? (
    <Moon className="h-4 w-4" />
  ) : (
    <Sun className="h-4 w-4" />
  )

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle theme"
      title={`Theme: ${mounted ? theme : 'dark'}`}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-md border border-card-border bg-card-background text-muted-foreground transition-colors hover:bg-card-background-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background cursor-pointer',
        className,
      )}
    >
      {icon}
    </button>
  )
}
