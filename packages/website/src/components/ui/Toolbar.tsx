import * as React from 'react'
import { cn } from '@/lib/cn'

export function Toolbar({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-card-border bg-card-background p-3 shadow-sm',
        className,
      )}
      {...props}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-2">
        {children}
      </div>
    </div>
  )
}

export function ToolbarSection({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-wrap items-center gap-2', className)}
      {...props}
    >
      {children}
    </div>
  )
}
