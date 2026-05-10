import * as React from 'react'
import { cn } from '@/lib/cn'

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md bg-card-background-hover',
        'after:absolute after:inset-0 after:-translate-x-full after:animate-shimmer',
        'after:bg-[linear-gradient(110deg,transparent_25%,color-mix(in_oklab,var(--card-border-strong)_55%,transparent)_50%,transparent_75%)]',
        'after:bg-[length:200%_100%]',
        className,
      )}
      {...props}
    />
  )
}
