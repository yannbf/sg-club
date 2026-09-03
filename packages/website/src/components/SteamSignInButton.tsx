'use client'

import { useAuth } from '@/lib/auth'
import { Button, buttonVariants, type ButtonProps } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { VariantProps } from 'class-variance-authority'

function SteamGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2C6.99 2 2.87 5.8 2.15 10.71l5.29 2.24a2.9 2.9 0 0 1 1.65-.51c.15 0 .3.01.44.03l2.34-3.44v-.05a3.87 3.87 0 0 1 3.86-3.87 3.88 3.88 0 0 1 3.87 3.87 3.88 3.88 0 0 1-3.87 3.87h-.09l-3.32 2.42c0 .12.02.25.02.38a2.9 2.9 0 0 1-2.9 2.9 2.9 2.9 0 0 1-2.87-2.5L2.5 14.5C3.79 18.83 7.53 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zM8.98 17.6l-1.21-.5a2.19 2.19 0 0 0 1.99 1.27 2.19 2.19 0 0 0 2.19-2.2c0-.28-.06-.55-.15-.79l-1.19-.49c-.1.4-.44.7-.85.7a.9.9 0 0 1-.78-.99zM17.5 9.06a2.58 2.58 0 0 0-2.58-2.58 2.58 2.58 0 0 0-2.58 2.58 2.58 2.58 0 0 0 2.58 2.58 2.58 2.58 0 0 0 2.58-2.58zm-4.51 0a1.93 1.93 0 1 1 3.86 0 1.93 1.93 0 0 1-3.86 0z" />
    </svg>
  )
}

type SteamSignInButtonProps = {
  next?: string
  className?: string
  size?: VariantProps<typeof buttonVariants>['size']
} & Omit<ButtonProps, 'size' | 'onClick'>

export function SteamSignInButton({
  next,
  className,
  size = 'md',
  variant = 'primary',
  ...props
}: SteamSignInButtonProps) {
  const { loginWithSteam } = useAuth()

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn('gap-2', className)}
      onClick={() => loginWithSteam(next)}
      {...props}
    >
      <SteamGlyph className="h-4 w-4" />
      Sign in with Steam
    </Button>
  )
}
